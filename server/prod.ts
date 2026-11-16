import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb, getDbPath } from './db.js';
import { PROJECT_ROOT, getEnvVar } from './env.js';
import { getRequestUrl, sendJson } from './httpUtils.js';
import { ensureServerInit, handleApiRequest } from './index.js';
import { applyCommonSecurityHeaders, buildAppCspHeader } from './security.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

export interface ProdServerOptions {
  distDir?: string;
  host?: string;
  port?: number;
}

function sendText(res: ServerResponse, status: number, body: string, method = 'GET'): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (method === 'HEAD') {
    res.end();
  } else {
    res.end(body);
  }
}

function serveStaticFile(
  res: ServerResponse,
  filePath: string,
  method: string,
  cspHeader: string,
  isImmutableAsset: boolean
): void {
  const ext = path.extname(filePath).toLowerCase();
  const isHtml = ext === '.html';
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(data.length));

  if (isHtml) {
    res.setHeader('Content-Security-Policy', cspHeader);
    res.setHeader('Cache-Control', 'no-cache');
  } else if (isImmutableAsset) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }

  if (method === 'HEAD') {
    res.end();
  } else {
    res.end(data);
  }
}

export function resolveDistDir(customDir?: string): string {
  const configured = customDir || getEnvVar('DIST_DIR');
  return path.resolve(configured || path.join(PROJECT_ROOT, 'dist'));
}

export function createProdRequestHandler(distDir = resolveDistDir()) {
  const distRoot = path.resolve(distDir);
  const indexHtmlPath = path.join(distRoot, 'index.html');
  const cspHeader = buildAppCspHeader(false);

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = (req.method || 'GET').toUpperCase();
    applyCommonSecurityHeaders(res);

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (process.env.TRUST_PROXY === '1' && forwardedProto === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    let url: URL;
    let decodedPath: string;
    try {
      url = getRequestUrl(req);
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      sendText(res, 400, 'Bad Request', method);
      return;
    }

    if (url.pathname === '/api/health') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        sendJson(res, 405, { error: 'Method Not Allowed' });
        return;
      }
      try {
        const db = await getDb();
        await db.healthCheck();
        const payload = {
          ok: true,
          db: 'connected',
          dialect: db.dialect,
          uptimeSec: Math.floor(process.uptime()),
        };
        if (method === 'HEAD') {
          res.statusCode = 200;
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end();
        } else {
          sendJson(res, 200, payload);
        }
      } catch {
        sendJson(res, 503, { ok: false, error: 'Database unavailable.' });
      }
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApiRequest(req, res, () => {
        if (!res.headersSent) {
          sendJson(res, 404, { error: 'API route not found.' });
        }
      });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendText(res, 405, 'Method Not Allowed', method);
      return;
    }

    if (decodedPath.includes('\0') || decodedPath.includes('\\')) {
      sendText(res, 400, 'Bad Request', method);
      return;
    }

    const cleanRel = decodedPath.replace(/^\/+/, '');
    if (cleanRel.split('/').some((seg) => seg.startsWith('.') && seg.length > 0)) {
      sendText(res, 403, 'Forbidden', method);
      return;
    }

    const candidate = cleanRel ? path.resolve(distRoot, cleanRel) : indexHtmlPath;
    if (candidate !== distRoot && !candidate.startsWith(distRoot + path.sep)) {
      sendText(res, 403, 'Forbidden', method);
      return;
    }

    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        serveStaticFile(
          res,
          candidate,
          method,
          cspHeader,
          url.pathname.startsWith('/assets/')
        );
        return;
      }
    } catch {
      // Fall through to 404 for explicit asset extensions or index.html for SPA routes
    }

    if (url.pathname.startsWith('/assets/') || path.posix.extname(cleanRel) !== '') {
      sendText(res, 404, 'Not Found', method);
      return;
    }

    if (!fs.existsSync(indexHtmlPath)) {
      sendText(res, 503, 'Frontend build not found.', method);
      return;
    }

    serveStaticFile(res, indexHtmlPath, method, cspHeader, false);
  };
}

export function createProdServer(options: ProdServerOptions = {}): http.Server {
  ensureServerInit();
  const distDir = resolveDistDir(options.distDir);
  const handler = createProdRequestHandler(distDir);

  const server = http.createServer((req, res) => {
    void handler(req, res).catch((err) => {
      console.error('[ProdServer] Unhandled request error:', err);
      if (!res.headersSent) {
        sendText(res, 500, 'Internal Server Error', req.method || 'GET');
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });

  // Match cloud edge proxy idle keep-alive timeouts (>60s) to avoid 502 reset races
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;
  return server;
}

function startCliServer(): void {
  const host = getEnvVar('HOST') || '0.0.0.0';
  const rawPort = Number(getEnvVar('PORT') || '3000');
  const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3000;
  const distDir = resolveDistDir();
  const server = createProdServer({ distDir, host, port });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[KaiwaTube] Received ${signal}, shutting down cleanly...`);

    const forceTimer = setTimeout(() => {
      void closeDb().finally(() => process.exit(1));
    }, 8_000);
    forceTimer.unref();

    server.close(() => {
      void closeDb().finally(() => {
        clearTimeout(forceTimer);
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  server.listen(port, host, () => {
    console.log(
      `[KaiwaTube] Production server listening on http://${host}:${port} (dist=${distDir}, db=${getDbPath()})`
    );
  });
}

const currentFile = fileURLToPath(import.meta.url);
const entryArg = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryArg === currentFile) {
  startCliServer();
}
