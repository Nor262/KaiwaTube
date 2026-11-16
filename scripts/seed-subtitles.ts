import yts from 'yt-search';
import { closeDb, getDb } from '../server/db.js';
import { loadEnv } from '../server/env.js';
import { fetchFullYouTubeSubtitles } from '../server/media.js';
import {
  isValidYouTubePlaylistId,
  isValidYouTubeVideoId,
  sanitizeText,
} from '../server/security.js';

async function fetchOembedTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`
      )}&format=json`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return '';
    const data = (await res.json()) as { title?: string };
    return sanitizeText(data?.title || '', 160);
  } catch {
    return '';
  }
}

async function resolveVideoIdsFromArg(arg: string): Promise<string[]> {
  const trimmed = arg.trim();
  if (!trimmed) return [];
  if (isValidYouTubeVideoId(trimmed)) return [trimmed];
  if (/^(PL|UU|OL)/.test(trimmed) && isValidYouTubePlaylistId(trimmed)) {
    const pl = await yts({ listId: trimmed });
    return (pl.videos || [])
      .map((v: any) => String(v?.videoId || '').trim())
      .filter((id: string) => isValidYouTubeVideoId(id));
  }

  try {
    const u = new URL(trimmed);
    const vParam = (u.searchParams.get('v') || '').trim();
    if (isValidYouTubeVideoId(vParam)) return [vParam];

    const listParam = (u.searchParams.get('list') || '').trim();
    if (isValidYouTubePlaylistId(listParam)) {
      const pl = await yts({ listId: listParam });
      return (pl.videos || [])
        .map((v: any) => String(v?.videoId || '').trim())
        .filter((id: string) => isValidYouTubeVideoId(id));
    }

    if (u.hostname === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0] || '';
      if (isValidYouTubeVideoId(id)) return [id];
    }
  } catch {
    // Not a URL
  }
  return [];
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Cách dùng: bun run seed:subs <videoId|playlistId|YouTubeURL> [...]');
    process.exit(1);
  }

  const videoIds = Array.from(
    new Set((await Promise.all(args.map(resolveVideoIdsFromArg))).flat())
  );
  if (videoIds.length === 0) {
    console.error('Không tìm thấy videoId/playlistId hợp lệ.');
    process.exit(1);
  }

  const db = await getDb();
  const communityTable = db.table('community_subtitles');
  const authorName = 'KaiwaTube Community';

  for (const vid of videoIds) {
    process.stdout.write(`Đang lấy phụ đề cho ${vid}... `);
    const cues = await fetchFullYouTubeSubtitles(vid);
    if (!cues.length) {
      console.log('bỏ qua (không có CC).');
      continue;
    }

    const title = (await fetchOembedTitle(vid)) || `Sub Song ngữ (${vid})`;
    const cuesJson = JSON.stringify(cues);
    const existing = await db.queryOne<{ id: number }>(
      `SELECT id FROM ${communityTable} WHERE video_id = ? AND author_name = ? LIMIT 1`,
      [vid, authorName]
    );

    if (existing) {
      await db.execute(
        `UPDATE ${communityTable} SET title = ?, source_type = ?, cues_json = ?, cue_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [title, 'uploaded', cuesJson, cues.length, Number(existing.id)]
      );
      console.log(`cập nhật (${cues.length} câu).`);
    } else {
      await db.insertReturningId(
        `INSERT INTO ${communityTable} (video_id, title, source_type, author_id, author_name, cues_json, cue_count) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [vid, title, 'uploaded', null, authorName, cuesJson, cues.length]
      );
      console.log(`đã lưu mới (${cues.length} câu).`);
    }
  }

  await closeDb();
}

void main();
