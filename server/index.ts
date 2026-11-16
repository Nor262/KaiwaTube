import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv } from './env.js';
import { handleAuthRoutes } from './auth.js';
import { handleMediaRoutes } from './media.js';
import { handleSubtitleRoutes } from './subtitlesApi.js';
import { handleFavoriteRoutes } from './favoritesApi.js';
import { getRequestUrl, sendJson } from './httpUtils.js';
import { HttpError, applyApiCorsHeaders } from './security.js';

let initialized = false;

export function ensureServerInit(): void {
  if (initialized) return;
  loadEnv();
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
  if (applyApiCorsHeaders(req, res)) return;

  try {
    if (await handleAuthRoutes(req, res, pathname)) return;
    if (await handleSubtitleRoutes(req, res, pathname)) return;
    if (await handleFavoriteRoutes(req, res, pathname)) return;
    if (await handleMediaRoutes(req, res, pathname)) return;

    sendJson(res, 404, { error: 'API route not found.' });
  } catch (err: unknown) {
    if (err instanceof HttpError) {
      if (!res.headersSent) {
        sendJson(res, err.status, { error: err.message });
      }
      return;
    }

    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[API Error] ${req.method} ${pathname}:`, detail);
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: 'Lỗi máy chủ nội bộ.',
      });
    }
  }
}
