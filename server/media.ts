import type { IncomingMessage, ServerResponse } from 'node:http';
import { YoutubeTranscript } from 'youtube-transcript';
import yts from 'yt-search';
import { canPublishCommunitySub, getAuthUser } from './auth';
import { getDb } from './db';
import { getRequestUrl, readJsonBody, sendJson } from './httpUtils';
import {
  BoundedTtlCache,
  HttpError,
  SlidingWindowRateLimiter,
  enforceRateLimit,
  fetchWithTimeout,
  getClientIp,
  isSafeHttpUrl,
  isSingleKanji,
  isValidAkaiwaSlug,
  isValidYouTubePlaylistId,
  isValidYouTubeVideoId,
  sanitizeText,
} from './security';
import { normalizeSubtitleCueTimings } from '../src/services/subtitleTiming';

const kanjiCache = new BoundedTtlCache<string, any>(500, 60 * 60 * 1000);
const subCache = new BoundedTtlCache<string, any[]>(120, 30 * 60 * 1000);
const searchCache = new BoundedTtlCache<string, any>(200, 5 * 60 * 1000);
const playlistCache = new BoundedTtlCache<string, any>(200, 10 * 60 * 1000);
const homeFeedCache = new BoundedTtlCache<string, any>(32, 15 * 60 * 1000);

const translateRateLimiter = new SlidingWindowRateLimiter(40, 60 * 1000);
const mediaFetchLimiter = new SlidingWindowRateLimiter(90, 60 * 1000);
const mnemonicWriteLimiter = new SlidingWindowRateLimiter(30, 60 * 1000);

const HOME_TOPIC_QUERIES: Record<string, { label: string; queries: string[] }> = {
  all: {
    label: 'Tất cả',
    queries: [
      'Japanese anime Japanese subtitles',
      'Nihongo no Mori Japanese lesson',
      'Japanese vlog Japanese subtitles',
    ],
  },
  anime: {
    label: 'Anime học tiếng Nhật',
    queries: ['Anime tiếng Nhật vietsub playlist', 'Japanese anime with Japanese subtitles'],
  },
  jlpt_n5_n4: {
    label: 'JLPT N5 – N4',
    queries: ['JLPT N5 N4 listening conversation Japanese subtitles'],
  },
  jlpt_n3_n1: {
    label: 'JLPT N3 – N1',
    queries: ['Nihongo no Mori N3 N2', 'JLPT N3 listening Japanese subtitles'],
  },
  vlog: {
    label: 'Vlog & Đời sống Nhật',
    queries: ['Japanese daily vlog Japanese subtitles', 'Learn Japanese daily conversation'],
  },
  news: {
    label: 'Tin tức & Nghe hiểu',
    queries: ['NHK Easy News Japanese', 'Japanese podcast shadowing subtitles'],
  },
  music: {
    label: 'Âm nhạc Nhật',
    queries: ['Japanese anime ost lyrics kanji', 'J-pop Japanese lyrics vietsub'],
  },
};

function extractRunsText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node.content === 'string') return node.content;
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) {
    return node.runs.map((r: any) => r?.text || '').join('');
  }
  return '';
}

function mapYtsVideoItem(v: any) {
  const safeVid = isValidYouTubeVideoId(v?.videoId) ? v.videoId.trim() : '';
  const fallback = safeVid ? `https://i.ytimg.com/vi/${safeVid}/mqdefault.jpg` : '';
  return {
    videoId: safeVid,
    title: v.title || '',
    thumbnail: isSafeHttpUrl(v.thumbnail || v.image) || fallback,
    duration: v.timestamp || v.duration?.timestamp || '',
    seconds: v.seconds || v.duration?.seconds || 0,
    views: v.views || 0,
    ago: v.ago || '',
    author: v.author?.name || '',
  };
}

function mapYtsPlaylistItem(pl: any) {
  return {
    listId: pl.listId,
    title: pl.title || '',
    thumbnail: isSafeHttpUrl(pl.thumbnail || pl.image),
    videoCount: pl.videoCount || 0,
    author: pl.author?.name || '',
  };
}

