import { SubtitleCue, PlaylistItem } from '../types';
import { fetchYouTubePlaylistApi, fetchYouTubeVideoApi, resolveApiUrl } from './api';
import {
  findActiveSubtitleCue,
  findCueAtOrBeforeTime,
  isNonSpeechTagCue,
  normalizeSubtitleCueTimings,
} from './subtitleTiming';

export { isNonSpeechTagCue };

const YOUTUBE_ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{6,32}$/;
const YOUTUBE_PLAYLIST_ID_RE = /^[a-zA-Z0-9_-]{2,80}$/;
const AKAIWA_SLUG_RE = /^[a-z0-9-]{1,100}$/i;
export const MAX_SUBTITLE_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_PARSED_CUES = 6000;

export function isValidYouTubeVideoId(val: unknown): val is string {
  return typeof val === 'string' && YOUTUBE_VIDEO_ID_RE.test(val.trim());
}

export function isValidYouTubePlaylistId(val: unknown): val is string {
  return typeof val === 'string' && YOUTUBE_PLAYLIST_ID_RE.test(val.trim());
}

export function isValidAkaiwaSlug(val: unknown): val is string {
  return typeof val === 'string' && AKAIWA_SLUG_RE.test(val.trim());
}

export function isSafeClientHttpUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 1000) return '';
  try {
    const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    const u = new URL(normalized);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

function parseYouTubeStartTime(rawT: string | null): number {
  if (!rawT) return 0;
  const s = rawT.trim();
  if (/^\d+$/.test(s)) return Math.min(86400 * 7, parseInt(s, 10));
  const match = s.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/i);
  if (!match) return 0;
  const h = parseInt(match[1] || '0', 10);
  const m = parseInt(match[2] || '0', 10);
  const sec = parseInt(match[3] || '0', 10);
  return Math.min(86400 * 7, h * 3600 + m * 60 + sec);
}

export function parseYouTubeUrl(url: string): {
  videoId: string | null;
  playlistId: string | null;
  startSeconds: number;
} {
  try {
    const raw = url.trim();
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return { videoId: null, playlistId: null, startSeconds: 0 };
    }
    const host = u.hostname.toLowerCase();
    if (!YOUTUBE_ALLOWED_HOSTS.has(host)) {
      return { videoId: null, playlistId: null, startSeconds: 0 };
    }

    const rawPlaylistId = u.searchParams.get('list');
    const playlistId = isValidYouTubePlaylistId(rawPlaylistId) ? rawPlaylistId.trim() : null;
    let candidateVideoId = u.searchParams.get('v');
    if (!candidateVideoId && (host === 'youtu.be' || host === 'www.youtu.be')) {
      candidateVideoId = u.pathname.replace(/^\/+/, '').split('/')[0] || null;
    }
    if (!candidateVideoId) {
      const pathMatch = u.pathname.match(/^\/(?:shorts|live|embed)\/([a-zA-Z0-9_-]{6,32})/);
      if (pathMatch) {
        candidateVideoId = pathMatch[1];
      }
    }

    const videoId = isValidYouTubeVideoId(candidateVideoId) ? candidateVideoId.trim() : null;
    const startSeconds = parseYouTubeStartTime(u.searchParams.get('t') || u.searchParams.get('start'));
    return { videoId, playlistId, startSeconds };
  } catch {
    return { videoId: null, playlistId: null, startSeconds: 0 };
  }
}

export function parseAkaiwaUrl(url: string): {
  slug: string | null;
  ep: number;
} {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return { slug: null, ep: 1 };
    }
    const host = u.hostname.toLowerCase();
    if (host === 'akaiwa.tv' || host.endsWith('.akaiwa.tv')) {
      const match = u.pathname.match(/\/xem\/([^/]+)(?:\/ep(\d+))?/);
      if (match && isValidAkaiwaSlug(match[1])) {
        const rawEp = match[2] ? parseInt(match[2], 10) : 1;
        return {
          slug: match[1].trim(),
          ep: Math.max(1, Math.min(2000, Number.isFinite(rawEp) ? rawEp : 1)),
        };
      }
    }
  } catch {}
  return { slug: null, ep: 1 };
}

export function normalizeCueTimings(rawCues: SubtitleCue[]): SubtitleCue[] {
  return normalizeSubtitleCueTimings(rawCues);
}

