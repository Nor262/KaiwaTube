import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolConfig } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { PROJECT_ROOT, getEnvVar } from './env';

export type UserRole = 'user' | 'contributor' | 'admin';

export interface DbUser {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  created_at: string | Date;
}

export type DbTableName =
  | 'app_settings'
  | 'users'
  | 'favorites'
  | 'community_subtitles'
  | 'user_subtitles'
  | 'subtitle_reports'
  | 'kanji_mnemonics';

export interface DbClient {
  dialect: 'postgres' | 'sqlite';
  table(name: DbTableName): string;
  queryOne<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  queryAll<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  insertReturningId(sql: string, params?: unknown[]): Promise<number>;
  healthCheck(): Promise<void>;
}

const VALID_TABLES = new Set<DbTableName>([
  'app_settings',
  'users',
  'favorites',
  'community_subtitles',
  'user_subtitles',
  'subtitle_reports',
  'kanji_mnemonics',
]);

let clientPromise: Promise<DbClient> | null = null;
let clientConfigKey = '';
let activePgPool: Pool | null = null;
let activeSqliteDb: { exec: (sql: string) => void; close: () => void } | null = null;
let cachedJwtSecret: string | null = null;

export function normalizeDbTimestamp(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return val == null ? '' : String(val);
}

export function getDatabaseUrl(): string {
  return getEnvVar('POSTGRES_URL') || getEnvVar('DATABASE_URL');
}

export function getDbSchema(): string {
  const raw = getEnvVar('KAIWATUBE_DB_SCHEMA') || 'kaiwatube';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(raw)) {
    throw new Error(`Invalid KAIWATUBE_DB_SCHEMA identifier: ${raw}`);
  }
  return raw;
}

export function getDbPath(): string {
  const customPath = getEnvVar('NIHONGO_DB_PATH');
  return customPath || path.join(PROJECT_ROOT, 'nihongo.db');
}

/**
 * Converts `?` positional placeholders (outside SQL single-quoted string literals)
 * into PostgreSQL `$1, $2, ...` placeholders.
 */
