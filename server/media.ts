import type { IncomingMessage, ServerResponse } from 'node:http';
import { YoutubeTranscript } from 'youtube-transcript';
import yts from 'yt-search';
import { getDb } from './db';
import { getRequestUrl, readJsonBody, sendJson } from './httpUtils';
import { normalizeSubtitleCueTimings } from '../src/services/subtitleTiming';

const kanjiCache = new Map<string, any>();
const subCache = new Map<string, any[]>();
const searchCache = new Map<string, { ts: number; data: any }>();
const playlistCache = new Map<string, { ts: number; data: any }>();
const homeFeedCache = new Map<string, { ts: number; data: any }>();

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
  return {
    videoId: v.videoId,
    title: v.title || '',
    thumbnail: v.thumbnail || v.image || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
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
    thumbnail: pl.thumbnail || pl.image || '',
    videoCount: pl.videoCount || 0,
    author: pl.author?.name || '',
  };
}

async function fetchYtInitialData(pageUrl: string): Promise<any> {
  const resp = await fetch(pageUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8,vi;q=0.7',
    },
  });
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
    const clean = thumbs[thumbs.length - 1]?.url || thumbs[0]?.url;
    if (typeof clean === 'string' && clean.trim()) {
      return clean.startsWith('//') ? `https:${clean}` : clean;
    }
  }
  return fallbackVideoId ? `https://i.ytimg.com/vi/${fallbackVideoId}/mqdefault.jpg` : '';
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
        const lThumb =
          (Array.isArray(thumbSources) && thumbSources.length > 0 && thumbSources[0]?.url) ||
          `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;

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
      if (!seen.has(vid)) {
        seen.add(vid);
        const thumbs = pvr.thumbnail?.thumbnails;
        const thumb =
          (Array.isArray(thumbs) && thumbs.length > 0 && thumbs[thumbs.length - 1]?.url) ||
          `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
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
  const chunkSize = 35;
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += chunkSize) {
    chunks.push(texts.slice(i, i + chunkSize));
  }

  const chunkPromises = chunks.map(async (chunk) => {
    const combined = chunk.join('\n|||\n');
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=vi&dt=t&q=${encodeURIComponent(
        combined
      )}`;
      const res = await fetch(url);
      const data = await res.json();
      const fullTranslated = (data[0] || []).map((item: any) => item[0]).join('');
      const parts = fullTranslated.split(/\s*\|\|\|\s*/);
      const resChunk: string[] = [];
      for (let j = 0; j < chunk.length; j++) {
        resChunk.push((parts[j] || '').trim());
      }
      return resChunk;
    } catch {
      return chunk.map(() => '');
    }
  });

  const results = await Promise.all(chunkPromises);
  return results.flat();
}

export async function fetchFullYouTubeSubtitles(videoId: string) {
  if (!videoId) return [];
  if (subCache.has(videoId)) {
    return subCache.get(videoId)!;
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

  const jaTexts = validItems.map((item) => item.text.replace(/\n/g, ' ').trim());
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
  const epStr = String(ep).padStart(2, '0');
  const url = `https://akaiwa.tv/xem/${slug}/ep${epStr}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`Akaiwa series not found (${res.status})`);
  }

  const html = await res.text();
  const titleMatch = html.match(/seriesTitleVi\\*":\\*"([^"\\]+)/);
  const epMatch = html.match(/episodes\\*":\\*(\[.+?\])[,\}]/);

  let episodes: Array<{ ep_number: number; youtube_video_id: string; title: string | null }> = [];
  if (epMatch) {
    try {
      episodes = JSON.parse(epMatch[1].replace(/\\"/g, '"'));
    } catch (e) {
      console.warn('Failed parsing episodes json:', e);
    }
  }

  const currentEp = episodes.find((e) => e.ep_number === ep) || episodes[0];
  const videoId = currentEp?.youtube_video_id || '';

  let cues: any[] = [];
  if (videoId) {
    cues = await fetchFullYouTubeSubtitles(videoId);
  }

  return {
    title: titleMatch ? titleMatch[1] : slug,
    slug,
    currentEp: currentEp?.ep_number || ep,
    videoId,
    episodes,
    cues,
  };
}

function getStoredMnemonic(kanji: string) {
  const db = getDb();
  return db
    .prepare('SELECT kanji, han_viet, decomposition, mnemonic FROM kanji_mnemonics WHERE kanji = ?')
    .get(kanji) as
    | { kanji: string; han_viet: string; decomposition: string; mnemonic: string }
    | undefined;
}

export async function handleMediaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();
  const url = getRequestUrl(req);

  // 1. Akaiwa series & episodes proxy
  if (pathname === '/api/akaiwa' && method === 'GET') {
    const slug = url.searchParams.get('slug') || 'that-nghiep-chuyen-sinh';
    const ep = parseInt(url.searchParams.get('ep') || '1', 10);
    const data = await fetchAkaiwaSeries(slug, ep);
    sendJson(res, 200, data);
    return true;
  }

  // 2. YouTube original CC subtitles + parallel Vietnamese translation
  if (pathname === '/api/yt-subtitles' && method === 'GET') {
    const videoId = url.searchParams.get('v') || '';
    if (!videoId) {
      sendJson(res, 400, { error: 'Thiếu videoId', cues: [] });
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
    const body = await readJsonBody<{ texts?: string[] }>(req);
    const texts = Array.isArray(body.texts) ? body.texts.map((t) => String(t || '')) : [];
    const translations = await translateBatch(texts);
    sendJson(res, 200, { translations });
    return true;
  }

  // 4. YouTube in-app search (Videos + Playlists)
  if (pathname === '/api/yt-search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) {
      sendJson(res, 400, { error: 'Vui lòng nhập từ khóa tìm kiếm.', videos: [], playlists: [] });
      return true;
    }

    const cacheKey = q.toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
      sendJson(res, 200, cached.data);
      return true;
    }

    const result = await searchYouTubeNative(q);
    const payload = {
      query: q,
      videos: result.videos,
      playlists: result.playlists,
    };
    searchCache.set(cacheKey, { ts: Date.now(), data: payload });
    sendJson(res, 200, payload);
    return true;
  }

  // 5. YouTube Playlist fetcher (supports modern lockupViewModel + classic playlistVideoRenderer)
  if (pathname === '/api/yt-playlist' && method === 'GET') {
    const listId = (url.searchParams.get('list') || '').trim();
    if (!listId) {
      sendJson(res, 400, { error: 'Thiếu listId.' });
      return true;
    }

    const cached = playlistCache.get(listId);
    if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
      sendJson(res, 200, cached.data);
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
        const videos = (pl.videos || []).map((v: any, idx: number) => ({
          ep_number: idx + 1,
          videoId: v.videoId,
          title: v.title || `Video ${idx + 1}`,
          thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
          duration: v.duration?.timestamp || '',
          author: v.author?.name || '',
        }));
        payload = {
          listId: pl.listId || listId,
          title: pl.title || `Playlist (${listId})`,
          author: (pl as any).author?.name || '',
          thumbnail: pl.thumbnail || pl.image || videos[0]?.thumbnail || '',
          videos,
        };
      } catch (err: any) {
        sendJson(res, 502, {
          error: `Không tải được playlist (${err?.message || 'lỗi từ YouTube'}).`,
          videos: [],
        });
        return true;
      }
    }

    playlistCache.set(listId, { ts: Date.now(), data: payload });
    sendJson(res, 200, payload);
    return true;
  }

  // 5b. YouTube-style Home Feed by category topic (cached 15 min)
  if (pathname === '/api/yt-home' && method === 'GET') {
    const topicParam = (url.searchParams.get('topic') || 'all').trim();
    const topicKey = HOME_TOPIC_QUERIES[topicParam] ? topicParam : 'all';

    const cached = homeFeedCache.get(topicKey);
    if (cached && Date.now() - cached.ts < 15 * 60 * 1000) {
      sendJson(res, 200, cached.data);
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
    homeFeedCache.set(topicKey, { ts: Date.now(), data: payload });
    sendJson(res, 200, payload);
    return true;
  }

  // 6. Single YouTube Video Metadata fetcher
  if (pathname === '/api/yt-video' && method === 'GET') {
    const videoId = (url.searchParams.get('v') || '').trim();
    if (!videoId) {
      sendJson(res, 400, { error: 'Thiếu videoId.' });
      return true;
    }
    try {
      const v = await yts({ videoId });
      sendJson(res, 200, {
        videoId: v.videoId || videoId,
        title: v.title || `Video (${videoId})`,
        thumbnail: v.thumbnail || v.image || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
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
    const q = url.searchParams.get('q') || '';
    const type = url.searchParams.get('type') || 'kanji';
    if (!q) {
      sendJson(res, 400, { error: 'Missing query (q)' });
      return true;
    }

    const cacheKey = `${type}:${q}`;
    if (kanjiCache.has(cacheKey)) {
      const cached = kanjiCache.get(cacheKey);
      if (type === 'kanji') {
        const mn = getStoredMnemonic(cached.kanji || q);
        sendJson(res, 200, mn ? { ...cached, decomposition: mn.decomposition, mnemonic: mn.mnemonic } : cached);
      } else {
        sendJson(res, 200, cached);
      }
      return true;
    }

    if (type === 'word') {
      const mRes = await fetch('https://mazii.net/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dict: 'javi', type: 'word', query: q, page: 1 }),
      });
      const data = await mRes.json();
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
      const gRes = await fetch(gUrl);
      const gData = await gRes.json();
      const gMeaning = (gData[0] || []).map((item: any) => item[0]).join('').trim();
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

    const mRes = await fetch('https://mazii.net/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dict: 'javi', type: 'kanji', query: q, page: 1 }),
    });

    if (!mRes.ok) {
      throw new Error('Mazii API error');
    }

    const data = await mRes.json();
    const k = data?.results?.[0];
    if (!k) {
      sendJson(res, 200, { kanji: q, notFound: true });
      return true;
    }

    const storedMn = getStoredMnemonic(k.kanji || q);
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
    if (!kanji) {
      sendJson(res, 400, { error: 'Thiếu kanji.' });
      return true;
    }
    const row = getStoredMnemonic(kanji);
    sendJson(res, 200, { mnemonicData: row || null });
    return true;
  }

  if (pathname === '/api/kanji-mnemonic' && method === 'POST') {
    const body = await readJsonBody<{
      items?: Array<{
        kanji: string;
        hanViet?: string;
        decomposition: string;
        mnemonic: string;
      }>;
    }>(req);

    const items = Array.isArray(body.items) ? body.items : [];
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO kanji_mnemonics (kanji, han_viet, decomposition, mnemonic, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(kanji) DO UPDATE SET
        han_viet = CASE WHEN excluded.han_viet != '' THEN excluded.han_viet ELSE kanji_mnemonics.han_viet END,
        decomposition = excluded.decomposition,
        mnemonic = excluded.mnemonic,
        updated_at = CURRENT_TIMESTAMP
    `);

    for (const item of items) {
      const k = String(item.kanji || '').trim();
      const d = String(item.decomposition || '').trim();
      const m = String(item.mnemonic || '').trim();
      if (!k || (!d && !m)) continue;
      stmt.run(k, String(item.hanViet || '').trim().toUpperCase(), d, m);
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
