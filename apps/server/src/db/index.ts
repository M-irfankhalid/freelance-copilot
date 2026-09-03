import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { env } from "../env.js";
import * as schema from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

let client: Database.Database | null = null;

/**
 * Lazy singleton database connection. The path comes from DATABASE_PATH so
 * tests can use ":memory:" and production uses ./data/app.db (git-ignored).
 */
export function getDb(): Db {
  if (client === null) {
    const path =
      env.DATABASE_PATH === ":memory:" ? ":memory:" : resolve(env.DATABASE_PATH);
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    client = new Database(path);
    client.pragma("journal_mode = WAL");
    ensureSchema(client);
  }
  return drizzle(client, { schema });
}

/** Close cleanly on shutdown or between tests. */
export function closeDb(): void {
  client?.close();
  client = null;
}

/**
 * Idempotent bootstrap of the current schema. Drizzle-kit manages migrations
 * from Phase 4 onward; this keeps a fresh install working with zero steps.
 */
function ensureSchema(db: Database.Database): void {
  // The `jobs` table was added in Phase 7 with `project_id` as TEXT, then
  // later changed to INTEGER. Older databases still have the TEXT column.
  // If we find one, drop it so the new schema takes effect cleanly. The
  // table is a local-only cache of public Freelancer data — nothing to lose.
  const jobCols = db
    .prepare("PRAGMA table_info(jobs)")
    .all() as Array<{ name: string; type: string }>;
  if (jobCols.length > 0) {
    const pidType = jobCols.find((c) => c.name === "project_id")?.type ?? "";
    if (pidType.toUpperCase() !== "INTEGER") {
      db.exec("DROP TABLE jobs");
    }
  }

  // Backfill any missing columns on user_profile. We use ALTER TABLE ADD COLUMN
  // (not DROP) because this table holds user-entered data we must not destroy.
  const profileCols = db
    .prepare("PRAGMA table_info(user_profile)")
    .all() as Array<{ name: string }>;
  if (profileCols.length > 0) {
    const profileColNames = new Set(profileCols.map((c) => c.name));
    for (const col of [
      "user_summary",
      "skill_ids",
      "ignored_countries",
      "relevancy_instructions",
      "portfolio_summary",
      "proposal_templates",
    ] as const) {
      if (!profileColNames.has(col)) {
        db.exec(`ALTER TABLE user_profile ADD COLUMN ${col} TEXT`);
      }
    }
  }

  // Backfill raw_data column on jobs (non-breaking addition for existing DBs).
  const jobsCols = db
    .prepare("PRAGMA table_info(jobs)")
    .all() as Array<{ name: string }>;
  if (jobsCols.length > 0) {
    const jobsColNames = new Set(jobsCols.map((c) => c.name));
    if (!jobsColNames.has("raw_data")) {
      db.exec("ALTER TABLE jobs ADD COLUMN raw_data TEXT");
    }
    if (!jobsColNames.has("rejection_reason")) {
      db.exec("ALTER TABLE jobs ADD COLUMN rejection_reason TEXT");
    }
    if (!jobsColNames.has("auto_bid_failed_at")) {
      db.exec("ALTER TABLE jobs ADD COLUMN auto_bid_failed_at TEXT");
    }
    if (!jobsColNames.has("auto_bid_error")) {
      db.exec("ALTER TABLE jobs ADD COLUMN auto_bid_error TEXT");
    }
  }

  // Backfill consecutive_errors column on automation_settings (Phase 12).
  const autoCols = db
    .prepare("PRAGMA table_info(automation_settings)")
    .all() as Array<{ name: string }>;
  if (autoCols.length > 0) {
    const autoColNames = new Set(autoCols.map((c) => c.name));
    if (!autoColNames.has("consecutive_errors")) {
      db.exec("ALTER TABLE automation_settings ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0");
    }
    if (!autoColNames.has("proposal_threshold")) {
      db.exec("ALTER TABLE automation_settings ADD COLUMN proposal_threshold INTEGER NOT NULL DEFAULT 70");
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      time TEXT NOT NULL,
      level TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      meta TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      freelancer_username TEXT,
      name TEXT,
      title TEXT,
      hourly_rate TEXT,
      about TEXT,
      skills TEXT,
      skill_ids TEXT,
      experience TEXT,
      portfolio TEXT,
      certifications TEXT,
      preferred_project_types TEXT,
      wants TEXT,
      not_wants TEXT,
      ignored_countries TEXT,
      custom_instructions TEXT,
      imported_from_freelancer TEXT NOT NULL DEFAULT '0',
      user_summary TEXT,
      relevancy_instructions TEXT,
      portfolio_summary TEXT,
      proposal_templates TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_credentials (
      id TEXT PRIMARY KEY,
      cipher_text TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      meta TEXT,
      status TEXT NOT NULL DEFAULT 'untested',
      last_tested_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      client TEXT NOT NULL,
      client_country TEXT NOT NULL,
      budget_label TEXT NOT NULL,
      skills TEXT,
      posted_label TEXT NOT NULL,
      bid_count INTEGER NOT NULL,
      avg_bid_label TEXT NOT NULL,
      match_score INTEGER,
      severity TEXT,
      status TEXT NOT NULL,
      analysis TEXT,
      raw_data TEXT,
      last_analyzed_at TEXT,
      ignored_at TEXT,
      rejection_reason TEXT,
      auto_bid_failed_at TEXT,
      auto_bid_error TEXT,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS jobs_project_id_unique ON jobs (project_id);

    CREATE TABLE IF NOT EXISTS bids (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL,
      bidder_id INTEGER,
      bidder_name TEXT,
      amount REAL,
      currency_code TEXT,
      is_cheapest INTEGER NOT NULL DEFAULT 0,
      time_submitted INTEGER,
      description TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS bids_project_bidder_unique ON bids (project_id, bidder_id);

    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      job_id TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      job_title TEXT NOT NULL,
      client TEXT NOT NULL,
      bid_amount INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      content TEXT NOT NULL,
      competitor_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS proposals_user_job_unique ON proposals (user_id, job_id);

    CREATE TABLE IF NOT EXISTS user_bids (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL,
      proposal_id TEXT REFERENCES proposals (id) ON DELETE SET NULL,
      job_title TEXT NOT NULL,
      client TEXT NOT NULL,
      amount INTEGER NOT NULL,
      period INTEGER NOT NULL,
      milestone_percentage INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      outcome TEXT,
      via TEXT NOT NULL DEFAULT 'manual',
      submitted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automation_settings (
      user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      scan_interval_seconds INTEGER NOT NULL DEFAULT 60,
      auto_analyze INTEGER NOT NULL DEFAULT 0,
      auto_match INTEGER NOT NULL DEFAULT 0,
      auto_draft INTEGER NOT NULL DEFAULT 0,
      autobid_enabled INTEGER NOT NULL DEFAULT 0,
      proposal_threshold INTEGER NOT NULL DEFAULT 70,
      min_match_score INTEGER NOT NULL DEFAULT 80,
      min_bid INTEGER NOT NULL DEFAULT 0,
      max_bid INTEGER NOT NULL DEFAULT 0,
      daily_cap INTEGER NOT NULL DEFAULT 5,
      bids_today INTEGER NOT NULL DEFAULT 0,
      cap_date TEXT,
      paused INTEGER NOT NULL DEFAULT 0,
      consecutive_errors INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discord_settings (
      user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      webhook_cipher_text TEXT,
      webhook_iv TEXT,
      webhook_auth_tag TEXT,
      events TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
  `);
}