export function convertPlaceholdersToPg(sql: string): string {
  let out = '';
  let paramIndex = 0;
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      out += ch;
      if (inSingleQuote && sql[i + 1] === "'") {
        out += sql[i + 1];
        i++;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }
    if (ch === '?' && !inSingleQuote) {
      paramIndex += 1;
      out += `$${paramIndex}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function buildPgPoolConfig(rawUrl: string): PoolConfig {
  let ssl: PoolConfig['ssl'] = { rejectUnauthorized: false };
  let connectionString = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (isLocal && parsed.searchParams.get('sslmode') !== 'require') {
      ssl = false;
    }
    parsed.searchParams.delete('sslmode');
    connectionString = parsed.toString();
  } catch {
    // Fall back to raw connection string
  }

  return {
    connectionString,
    ssl,
    max: 5,
    idleTimeoutMillis: 15_000,
    connectionTimeoutMillis: 10_000,
  };
}

function assertValidTable(name: DbTableName): DbTableName {
  if (!VALID_TABLES.has(name)) {
    throw new Error(`Unknown database table: ${String(name)}`);
  }
  return name;
}

async function createPostgresClient(connUrl: string, schema: string): Promise<DbClient> {
  const pool = new Pool(buildPgPoolConfig(connUrl));
  try {
    attachDatabasePool(pool);
  } catch {
    // No-op when running outside Vercel Fluid Compute
  }
  activePgPool = pool;

  const table = (name: DbTableName) => `"${schema}"."${assertValidTable(name)}"`;

  return {
    dialect: 'postgres',
    table,
    async queryOne<T = Record<string, any>>(sql: string, params: unknown[] = []) {
      const pgSql = convertPlaceholdersToPg(sql);
      const res = await pool.query(pgSql, params);
      return res.rows[0] as T | undefined;
    },
    async queryAll<T = Record<string, any>>(sql: string, params: unknown[] = []) {
      const pgSql = convertPlaceholdersToPg(sql);
      const res = await pool.query(pgSql, params);
      return res.rows as T[];
    },
    async execute(sql: string, params: unknown[] = []) {
      const pgSql = convertPlaceholdersToPg(sql);
      const res = await pool.query(pgSql, params);
      return { changes: Number(res.rowCount || 0) };
    },
    async insertReturningId(sql: string, params: unknown[] = []) {
      const clean = sql.trim().replace(/;+$/, '');
      const withReturning = /\bRETURNING\b/i.test(clean) ? clean : `${clean} RETURNING id`;
      const pgSql = convertPlaceholdersToPg(withReturning);
      const res = await pool.query(pgSql, params);
      return Number(res.rows[0]?.id || 0);
    },
    async healthCheck() {
      await pool.query('SELECT 1 AS ok');
    },
  };
}

async function createSqliteClient(dbPath: string): Promise<DbClient> {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const { DatabaseSync } = await import('node:sqlite');
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

  activeSqliteDb = db;

  const table = (name: DbTableName) => assertValidTable(name);

  return {
    dialect: 'sqlite',
    table,
    async queryOne<T = Record<string, any>>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).get(...(params as any[])) as T | undefined;
    },
    async queryAll<T = Record<string, any>>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as any[])) as T[];
    },
    async execute(sql: string, params: unknown[] = []) {
      const info = db.prepare(sql).run(...(params as any[]));
      return { changes: Number(info.changes || 0) };
    },
    async insertReturningId(sql: string, params: unknown[] = []) {
      const info = db.prepare(sql).run(...(params as any[]));
      return Number(info.lastInsertRowid || 0);
    },
    async healthCheck() {
      db.prepare('SELECT 1 AS ok').get();
    },
  };
}

export async function getDb(): Promise<DbClient> {
  const dbUrl = getDatabaseUrl();
  const nextKey = dbUrl
    ? `postgres:${dbUrl}:${getDbSchema()}`
    : `sqlite:${getDbPath()}`;

  if (clientPromise && clientConfigKey === nextKey) {
    return clientPromise;
  }

  if (clientPromise && clientConfigKey !== nextKey) {
    await closeDb();
  }

  clientConfigKey = nextKey;
  clientPromise = dbUrl
    ? createPostgresClient(dbUrl, getDbSchema())
    : createSqliteClient(getDbPath());

  try {
    return await clientPromise;
  } catch (err) {
    clientPromise = null;
    clientConfigKey = '';
    throw err;
  }
}

export async function closeDb(): Promise<void> {
  clientPromise = null;
  clientConfigKey = '';
  cachedJwtSecret = null;

  if (activePgPool) {
    const pool = activePgPool;
    activePgPool = null;
    try {
      await pool.end();
    } catch {
      // Best-effort pool teardown
    }
  }

  if (activeSqliteDb) {
    const sqlite = activeSqliteDb;
    activeSqliteDb = null;
    try {
      sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // Best-effort WAL checkpoint
    }
    try {
      sqlite.close();
    } catch {
      // Ignore close errors during shutdown
    }
  }
}

export async function getJwtSecret(): Promise<string> {
  const envSecret = getEnvVar('JWT_SECRET');
  if (envSecret && envSecret.length >= 16) return envSecret;
  if (cachedJwtSecret) return cachedJwtSecret;

  const db = await getDb();
  const settingsTable = db.table('app_settings');
  const existing = await db.queryOne<{ value: string }>(
    `SELECT value FROM ${settingsTable} WHERE key = ?`,
    ['jwt_secret']
  );
  if (existing?.value) {
    cachedJwtSecret = existing.value;
    return existing.value;
  }

  const generated = crypto.randomBytes(32).toString('hex');
  await db.execute(
    `INSERT INTO ${settingsTable} (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`,
    ['jwt_secret', generated]
  );
  const stored = await db.queryOne<{ value: string }>(
    `SELECT value FROM ${settingsTable} WHERE key = ?`,
    ['jwt_secret']
  );
  cachedJwtSecret = stored?.value || generated;
  return cachedJwtSecret;
}
