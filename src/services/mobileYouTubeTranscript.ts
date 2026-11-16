import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { SubtitleCue } from '../types';
import { sanitizeAiText } from '../utils/aiSecurity';
import { translateBatchServer } from './api';
import { normalizeCueTimings } from './youtube';

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
}

const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const INNERTUBE_CLIENT_VERSION = '20.10.38';
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;
const WEB_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function extractInlineJson(html: string, globalName: string): any {
  const token = `var ${globalName} = `;
  const startIdx = html.indexOf(token);
  if (startIdx === -1) return null;

  const jsonStart = startIdx + token.length;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function decodeHtmlEntities(input: string): string {
  if (!input) return '';
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = input;
    return textarea.value;
  }
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseTranscriptXml(xmlText: string): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  if (!xmlText || typeof xmlText !== 'string') return out;

  // Format 1: srv3 <p t="ms" d="ms">...</p>
  const pMatches = [...xmlText.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)];
  if (pMatches.length > 0) {
    for (const match of pMatches) {
      const attrs = match[1] || '';
      const tMatch = attrs.match(/\bt="(\d+(?:\.\d+)?)"/);
      if (!tMatch) continue;
      const dMatch = attrs.match(/\bd="(\d+(?:\.\d+)?)"/);
      const start = Number(tMatch[1]) / 1000;
      const dur = dMatch ? Number(dMatch[1]) / 1000 : 2.5;
      const rawInner = (match[2] || '').replace(/<[^>]+>/g, ' ');
      const text = sanitizeAiText(decodeHtmlEntities(rawInner).replace(/\s+/g, ' '), 500);
      if (text) {
        out.push({ start: Math.max(0, start), end: Math.max(start, start + dur), text });
      }
    }
    if (out.length > 0) return out;
  }

  // Format 2: classic XML <text start="s" dur="s">...</text>
  const textMatches = [...xmlText.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)];
  for (const match of textMatches) {
    const attrs = match[1] || '';
    const sMatch = attrs.match(/\bstart="([^"]+)"/);
    if (!sMatch) continue;
    const dMatch = attrs.match(/\bdur="([^"]+)"/);
    const start = Number(sMatch[1]);
    const dur = dMatch ? Number(dMatch[1]) : 2.5;
    if (!Number.isFinite(start)) continue;
    const rawInner = (match[2] || '').replace(/<[^>]+>/g, ' ');
    const text = sanitizeAiText(decodeHtmlEntities(rawInner).replace(/\s+/g, ' '), 500);
    if (text) {
      out.push({
        start: Math.max(0, start),
        end: Math.max(start, start + (Number.isFinite(dur) ? dur : 2.5)),
        text,
      });
    }
  }
  return out;
}

function isAllowedCaptionUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

function pickPreferredTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  return (
    tracks.find((t) => t.languageCode === 'ja') ||
    tracks.find((t) => String(t.languageCode || '').startsWith('ja')) ||
    tracks[0]
  );
}

async function fetchCaptionTracksViaInnerTube(videoId: string): Promise<CaptionTrack[]> {
  try {
    const resp = await CapacitorHttp.post({
      url: INNERTUBE_API_URL,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_USER_AGENT,
      },
      data: {
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: INNERTUBE_CLIENT_VERSION,
          },
        },
        videoId,
      },
      connectTimeout: 10_000,
      readTimeout: 12_000,
    });
    if (resp.status < 200 || resp.status >= 300) return [];
    const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return Array.isArray(tracks) ? tracks : [];
  } catch {
    return [];
  }
}

async function fetchCaptionTracksViaWatchPage(videoId: string): Promise<CaptionTrack[]> {
  try {
    const resp = await CapacitorHttp.get({
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      headers: {
        'Accept-Language': 'ja,en;q=0.8',
        'User-Agent': WEB_USER_AGENT,
      },
      responseType: 'text',
      connectTimeout: 10_000,
      readTimeout: 15_000,
    });
    if (resp.status < 200 || resp.status >= 300 || typeof resp.data !== 'string') return [];
    const playerResponse = extractInlineJson(resp.data, 'ytInitialPlayerResponse');
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return Array.isArray(tracks) ? tracks : [];
  } catch {
    return [];
  }
}

/**
 * Fetches YouTube closed captions directly from the user's Android device IP via
 * CapacitorHttp so cloud datacenter IP blocks do not prevent subtitle loading.
 */
export async function fetchMobileYouTubeSubtitles(videoId: string): Promise<SubtitleCue[]> {
  if (!Capacitor.isNativePlatform()) return [];

  let tracks = await fetchCaptionTracksViaInnerTube(videoId);
  if (tracks.length === 0) {
    tracks = await fetchCaptionTracksViaWatchPage(videoId);
  }
  if (tracks.length === 0) return [];

  const track = pickPreferredTrack(tracks);
  if (!track?.baseUrl || !isAllowedCaptionUrl(track.baseUrl)) return [];

  const transcriptResp = await CapacitorHttp.get({
    url: track.baseUrl,
    headers: {
      'Accept-Language': track.languageCode || 'ja',
      'User-Agent': WEB_USER_AGENT,
    },
    responseType: 'text',
    connectTimeout: 10_000,
    readTimeout: 15_000,
  });

  if (transcriptResp.status < 200 || transcriptResp.status >= 300 || typeof transcriptResp.data !== 'string') {
    return [];
  }

  const parsedItems = parseTranscriptXml(transcriptResp.data);
  if (parsedItems.length === 0) return [];

  let viTexts: string[] = [];
  try {
    viTexts = await translateBatchServer(parsedItems.map((it) => it.text));
  } catch {
    viTexts = [];
  }

  const cues: SubtitleCue[] = parsedItems.map((it, idx) => ({
    id: `${Math.round(it.start * 1000)}-${idx}`,
    start: it.start,
    end: it.end,
    ja: it.text,
    vi: viTexts[idx] || undefined,
  }));

  return normalizeCueTimings(cues);
}
