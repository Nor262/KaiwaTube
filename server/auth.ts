import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getDb,
  getJwtSecret,
  normalizeDbTimestamp,
  type DbUser,
  type UserRole,
} from './db';
import { getEnvVar } from './env';
import { getRequestUrl, readJsonBody, sendJson } from './httpUtils';
import {
  SlidingWindowRateLimiter,
  enforceRateLimit,
  escapeLikePattern,
  getClientIp,
  parsePositiveIntId,
  sanitizeText,
} from './security';

const JWT_ISSUER = 'kaiwatube';
const JWT_AUDIENCE = 'kaiwatube-client';
const MAX_PASSWORD_LENGTH = 128;

const loginIpLimiter = new SlidingWindowRateLimiter(15, 15 * 60 * 1000);
const loginAccountLimiter = new SlidingWindowRateLimiter(10, 15 * 60 * 1000);
const registerIpLimiter = new SlidingWindowRateLimiter(8, 30 * 60 * 1000);
const claimAdminIpLimiter = new SlidingWindowRateLimiter(5, 30 * 60 * 1000);

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function safeCompareSecret(provided: string, configured: string): boolean {
  if (!provided || !configured) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(configured).digest();
  return crypto.timingSafeEqual(a, b);
}

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(input: string): string {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64').toString('utf8');
}

async function signToken(userId: number): Promise<string> {
  const secret = await getJwtSecret();
  const nowSec = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = nowSec + 60 * 60 * 24 * 14; // 14 days
  const payload = toBase64Url(
    JSON.stringify({
      sub: userId,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: nowSec,
      exp,
    })
  );
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  return `${data}.${toBase64Url(sig)}`;
}

async function verifyToken(token: string): Promise<{ userId: number } | null> {
  try {
    if (!token || token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigPart] = parts;
    if (!headerB64 || !payloadB64 || !sigPart) return null;

    const parsedHeader = JSON.parse(fromBase64Url(headerB64));
    if (
      !parsedHeader ||
      typeof parsedHeader !== 'object' ||
      parsedHeader.alg !== 'HS256' ||
      (parsedHeader.typ !== undefined && parsedHeader.typ !== 'JWT')
    ) {
      return null;
    }

    const secret = await getJwtSecret();
    const data = `${headerB64}.${payloadB64}`;
    const expectedSig = toBase64Url(
      crypto.createHmac('sha256', secret).update(data).digest()
    );
    const a = Buffer.from(sigPart);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    const decoded = JSON.parse(fromBase64Url(payloadB64));
    if (!decoded || typeof decoded !== 'object') return null;
    if (
      typeof decoded.sub !== 'number' ||
      !Number.isSafeInteger(decoded.sub) ||
      decoded.sub <= 0
    ) {
      return null;
    }
    if (decoded.iss !== JWT_ISSUER || decoded.aud !== JWT_AUDIENCE) {
      return null;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof decoded.exp !== 'number' || !Number.isFinite(decoded.exp) || decoded.exp <= nowSec) {
      return null;
    }
    if (typeof decoded.iat === 'number' && decoded.iat > nowSec + 60) {
      return null;
    }
    return { userId: decoded.sub };
  } catch {
    return null;
  }
}

export function sanitizeUser(row: DbUser): AuthUser {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: normalizeDbTimestamp(row.created_at),
  };
}

export async function getAuthUser(req: IncomingMessage): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const decoded = await verifyToken(match[1].trim());
  if (!decoded) return null;

  const db = await getDb();
  const row = await db.queryOne<DbUser>(
    `SELECT id, username, display_name, role, created_at FROM ${db.table('users')} WHERE id = ?`,
    [decoded.userId]
  );
  return row ? sanitizeUser(row) : null;
}

export function canPublishCommunitySub(user: AuthUser | null): boolean {
  return Boolean(user && (user.role === 'admin' || user.role === 'contributor'));
}

