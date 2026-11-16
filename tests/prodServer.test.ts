import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import vercelHandler, { resolveRewrittenApiUrl } from '../api/index';
import { closeDb, convertPlaceholdersToPg } from '../server/db';
import { createProdServer } from '../server/prod';

function createMockVercelRes() {
  const headers: Record<string, string> = {};
  let body = '';
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader(k: string, v: string | string[]) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    end(chunk?: unknown) {
      res.headersSent = true;
      if (chunk !== undefined) {
        body += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
      }
    },
  } as unknown as ServerResponse;

  return {
    res,
    getStatus: () => res.statusCode,
    getHeaders: () => headers,
    getJson: () => (body ? JSON.parse(body) : null),
  };
}

function createMockVercelReq(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  const req = new EventEmitter() as IncomingMessage & { body?: unknown };
  req.url = params.url;
  req.method = params.method || 'GET';
  req.headers = { ...params.headers };
  req.body = params.body;
  req.socket = { remoteAddress: '127.0.0.1' } as any;
  return req;
}

describe('Production HTTP server & Vercel Serverless adapter', () => {
  let tmpRoot = '';
  let distDir = '';
  let server: http.Server | null = null;
  let baseUrl = '';
  let prevDbPath: string | undefined;
  let prevDatabaseUrl: string | undefined;
  let prevPostgresUrl: string | undefined;
  let prevTrustProxy: string | undefined;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kaiwatube-prod-test-'));
    distDir = path.join(tmpRoot, 'dist');
    fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(distDir, 'index.html'),
      '<!doctype html><html><body><div id="root">KaiwaTube</div></body></html>',
      'utf8'
    );
    fs.writeFileSync(
      path.join(distDir, 'assets', 'index-test.js'),
      'console.log("ok");',
      'utf8'
    );
    fs.writeFileSync(path.join(distDir, '.hidden'), 'secret', 'utf8');

    prevDbPath = process.env.NIHONGO_DB_PATH;
    prevDatabaseUrl = process.env.DATABASE_URL;
    prevPostgresUrl = process.env.POSTGRES_URL;
    prevTrustProxy = process.env.TRUST_PROXY;

    await closeDb();
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    process.env.NIHONGO_DB_PATH = path.join(tmpRoot, 'test.db');
    process.env.TRUST_PROXY = '1';

    server = createProdServer({ distDir });
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    await closeDb();
    if (prevDbPath === undefined) delete process.env.NIHONGO_DB_PATH;
    else process.env.NIHONGO_DB_PATH = prevDbPath;
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
    if (prevPostgresUrl === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = prevPostgresUrl;
    if (prevTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prevTrustProxy;

    if (tmpRoot) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('serves /api/health with SQLite connectivity status and no-store cache', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.db).toBe('connected');
    expect(data.dialect).toBe('sqlite');
  });

  it('falls back to index.html for SPA routes with production CSP (no ws:)', async () => {
    const res = await fetch(`${baseUrl}/watch?v=M7lc1UVf-VE`, {
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000');
    const csp = res.headers.get('content-security-policy') || '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('ws:');
    expect(csp).not.toContain('wss:');
    const body = await res.text();
    expect(body).toContain('KaiwaTube');
  });

  it('serves static hashed assets with immutable caching and 404 for missing files', async () => {
    const assetRes = await fetch(`${baseUrl}/assets/index-test.js`);
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get('content-type')).toContain('application/javascript');
    expect(assetRes.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const missingAsset = await fetch(`${baseUrl}/assets/missing-chunk.js`);
    expect(missingAsset.status).toBe(404);
  });

  it('blocks path traversal, dotfiles, and unauthenticated API writes', async () => {
    const traversal = await fetch(`${baseUrl}/..%2fpackage.json`);
    expect(traversal.status).toBe(403);

    const hiddenFile = await fetch(`${baseUrl}/.hidden`);
    expect(hiddenFile.status).toBe(403);

    const favRes = await fetch(`${baseUrl}/api/favorites`);
    expect(favRes.status).toBe(401);
  });

  it('converts positional SQL ? placeholders to Postgres $1..$n without touching string literals', () => {
    expect(
      convertPlaceholdersToPg(
        "SELECT * FROM \"kaiwatube\".\"users\" WHERE username LIKE ? ESCAPE '\\' AND note = 'what?' AND role = ?"
      )
    ).toBe(
      "SELECT * FROM \"kaiwatube\".\"users\" WHERE username LIKE $1 ESCAPE '\\' AND note = 'what?' AND role = $2"
    );

    expect(
      convertPlaceholdersToPg("SELECT 'it''s ?' AS literal, id FROM t WHERE id = ?")
    ).toBe("SELECT 'it''s ?' AS literal, id FROM t WHERE id = $1");
  });

  it('resolves Vercel __kaiwa_path rewrites safely and rejects traversal', () => {
    expect(resolveRewrittenApiUrl('/api/index?__kaiwa_path=health')).toBe('/api/health');
    expect(resolveRewrittenApiUrl('/api/index?__kaiwa_path=yt-search&q=anime')).toBe(
      '/api/yt-search?q=anime'
    );
    expect(resolveRewrittenApiUrl('/api/index?__kaiwa_path=../../etc/passwd')).toBeNull();
  });

  it('handles Vercel pre-parsed req.body end-to-end across register, login, and favorites', async () => {
    const regReq = createMockVercelReq({
      url: '/api/index?__kaiwa_path=auth/register',
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10' },
      body: {
        username: 'vercel_user1',
        displayName: 'Vercel Tester',
        password: 'strongpassword123',
      },
    });
    const regRes = createMockVercelRes();
    await vercelHandler(regReq, regRes.res);
    expect(regRes.getStatus()).toBe(201);
    const regData = regRes.getJson();
    expect(regData.token).toBeString();
    expect(regData.user.username).toBe('vercel_user1');

    const favPostReq = createMockVercelReq({
      url: '/api/index?__kaiwa_path=favorites',
      method: 'POST',
      headers: {
        authorization: `Bearer ${regData.token}`,
        'x-forwarded-for': '203.0.113.10',
      },
      body: {
        itemType: 'video',
        itemId: 'M7lc1UVf-VE',
        title: 'Test Video',
        thumbnail: 'https://i.ytimg.com/vi/M7lc1UVf-VE/mqdefault.jpg',
      },
    });
    const favPostRes = createMockVercelRes();
    await vercelHandler(favPostReq, favPostRes.res);
    expect(favPostRes.getStatus()).toBe(200);
    expect(favPostRes.getJson().favorite.itemId).toBe('M7lc1UVf-VE');

    // Non-object JSON body and path traversal must be rejected cleanly
    const arrayReq = createMockVercelReq({
      url: '/api/index?__kaiwa_path=auth/login',
      method: 'POST',
      body: ['not', 'an', 'object'],
    });
    const arrayRes = createMockVercelRes();
    await vercelHandler(arrayReq, arrayRes.res);
    expect(arrayRes.getStatus()).toBe(400);

    const badPathReq = createMockVercelReq({
      url: '/api/index?__kaiwa_path=..%2fsecrets',
      method: 'GET',
    });
    const badPathRes = createMockVercelRes();
    await vercelHandler(badPathReq, badPathRes.res);
    expect(badPathRes.getStatus()).toBe(400);
  });
});
