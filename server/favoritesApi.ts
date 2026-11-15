import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDb } from './db';
import { getAuthUser } from './auth';
import { getRequestUrl, readJsonBody, sendJson } from './httpUtils';

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
    const rows = (
      typeFilter
        ? db
            .prepare(
              `SELECT id, item_type, item_id, title, subtitle, thumbnail, meta_json, created_at
               FROM favorites WHERE user_id = ? AND item_type = ? ORDER BY created_at DESC`
            )
            .all(user.id, typeFilter)
        : db
            .prepare(
              `SELECT id, item_type, item_id, title, subtitle, thumbnail, meta_json, created_at
               FROM favorites WHERE user_id = ? ORDER BY created_at DESC`
            )
            .all(user.id)
    ) as any[];

    const favorites = rows.map((r) => ({
      id: r.id,
      itemType: r.item_type,
      itemId: r.item_id,
      title: r.title,
      subtitle: r.subtitle || '',
      thumbnail: r.thumbnail || '',
      meta: (() => {
        try {
          return JSON.parse(r.meta_json || '{}');
        } catch {
          return {};
        }
      })(),
      createdAt: r.created_at,
    }));

    sendJson(res, 200, { favorites });
    return true;
  }

  if (method === 'POST') {
    const body = await readJsonBody(req);
    const itemType = String(body.itemType || '').trim();
    const itemId = String(body.itemId || '').trim();
    const title = String(body.title || '').trim();
    const subtitle = String(body.subtitle || '').trim();
    const thumbnail = String(body.thumbnail || '').trim();
    const metaJson = JSON.stringify(body.meta || {});

    if (!['video', 'playlist', 'anime'].includes(itemType) || !itemId || !title) {
      sendJson(res, 400, { error: 'Thiếu thông tin itemType, itemId hoặc title.' });
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
    ).run(user.id, itemType, itemId, title, subtitle, thumbnail, metaJson);

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
        thumbnail: saved.thumbnail || '',
        meta: JSON.parse(saved.meta_json || '{}'),
        createdAt: saved.created_at,
      },
    });
    return true;
  }

  if (method === 'DELETE') {
    const itemType = (url.searchParams.get('type') || '').trim();
    const itemId = (url.searchParams.get('id') || '').trim();
    if (!itemType || !itemId) {
      sendJson(res, 400, { error: 'Thiếu type hoặc id để xóa.' });
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
