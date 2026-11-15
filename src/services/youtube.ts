import { SubtitleCue, PlaylistItem } from '../types';
import { fetchYouTubePlaylistApi, fetchYouTubeVideoApi } from './api';
import {
  findActiveSubtitleCue,
  findCueAtOrBeforeTime,
  isNonSpeechTagCue,
  normalizeSubtitleCueTimings,
} from './subtitleTiming';

export { isNonSpeechTagCue };

function parseYouTubeStartTime(rawT: string | null): number {
  if (!rawT) return 0;
  const s = rawT.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const match = s.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/i);
  if (!match) return 0;
  const h = parseInt(match[1] || '0', 10);
  const m = parseInt(match[2] || '0', 10);
  const sec = parseInt(match[3] || '0', 10);
  return h * 3600 + m * 60 + sec;
}

export function parseYouTubeUrl(url: string): {
  videoId: string | null;
  playlistId: string | null;
  startSeconds: number;
} {
  try {
    const raw = url.trim();
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const isYt =
      host.includes('youtube.com') ||
      host.includes('youtu.be') ||
      host.includes('youtube-nocookie.com');
    if (!isYt) {
      return { videoId: null, playlistId: null, startSeconds: 0 };
    }

    const playlistId = u.searchParams.get('list');
    let videoId = u.searchParams.get('v');
    if (!videoId && host.includes('youtu.be')) {
      videoId = u.pathname.replace(/^\/+/, '').split('/')[0] || null;
    }
    if (!videoId) {
      const pathMatch = u.pathname.match(/^\/(?:shorts|live|embed)\/([a-zA-Z0-9_-]{6,})/);
      if (pathMatch) {
        videoId = pathMatch[1];
      }
    }

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
    if (u.hostname.includes('akaiwa.tv')) {
      const match = u.pathname.match(/\/xem\/([^/]+)(?:\/ep(\d+))?/);
      if (match) {
        return {
          slug: match[1],
          ep: match[2] ? parseInt(match[2], 10) : 1,
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
    const res = await fetch(`/api/akaiwa?slug=${encodeURIComponent(slug)}&ep=${ep}`);
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
    const res = await fetch(`/api/yt-subtitles?v=${encodeURIComponent(videoId)}`);
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
  const normalized = content.replace(/\r\n/g, '\n').replace(/^WEBVTT.*\n/, '');
  const blocks = normalized.split(/\n\n+/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;

    const [startStr, endStr] = lines[timeLineIdx].split('-->');
    const start = parseTimestamp(startStr);
    const end = parseTimestamp(endStr.split(' ')[0]);
    const textLines = lines
      .slice(timeLineIdx + 1)
      .map((l) => l.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);

    if (textLines.length === 0) continue;

    cues.push({
      id: `${start}-${cues.length}`,
      start,
      end,
      ja: textLines[0],
      vi: textLines.length > 1 ? textLines.slice(1).join(' ') : undefined,
    });
  }

  return normalizeCueTimings(cues);
}
