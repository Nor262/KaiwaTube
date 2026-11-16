import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { PROJECT_ROOT, getEnvVar } from './env';

export type UserRole = 'user' | 'contributor' | 'admin';

export interface DbUser {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
}

let dbInstance: DatabaseSync | null = null;

export function getDbPath(): string {
  const customPath = getEnvVar('NIHONGO_DB_PATH');
  return customPath || path.join(PROJECT_ROOT, 'nihongo.db');
}

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dbPath = getDbPath();
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      thumbnail TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, item_type, item_id)
    );

    CREATE TABLE IF NOT EXISTS community_subtitles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      cues_json TEXT NOT NULL,
      cue_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_subtitles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      cues_json TEXT NOT NULL,
      cue_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, video_id, source_type)
    );

    CREATE TABLE IF NOT EXISTS subtitle_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      community_sub_id INTEGER NOT NULL REFERENCES community_subtitles(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(community_sub_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS kanji_mnemonics (
      kanji TEXT PRIMARY KEY,
      han_viet TEXT NOT NULL DEFAULT '',
      decomposition TEXT NOT NULL,
      mnemonic TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_community_sub_video ON community_subtitles(video_id);
    CREATE INDEX IF NOT EXISTS idx_user_sub_lookup ON user_subtitles(user_id, video_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, item_type);
  `);

  dbInstance = db;
  return dbInstance;
}

export function closeDb(): void {
  if (!dbInstance) return;
  try {
    dbInstance.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // Best-effort WAL checkpoint during container shutdown
  }
  try {
    dbInstance.close();
  } finally {
    dbInstance = null;
  }
}

export function getJwtSecret(): string {
  const envSecret = getEnvVar('JWT_SECRET');
  if (envSecret && envSecret.length >= 16) return envSecret;

  const db = getDb();
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('jwt_secret') as { value: string } | undefined;
  if (row?.value) return row.value;

  const generated = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(
    'jwt_secret',
    generated
  );
  return generated;
}
