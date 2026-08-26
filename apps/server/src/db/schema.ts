import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Foundation schema. Tables for credentials, jobs, and proposals are added
 * in their own phases — this file holds what auth needs plus the log table.
 */
export const logs = sqliteTable("logs", {
  id: text("id").primaryKey(),
  time: text("time").notNull(),
  level: text("level").notNull(),
  category: text("category").notNull(),
  message: text("message").notNull(),
  meta: text("meta"),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const backupCodes = sqliteTable("backup_codes", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
});

export const platformCredentials = sqliteTable("platform_credentials", {
  /** Fixed platform id: "freelancer" | "openrouter". */
  id: text("id").primaryKey(),
  cipherText: text("cipher_text").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  /** JSON metadata, e.g. { modelId } for OpenRouter. Never secrets. */
  meta: text("meta"),
  /** "untested" | "ok" | "failed" — result of the last test action. */
  status: text("status").notNull().default("untested"),
  lastTestedAt: text("last_tested_at"),
  updatedAt: text("updated_at").notNull(),
});

export const userProfile = sqliteTable("user_profile", {
  /** Owner's user id — one profile per installation. */
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  freelancerUsername: text("freelancer_username"),
  name: text("name"),
  title: text("title"),
  hourlyRate: text("hourly_rate"),
  about: text("about"),
  /** JSON-encoded string arrays and structured lists. */
  skills: text("skills"),
  experience: text("experience"),
  portfolio: text("portfolio"),
  certifications: text("certifications"),
  preferredProjectTypes: text("preferred_project_types"),
  wants: text("wants"),
  notWants: text("not_wants"),
  customInstructions: text("custom_instructions"),
  importedFromFreelancer: text("imported_from_freelancer").notNull().default("0"),
  updatedAt: text("updated_at").notNull(),
});
