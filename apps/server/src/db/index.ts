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
  `);
}