async function fetchYtInitialData(pageUrl: string): Promise<any> {
  const resp = await fetchWithTimeout(
    pageUrl,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8,vi;q=0.7',
      },
    },
    12_000
  );
  if (!resp.ok) {
    throw new Error(`YouTube HTTP ${resp.status}`);
  }
  const html = await resp.text();
  const match = html.match(/var ytInitialData = (\{.+?\});\s*<\/script>/s);
  if (!match) {
    throw new Error('Không tìm thấy dữ liệu ytInitialData từ YouTube');
  }
  return JSON.parse(match[1]);
}

function parseDurationToSeconds(ts: string): number {
  const parts = ts.trim().split(':').map((n) => parseInt(n, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function parseCountNumber(raw: string): number {
  const digits = (raw || '').replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) || 0 : 0;
}

function pickThumbnailUrl(thumbs: any[], fallbackVideoId?: string): string {
  if (Array.isArray(thumbs) && thumbs.length > 0) {
    const safeUrl = isSafeHttpUrl(thumbs[thumbs.length - 1]?.url || thumbs[0]?.url);
    if (safeUrl) return safeUrl;
  }
  return fallbackVideoId && isValidYouTubeVideoId(fallbackVideoId)
    ? `https://i.ytimg.com/vi/${fallbackVideoId}/mqdefault.jpg`
    : '';
}

function extractOverlayBadgeText(overlays: any[]): string {
  for (const ov of overlays || []) {
    const badge =
      ov?.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]?.thumbnailBadgeViewModel?.text;
    if (typeof badge === 'string' && badge.trim()) {
      return badge.trim();
    }
  }
  return '';
}

async function searchYouTubeNative(q: string) {
  const data = await fetchYtInitialData(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en`
  );

  const seenVid = new Set<string>();
  const seenList = new Set<string>();
  const videos: any[] = [];
  const playlists: any[] = [];

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const vr = node.videoRenderer;
    if (vr && typeof vr.videoId === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(vr.videoId)) {
      const vid = vr.videoId;
      if (!seenVid.has(vid)) {
        seenVid.add(vid);
        const duration = extractRunsText(vr.lengthText);
        videos.push({
          videoId: vid,
          title: extractRunsText(vr.title) || `Video (${vid})`,
          thumbnail: pickThumbnailUrl(vr.thumbnail?.thumbnails, vid),
          duration,
          seconds: duration ? parseDurationToSeconds(duration) : 0,
          views: parseCountNumber(extractRunsText(vr.viewCountText)),
          ago: extractRunsText(vr.publishedTimeText),
          author: extractRunsText(vr.ownerText || vr.shortBylineText || vr.longBylineText),
        });
      }
      return;
    }

    const pr = node.playlistRenderer;
    if (pr && typeof pr.playlistId === 'string') {
      const listId = pr.playlistId;
      if (!seenList.has(listId)) {
        seenList.add(listId);
        playlists.push({
          listId,
          title: extractRunsText(pr.title) || `Playlist (${listId})`,
          thumbnail: pickThumbnailUrl(pr.thumbnails?.[0]?.thumbnails || pr.thumbnail?.thumbnails),
          videoCount: parseCountNumber(extractRunsText(pr.videoCountText)) || pr.videoCount || 0,
          author: extractRunsText(pr.shortBylineText || pr.longBylineText),
        });
      }
      return;
    }

    const lockup = node.lockupViewModel;
    if (lockup && typeof lockup.contentId === 'string') {
      const id = lockup.contentId;
      const lTitle = extractRunsText(lockup.metadata?.lockupMetadataViewModel?.title);
      const lAuthor = extractRunsText(
        lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel
          ?.metadataRows?.[0]?.metadataParts?.[0]?.text
      );
      const thumbVm =
        lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel ||
        lockup.contentImage?.thumbnailViewModel;
      const badge = extractOverlayBadgeText(thumbVm?.overlays || []);
      const thumbUrl = pickThumbnailUrl(
        thumbVm?.image?.sources || [],
        /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : undefined
      );

      if (
        lockup.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' ||
        id.startsWith('PL') ||
        id.startsWith('RD')
      ) {
        if (!seenList.has(id)) {
          seenList.add(id);
          playlists.push({
            listId: id,
            title: lTitle || `Playlist (${id})`,
            thumbnail: thumbUrl,
            videoCount: parseCountNumber(badge),
            author: lAuthor,
          });
        }
      } else if (/^[a-zA-Z0-9_-]{11}$/.test(id) && !seenVid.has(id)) {
        seenVid.add(id);
        videos.push({
          videoId: id,
          title: lTitle || `Video (${id})`,
          thumbnail: thumbUrl,
          duration: badge,
          seconds: badge ? parseDurationToSeconds(badge) : 0,
          views: 0,
          ago: '',
          author: lAuthor,
        });
      }
      return;
    }

    for (const val of Object.values(node)) {
      if (val && typeof val === 'object') walk(val);
    }
  };

  walk(data);

  if (videos.length === 0 && playlists.length === 0) {
    const result = await yts(q);
    return {
      videos: (result.videos || []).slice(0, 24).map(mapYtsVideoItem),
      playlists: (result.playlists || []).slice(0, 12).map(mapYtsPlaylistItem),
    };
  }

  return {
    videos: videos.slice(0, 24),
    playlists: playlists.slice(0, 12),
  };
}

async function fetchPlaylistNative(listId: string) {
  const data = await fetchYtInitialData(
    `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}&hl=en`
  );

  const title =
    extractRunsText(data?.metadata?.playlistMetadataRenderer?.title) ||
    extractRunsText(data?.header?.playlistHeaderRenderer?.title) ||
    extractRunsText(data?.header?.pageHeaderRenderer?.pageTitle) ||
    `Playlist (${listId})`;

  const author =
    extractRunsText(data?.header?.playlistHeaderRenderer?.ownerText) ||
    extractRunsText(
      data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.metadata
        ?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text
    ) ||
    '';

  const seen = new Set<string>();
  const videos: Array<{
    ep_number: number;
    videoId: string;
    title: string;
    thumbnail: string;
    duration: string;
    author: string;
  }> = [];

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    // Modern YouTube playlist renderer (lockupViewModel)
    const lockup = node.lockupViewModel;
    if (lockup && lockup.contentId && typeof lockup.contentId === 'string') {
      const vid = lockup.contentId;
      if (!seen.has(vid) && /^[a-zA-Z0-9_-]{11}$/.test(vid)) {
        seen.add(vid);
        const lTitle =
          extractRunsText(lockup.metadata?.lockupMetadataViewModel?.title) ||
          `Video ${videos.length + 1}`;
        const lAuthor = extractRunsText(
          lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel
            ?.metadataRows?.[0]?.metadataParts?.[0]?.text
        );
        const overlays = lockup.contentImage?.thumbnailViewModel?.overlays || [];
        let lDuration = '';
        for (const ov of overlays) {
          const badge =
            ov?.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]?.thumbnailBadgeViewModel
              ?.text;
          if (typeof badge === 'string' && badge.trim()) {
            lDuration = badge.trim();
            break;
          }
        }
        const thumbSources = lockup.contentImage?.thumbnailViewModel?.image?.sources;
        const lThumb = pickThumbnailUrl(thumbSources || [], vid);

        videos.push({
          ep_number: videos.length + 1,
          videoId: vid,
          title: lTitle,
          thumbnail: lThumb,
          duration: lDuration,
          author: lAuthor || author,
        });
      }
      return;
    }

    // Classic playlistVideoRenderer / playlistPanelVideoRenderer
    const pvr = node.playlistVideoRenderer || node.playlistPanelVideoRenderer;
    if (pvr && pvr.videoId && typeof pvr.videoId === 'string') {
      const vid = pvr.videoId;
      if (!seen.has(vid) && isValidYouTubeVideoId(vid)) {
        seen.add(vid);
        const thumbs = pvr.thumbnail?.thumbnails;
        const thumb = pickThumbnailUrl(thumbs || [], vid);
        videos.push({
          ep_number: videos.length + 1,
          videoId: vid,
          title: extractRunsText(pvr.title) || `Video ${videos.length + 1}`,
          thumbnail: thumb,
          duration: extractRunsText(pvr.lengthText),
          author: extractRunsText(pvr.shortBylineText) || author,
        });
      }
      return;
    }

    for (const val of Object.values(node)) {
      if (val && typeof val === 'object') walk(val);
    }
  };

  walk(data);

  return {
    listId,
    title,
    author,
    thumbnail: videos[0]?.thumbnail || '',
    videos,
  };
}

export async function translateBatch(texts: string[]): Promise<string[]> {
  if (!texts.length) return [];
  const boundedTexts = texts.slice(0, 200).map((t) => sanitizeText(t, 500));
  const chunkSize = 35;
  const chunks: string[][] = [];
  for (let i = 0; i < boundedTexts.length; i += chunkSize) {
    chunks.push(boundedTexts.slice(i, i + chunkSize));
  }

  const results: string[][] = new Array(chunks.length);
  const maxConcurrency = 4;
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < chunks.length) {
      const currentIdx = nextIdx++;
      const chunk = chunks[currentIdx];
      const combined = chunk.join('\n|||\n');
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=vi&dt=t&q=${encodeURIComponent(
          combined
        )}`;
        const res = await fetchWithTimeout(url, {}, 10_000);
        const data = await res.json();
        const fullTranslated = (data[0] || []).map((item: any) => item[0]).join('');
        const parts = fullTranslated.split(/\s*\|\|\|\s*/);
        const resChunk: string[] = [];
        for (let j = 0; j < chunk.length; j++) {
          resChunk.push(sanitizeText(parts[j] || '', 800));
        }
        results[currentIdx] = resChunk;
      } catch {
        results[currentIdx] = chunk.map(() => '');
      }
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrency, chunks.length) }, () => worker());
  await Promise.all(workers);
  return results.flat();
}