export function findActiveCueForTime(cues: SubtitleCue[], t: number): SubtitleCue | null {
  return findActiveSubtitleCue(cues, t);
}

export function findRestoreCueForTime(cues: SubtitleCue[], t: number): SubtitleCue | null {
  return findCueAtOrBeforeTime(cues, t);
}

export async function fetchAkaiwaSeriesData(slug: string, ep: number = 1): Promise<{
  title: string;
  slug: string;
  currentEp: number;
  videoId: string;
  playlist: PlaylistItem[];
  cues: SubtitleCue[];
  error?: string;
}> {
  try {
    const res = await fetch(resolveApiUrl(`/api/akaiwa?slug=${encodeURIComponent(slug)}&ep=${ep}`));
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const playlist: PlaylistItem[] = (data.episodes || []).map((e: any) => ({
      ep_number: e.ep_number,
      videoId: e.youtube_video_id,
      title: e.title ? `Tập ${e.ep_number}: ${e.title}` : `Tập ${e.ep_number}`,
      thumbnail: `https://i.ytimg.com/vi/${e.youtube_video_id}/mqdefault.jpg`,
    }));

    return {
      title: data.title || slug,
      slug: data.slug || slug,
      currentEp: data.currentEp || ep,
      videoId: data.videoId,
      playlist,
      cues: normalizeCueTimings(data.cues || []),
    };
  } catch (e: any) {
    return {
      title: slug,
      slug,
      currentEp: ep,
      videoId: '',
      playlist: [],
      cues: [],
      error: e?.message || 'Không thể tải dữ liệu Anime.',
    };
  }
}

export async function fetchYouTubePlaylistData(listId: string): Promise<{
  listId: string;
  title: string;
  author: string;
  thumbnail: string;
  playlist: PlaylistItem[];
}> {
  const data = await fetchYouTubePlaylistApi(listId);
  return {
    listId: data.listId,
    title: data.title,
    author: data.author,
    thumbnail: data.thumbnail,
    playlist: data.videos || [],
  };
}

export async function fetchSubtitlesForVideo(videoId: string): Promise<{
  cues: SubtitleCue[];
  languageCode?: string;
  error?: string;
}> {
  try {
    const res = await fetch(resolveApiUrl(`/api/yt-subtitles?v=${encodeURIComponent(videoId)}`));
    const data = await res.json();
    return {
      cues: Array.isArray(data?.cues) ? normalizeCueTimings(data.cues) : [],
      languageCode: data?.languageCode,
      error: data?.error,
    };
  } catch (e: any) {
    return { cues: [], error: e?.message || 'Không thể tải phụ đề.' };
  }
}

export async function fetchVideoMetadata(videoId: string): Promise<PlaylistItem & { duration?: string }> {
  try {
    const meta = await fetchYouTubeVideoApi(videoId);
    return {
      ep_number: 1,
      videoId: meta.videoId || videoId,
      title: meta.title || `Video (${videoId})`,
      thumbnail: meta.thumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      duration: meta.duration,
      author: meta.author,
    };
  } catch {
    return {
      ep_number: 1,
      videoId,
      title: `Video (${videoId})`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    };
  }
}

function parseTimestamp(ts: string): number {
  const clean = ts.trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

export function parseSrtOrVtt(content: string): SubtitleCue[] {
  if (!content || content.length > MAX_SUBTITLE_UPLOAD_BYTES) {
    return [];
  }
  const normalized = content.replace(/\r\n/g, '\n').replace(/^WEBVTT.*\n/, '');
  const blocks = normalized.split(/\n\n+/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    if (cues.length >= MAX_PARSED_CUES) break;
    const lines = block.trim().split('\n');
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;

    const [startStr, endStr] = lines[timeLineIdx].split('-->');
    const start = parseTimestamp(startStr);
    const end = parseTimestamp(endStr.split(' ')[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const textLines = lines
      .slice(timeLineIdx + 1)
      .map((l) => l.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);

    if (textLines.length === 0) continue;

    cues.push({
      id: `${start}-${cues.length}`,
      start,
      end,
      ja: textLines[0].slice(0, 600),
      vi: textLines.length > 1 ? textLines.slice(1).join(' ').slice(0, 600) : undefined,
    });
  }

  return normalizeCueTimings(cues);
}
