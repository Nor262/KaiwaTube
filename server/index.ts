import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv } from './env';
import { getDb } from './db';
import { handleAuthRoutes } from './auth';
import { handleMediaRoutes } from './media';
import { handleSubtitleRoutes } from './subtitlesApi';
import { handleFavoriteRoutes } from './favoritesApi';
import { getRequestUrl, sendJson } from './httpUtils';

let initialized = false;

export function ensureServerInit(): void {
  if (initialized) return;
  loadEnv();
  getDb();
  initialized = true;
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
): Promise<void> {
  const url = getRequestUrl(req);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    next();
    return;
  }

  ensureServerInit();

  try {
    if (await handleAuthRoutes(req, res, pathname)) return;
    if (await handleSubtitleRoutes(req, res, pathname)) return;
    if (await handleFavoriteRoutes(req, res, pathname)) return;
    if (await handleMediaRoutes(req, res, pathname)) return;

    sendJson(res, 404, { error: `API route not found: ${pathname}` });
  } catch (err: any) {
    console.error(`[API Error] ${req.method} ${pathname}:`, err);
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: err?.message || 'Lỗi máy chủ nội bộ.',
      });
    }
  }
}