export async function fetchFullYouTubeSubtitles(videoId: string) {
  if (!isValidYouTubeVideoId(videoId)) return [];
  const cached = subCache.get(videoId);
  if (cached) {
    return cached;
  }

  let list: any[] = [];
  try {
    list = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ja' });
  } catch {
    try {
      list = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (e: any) {
      console.warn(`[YouTubeSubtitles] Failed fetching transcript for ${videoId}:`, e?.message);
    }
  }

  if (!list || !list.length) {
    return [];
  }

  const validItems = list
    .filter((item) => item.text && item.text.trim().length > 0)
    .sort((a, b) => Number(a.offset || 0) - Number(b.offset || 0));

  // youtube-transcript returns integer ms for srv3 (<p t="ms" d="ms">),
  // but float seconds for classic XML (<text start="s" dur="s">).
  const hasNonInt = validItems.some(
    (it) => !Number.isInteger(Number(it.offset)) || !Number.isInteger(Number(it.duration))
  );
  const durs = validItems
    .map((it) => Number(it.duration) || 0)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const medianDur = durs.length > 0 ? durs[Math.floor(durs.length / 2)] : 0;
  const isMilliseconds = !hasNonInt && medianDur >= 100;
  const unitScale = isMilliseconds ? 1000 : 1;

  const jaTexts = validItems.map((item) => sanitizeText(String(item.text).replace(/\n/g, ' '), 500));
  const viTexts = await translateBatch(jaTexts);

  const cues = validItems.map((item, idx) => {
    const start = Math.max(0, Number(item.offset) / unitScale);
    const rawEnd = Math.max(start, (Number(item.offset) + Number(item.duration)) / unitScale);
    return {
      id: `${item.offset}-${idx}`,
      start,
      end: rawEnd,
      ja: jaTexts[idx],
      vi: viTexts[idx] || undefined,
    };
  });

  const normalizedCues = normalizeSubtitleCueTimings(cues);

  subCache.set(videoId, normalizedCues);
  return normalizedCues;
}

export async function fetchAkaiwaSeries(slug: string, ep: number = 1) {
  if (!isValidAkaiwaSlug(slug)) {
    throw new HttpError(400, 'Slug Anime không hợp lệ.');
  }
  const safeEp = Number.isFinite(ep) ? Math.max(1, Math.min(2000, Math.floor(ep))) : 1;
  const epStr = String(safeEp).padStart(2, '0');
  const url = `https://akaiwa.tv/xem/${encodeURIComponent(slug.trim())}/ep${epStr}`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    },
    12_000
  );

  if (!res.ok) {
    throw new HttpError(404, `Akaiwa series not found (${res.status})`);
  }

  const html = await res.text();
  const titleMatch = html.match(/seriesTitleVi\\*":\\*"([^"\\]+)/);
  const epMatch = html.match(/episodes\\*":\\*(\[.+?\])[,\}]/);

  let episodes: Array<{ ep_number: number; youtube_video_id: string; title: string | null }> = [];
  if (epMatch) {
    try {
      const parsedEps = JSON.parse(epMatch[1].replace(/\\"/g, '"'));
      if (Array.isArray(parsedEps)) {
        episodes = parsedEps.filter(
          (item: any) => item && typeof item === 'object' && isValidYouTubeVideoId(item.youtube_video_id)
        );
      }
    } catch (e) {
      console.warn('Failed parsing episodes json:', e);
    }
  }

  const currentEp = episodes.find((e) => e.ep_number === safeEp) || episodes[0];
  const videoId = currentEp && isValidYouTubeVideoId(currentEp.youtube_video_id) ? currentEp.youtube_video_id : '';

  let cues: any[] = [];
  if (videoId) {
    cues = await fetchFullYouTubeSubtitles(videoId);
  }

  return {
    title: titleMatch ? sanitizeText(titleMatch[1], 200) : slug,
    slug: slug.trim(),
    currentEp: currentEp?.ep_number || safeEp,
    videoId,
    episodes,
    cues,
  };
}

async function getStoredMnemonic(kanji: string) {
  const db = await getDb();
  return db.queryOne<{ kanji: string; han_viet: string; decomposition: string; mnemonic: string }>(
    `SELECT kanji, han_viet, decomposition, mnemonic FROM ${db.table('kanji_mnemonics')} WHERE kanji = ?`,
    [kanji]
  );
}

export async function handleMediaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();
  const url = getRequestUrl(req);
  const clientIp = getClientIp(req);

  // 1. Akaiwa series & episodes proxy
  if (pathname === '/api/akaiwa' && method === 'GET') {
    if (!enforceRateLimit(mediaFetchLimiter, `media:${clientIp}`, res)) return true;
    const slug = (url.searchParams.get('slug') || 'that-nghiep-chuyen-sinh').trim();
    if (!isValidAkaiwaSlug(slug)) {
      sendJson(res, 400, { error: 'Slug Anime không hợp lệ.' });
      return true;
    }
    const rawEp = Number(url.searchParams.get('ep') || '1');
    const ep = Number.isFinite(rawEp) ? Math.max(1, Math.min(2000, Math.floor(rawEp))) : 1;
    const data = await fetchAkaiwaSeries(slug, ep);
    sendJson(res, 200, data);
    return true;
  }

  // 2. YouTube original CC subtitles + parallel Vietnamese translation
  if (pathname === '/api/yt-subtitles' && method === 'GET') {
    if (!enforceRateLimit(mediaFetchLimiter, `media:${clientIp}`, res)) return true;
    const videoId = (url.searchParams.get('v') || '').trim();
    if (!isValidYouTubeVideoId(videoId)) {
      sendJson(res, 400, { error: 'videoId không hợp lệ.', cues: [] });
      return true;
    }
    const cues = await fetchFullYouTubeSubtitles(videoId);
    if (!cues || !cues.length) {
      sendJson(res, 200, {
        cues: [],
        error:
          'Video YouTube này không có phụ đề (CC). Hãy nạp file .SRT/.VTT hoặc chọn video khác.',
      });
      return true;
    }
    sendJson(res, 200, { cues });
    return true;
  }

  // 3. Batch Japanese -> Vietnamese translation for AI merged / uploaded subtitles
  if (pathname === '/api/translate-batch' && method === 'POST') {
    if (!enforceRateLimit(translateRateLimiter, `tr:${clientIp}`, res)) return true;
    const body = await readJsonBody<{ texts?: unknown[] }>(req, 256 * 1024);
    if (!Array.isArray(body.texts)) {
      sendJson(res, 400, { error: 'Trường texts phải là một mảng.' });
      return true;
    }
    if (body.texts.length > 200) {
      sendJson(res, 400, { error: 'Mỗi lượt dịch tối đa 200 câu.' });
      return true;
    }
    const texts = body.texts.map((t) => sanitizeText(t, 500));
    const translations = await translateBatch(texts);
    sendJson(res, 200, { translations });
    return true;
  }

  // 4. YouTube in-app search (Videos + Playlists)
  if (pathname === '/api/yt-search' && method === 'GET') {
    if (!enforceRateLimit(mediaFetchLimiter, `media:${clientIp}`, res)) return true;
    const q = sanitizeText(url.searchParams.get('q') || '', 120);
    if (!q) {
      sendJson(res, 400, { error: 'Vui lòng nhập từ khóa tìm kiếm hợp lệ.', videos: [], playlists: [] });
      return true;
    }

    const cacheKey = q.toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached) {
      sendJson(res, 200, cached);
      return true;
    }

    const result = await searchYouTubeNative(q);
    const payload = {
      query: q,
      videos: result.videos,
      playlists: result.playlists,
    };
    searchCache.set(cacheKey, payload);
    sendJson(res, 200, payload);
    return true;
  }

  // 5. YouTube Playlist fetcher (supports modern lockupViewModel + classic playlistVideoRenderer)
  if (pathname === '/api/yt-playlist' && method === 'GET') {
    if (!enforceRateLimit(mediaFetchLimiter, `media:${clientIp}`, res)) return true;
    const listId = (url.searchParams.get('list') || '').trim();
    if (!isValidYouTubePlaylistId(listId)) {
      sendJson(res, 400, { error: 'listId không hợp lệ.' });
      return true;
    }

    const cached = playlistCache.get(listId);
    if (cached) {
      sendJson(res, 200, cached);
      return true;
    }

    let payload: any = null;
    try {
      const nativePl = await fetchPlaylistNative(listId);
      if (nativePl.videos.length > 0) {
        payload = nativePl;
      }
    } catch {
      // Fallback below
    }

    if (!payload) {
      try {
        const pl = await yts({ listId });
        const videos = (pl.videos || [])
          .filter((v: any) => isValidYouTubeVideoId(v?.videoId))
          .map((v: any, idx: number) => ({
            ep_number: idx + 1,
            videoId: v.videoId,
            title: v.title || `Video ${idx + 1}`,
            thumbnail:
              isSafeHttpUrl(v.thumbnail) ||
              `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
            duration: v.duration?.timestamp || '',
            author: v.author?.name || '',
          }));
        payload = {
          listId: pl.listId || listId,
          title: pl.title || `Playlist (${listId})`,
          author: (pl as any).author?.name || '',
          thumbnail:
            isSafeHttpUrl(pl.thumbnail || pl.image) || videos[0]?.thumbnail || '',
          videos,
        };
      } catch (err: any) {
        console.warn(`[PlaylistFallback] Failed loading ${listId}:`, err?.message);
        sendJson(res, 502, {
          error: 'Không tải được playlist từ YouTube.',
          videos: [],
        });
        return true;
      }
    }

    playlistCache.set(listId, payload);
    sendJson(res, 200, payload);
    return true;
  }

  // 5b. YouTube-style Home Feed by category topic (cached 15 min)
  if (pathname === '/api/yt-home' && method === 'GET') {
    if (!enforceRateLimit(mediaFetchLimiter, `media:${clientIp}`, res)) return true;
    const topicParam = (url.searchParams.get('topic') || 'all').trim();
    const topicKey = HOME_TOPIC_QUERIES[topicParam] ? topicParam : 'all';

    const cached = homeFeedCache.get(topicKey);
    if (cached) {
      sendJson(res, 200, cached);
      return true;
    }

    const topicCfg = HOME_TOPIC_QUERIES[topicKey];
    const results = await Promise.all(
      topicCfg.queries.map((q) => searchYouTubeNative(q).catch(() => ({ videos: [], playlists: [] })))
    );

    const seenVid = new Set<string>();
    const seenList = new Set<string>();
    const videos: any[] = [];
    const playlists: any[] = [];

    for (const r of results) {
      for (const v of r.videos || []) {
        if (!v?.videoId || seenVid.has(v.videoId)) continue;
        seenVid.add(v.videoId);
        videos.push(v);
        if (videos.length >= 24) break;
      }
      for (const pl of r.playlists || []) {
        if (!pl?.listId || seenList.has(pl.listId)) continue;
        seenList.add(pl.listId);
        playlists.push(pl);
        if (playlists.length >= 8) break;
      }
    }

    const payload = {
      topic: topicKey,
      label: topicCfg.label,
      categories: Object.entries(HOME_TOPIC_QUERIES).map(([id, cfg]) => ({
        id,
        label: cfg.label,
      })),
      videos: videos.slice(0, 24),
      playlists: playlists.slice(0, 8),
    };
    homeFeedCache.set(topicKey, payload);
    sendJson(res, 200, payload);
    return true;
  }

  // 6. Single YouTube Video Metadata fetcher
  if (pathname === '/api/yt-video' && method === 'GET') {
    if (!enforceRateLimit(mediaFetchLimiter, `media:${clientIp}`, res)) return true;
    const videoId = (url.searchParams.get('v') || '').trim();
    if (!isValidYouTubeVideoId(videoId)) {
      sendJson(res, 400, { error: 'videoId không hợp lệ.' });
      return true;
    }
    try {
      const v = await yts({ videoId });
      sendJson(res, 200, {
        videoId: isValidYouTubeVideoId(v.videoId) ? v.videoId : videoId,
        title: v.title || `Video (${videoId})`,
        thumbnail:
          isSafeHttpUrl(v.thumbnail || v.image) ||
          `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        duration: v.timestamp || '',
        author: v.author?.name || '',
      });
    } catch {
      sendJson(res, 200, {
        videoId,
        title: `Video (${videoId})`,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        duration: '',
        author: '',
      });
    }
    return true;
  }

  // 7. Kanji & Word Dictionary API (Mazii proxy + cached mnemonic)
  if (pathname === '/api/kanji' && method === 'GET') {
    if (!enforceRateLimit(mediaFetchLimiter, `media:${clientIp}`, res)) return true;
    const q = sanitizeText(url.searchParams.get('q') || '', 64);
    const type = (url.searchParams.get('type') || 'kanji').trim();
    if (!q || !['kanji', 'word'].includes(type)) {
      sendJson(res, 400, { error: 'Tham số tra cứu q hoặc type không hợp lệ.' });
      return true;
    }
    if (type === 'kanji' && !isSingleKanji(q)) {
      sendJson(res, 400, { error: 'Tra cứu Kanji yêu cầu đúng 1 chữ Hán.' });
      return true;
    }

    const cacheKey = `${type}:${q}`;
    const cached = kanjiCache.get(cacheKey);
    if (cached) {
      if (type === 'kanji') {
        const mn = await getStoredMnemonic(cached.kanji || q);
        sendJson(res, 200, mn ? { ...cached, decomposition: mn.decomposition, mnemonic: mn.mnemonic } : cached);
      } else {
        sendJson(res, 200, cached);
      }
      return true;
    }

    if (type === 'word') {
      const mRes = await fetchWithTimeout(
        'https://mazii.net/api/search',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dict: 'javi', type: 'word', query: q, page: 1 }),
        },
        10_000
      );
      const data = mRes.ok ? await mRes.json() : null;
      const w = data?.data?.[0];
      if (w && w.means?.length) {
        const result = {
          type: 'word',
          word: w.word || q,
          reading: w.phonetic || '',
          meanings: (w.means || []).map((m: any) => ({
            kind: m.kind || '',
            mean: m.mean || '',
            examples: (m.examples || []).slice(0, 2),
          })),
        };
        kanjiCache.set(cacheKey, result);
        sendJson(res, 200, result);
        return true;
      }

      const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=vi&dt=t&q=${encodeURIComponent(
        q
      )}`;
      const gRes = await fetchWithTimeout(gUrl, {}, 10_000);
      const gData = gRes.ok ? await gRes.json() : null;
      const gMeaning = (gData?.[0] || []).map((item: any) => item[0]).join('').trim();
      if (gMeaning) {
        const result = {
          type: 'word',
          word: q,
          reading: '',
          meanings: [{ kind: 'cụm từ / thành ngữ', mean: gMeaning }],
        };
        kanjiCache.set(cacheKey, result);
        sendJson(res, 200, result);
        return true;
      }

      sendJson(res, 200, { query: q, notFound: true });
      return true;
    }

    const mRes = await fetchWithTimeout(
      'https://mazii.net/api/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dict: 'javi', type: 'kanji', query: q, page: 1 }),
      },
      10_000
    );

    if (!mRes.ok) {
      throw new HttpError(502, 'Mazii API tạm thời không phản hồi.');
    }

    const data = await mRes.json();
    const k = data?.results?.[0];
    if (!k) {
      sendJson(res, 200, { kanji: q, notFound: true });
      return true;
    }

    const storedMn = await getStoredMnemonic(k.kanji || q);
    const result = {
      type: 'kanji',
      kanji: k.kanji || q,
      hanViet: (k.mean || '').toUpperCase(),
      meaning: (k.detail || '').split('\n')[0].replace(/^VD:.*/, '').trim(),
      fullDetail: k.detail || '',
      on: k.on || '',
      kun: k.kun || '',
      jlpt: k.level?.[0] || '',
      strokes: k.stroke_count || '',
      compDetail: k.compDetail || [],
      decomposition: storedMn?.decomposition || undefined,
      mnemonic: storedMn?.mnemonic || undefined,
    };

    kanjiCache.set(cacheKey, result);
    sendJson(res, 200, result);
    return true;
  }

  // 8. Kanji Mnemonic Shared Cache (stores AI breakdown & mnemonic for instant reuse)
  if (pathname === '/api/kanji-mnemonic' && method === 'GET') {
    const kanji = (url.searchParams.get('kanji') || '').trim();
    if (!isSingleKanji(kanji)) {
      sendJson(res, 400, { error: 'Tham số kanji phải là đúng 1 chữ Hán hợp lệ.' });
      return true;
    }
    const row = await getStoredMnemonic(kanji);
    sendJson(res, 200, { mnemonicData: row || null });
    return true;
  }

  if (pathname === '/api/kanji-mnemonic' && method === 'POST') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Vui lòng đăng nhập để đóng góp bộ nhớ Kanji.' });
      return true;
    }
    if (!enforceRateLimit(mnemonicWriteLimiter, `mn:${clientIp}:${user.id}`, res)) {
      return true;
    }

    const body = await readJsonBody<{
      items?: Array<{
        kanji?: unknown;
        hanViet?: unknown;
        decomposition?: unknown;
        mnemonic?: unknown;
      }>;
    }>(req, 32 * 1024);

    if (!Array.isArray(body.items) || body.items.length === 0) {
      sendJson(res, 400, { error: 'Danh sách items không hợp lệ.' });
      return true;
    }
    if (body.items.length > 24) {
      sendJson(res, 400, { error: 'Tối đa 24 chữ Kanji mỗi lần lưu.' });
      return true;
    }

    const db = await getDb();
    const mnemonicsTable = db.table('kanji_mnemonics');
    const isPrivileged = canPublishCommunitySub(user);
    // Regular users may only populate missing mnemonics (prevents overwriting shared cache)
    const upsertSql = isPrivileged
      ? `INSERT INTO ${mnemonicsTable} (kanji, han_viet, decomposition, mnemonic, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(kanji) DO UPDATE SET
           han_viet = CASE WHEN excluded.han_viet != '' THEN excluded.han_viet ELSE ${mnemonicsTable}.han_viet END,
           decomposition = excluded.decomposition,
           mnemonic = excluded.mnemonic,
           updated_at = CURRENT_TIMESTAMP`
      : `INSERT INTO ${mnemonicsTable} (kanji, han_viet, decomposition, mnemonic, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(kanji) DO NOTHING`;

    let savedCount = 0;
    for (const item of body.items) {
      if (!item || typeof item !== 'object') continue;
      const k = typeof item.kanji === 'string' ? item.kanji.trim() : '';
      if (!isSingleKanji(k)) continue;
      const d = sanitizeText(item.decomposition || '', 400);
      const m = sanitizeText(item.mnemonic || '', 500);
      if (!d && !m) continue;
      const hv = sanitizeText(item.hanViet || '', 64).toUpperCase();
      await db.execute(upsertSql, [k, hv, d, m]);
      savedCount++;
    }

    if (savedCount === 0) {
      sendJson(res, 400, { error: 'Không có mục Kanji hợp lệ để lưu.' });
      return true;
    }

    sendJson(res, 200, { ok: true, savedCount });
    return true;
  }

  return false;
}
