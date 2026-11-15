import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDb } from './db';
import { getAuthUser } from './auth';
import { getRequestUrl, readJsonBody, sendJson } from './httpUtils';
import { isSafeHttpUrl, isValidItemId, sanitizeText } from './security';

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

export async function handleFavoriteRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  if (pathname !== '/api/favorites') return false;

  const db = getDb();
  const method = (req.method || 'GET').toUpperCase();
  const url = getRequestUrl(req);
  const user = getAuthUser(req);

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

    const rows = (
      typeFilter
        ? db
            .prepare(
              `SELECT id, item_type, item_id, title, subtitle, thumbnail, meta_json, created_at
               FROM favorites WHERE user_id = ? AND item_type = ? ORDER BY created_at DESC LIMIT 500`
            )
            .all(user.id, typeFilter)
        : db
            .prepare(
              `SELECT id, item_type, item_id, title, subtitle, thumbnail, meta_json, created_at
               FROM favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`
            )
            .all(user.id)
    ) as any[];

    const favorites = rows.map((r) => ({
      id: r.id,
      itemType: r.item_type,
      itemId: r.item_id,
      title: r.title,
      subtitle: r.subtitle || '',
      thumbnail: isSafeHttpUrl(r.thumbnail || ''),
      meta: safeParseMetaObject(r.meta_json),
      createdAt: r.created_at,
    }));

    sendJson(res, 200, { favorites });
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

    db.prepare(
      `INSERT INTO favorites (user_id, item_type, item_id, title, subtitle, thumbnail, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET
         title = excluded.title,
         subtitle = excluded.subtitle,
         thumbnail = excluded.thumbnail,
         meta_json = excluded.meta_json`
    ).run(user.id, itemType, itemId, title, subtitle, safeThumbnail, metaJson);

    const saved = db
      .prepare(
        `SELECT id, item_type, item_id, title, subtitle, thumbnail, meta_json, created_at
         FROM favorites WHERE user_id = ? AND item_type = ? AND item_id = ?`
      )
      .get(user.id, itemType, itemId) as any;

    sendJson(res, 200, {
      favorite: {
        id: saved.id,
        itemType: saved.item_type,
        itemId: saved.item_id,
        title: saved.title,
        subtitle: saved.subtitle || '',
        thumbnail: isSafeHttpUrl(saved.thumbnail || ''),
        meta: safeParseMetaObject(saved.meta_json),
        createdAt: saved.created_at,
      },
    });
    return true;
  }

  if (method === 'DELETE') {
    const itemType = (url.searchParams.get('type') || '').trim();
    const itemId = (url.searchParams.get('id') || '').trim();
    if (!ALLOWED_FAVORITE_TYPES.has(itemType) || !isValidItemId(itemId)) {
      sendJson(res, 400, { error: 'Tham số type hoặc id không hợp lệ.' });
      return true;
    }
    db.prepare(
      'DELETE FROM favorites WHERE user_id = ? AND item_type = ? AND item_id = ?'
    ).run(user.id, itemType, itemId);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
