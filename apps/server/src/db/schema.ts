import { sqliteTable, text, uniqueIndex, integer, real } from "drizzle-orm/sqlite-core";

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
  /** JSON-encoded array of numeric Freelancer.com skill/category ids for the user's skills. */
  skillIds: text("skill_ids"),
  experience: text("experience"),
  portfolio: text("portfolio"),
  certifications: text("certifications"),
  preferredProjectTypes: text("preferred_project_types"),
  wants: text("wants"),
  notWants: text("not_wants"),
  customInstructions: text("custom_instructions"),
  importedFromFreelancer: text("imported_from_freelancer").notNull().default("0"),
  userSummary: text("user_summary"),
  updatedAt: text("updated_at").notNull(),
});

export const jobs = sqliteTable("jobs", {
  /** Internal job id format: "job-{projectId}". */
  id: text("id").primaryKey(),
  /** Freelancer.com project id (number on the wire). */
  projectId: integer("project_id").notNull(),
  title: text("title").notNull(),
  client: text("client").notNull(),
  clientCountry: text("client_country").notNull(),
  budgetLabel: text("budget_label").notNull(),
  skills: text("skills"),
  postedLabel: text("posted_label").notNull(),
  bidCount: integer("bid_count").notNull(),
  avgBidLabel: text("avg_bid_label").notNull(),
  matchScore: integer("match_score"),
  severity: text("severity"),
  status: text("status").notNull(),
  analysis: text("analysis"),
  /** Raw JSON of the full Freelancer.com API project response. */
  rawData: text("raw_data"),
  lastAnalyzedAt: text("last_analyzed_at"),
  ignoredAt: text("ignored_at"),
  importedAt: text("imported_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("jobs_project_id_unique").on(table.projectId),
]);

/** Competition data: individual bids stored per-project for later analysis. */
export const bids = sqliteTable("bids", {
  /** Internal id: "bid-{projectId}-{index}". */
  id: text("id").primaryKey(),
  /** Freelancer.com project id — links to jobs.projectId. */
  projectId: integer("project_id").notNull(),
  /** Freelancer.com bidder user id (may be null if absent). */
  bidderId: integer("bidder_id"),
  bidderName: text("bidder_name"),
  /** Bid amount in the project's currency. */
  amount: real("amount"),
  currencyCode: text("currency_code"),
  /** Whether this was the cheapest bid. */
  isCheapest: integer("is_cheapest").default(0).notNull(),
  /** Unix timestamp of bid submission. */
  timeSubmitted: integer("time_submitted"),
  /** Brief excerpt of the proposal text (for context, not storage of full text). */
  description: text("description"),
  /** When we last fetched/updated the bids for this project. */
  fetchedAt: text("fetched_at").notNull(),
}, (table) => [
  uniqueIndex("bids_project_bidder_unique").on(table.projectId, table.bidderId),
]);

export const proposals = sqliteTable("proposals", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  jobId: text("job_id").notNull(),
  projectId: integer("project_id").notNull(),
  jobTitle: text("job_title").notNull(),
  client: text("client").notNull(),
  bidAmount: integer("bid_amount"),
  status: text("status").notNull().default("draft"),
  content: text("content").notNull(),
  competitorNote: text("competitor_note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("proposals_user_job_unique").on(table.userId, table.jobId),
]);

/** The user's own bids on Freelancer.com — distinct from competitor bids. */
export const userBids = sqliteTable("user_bids", {
  /** Internal id: "bid-{projectId}-{timestamp}". */
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull(),
  /** Links to the proposal row whose text was submitted, if any. */
  proposalId: text("proposal_id").references(() => proposals.id, { onDelete: "set null" }),
  jobTitle: text("job_title").notNull(),
  client: text("client").notNull(),
  amount: integer("amount").notNull(),
  /** Bid period in days. */
  period: integer("period").notNull(),
  /** 0–100 percentage of the project placed as a milestone upfront. */
  milestonePercentage: integer("milestone_percentage").notNull().default(0),
  description: text("description").notNull(),
  status: text("status").notNull().default("submitted"),
  outcome: text("outcome"),
  via: text("via").notNull().default("manual"),
  submittedAt: text("submitted_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Per-user automation configuration, disabled by default. */
export const automationSettings = sqliteTable("automation_settings", {
  userId: text("user_id")
    .notNull()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  scanIntervalSeconds: integer("scan_interval_seconds").notNull().default(60),
  autoAnalyze: integer("auto_analyze").notNull().default(0),
  autoMatch: integer("auto_match").notNull().default(0),
  autoDraft: integer("auto_draft").notNull().default(0),
  autobidEnabled: integer("autobid_enabled").notNull().default(0),
  minMatchScore: integer("min_match_score").notNull().default(80),
  minBid: integer("min_bid").notNull().default(0),
  maxBid: integer("max_bid").notNull().default(0),
  dailyCap: integer("daily_cap").notNull().default(5),
  bidsToday: integer("bids_today").notNull().default(0),
  capDate: text("cap_date"),
  paused: integer("paused").notNull().default(0),
  /** Consecutive pipeline errors before auto-pause kicks in. */
  consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Log entries for every automation decision. */
export const automationRuns = sqliteTable("automation_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull(),
});
