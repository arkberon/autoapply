import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = path.join(APP_DIR, 'data')
export const KIT_DIR =
  process.env.KIT_DIR ?? path.resolve(APP_DIR, '../JobListAll/outputs/2026-09-28/AI_application_kit')

fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(path.join(DATA_DIR, 'app.db'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    market TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    ats TEXT NOT NULL,
    mode TEXT NOT NULL,
    org TEXT,
    posting_id TEXT,
    fit TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL,
    priority_reason TEXT NOT NULL DEFAULT '',
    priority_locked INTEGER NOT NULL DEFAULT 0,
    salary_low INTEGER,
    salary_high INTEGER,
    status TEXT NOT NULL DEFAULT 'not_started',
    live TEXT NOT NULL DEFAULT 'unknown',
    live_note TEXT NOT NULL DEFAULT '',
    live_checked_at TEXT,
    last_checked TEXT,
    applied_at TEXT,
    dup_of TEXT,
    hold INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    raw TEXT NOT NULL DEFAULT '{}'
  );

  -- Saved answers to the setup questions, reused on every application.
  CREATE TABLE IF NOT EXISTS answers (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    source TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Per-job written answers drafted earlier (from the kit's answers.json files).
  CREATE TABLE IF NOT EXISTS drafts (
    job_id TEXT NOT NULL,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (job_id, label)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT,
    at TEXT NOT NULL,
    type TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
`)

export const now = () => new Date().toISOString()

const getSettingStmt = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
)

export function getSetting(key: string, fallback = ''): string {
  return getSettingStmt.get(key)?.value ?? fallback
}

export function setSetting(key: string, value: string) {
  setSettingStmt.run(key, value)
}

const eventStmt = db.prepare('INSERT INTO events (job_id, at, type, detail) VALUES (?, ?, ?, ?)')

export function logEvent(jobId: string | null, type: string, detail = '') {
  eventStmt.run(jobId, now(), type, detail)
}
