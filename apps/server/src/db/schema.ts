import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Foundation schema. Tables for auth, credentials, jobs, and proposals are
 * added in their own phases — this file only holds what Phase 2 needs.
 */
export const logs = sqliteTable("logs", {
  id: text("id").primaryKey(),
  /** ISO 8601 timestamp. */
  time: text("time").notNull(),
  level: text("level").notNull(),
  category: text("category").notNull(),
  message: text("message").notNull(),
  /** JSON-encoded redacted metadata, when present. */
  meta: text("meta"),
});
