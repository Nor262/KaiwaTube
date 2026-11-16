import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDb } from '../server/db';
import { getRequestUrl, sendJson } from '../server/httpUtils';
import { ensureServerInit, handleApiRequest } from '../server/index';
import { applyCommonSecurityHeaders } from '../server/security';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

export function resolveRewrittenApiUrl(rawUrl: string): string | null {
  const parsed = new URL(rawUrl || '/api', 'http://localhost');
  if (!parsed.searchParams.has('__kaiwa_path')) {
    return rawUrl || '/api';
  }

  const rawSubPath = parsed.searchParams.get('__kaiwa_path') || '';
  parsed.searchParams.delete('__kaiwa_path');

  if (rawSubPath.includes('\0') || rawSubPath.includes('\\') || rawSubPath.includes('..')) {
    return null;
  }

  const cleanSubPath = rawSubPath.replace(/^\/+/, '');
  const nextPath = cleanSubPath ? `/api/${cleanSubPath}` : '/api';
  const nextQuery = parsed.searchParams.toString();
  return nextQuery ? `${nextPath}?${nextQuery}` : nextPath;
}

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  ensureServerInit();
  applyCommonSecurityHeaders(res);

  const resolvedUrl = resolveRewrittenApiUrl(req.url || '/api');
  if (!resolvedUrl) {
    sendJson(res, 400, { error: 'Đường dẫn API không hợp lệ.' });
    return;
  }
  req.url = resolvedUrl;

  const pathname = getRequestUrl(req).pathname;
  const method = (req.method || 'GET').toUpperCase();

  if (pathname === '/api/health') {
    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }
    try {
      const db = await getDb();
      await db.healthCheck();
      if (method === 'HEAD') {
        res.statusCode = 200;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end();
      } else {
        sendJson(res, 200, {
          ok: true,
          db: 'connected',
          dialect: db.dialect,
          uptimeSec: Math.floor(process.uptime()),
        });
      }
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[HealthCheck Error]', detail);
      sendJson(res, 503, { ok: false, error: 'Database unavailable.' });
    }
    return;
  }

  try {
    await handleApiRequest(req, res, () => {
      if (!res.headersSent) {
        sendJson(res, 404, { error: 'API route not found.' });
      }
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[Vercel API Error] ${method} ${pathname}:`, detail);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Lỗi máy chủ nội bộ.' });
    }
  }
}
