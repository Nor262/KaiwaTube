import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

export const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{6,32}$/;
export const PLAYLIST_ID_RE = /^[a-zA-Z0-9_-]{2,80}$/;
export const AKAIWA_SLUG_RE = /^[a-z0-9-]{1,100}$/i;
export const ITEM_ID_RE = /^[a-zA-Z0-9_.:-]{1,128}$/;

export function isValidYouTubeVideoId(val: unknown): val is string {
  return typeof val === 'string' && VIDEO_ID_RE.test(val.trim());
}

export function isValidYouTubePlaylistId(val: unknown): val is string {
  return typeof val === 'string' && PLAYLIST_ID_RE.test(val.trim());
}

export function isValidAkaiwaSlug(val: unknown): val is string {
  return typeof val === 'string' && AKAIWA_SLUG_RE.test(val.trim());
}

export function isValidItemId(val: unknown): val is string {
  return typeof val === 'string' && ITEM_ID_RE.test(val.trim());
}

const SINGLE_KANJI_RE = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2ebef}]$/u;

export function isSingleKanji(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return Array.from(trimmed).length === 1 && SINGLE_KANJI_RE.test(trimmed);
}

/**
 * Strips NUL bytes, ASCII control chars (except newlines/tabs when allowed),
 * and invisible bidirectional/zero-width characters used for spoofing.
 */
export function sanitizeText(
  val: unknown,
  maxLength: number,
  options: { preserveNewlines?: boolean } = {}
): string {
  const raw = typeof val === 'string' ? val : String(val ?? '');
  const ctrlRe = options.preserveNewlines
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g
    : /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
  return raw.replace(ctrlRe, '').trim().slice(0, maxLength);
}

export function isSafeHttpUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 1000) return '';
  try {
    const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    const u = new URL(normalized);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return '';
    }
    return u.toString();
  } catch {
    return '';
  }
}

export function escapeLikePattern(query: string): string {
  return query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function parsePositiveIntId(raw: string | undefined): number | null {
  if (!raw || !/^[1-9]\d{0,15}$/.test(raw)) return null;
  const num = Number(raw);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

export function getClientIp(req: IncomingMessage): string {
  const trustProxy = process.env.TRUST_PROXY === '1' || process.env.VERCEL === '1';
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0];
    if (first && first.trim()) return first.trim();
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 12_000
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(input, { ...init, signal });
}

export class BoundedTtlCache<K, V> {
  private readonly store = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number = 0
  ) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.ttlMs > 0 && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency for LRU ordering
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    const expiresAt = this.ttlMs > 0 ? Date.now() + this.ttlMs : Number.MAX_SAFE_INTEGER;
    this.store.set(key, { value, expiresAt });
  }

  clear(): void {
    this.store.clear();
  }
}

interface RateBucket {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxBuckets = 10_000
  ) {}

  consume(key: string): { allowed: boolean; retryAfterSec: number; remaining: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let bucket = this.buckets.get(key);

    if (!bucket) {
      if (this.buckets.size >= this.maxBuckets) {
        this.prune(cutoff);
        if (this.buckets.size >= this.maxBuckets) {
          const oldestKey = this.buckets.keys().next().value;
          if (oldestKey !== undefined) this.buckets.delete(oldestKey);
        }
      }
      bucket = { timestamps: [] };
    }

    bucket.timestamps = bucket.timestamps.filter((ts) => ts > cutoff);

    if (bucket.timestamps.length >= this.maxRequests) {
      const oldest = bucket.timestamps[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.buckets.set(key, bucket);
      return { allowed: false, retryAfterSec, remaining: 0 };
    }

    bucket.timestamps.push(now);
    this.buckets.delete(key);
    this.buckets.set(key, bucket);

    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: Math.max(0, this.maxRequests - bucket.timestamps.length),
    };
  }

  private prune(cutoff: number): void {
    for (const [key, bucket] of this.buckets) {
      const active = bucket.timestamps.filter((ts) => ts > cutoff);
      if (active.length === 0) {
        this.buckets.delete(key);
      } else {
        bucket.timestamps = active;
      }
    }
  }
}

export function enforceRateLimit(
  limiter: SlidingWindowRateLimiter,
  key: string,
  res: ServerResponse,
  errorMessage = 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.'
): boolean {
  const result = limiter.consume(key);
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfterSec));
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: errorMessage }));
    return false;
  }
  return true;
}

export function applyCommonSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

export function buildAppCspHeader(isDev: boolean): string {
  const connectSources = [
    "'self'",
    'https://generativelanguage.googleapis.com',
    'https://translate.googleapis.com',
    'https://www.youtube.com',
    'https://www.youtube-nocookie.com',
    ...(isDev ? ['ws:', 'wss:'] : []),
  ].join(' ');

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
  ].join('; ');
}
