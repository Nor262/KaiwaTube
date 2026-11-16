import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDb, normalizeDbTimestamp } from './db.js';
import { getAuthUser } from './auth.js';
import { getRequestUrl, readJsonBody, sendJson } from './httpUtils.js';
import { isSafeHttpUrl, isValidItemId, sanitizeText } from './security.js';

const ALLOWED_FAVORITE_TYPES = new Set(['video', 'playlist', 'anime']);

function safeParseMetaObject(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function serializeFavoriteRow(r: Record<string, any>) {
  return {
    id: Number(r.id),
    itemType: r.item_type,
    itemId: r.item_id,
    title: r.title,
    subtitle: r.subtitle || '',
    thumbnail: isSafeHttpUrl(r.thumbnail || ''),
    meta: safeParseMetaObject(r.meta_json),
    createdAt: normalizeDbTimestamp(r.created_at),
  };
}

export async function handleFavoriteRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  if (pathname !== '/api/favorites') return false;

  const db = await getDb();
  const favTable = db.table('favorites');
  const method = (req.method || 'GET').toUpperCase();
  const url = getRequestUrl(req);
  const user = await getAuthUser(req);

  if (!user) {
    sendJson(res, 401, { error: 'Vui lòng đăng nhập để sử dụng Mục yêu thích.' });
    return true;
  }

  if (method === 'GET') {
    const typeFilter = (url.searchParams.get('type') || '').trim();
    if (typeFilter && !ALLOWED_FAVORITE_TYPES.has(typeFilter)) {
      sendJson(res, 400, { error: 'Loại mục yêu thích không hợp lệ.' });
      return true;
    }

    const rows = typeFilter
      ? await db.queryAll<Record<string, any>>(
          `SELECT id, item_type, item_id, title, subtitle, thumbnail, meta_json, created_at
           FROM ${favTable} WHERE user_id = ? AND item_type = ? ORDER BY created_at DESC LIMIT 500`,
          [user.id, typeFilter]
        )
      : await db.queryAll<Record<string, any>>(
          `SELECT id, item_type, item_id, title, subtitle, thumbnail, meta_json, created_at
           FROM ${favTable} WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`,
          [user.id]
        );

    sendJson(res, 200, { favorites: rows.map(serializeFavoriteRow) });
    return true;
  }

  if (method === 'POST') {
    const body = await readJsonBody(req, 32 * 1024);
    const itemType = String(body.itemType || '').trim();
    const itemId = String(body.itemId || '').trim();
    const title = sanitizeText(body.title, 200);
    const subtitle = sanitizeText(body.subtitle, 120);
    const rawThumbnail = String(body.thumbnail || '').trim();
    const safeThumbnail = rawThumbnail ? isSafeHttpUrl(rawThumbnail) : '';

    if (rawThumbnail && !safeThumbnail) {
      sendJson(res, 400, { error: 'URL hình ảnh thumbnail không hợp lệ.' });
      return true;
    }

    if (!ALLOWED_FAVORITE_TYPES.has(itemType) || !isValidItemId(itemId) || !title) {
      sendJson(res, 400, { error: 'Thiếu hoặc sai định dạng itemType, itemId hoặc title.' });
      return true;
    }

    const metaVal =
      body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta) ? body.meta : {};
    const metaJson = JSON.stringify(metaVal);
    if (metaJson.length > 8192) {
      sendJson(res, 400, { error: 'Dữ liệu meta quá lớn.' });
      return true;
    }

    await db.execute(
      `INSERT INTO ${favTable} (user_id, item_type, item_id, title, subtitle, thumbnail, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET
         title = excluded.title,
         subtitle = excluded.subtitle,
         thumbnail = excluded.thumbnail,
         meta_json = excluded.meta_json`,
      [user.id, itemType, itemId, title, subtitle, safeThumbnail, metaJson]
    );

    const saved = (await db.queryOne<Record<string, any>>(
      `SELECT id, item_type, item_id, title, subtitle, thumbnail, meta_json, created_at
       FROM ${favTable} WHERE user_id = ? AND item_type = ? AND item_id = ?`,
      [user.id, itemType, itemId]
    )) as Record<string, any>;

    sendJson(res, 200, { favorite: serializeFavoriteRow(saved) });
    return true;
  }

  if (method === 'DELETE') {
    const itemType = (url.searchParams.get('type') || '').trim();
    const itemId = (url.searchParams.get('id') || '').trim();
    if (!ALLOWED_FAVORITE_TYPES.has(itemType) || !isValidItemId(itemId)) {
      sendJson(res, 400, { error: 'Tham số type hoặc id không hợp lệ.' });
      return true;
    }
    await db.execute(
      `DELETE FROM ${favTable} WHERE user_id = ? AND item_type = ? AND item_id = ?`,
      [user.id, itemType, itemId]
    );
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
