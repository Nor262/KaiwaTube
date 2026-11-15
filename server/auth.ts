import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDb, getJwtSecret, type DbUser, type UserRole } from './db';
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

function signToken(userId: number): string {
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
  const sig = crypto
    .createHmac('sha256', getJwtSecret())
    .update(data)
    .digest();
  return `${data}.${toBase64Url(sig)}`;
}

function verifyToken(token: string): { userId: number } | null {
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

    const data = `${headerB64}.${payloadB64}`;
    const expectedSig = toBase64Url(
      crypto.createHmac('sha256', getJwtSecret()).update(data).digest()
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
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  };
}

export function getAuthUser(req: IncomingMessage): AuthUser | null {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const decoded = verifyToken(match[1].trim());
  if (!decoded) return null;

  const db = getDb();
  const row = db
    .prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?')
    .get(decoded.userId) as DbUser | undefined;
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
  const db = getDb();
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

    const existing = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(rawUsername);
    if (existing) {
      sendJson(res, 409, { error: 'Tên đăng nhập này đã tồn tại.' });
      return true;
    }

    const pwHash = hashPassword(password);
    const result = db
      .prepare(
        'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
      )
      .run(rawUsername, displayName, pwHash, role);

    const created = db
      .prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as DbUser;

    const token = signToken(created.id);
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

    const row = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(rawUsername) as DbUser | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      sendJson(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
      return true;
    }

    const token = signToken(row.id);
    sendJson(res, 200, { token, user: sanitizeUser(row) });
    return true;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { user: null, error: 'Chưa đăng nhập.' });
      return true;
    }
    sendJson(res, 200, { user });
    return true;
  }

  if (pathname === '/api/auth/claim-admin' && method === 'POST') {
    const user = getAuthUser(req);
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

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', user.id);
    const updated = db
      .prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?')
      .get(user.id) as DbUser;

    sendJson(res, 200, { user: sanitizeUser(updated) });
    return true;
  }

  // Admin: list users & manage permissions
  if (pathname === '/api/admin/users' && method === 'GET') {
    const actor = getAuthUser(req);
    if (!actor || actor.role !== 'admin') {
      sendJson(res, 403, { error: 'Chỉ Admin mới có quyền xem danh sách tài khoản.' });
      return true;
    }

    const url = getRequestUrl(req);
    const q = sanitizeText(url.searchParams.get('q') || '', 64).toLowerCase();
    const escapedQ = q ? `%${escapeLikePattern(q)}%` : '';
    const rows = (
      q
        ? db
            .prepare(
              `SELECT id, username, display_name, role, created_at FROM users
               WHERE username LIKE ? ESCAPE '\\' OR LOWER(display_name) LIKE ? ESCAPE '\\'
               ORDER BY created_at DESC LIMIT 100`
            )
            .all(escapedQ, escapedQ)
        : db
            .prepare(
              'SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at DESC LIMIT 100'
            )
            .all()
    ) as DbUser[];

    sendJson(res, 200, { users: rows.map(sanitizeUser) });
    return true;
  }

  const roleMatch = pathname.match(/^\/api\/admin\/users\/([1-9]\d*)\/role$/);
  if (roleMatch && method === 'PATCH') {
    const actor = getAuthUser(req);
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
      const adminCountRow = db
        .prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'")
        .get() as { cnt: number };
      if ((adminCountRow?.cnt || 0) <= 1) {
        sendJson(res, 400, {
          error: 'Không thể tự hạ quyền khi bạn là Admin duy nhất.',
        });
        return true;
      }
    }

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(nextRole, targetId);
    const updated = db
      .prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?')
      .get(targetId) as DbUser | undefined;
    if (!updated) {
      sendJson(res, 404, { error: 'Không tìm thấy tài khoản.' });
      return true;
    }

    sendJson(res, 200, { user: sanitizeUser(updated) });
    return true;
  }

  if (pathname === '/api/admin/reports' && method === 'GET') {
    const actor = getAuthUser(req);
    if (!actor || actor.role !== 'admin') {
      sendJson(res, 403, { error: 'Chỉ Admin mới có quyền xem báo cáo phụ đề.' });
      return true;
    }

    const reports = db
      .prepare(
        `SELECT r.id, r.community_sub_id, r.reason, r.created_at,
                u.username AS reporter_username,
                cs.video_id, cs.title AS sub_title, cs.author_name, cs.source_type
         FROM subtitle_reports r
         JOIN users u ON u.id = r.user_id
         JOIN community_subtitles cs ON cs.id = r.community_sub_id
         ORDER BY r.created_at DESC LIMIT 100`
      )
      .all();

    sendJson(res, 200, { reports });
    return true;
  }

  return false;
}
