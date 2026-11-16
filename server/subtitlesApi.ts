import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDb, normalizeDbTimestamp } from './db.js';
import { canPublishCommunitySub, getAuthUser } from './auth.js';
import { getRequestUrl, readJsonBody, sendJson } from './httpUtils.js';
import {
  HttpError,
  isValidYouTubeVideoId,
  parsePositiveIntId,
  sanitizeText,
} from './security.js';

const MAX_SUBTITLE_BODY_BYTES = 4 * 1024 * 1024;
const ALLOWED_SUB_SOURCE_TYPES = new Set(['ai_merged', 'uploaded']);

interface NormalizedCue {
  id: string;
  start: number;
  end: number;
  ja: string;
  vi?: string;
}

function safeParseCuesJson(rawJson: string | null | undefined): NormalizedCue[] {
  try {
    const parsed = JSON.parse(rawJson || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeCommunityTrack(row: Record<string, any>) {
  return {
    id: Number(row.id),
    videoId: row.video_id,
    title: row.title,
    sourceType: row.source_type,
    authorId: row.author_id != null ? Number(row.author_id) : null,
    authorName: row.author_name,
    cueCount: Number(row.cue_count),
    reportCount: Number(row.report_count || 0),
    createdAt: normalizeDbTimestamp(row.created_at),
    updatedAt: normalizeDbTimestamp(row.updated_at),
    cues: safeParseCuesJson(row.cues_json),
  };
}

function serializePersonalTrack(row: Record<string, any>) {
  return {
    id: Number(row.id),
    videoId: row.video_id,
    title: row.title,
    sourceType: row.source_type,
    cueCount: Number(row.cue_count),
    createdAt: normalizeDbTimestamp(row.created_at),
    updatedAt: normalizeDbTimestamp(row.updated_at),
    cues: safeParseCuesJson(row.cues_json),
  };
}

function validateAndNormalizeCues(rawCues: unknown): NormalizedCue[] {
  if (!Array.isArray(rawCues) || rawCues.length === 0) {
    throw new HttpError(400, 'Danh sách phụ đề không được rỗng.');
  }
  if (rawCues.length > 6000) {
    throw new HttpError(400, 'Số lượng câu phụ đề vượt quá giới hạn 6000 dòng.');
  }

  const normalized: NormalizedCue[] = [];
  for (let i = 0; i < rawCues.length; i++) {
    const c = rawCues[i] as any;
    const ja = sanitizeText(c?.ja, 600, { preserveNewlines: true });
    const start = Number(c?.start);
    const end = Number(c?.end);
    if (!ja || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const safeStart = Math.max(0, start);
    const safeEnd = Math.max(safeStart, end);
    const vi = c?.vi ? sanitizeText(c.vi, 600, { preserveNewlines: true }) : '';
    const id = sanitizeText(c?.id, 64) || `${safeStart}-${i}`;
    normalized.push({
      id,
      start: safeStart,
      end: safeEnd,
      ja,
      vi: vi || undefined,
    });
  }

  if (normalized.length === 0) {
    throw new HttpError(400, 'Không tìm thấy câu phụ đề hợp lệ.');
  }
  return normalized;
}

export async function handleSubtitleRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  if (!pathname.startsWith('/api/subtitles')) return false;

  const db = await getDb();
  const communityTable = db.table('community_subtitles');
  const userSubTable = db.table('user_subtitles');
  const reportsTable = db.table('subtitle_reports');
  const method = (req.method || 'GET').toUpperCase();
  const url = getRequestUrl(req);

  // 1. Get all saved subtitle tracks (community + current user personal) for a video
  if (pathname === '/api/subtitles' && method === 'GET') {
    const videoId = (url.searchParams.get('v') || '').trim();
    if (!isValidYouTubeVideoId(videoId)) {
      sendJson(res, 400, { error: 'videoId (v) không hợp lệ.' });
      return true;
    }

    const user = await getAuthUser(req);

    const communityRows = await db.queryAll<Record<string, any>>(
      `SELECT cs.id, cs.video_id, cs.title, cs.source_type, cs.author_id, cs.author_name,
              cs.cues_json, cs.cue_count, cs.created_at, cs.updated_at,
              (SELECT COUNT(*) FROM ${reportsTable} r WHERE r.community_sub_id = cs.id) AS report_count
       FROM ${communityTable} cs
       WHERE cs.video_id = ?
       ORDER BY cs.updated_at DESC LIMIT 50`,
      [videoId]
    );

    const community = communityRows.map(serializeCommunityTrack);

    let personal: ReturnType<typeof serializePersonalTrack>[] = [];
    if (user) {
      const userRows = await db.queryAll<Record<string, any>>(
        `SELECT id, video_id, title, source_type, cues_json, cue_count, created_at, updated_at
         FROM ${userSubTable}
         WHERE user_id = ? AND video_id = ?
         ORDER BY updated_at DESC LIMIT 20`,
        [user.id, videoId]
      );
      personal = userRows.map(serializePersonalTrack);
    }

    sendJson(res, 200, { videoId, community, personal });
    return true;
  }

  // 2. Save personal subtitle for logged-in user (accessible to ALL logged-in accounts)
  if (pathname === '/api/subtitles/user' && method === 'POST') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Vui lòng đăng nhập để lưu phụ đề vào tài khoản cá nhân.' });
      return true;
    }

    const body = await readJsonBody(req, MAX_SUBTITLE_BODY_BYTES);
    const videoId = String(body.videoId || '').trim();
    const title = sanitizeText(body.title, 160) || 'Phụ đề cá nhân';
    const sourceType = String(body.sourceType || '').trim();
    if (!isValidYouTubeVideoId(videoId) || !ALLOWED_SUB_SOURCE_TYPES.has(sourceType)) {
      sendJson(res, 400, { error: 'Dữ liệu videoId hoặc sourceType không hợp lệ.' });
      return true;
    }

    const cues = validateAndNormalizeCues(body.cues);
    await db.execute(
      `INSERT INTO ${userSubTable} (user_id, video_id, title, source_type, cues_json, cue_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, video_id, source_type) DO UPDATE SET
         title = excluded.title,
         cues_json = excluded.cues_json,
         cue_count = excluded.cue_count,
         updated_at = CURRENT_TIMESTAMP`,
      [user.id, videoId, title, sourceType, JSON.stringify(cues), cues.length]
    );

    const saved = (await db.queryOne<Record<string, any>>(
      `SELECT id, video_id, title, source_type, cues_json, cue_count, created_at, updated_at
       FROM ${userSubTable} WHERE user_id = ? AND video_id = ? AND source_type = ?`,
      [user.id, videoId, sourceType]
    )) as Record<string, any>;

    sendJson(res, 200, { track: serializePersonalTrack(saved) });
    return true;
  }

  // 3. Delete user's own personal subtitle
  const userDeleteMatch = pathname.match(/^\/api\/subtitles\/user\/([1-9]\d*)$/);
  if (userDeleteMatch && method === 'DELETE') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Chưa đăng nhập.' });
      return true;
    }
    const id = parsePositiveIntId(userDeleteMatch[1]);
    if (!id) {
      sendJson(res, 400, { error: 'ID phụ đề không hợp lệ.' });
      return true;
    }
    const info = await db.execute(
      `DELETE FROM ${userSubTable} WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );
    if (!info.changes) {
      sendJson(res, 404, { error: 'Không tìm thấy bản phụ đề cá nhân này.' });
      return true;
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // 4. Publish Community Subtitle (ADMIN & AUTHORIZED CONTRIBUTOR ONLY)
  if (pathname === '/api/subtitles/community' && method === 'POST') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Vui lòng đăng nhập trước.' });
      return true;
    }
    if (!canPublishCommunitySub(user)) {
      sendJson(res, 403, {
        error:
          'Chỉ Admin hoặc tài khoản được cấp phép mới có quyền đăng phụ đề lên Cộng đồng. Bản phụ đề của bạn vẫn có thể lưu vào tài khoản cá nhân.',
      });
      return true;
    }

    const body = await readJsonBody(req, MAX_SUBTITLE_BODY_BYTES);
    const videoId = String(body.videoId || '').trim();
    const title = sanitizeText(body.title, 160) || 'Sub Cộng đồng';
    const sourceType = String(body.sourceType || '').trim();
    if (!isValidYouTubeVideoId(videoId) || !ALLOWED_SUB_SOURCE_TYPES.has(sourceType)) {
      sendJson(res, 400, { error: 'videoId hoặc sourceType không hợp lệ.' });
      return true;
    }

    const cues = validateAndNormalizeCues(body.cues);
    const authorName = sanitizeText(user.displayName || user.username, 80) || user.username;
    const insertedId = await db.insertReturningId(
      `INSERT INTO ${communityTable} (video_id, title, source_type, author_id, author_name, cues_json, cue_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [videoId, title, sourceType, user.id, authorName, JSON.stringify(cues), cues.length]
    );

    const created = (await db.queryOne<Record<string, any>>(
      `SELECT id, video_id, title, source_type, author_id, author_name, cues_json, cue_count, created_at, updated_at
       FROM ${communityTable} WHERE id = ?`,
      [insertedId]
    )) as Record<string, any>;

    sendJson(res, 201, { track: serializeCommunityTrack({ ...created, report_count: 0 }) });
    return true;
  }

  // 5. Update Community Subtitle (Admin or original Contributor author)
  const communityItemMatch = pathname.match(/^\/api\/subtitles\/community\/([1-9]\d*)$/);
  if (communityItemMatch && method === 'PUT') {
    const user = await getAuthUser(req);
    if (!user || !canPublishCommunitySub(user)) {
      sendJson(res, 403, { error: 'Bạn không có quyền chỉnh sửa phụ đề cộng đồng.' });
      return true;
    }

    const id = parsePositiveIntId(communityItemMatch[1]);
    if (!id) {
      sendJson(res, 400, { error: 'ID phụ đề không hợp lệ.' });
      return true;
    }

    const existing = await db.queryOne<{ id: number; author_id: number | null }>(
      `SELECT id, author_id FROM ${communityTable} WHERE id = ?`,
      [id]
    );
    if (!existing) {
      sendJson(res, 404, { error: 'Không tìm thấy bản phụ đề cộng đồng.' });
      return true;
    }
    if (user.role !== 'admin' && Number(existing.author_id) !== user.id) {
      sendJson(res, 403, { error: 'Chỉ Admin hoặc tác giả mới được sửa bản phụ đề này.' });
      return true;
    }

    const body = await readJsonBody(req, MAX_SUBTITLE_BODY_BYTES);
    const title = body.title ? sanitizeText(body.title, 160) : undefined;
    const cues = validateAndNormalizeCues(body.cues);

    if (title) {
      await db.execute(
        `UPDATE ${communityTable} SET title = ?, cues_json = ?, cue_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [title, JSON.stringify(cues), cues.length, id]
      );
    } else {
      await db.execute(
        `UPDATE ${communityTable} SET cues_json = ?, cue_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify(cues), cues.length, id]
      );
    }

    const updated = (await db.queryOne<Record<string, any>>(
      `SELECT id, video_id, title, source_type, author_id, author_name, cues_json, cue_count, created_at, updated_at
       FROM ${communityTable} WHERE id = ?`,
      [id]
    )) as Record<string, any>;

    sendJson(res, 200, { track: serializeCommunityTrack(updated) });
    return true;
  }

  // 6. Delete Community Subtitle (Admin or original Contributor author)
  if (communityItemMatch && method === 'DELETE') {
    const user = await getAuthUser(req);
    if (!user || !canPublishCommunitySub(user)) {
      sendJson(res, 403, { error: 'Bạn không có quyền xóa phụ đề cộng đồng.' });
      return true;
    }

    const id = parsePositiveIntId(communityItemMatch[1]);
    if (!id) {
      sendJson(res, 400, { error: 'ID phụ đề không hợp lệ.' });
      return true;
    }

    const existing = await db.queryOne<{ id: number; author_id: number | null }>(
      `SELECT id, author_id FROM ${communityTable} WHERE id = ?`,
      [id]
    );
    if (!existing) {
      sendJson(res, 404, { error: 'Không tìm thấy bản phụ đề.' });
      return true;
    }
    if (user.role !== 'admin' && Number(existing.author_id) !== user.id) {
      sendJson(res, 403, { error: 'Chỉ Admin hoặc tác giả mới được xóa bản phụ đề này.' });
      return true;
    }

    await db.execute(`DELETE FROM ${communityTable} WHERE id = ?`, [id]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // 7. Report Faulty Community Subtitle (Any logged-in user)
  const reportMatch = pathname.match(/^\/api\/subtitles\/community\/([1-9]\d*)\/report$/);
  if (reportMatch && method === 'POST') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Vui lòng đăng nhập để báo cáo lỗi phụ đề.' });
      return true;
    }
    const id = parsePositiveIntId(reportMatch[1]);
    if (!id) {
      sendJson(res, 400, { error: 'ID phụ đề không hợp lệ.' });
      return true;
    }
    const existing = await db.queryOne<{ id: number }>(
      `SELECT id FROM ${communityTable} WHERE id = ?`,
      [id]
    );
    if (!existing) {
      sendJson(res, 404, { error: 'Không tìm thấy bản phụ đề cộng đồng.' });
      return true;
    }

    const body = await readJsonBody(req, 16 * 1024);
    const reason =
      sanitizeText(body.reason, 500) || 'Sub bị lệch thời gian hoặc dịch sai nghiêm trọng';

    await db.execute(
      `INSERT INTO ${reportsTable} (community_sub_id, user_id, reason)
       VALUES (?, ?, ?)
       ON CONFLICT(community_sub_id, user_id) DO UPDATE SET reason = excluded.reason, created_at = CURRENT_TIMESTAMP`,
      [id, user.id, reason]
    );

    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
