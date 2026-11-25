import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

// Loaded via require so bundlers/vitest don't strip the `node:` prefix from the built-in.
const { DatabaseSync: SqliteDb } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export type Db = DatabaseSync;

/**
 * Portable schema: TEXT / INTEGER / REAL only, timestamps as naive ISO text,
 * JSON as TEXT, no SQLite-only features. Moving to the production database
 * means swapping the driver behind `Db` and running this same migration.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE shutdown (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     window_start TEXT, window_end TEXT,
     active_import_id INTEGER,
     created_at TEXT NOT NULL
   );
   CREATE TABLE import_run (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     shutdown_id INTEGER NOT NULL,
     filename TEXT NOT NULL,
     sha256 TEXT NOT NULL,
     uploaded_by TEXT,
     uploaded_at TEXT NOT NULL,
     status TEXT NOT NULL,            -- staged | committed | superseded | discarded
     committed_at TEXT,
     stats_json TEXT NOT NULL,
     parse_json TEXT,                 -- staged ParseResult; cleared after commit
     mapping_json TEXT NOT NULL,      -- {groupKey: page}
     window_start TEXT, window_end TEXT
   );
   CREATE TABLE import_issue (
     import_id INTEGER NOT NULL, source_row INTEGER NOT NULL,
     code TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL
   );
   CREATE INDEX ix_issue_import ON import_issue(import_id);
   CREATE TABLE grp (
     import_id INTEGER NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL,
     source_row INTEGER NOT NULL, ord INTEGER NOT NULL, page TEXT NOT NULL,
     planned_start TEXT, planned_finish TEXT,
     PRIMARY KEY (import_id, key)
   );
   CREATE TABLE job (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     import_id INTEGER NOT NULL, group_key TEXT NOT NULL,
     stable_key TEXT NOT NULL, source_row INTEGER NOT NULL,
     parent_row INTEGER, depth INTEGER NOT NULL,
     description TEXT NOT NULL, unit TEXT NOT NULL,
     teams TEXT NOT NULL, priority INTEGER NOT NULL,
     phase TEXT NOT NULL, type TEXT NOT NULL, is_marker INTEGER NOT NULL,
     planned_start TEXT, planned_finish TEXT, duration_hrs REAL,
     scheduled INTEGER NOT NULL, note TEXT
   );
   CREATE INDEX ix_job_import ON job(import_id, group_key);
   CREATE UNIQUE INDEX ux_job_key ON job(import_id, stable_key);
   CREATE TABLE job_dependency (
     import_id INTEGER NOT NULL, job_row INTEGER NOT NULL,
     depends_on_row INTEGER NOT NULL, kind TEXT NOT NULL, cross_group INTEGER NOT NULL
   );
   CREATE INDEX ix_dep_import ON job_dependency(import_id);
   -- Operator data is keyed by stable_key, NOT job id, so re-imports and rollbacks never lose it.
   CREATE TABLE job_progress (
     shutdown_id INTEGER NOT NULL, stable_key TEXT NOT NULL,
     status TEXT, progress INTEGER NOT NULL DEFAULT 0,
     actual_start TEXT, actual_finish TEXT, note TEXT,
     updated_by TEXT, updated_at TEXT NOT NULL,
     PRIMARY KEY (shutdown_id, stable_key)
   );
   CREATE TABLE job_event (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     shutdown_id INTEGER NOT NULL, stable_key TEXT NOT NULL,
     at TEXT NOT NULL, by TEXT, change_json TEXT NOT NULL
   );
   -- Remembered group -> page choices, applied to later uploads.
   CREATE TABLE group_mapping (name_key TEXT PRIMARY KEY, page TEXT NOT NULL);`,
];

export function openDb(path = ':memory:'): Db {
  const db = new SqliteDb(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL'); // readers don't block the single writer
  const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
