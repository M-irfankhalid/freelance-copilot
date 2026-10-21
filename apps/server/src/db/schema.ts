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
  /** JSON-encoded string arrays. */
  skills: text("skills"),
  /** JSON-encoded array of numeric Freelancer.com skill/category ids for the user's skills. */
  skillIds: text("skill_ids"),
  preferredProjectTypes: text("preferred_project_types"),
  wants: text("wants"),
  notWants: text("not_wants"),
  /** Country names/codes whose jobs are excluded before analysis. JSON array. */
  ignoredCountries: text("ignored_countries"),
  customInstructions: text("custom_instructions"),
  importedFromFreelancer: text("imported_from_freelancer").notNull().default("0"),
  userSummary: text("user_summary"),
  /** Free-text guidance for the relevance model (Model A), e.g. "no web3". */
  relevancyInstructions: text("relevancy_instructions"),
  /** Markdown summary of the user's portfolio projects, used in proposals. */
  portfolioSummary: text("portfolio_summary"),
    /** Markdown block holding all the user's proposal templates, used in proposals. */
    proposalTemplates: text("proposal_templates"),
    /** Editable system prompt for proposal generation. Null means use the default. */
    proposalSystemInstructions: text("proposal_system_instructions"),
    /** Editable pre-instructions placed before profile facts in the proposal prompt. */
    proposalWritingInstructions: text("proposal_writing_instructions"),
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
  /**
   * JSON of the client-trust snapshot (payment/deposit/email verification,
   * account age, overall reputation, upgrade flags). Kept separate from
   * rawData so quality gates and alerts never have to parse the full blob.
   */
  clientQuality: text("client_quality"),
  /** Raw JSON of the full Freelancer.com API project response. */
  rawData: text("raw_data"),
  lastAnalyzedAt: text("last_analyzed_at"),
  ignoredAt: text("ignored_at"),
  /** Why the job was rejected/ignored — set by the system or manual ignore. */
  rejectionReason: text("rejection_reason"),
  /** When the last automatic bid attempt failed — gates auto-bid retries. */
  autoBidFailedAt: text("auto_bid_failed_at"),
  /** Error message from the last failed automatic bid attempt. */
  autoBidError: text("auto_bid_error"),
  /**
   * Delivery time (days) the relevance gate chose for this project, when the
   * user has AI timeline selection on. Null means "no AI pick" — auto-bid then
   * falls back to the user's preferred delivery time.
   */
  deliveryDays: integer("delivery_days"),
  /**
   * Bid amount the relevance gate chose for this project, when the user has AI
   * bid-amount selection on. Null means "no AI pick" — auto-bid then prices off
   * the project's minimum budget as before.
   */
  bidAmount: integer("bid_amount"),
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
  /**
   * Freelancer.com's own bid id, returned when the bid is placed. Needed to
   * update the bid later (`PUT /bids/{bid_id}/`). Null for bids placed before
   * the id was captured, or when the API responded without one — the Update bid
   * dialog lets the user supply it by hand in that case.
   */
  freelancerBidId: integer("freelancer_bid_id"),
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
  /** Minimum relevance score to auto-draft a proposal (Model A score). */
  proposalThreshold: integer("proposal_threshold").notNull().default(70),
  /** Minimum relevance score to auto-bid. */
  minMatchScore: integer("min_match_score").notNull().default(80),
  minBid: integer("min_bid").notNull().default(0),
  maxBid: integer("max_bid").notNull().default(0),
  dailyCap: integer("daily_cap").notNull().default(5),
  bidsToday: integer("bids_today").notNull().default(0),
  capDate: text("cap_date"),
  paused: integer("paused").notNull().default(0),
  /** Consecutive pipeline errors before auto-pause kicks in. */
  consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  /** Pre-analysis rejection rules — each can be switched off in Automation. */
  rejectStaleJobs: integer("reject_stale_jobs").notNull().default(1),
  /** Master switch for the free keyword/country screen run at poll time. */
  cheapScreeningEnabled: integer("cheap_screening_enabled").notNull().default(1),
  rejectIgnoredCountries: integer("reject_ignored_countries").notNull().default(1),
  rejectNotWants: integer("reject_not_wants").notNull().default(1),
  rejectMissingWants: integer("reject_missing_wants").notNull().default(1),
  rejectBadReputation: integer("reject_bad_reputation").notNull().default(1),
  /** Let the relevance gate pick each project's delivery time. */
  aiDeliveryTimeline: integer("ai_delivery_timeline").notNull().default(0),
  /** Delivery time (days) quoted when AI selection is off. */
  preferredDeliveryDays: integer("preferred_delivery_days").notNull().default(4),
  /** JSON array of the day values the AI may choose from. Null → the default list. */
  deliveryTimelineOptions: text("delivery_timeline_options"),
  /** Free-text guidance for the pick. Null → the default text. */
  deliveryTimelineInstructions: text("delivery_timeline_instructions"),
  /** Let the relevance gate pick each project's bid amount from a fraction of the project max. */
  aiBidAmount: integer("ai_bid_amount").notNull().default(0),
  /** JSON array of the fraction strings the AI may choose from (e.g. ["1/2","1/3","2/3","full"]). */
  bidAmountFractions: text("bid_amount_fractions"),
  /** Free-text guidance for the bid-amount pick. Null → the default text. */
  bidAmountInstructions: text("bid_amount_instructions"),
  /** When AI bid selection is off, markup the minimum by this % of the project max. */
  defaultBidMarkupPct: integer("default_bid_markup_pct").notNull().default(0),
  /** Guidance for the default markup rule. Null → the default text. */
  bidAmountMarkupInstructions: text("bid_amount_markup_instructions"),
  /** Round the final bid amount to the nearest multiple of this value (0 = no rounding). */
  roundBidUpTo: integer("round_bid_up_to").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Per-user AI tuning: temperatures, token caps, timeouts, and score bands. */
