import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDb } from './db';
import { canPublishCommunitySub, getAuthUser } from './auth';
import { getRequestUrl, readJsonBody, sendJson } from './httpUtils';
import {
  HttpError,
  isValidYouTubeVideoId,
  parsePositiveIntId,
  sanitizeText,
} from './security';

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
  const db = getDb();
  const method = (req.method || 'GET').toUpperCase();
  const url = getRequestUrl(req);

  // 1. Get all saved subtitle tracks (community + current user personal) for a video
  if (pathname === '/api/subtitles' && method === 'GET') {
    const videoId = (url.searchParams.get('v') || '').trim();
    if (!isValidYouTubeVideoId(videoId)) {
      sendJson(res, 400, { error: 'videoId (v) không hợp lệ.' });
      return true;
    }

    const user = getAuthUser(req);

    const communityRows = db
      .prepare(
        `SELECT cs.id, cs.video_id, cs.title, cs.source_type, cs.author_id, cs.author_name,
                cs.cues_json, cs.cue_count, cs.created_at, cs.updated_at,
                (SELECT COUNT(*) FROM subtitle_reports r WHERE r.community_sub_id = cs.id) AS report_count
         FROM community_subtitles cs
         WHERE cs.video_id = ?
         ORDER BY cs.updated_at DESC LIMIT 50`
      )
      .all(videoId) as any[];

    const community = communityRows.map((row) => ({
      id: row.id,
      videoId: row.video_id,
      title: row.title,
      sourceType: row.source_type,
      authorId: row.author_id,
      authorName: row.author_name,
      cueCount: row.cue_count,
      reportCount: row.report_count || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cues: safeParseCuesJson(row.cues_json),
    }));

    let personal: any[] = [];
    if (user) {
      const userRows = db
        .prepare(
          `SELECT id, video_id, title, source_type, cues_json, cue_count, created_at, updated_at
           FROM user_subtitles
           WHERE user_id = ? AND video_id = ?
           ORDER BY updated_at DESC LIMIT 20`
        )
        .all(user.id, videoId) as any[];

      personal = userRows.map((row) => ({
        id: row.id,
        videoId: row.video_id,
        title: row.title,
        sourceType: row.source_type,
        cueCount: row.cue_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        cues: safeParseCuesJson(row.cues_json),
      }));
    }

    sendJson(res, 200, { videoId, community, personal });
    return true;
  }

  // 2. Save personal subtitle for logged-in user (accessible to ALL logged-in accounts)
  if (pathname === '/api/subtitles/user' && method === 'POST') {
    const user = getAuthUser(req);
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
    db.prepare(
      `INSERT INTO user_subtitles (user_id, video_id, title, source_type, cues_json, cue_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, video_id, source_type) DO UPDATE SET
         title = excluded.title,
         cues_json = excluded.cues_json,
         cue_count = excluded.cue_count,
         updated_at = CURRENT_TIMESTAMP`
    ).run(user.id, videoId, title, sourceType, JSON.stringify(cues), cues.length);

    const saved = db
      .prepare(
        `SELECT id, video_id, title, source_type, cues_json, cue_count, created_at, updated_at
         FROM user_subtitles WHERE user_id = ? AND video_id = ? AND source_type = ?`
      )
      .get(user.id, videoId, sourceType) as any;

    sendJson(res, 200, {
      track: {
        id: saved.id,
        videoId: saved.video_id,
        title: saved.title,
        sourceType: saved.source_type,
        cueCount: saved.cue_count,
        createdAt: saved.created_at,
        updatedAt: saved.updated_at,
        cues: safeParseCuesJson(saved.cues_json),
      },
    });
    return true;
  }

  // 3. Delete user's own personal subtitle
  const userDeleteMatch = pathname.match(/^\/api\/subtitles\/user\/([1-9]\d*)$/);
  if (userDeleteMatch && method === 'DELETE') {
    const user = getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Chưa đăng nhập.' });
      return true;
    }
    const id = parsePositiveIntId(userDeleteMatch[1]);
    if (!id) {
      sendJson(res, 400, { error: 'ID phụ đề không hợp lệ.' });
      return true;
    }
    const info = db
      .prepare('DELETE FROM user_subtitles WHERE id = ? AND user_id = ?')
      .run(id, user.id);
    if (!info.changes) {
      sendJson(res, 404, { error: 'Không tìm thấy bản phụ đề cá nhân này.' });
      return true;
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // 4. Publish Community Subtitle (ADMIN & AUTHORIZED CONTRIBUTOR ONLY)
  if (pathname === '/api/subtitles/community' && method === 'POST') {
    const user = getAuthUser(req);
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
    const result = db
      .prepare(
        `INSERT INTO community_subtitles (video_id, title, source_type, author_id, author_name, cues_json, cue_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        videoId,
        title,
        sourceType,
        user.id,
        authorName,
        JSON.stringify(cues),
        cues.length
      );

    const created = db
      .prepare(
        `SELECT id, video_id, title, source_type, author_id, author_name, cues_json, cue_count, created_at, updated_at
         FROM community_subtitles WHERE id = ?`
      )
      .get(Number(result.lastInsertRowid)) as any;

    sendJson(res, 201, {
      track: {
        id: created.id,
        videoId: created.video_id,
        title: created.title,
        sourceType: created.source_type,
        authorId: created.author_id,
        authorName: created.author_name,
        cueCount: created.cue_count,
        reportCount: 0,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
        cues: safeParseCuesJson(created.cues_json),
      },
    });
    return true;
  }

  // 5. Update Community Subtitle (Admin or original Contributor author)
  const communityItemMatch = pathname.match(/^\/api\/subtitles\/community\/([1-9]\d*)$/);
  if (communityItemMatch && method === 'PUT') {
    const user = getAuthUser(req);
    if (!user || !canPublishCommunitySub(user)) {
      sendJson(res, 403, { error: 'Bạn không có quyền chỉnh sửa phụ đề cộng đồng.' });
      return true;
    }

    const id = parsePositiveIntId(communityItemMatch[1]);
    if (!id) {
      sendJson(res, 400, { error: 'ID phụ đề không hợp lệ.' });
      return true;
    }

    const existing = db
      .prepare('SELECT id, author_id FROM community_subtitles WHERE id = ?')
      .get(id) as { id: number; author_id: number } | undefined;
    if (!existing) {
      sendJson(res, 404, { error: 'Không tìm thấy bản phụ đề cộng đồng.' });
      return true;
    }
    if (user.role !== 'admin' && existing.author_id !== user.id) {
      sendJson(res, 403, { error: 'Chỉ Admin hoặc tác giả mới được sửa bản phụ đề này.' });
      return true;
    }

    const body = await readJsonBody(req, MAX_SUBTITLE_BODY_BYTES);
    const title = body.title ? sanitizeText(body.title, 160) : undefined;
    const cues = validateAndNormalizeCues(body.cues);

    if (title) {
      db.prepare(
        `UPDATE community_subtitles SET title = ?, cues_json = ?, cue_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(title, JSON.stringify(cues), cues.length, id);
    } else {
      db.prepare(
        `UPDATE community_subtitles SET cues_json = ?, cue_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(JSON.stringify(cues), cues.length, id);
    }

    const updated = db
      .prepare(
        `SELECT id, video_id, title, source_type, author_id, author_name, cues_json, cue_count, created_at, updated_at
         FROM community_subtitles WHERE id = ?`
      )
      .get(id) as any;

    sendJson(res, 200, {
      track: {
        id: updated.id,
        videoId: updated.video_id,
        title: updated.title,
        sourceType: updated.source_type,
        authorId: updated.author_id,
        authorName: updated.author_name,
        cueCount: updated.cue_count,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
        cues: safeParseCuesJson(updated.cues_json),
      },
    });
    return true;
  }

  // 6. Delete Community Subtitle (Admin or original Contributor author)
  if (communityItemMatch && method === 'DELETE') {
    const user = getAuthUser(req);
    if (!user || !canPublishCommunitySub(user)) {
      sendJson(res, 403, { error: 'Bạn không có quyền xóa phụ đề cộng đồng.' });
      return true;
    }

    const id = parsePositiveIntId(communityItemMatch[1]);
    if (!id) {
      sendJson(res, 400, { error: 'ID phụ đề không hợp lệ.' });
      return true;
    }

    const existing = db
      .prepare('SELECT id, author_id FROM community_subtitles WHERE id = ?')
      .get(id) as { id: number; author_id: number } | undefined;
    if (!existing) {
      sendJson(res, 404, { error: 'Không tìm thấy bản phụ đề.' });
      return true;
    }
    if (user.role !== 'admin' && existing.author_id !== user.id) {
      sendJson(res, 403, { error: 'Chỉ Admin hoặc tác giả mới được xóa bản phụ đề này.' });
      return true;
    }

    db.prepare('DELETE FROM community_subtitles WHERE id = ?').run(id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // 7. Report Faulty Community Subtitle (Any logged-in user)
  const reportMatch = pathname.match(/^\/api\/subtitles\/community\/([1-9]\d*)\/report$/);
  if (reportMatch && method === 'POST') {
    const user = getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Vui lòng đăng nhập để báo cáo lỗi phụ đề.' });
      return true;
    }
    const id = parsePositiveIntId(reportMatch[1]);
    if (!id) {
      sendJson(res, 400, { error: 'ID phụ đề không hợp lệ.' });
      return true;
    }
    const existing = db
      .prepare('SELECT id FROM community_subtitles WHERE id = ?')
      .get(id);
    if (!existing) {
      sendJson(res, 404, { error: 'Không tìm thấy bản phụ đề cộng đồng.' });
      return true;
    }

    const body = await readJsonBody(req, 16 * 1024);
    const reason =
      sanitizeText(body.reason, 500) || 'Sub bị lệch thời gian hoặc dịch sai nghiêm trọng';

    db.prepare(
      `INSERT INTO subtitle_reports (community_sub_id, user_id, reason)
       VALUES (?, ?, ?)
       ON CONFLICT(community_sub_id, user_id) DO UPDATE SET reason = excluded.reason, created_at = CURRENT_TIMESTAMP`
    ).run(id, user.id, reason);

    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