export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  if (!pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/admin/')) {
    return false;
  }

  const db = await getDb();
  const usersTable = db.table('users');
  const method = (req.method || 'GET').toUpperCase();
  const clientIp = getClientIp(req);

  if (pathname === '/api/auth/register' && method === 'POST') {
    if (
      !enforceRateLimit(
        registerIpLimiter,
        `reg:${clientIp}`,
        res,
        'Bạn đã đăng ký quá nhiều lần. Vui lòng thử lại sau ít phút.'
      )
    ) {
      return true;
    }

    const body = await readJsonBody(req, 16 * 1024);
    const rawUsername = String(body.username || '').trim().toLowerCase();
    const displayName = sanitizeText(body.displayName || rawUsername, 80) || rawUsername;
    const password = typeof body.password === 'string' ? body.password : String(body.password || '');
    const adminSecret = sanitizeText(body.adminSecret || '', 256);

    if (!/^[a-z0-9_.-]{3,32}$/.test(rawUsername)) {
      sendJson(res, 400, {
        error: 'Tên đăng nhập phải dài 3–32 ký tự (chữ thường, số, ., _, -).',
      });
      return true;
    }
    if (password.length < 6 || password.length > MAX_PASSWORD_LENGTH) {
      sendJson(res, 400, { error: 'Mật khẩu phải dài từ 6 đến 128 ký tự.' });
      return true;
    }

    let role: UserRole = 'user';
    if (adminSecret) {
      if (
        !enforceRateLimit(
          claimAdminIpLimiter,
          `claim:${clientIp}`,
          res,
          'Thử mã kích hoạt Admin quá nhiều lần. Vui lòng thử lại sau 30 phút.'
        )
      ) {
        return true;
      }
      const configuredSecret = getEnvVar('ADMIN_SECRET');
      if (!configuredSecret) {
        sendJson(res, 403, { error: 'Máy chủ chưa cấu hình ADMIN_SECRET.' });
        return true;
      }
      if (!safeCompareSecret(adminSecret, configuredSecret)) {
        sendJson(res, 403, { error: 'Mã kích hoạt Admin không chính xác.' });
        return true;
      }
      role = 'admin';
    }

    const existing = await db.queryOne<{ id: number }>(
      `SELECT id FROM ${usersTable} WHERE username = ?`,
      [rawUsername]
    );
    if (existing) {
      sendJson(res, 409, { error: 'Tên đăng nhập này đã tồn tại.' });
      return true;
    }

    const pwHash = hashPassword(password);
    const newId = await db.insertReturningId(
      `INSERT INTO ${usersTable} (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)`,
      [rawUsername, displayName, pwHash, role]
    );

    const created = (await db.queryOne<DbUser>(
      `SELECT id, username, display_name, role, created_at FROM ${usersTable} WHERE id = ?`,
      [newId]
    )) as DbUser;

    const token = await signToken(Number(created.id));
    sendJson(res, 201, { token, user: sanitizeUser(created) });
    return true;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    if (
      !enforceRateLimit(
        loginIpLimiter,
        `login:${clientIp}`,
        res,
        'Đăng nhập sai hoặc thao tác quá nhiều lần. Vui lòng thử lại sau ít phút.'
      )
    ) {
      return true;
    }

    const body = await readJsonBody(req, 16 * 1024);
    const rawUsername = String(body.username || '').trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password : String(body.password || '');

    if (!rawUsername || !password || rawUsername.length > 64 || password.length > MAX_PASSWORD_LENGTH) {
      sendJson(res, 400, { error: 'Vui lòng nhập tên đăng nhập và mật khẩu hợp lệ.' });
      return true;
    }

    if (
      !enforceRateLimit(
        loginAccountLimiter,
        `login-acct:${clientIp}:${rawUsername}`,
        res,
        'Tài khoản đang tạm giới hạn do thử đăng nhập nhiều lần. Vui lòng đợi ít phút.'
      )
    ) {
      return true;
    }

    const row = await db.queryOne<DbUser>(
      `SELECT id, username, display_name, password_hash, role, created_at FROM ${usersTable} WHERE username = ?`,
      [rawUsername]
    );

    if (!row || !verifyPassword(password, row.password_hash)) {
      sendJson(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
      return true;
    }

    const token = await signToken(Number(row.id));
    sendJson(res, 200, { token, user: sanitizeUser(row) });
    return true;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { user: null, error: 'Chưa đăng nhập.' });
      return true;
    }
    sendJson(res, 200, { user });
    return true;
  }

  if (pathname === '/api/auth/claim-admin' && method === 'POST') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Bạn cần đăng nhập trước.' });
      return true;
    }
    if (
      !enforceRateLimit(
        claimAdminIpLimiter,
        `claim:${clientIp}:${user.id}`,
        res,
        'Thử mã kích hoạt Admin quá nhiều lần. Vui lòng thử lại sau 30 phút.'
      )
    ) {
      return true;
    }

    const body = await readJsonBody(req, 8 * 1024);
    const adminSecret = sanitizeText(body.adminSecret || '', 256);
    const configuredSecret = getEnvVar('ADMIN_SECRET');
    if (!configuredSecret) {
      sendJson(res, 403, { error: 'Máy chủ chưa cấu hình ADMIN_SECRET.' });
      return true;
    }
    if (!safeCompareSecret(adminSecret, configuredSecret)) {
      sendJson(res, 403, { error: 'Mã kích hoạt Admin không chính xác.' });
      return true;
    }

    await db.execute(`UPDATE ${usersTable} SET role = ? WHERE id = ?`, ['admin', user.id]);
    const updated = (await db.queryOne<DbUser>(
      `SELECT id, username, display_name, role, created_at FROM ${usersTable} WHERE id = ?`,
      [user.id]
    )) as DbUser;

    sendJson(res, 200, { user: sanitizeUser(updated) });
    return true;
  }

  // Admin: list users & manage permissions
  if (pathname === '/api/admin/users' && method === 'GET') {
    const actor = await getAuthUser(req);
    if (!actor || actor.role !== 'admin') {
      sendJson(res, 403, { error: 'Chỉ Admin mới có quyền xem danh sách tài khoản.' });
      return true;
    }

    const url = getRequestUrl(req);
    const q = sanitizeText(url.searchParams.get('q') || '', 64).toLowerCase();
    const escapedQ = q ? `%${escapeLikePattern(q)}%` : '';
    const rows = q
      ? await db.queryAll<DbUser>(
          `SELECT id, username, display_name, role, created_at FROM ${usersTable}
           WHERE username LIKE ? ESCAPE '\\' OR LOWER(display_name) LIKE ? ESCAPE '\\'
           ORDER BY created_at DESC LIMIT 100`,
          [escapedQ, escapedQ]
        )
      : await db.queryAll<DbUser>(
          `SELECT id, username, display_name, role, created_at FROM ${usersTable}
           ORDER BY created_at DESC LIMIT 100`
        );

    sendJson(res, 200, { users: rows.map(sanitizeUser) });
    return true;
  }

  const roleMatch = pathname.match(/^\/api\/admin\/users\/([1-9]\d*)\/role$/);
  if (roleMatch && method === 'PATCH') {
    const actor = await getAuthUser(req);
    if (!actor || actor.role !== 'admin') {
      sendJson(res, 403, { error: 'Chỉ Admin mới có quyền phân quyền tài khoản.' });
      return true;
    }

    const targetId = parsePositiveIntId(roleMatch[1]);
    if (!targetId) {
      sendJson(res, 400, { error: 'ID tài khoản không hợp lệ.' });
      return true;
    }

    const body = await readJsonBody(req, 8 * 1024);
    const nextRole = String(body.role || '') as UserRole;
    if (!['user', 'contributor', 'admin'].includes(nextRole)) {
      sendJson(res, 400, { error: 'Vai trò không hợp lệ (chọn user, contributor hoặc admin).' });
      return true;
    }

    if (targetId === actor.id && nextRole !== 'admin') {
      const adminCountRow = await db.queryOne<{ cnt: number | string }>(
        `SELECT COUNT(*) as cnt FROM ${usersTable} WHERE role = 'admin'`
      );
      if (Number(adminCountRow?.cnt || 0) <= 1) {
        sendJson(res, 400, {
          error: 'Không thể tự hạ quyền khi bạn là Admin duy nhất.',
        });
        return true;
      }
    }

    await db.execute(`UPDATE ${usersTable} SET role = ? WHERE id = ?`, [nextRole, targetId]);
    const updated = await db.queryOne<DbUser>(
      `SELECT id, username, display_name, role, created_at FROM ${usersTable} WHERE id = ?`,
      [targetId]
    );
    if (!updated) {
      sendJson(res, 404, { error: 'Không tìm thấy tài khoản.' });
      return true;
    }

    sendJson(res, 200, { user: sanitizeUser(updated) });
    return true;
  }

  if (pathname === '/api/admin/reports' && method === 'GET') {
    const actor = await getAuthUser(req);
    if (!actor || actor.role !== 'admin') {
      sendJson(res, 403, { error: 'Chỉ Admin mới có quyền xem báo cáo phụ đề.' });
      return true;
    }

    const rawReports = await db.queryAll<Record<string, any>>(
      `SELECT r.id, r.community_sub_id, r.reason, r.created_at,
              u.username AS reporter_username,
              cs.video_id, cs.title AS sub_title, cs.author_name, cs.source_type
       FROM ${db.table('subtitle_reports')} r
       JOIN ${usersTable} u ON u.id = r.user_id
       JOIN ${db.table('community_subtitles')} cs ON cs.id = r.community_sub_id
       ORDER BY r.created_at DESC LIMIT 100`
    );

    const reports = rawReports.map((r) => ({
      id: Number(r.id),
      community_sub_id: Number(r.community_sub_id),
      reason: r.reason,
      created_at: normalizeDbTimestamp(r.created_at),
      reporter_username: r.reporter_username,
      video_id: r.video_id,
      sub_title: r.sub_title,
      author_name: r.author_name,
      source_type: r.source_type,
    }));

    sendJson(res, 200, { reports });
    return true;
  }

  return false;
}