export const aiSettings = sqliteTable("ai_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  relevanceTemperature: real("relevance_temperature").notNull().default(0.2),
  relevanceMaxTokens: integer("relevance_max_tokens").notNull().default(500),
  relevanceTimeoutSeconds: integer("relevance_timeout_seconds").notNull().default(120),
  analysisTemperature: real("analysis_temperature").notNull().default(0.2),
  analysisMaxTokens: integer("analysis_max_tokens").notNull().default(1000),
  analysisTimeoutSeconds: integer("analysis_timeout_seconds").notNull().default(120),
  proposalTemperature: real("proposal_temperature").notNull().default(0.5),
  proposalTimeoutSeconds: integer("proposal_timeout_seconds").notNull().default(180),
  proposalCorrectionAttempts: integer("proposal_correction_attempts").notNull().default(1),
  relevanceIgnoreFloor: integer("relevance_ignore_floor").notNull().default(50),
  goodScoreFloor: integer("good_score_floor").notNull().default(75),
  strongScoreFloor: integer("strong_score_floor").notNull().default(90),
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

/** Discord webhook + per-event notification toggles. Webhook encrypted at rest. */
export const discordSettings = sqliteTable("discord_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  webhookCipherText: text("webhook_cipher_text"),
  webhookIv: text("webhook_iv"),
  webhookAuthTag: text("webhook_auth_tag"),
  /** JSON array of enabled events: match | needs_review | bid_placed | bid_failed | api_error. */
  events: text("events").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
});

/** Secure MCP Tunnel configuration. The runtime API key is encrypted at rest. */
export const mcpSettings = sqliteTable("mcp_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  tunnelId: text("tunnel_id"),
  apiKeyCipherText: text("api_key_cipher_text"),
  apiKeyIv: text("api_key_iv"),
  apiKeyAuthTag: text("api_key_auth_tag"),
  /** Expose write tools to ChatGPT (profile + draft proposals only). */
  allowWrites: integer("allow_writes").notNull().default(1),
  /** Desired state: start the tunnel automatically on server boot. */
  enabled: integer("enabled").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});
