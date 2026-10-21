import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import {
  jobs as jobsTable,
  proposals as proposalsTable,
  userBids,
  automationSettings as automationSettingsTable,
  automationRuns as automationRunsTable,
} from "../../db/schema.js";
import {
  getBidderId,
  getFreelancerClient,
  searchJobs,
  analyzeJob,
  parseStoredAnalysis,
  MANUAL_REVIEW_FLOOR,
} from "../jobs/jobs.service.js";
import { getProfile } from "../profile/profile.service.js";
import { generateProposal } from "../proposals/proposals.service.js";
import { sendDiscordEvent } from "../discord/discord.service.js";
import {
  splitParagraphs,
  readBidId,
  type FreelancerProject,
  type JobSearchFilters,
} from "../jobs/jobs.client.js";
import {
  accountAgeLabel,
  clientTrustConcerns,
  isAutoBidEligible,
  isBidBlocked,
  parseClientQuality,
  presentUpgradeLabels,
  qualityFromRawData,
  reputationLabel,
  type ClientQuality,
} from "../jobs/client-quality.js";
import { MAX_CONSECUTIVE_ERRORS } from "../logs/logs.service.js";
import {
  DEFAULT_BID_AMOUNT_INSTRUCTIONS,
  DEFAULT_BID_AMOUNT_FRACTIONS,
  DEFAULT_BID_AMOUNT_MARKUP_INSTRUCTIONS,
  DEFAULT_BID_AMOUNT_MARKUP_PCT,
  DEFAULT_BID_AMOUNT_ROUND_UP_TO,
  DEFAULT_DELIVERY_TIMELINE_INSTRUCTIONS,
  DEFAULT_DELIVERY_TIMELINE_OPTIONS,
  DEFAULT_PREFERRED_DELIVERY_DAYS,
  resolveBidAmount,
  resolveDeliveryDays,
  sanitizeBidAmountFractions,
  sanitizeDeliveryDaysList,
} from "../../lib/delivery-timeline.js";

const log = createLogger("bid");

// Freelancer.com requires milestone percentage to be in [20, 100]; 0 is
// rejected upstream, so auto-bids default to a 50% milestone.
const DEFAULT_MILESTONE_PERCENTAGE = 50;

export type AutomationRunResult = "ok" | "skipped" | "error";

export interface AutomationSettings {
  userId: string;
  scanIntervalSeconds: number;
  autoAnalyze: boolean;
  autoMatch: boolean;
  autobidEnabled: boolean;
  /**
   * Minimum relevance score to auto-bid. Proposals are auto-written only for
   * jobs the pipeline is about to bid on, so this is also the auto-proposal gate.
   */
  minMatchScore: number;
  minBid: number;
  maxBid: number;
  dailyCap: number;
  bidsToday: number;
  capDate: string | null;
  paused: boolean;
  /** Consecutive pipeline errors before auto-pause. */
  consecutiveErrors: number;
  /** Reject jobs posted more than 12h ago before they are even stored. */
  rejectStaleJobs: boolean;
  /** Master switch for the free keyword/country screen run at poll time. */
  cheapScreeningEnabled: boolean;
  /** Reject jobs whose client country is on the profile ignore list. */
  rejectIgnoredCountries: boolean;
  /** Reject jobs whose text matches a profile not-wants term. */
  rejectNotWants: boolean;
  /** Reject jobs that don't mention any profile wants term (when any are set). */
  rejectMissingWants: boolean;
  /** Reject brand-new, unverified, no-deposit clients with no upgrades before analysis. */
  rejectBadReputation: boolean;
  /** Let the relevance gate pick each project's delivery time. */
  aiDeliveryTimeline: boolean;
  /** Delivery time (days) quoted when AI selection is off, or when the gate
   * produced no value for a job. */
  preferredDeliveryDays: number;
  /** The day values the AI may choose from. Never empty. */
  deliveryTimelineOptions: number[];
  /** Free-text guidance the AI follows when picking. Never empty. */
  deliveryTimelineInstructions: string;
  /** Let the relevance gate pick each project's bid amount from a fraction of the project max. */
  aiBidAmount: boolean;
  /** The fraction strings the AI may choose from (e.g. ["1/2","1/3","2/3","full"]). */
  bidAmountFractions: string[];
  /** Free-text guidance for the bid-amount pick. Never empty. */
  bidAmountInstructions: string;
  /** Percentage (0–100) applied to the project max as a markup on the minimum,
   * when AI bid-amount selection is off. */
  defaultBidMarkupPct: number;
  /** Guidance for the default markup rule. Never empty. */
  bidAmountMarkupInstructions: string;
  /** Round the final bid amount to the nearest multiple of this value (0 = no rounding). */
  roundBidUpTo: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  userId: string;
  action: string;
  detail: string;
  result: AutomationRunResult;
  createdAt: string;
}

export interface AutomationRunResponse {
  id: string;
  action: string;
  detail: string;
  result: AutomationRunResult;
  timeLabel: string;
}

function rowToSettings(row: {
  userId: string;
  scanIntervalSeconds: number;
  autoAnalyze: number;
  autoMatch: number;
  autobidEnabled: number;
  minMatchScore: number;
  minBid: number;
  maxBid: number;
  dailyCap: number;
  bidsToday: number;
  capDate: string | null;
  paused: number;
  consecutiveErrors: number;
  rejectStaleJobs: number;
  cheapScreeningEnabled: number;
  rejectIgnoredCountries: number;
  rejectNotWants: number;
  rejectMissingWants: number;
  rejectBadReputation: number;
  aiDeliveryTimeline: number;
  preferredDeliveryDays: number;
  deliveryTimelineOptions: string | null;
  deliveryTimelineInstructions: string | null;
  aiBidAmount: number;
  bidAmountFractions: string | null;
  bidAmountInstructions: string | null;
  defaultBidMarkupPct: number | null;
  bidAmountMarkupInstructions: string | null;
  roundBidUpTo: number | null;
  createdAt: string;
  updatedAt: string;
}): AutomationSettings {
  return {
    userId: row.userId,
    scanIntervalSeconds: row.scanIntervalSeconds,
    autoAnalyze: row.autoAnalyze === 1,
    autoMatch: row.autoMatch === 1,
    autobidEnabled: row.autobidEnabled === 1,
    minMatchScore: row.minMatchScore,
    minBid: row.minBid,
    maxBid: row.maxBid,
    dailyCap: row.dailyCap,
    bidsToday: row.bidsToday,
    capDate: row.capDate,
    paused: row.paused === 1,
    consecutiveErrors: row.consecutiveErrors ?? 0,
    rejectStaleJobs: (row.rejectStaleJobs ?? 1) === 1,
    cheapScreeningEnabled: (row.cheapScreeningEnabled ?? 1) === 1,
    rejectIgnoredCountries: (row.rejectIgnoredCountries ?? 1) === 1,
    rejectNotWants: (row.rejectNotWants ?? 1) === 1,
    rejectMissingWants: (row.rejectMissingWants ?? 1) === 1,
    rejectBadReputation: (row.rejectBadReputation ?? 1) === 1,
    aiDeliveryTimeline: (row.aiDeliveryTimeline ?? 0) === 1,
    preferredDeliveryDays: row.preferredDeliveryDays ?? DEFAULT_PREFERRED_DELIVERY_DAYS,
    // A null column means "never edited" — the UI shows the defaults so the user
    // has something concrete to change rather than an empty box.
    deliveryTimelineOptions: parseOptionsColumn(row.deliveryTimelineOptions),
    deliveryTimelineInstructions: parseInstructionsColumn(
      row.deliveryTimelineInstructions
    ),
    aiBidAmount: (row.aiBidAmount ?? 0) === 1,
    bidAmountFractions: parseBidAmountFractionsColumn(row.bidAmountFractions),
    bidAmountInstructions: parseBidAmountInstructionsColumn(row.bidAmountInstructions),
    defaultBidMarkupPct:
      typeof row.defaultBidMarkupPct === "number"
        ? Math.max(0, Math.min(100, Math.round(row.defaultBidMarkupPct)))
        : DEFAULT_BID_AMOUNT_MARKUP_PCT,
    bidAmountMarkupInstructions: parseBidAmountMarkupInstructionsColumn(
      row.bidAmountMarkupInstructions
    ),
    roundBidUpTo:
      typeof row.roundBidUpTo === "number" && Number.isFinite(row.roundBidUpTo)
        ? Math.max(0, Math.round(row.roundBidUpTo))
        : 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The stored options JSON, sanitized; the default list when absent or broken. */
function parseOptionsColumn(raw: string | null): number[] {
  if (raw === null || raw.trim().length === 0) {
    return [...DEFAULT_DELIVERY_TIMELINE_OPTIONS];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeDeliveryDaysList(Array.isArray(parsed) ? (parsed as number[]) : null);
  } catch {
    return [...DEFAULT_DELIVERY_TIMELINE_OPTIONS];
  }
}

/** The stored instructions text; the default text when absent or blank. */
function parseInstructionsColumn(raw: string | null): string {
  const text = (raw ?? "").trim();
  return text.length > 0 ? text : DEFAULT_DELIVERY_TIMELINE_INSTRUCTIONS;
}

/**
 * The bid-amount instructions text; the default text when absent or blank.
 * Reuses the same "non-empty or default" rule as the delivery timeline.
 */
function parseBidAmountInstructionsColumn(raw: string | null): string {
  const text = (raw ?? "").trim();
  return text.length > 0 ? text : DEFAULT_BID_AMOUNT_INSTRUCTIONS;
}

/**
 * The bid-amount markup instructions text; the default text when absent or blank.
 * Reuses the same "non-empty or default" rule as the other instructions columns.
 */
function parseBidAmountMarkupInstructionsColumn(raw: string | null): string {
  const text = (raw ?? "").trim();
  return text.length > 0 ? text : DEFAULT_BID_AMOUNT_MARKUP_INSTRUCTIONS;
}

/**
 * The stored bid-amount fractions (JSON array of strings in a TEXT column),
 * sanitized; the default list when absent, empty, or broken.
 */
function parseBidAmountFractionsColumn(raw: string | null): string[] {
  if (raw === null || raw.trim().length === 0) return [...DEFAULT_BID_AMOUNT_FRACTIONS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeBidAmountFractions(Array.isArray(parsed) ? parsed : null);
  } catch {
    return [...DEFAULT_BID_AMOUNT_FRACTIONS];
  }
}

function rowToRun(row: {
  id: string;
  userId: string;
  action: string;
  detail: string;
  result: string;
  createdAt: string;
}): AutomationRunResponse {
  const createdAt = new Date(row.createdAt);
  const now = Date.now();
  const diffMs = now - createdAt.getTime();

  const formatLabel = (ms: number): string => {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.round(days / 7);
    return `${weeks}w ago`;
  };

  return {
    id: row.id,
    action: row.action,
    detail: row.detail,
    result: row.result as AutomationRunResult,
    timeLabel: formatLabel(diffMs),
  };
}

/** Get or create automation settings for a user (with defaults). */
export async function getOrCreateSettings(userId: string): Promise<AutomationSettings> {
  try {
    const row = getDb()
      .select()
      .from(automationSettingsTable)
      .where(eq(automationSettingsTable.userId, userId))
      .get();

    if (!row) {
      const now = new Date().toISOString();
      const defaults: AutomationSettings = {
        userId,
        scanIntervalSeconds: 60,
        autoAnalyze: true,
        autoMatch: true,
        autobidEnabled: false,
        minMatchScore: 80,
        minBid: 500,
        maxBid: 5000,
        dailyCap: 5,
        bidsToday: 0,
        capDate: new Date().toISOString().slice(0, 10),
        paused: false,
        consecutiveErrors: 0,
        rejectStaleJobs: true,
        cheapScreeningEnabled: true,
        rejectIgnoredCountries: true,
        rejectNotWants: true,
        rejectMissingWants: true,
        rejectBadReputation: true,
        aiDeliveryTimeline: false,
        preferredDeliveryDays: DEFAULT_PREFERRED_DELIVERY_DAYS,
        deliveryTimelineOptions: [...DEFAULT_DELIVERY_TIMELINE_OPTIONS],
        deliveryTimelineInstructions: DEFAULT_DELIVERY_TIMELINE_INSTRUCTIONS,
        aiBidAmount: false,
        bidAmountFractions: [...DEFAULT_BID_AMOUNT_FRACTIONS],
        bidAmountInstructions: DEFAULT_BID_AMOUNT_INSTRUCTIONS,
        defaultBidMarkupPct: DEFAULT_BID_AMOUNT_MARKUP_PCT,
        bidAmountMarkupInstructions: DEFAULT_BID_AMOUNT_MARKUP_INSTRUCTIONS,
        roundBidUpTo: DEFAULT_BID_AMOUNT_ROUND_UP_TO,
        createdAt: now,
        updatedAt: now,
      };

      getDb()
        .insert(automationSettingsTable)
        .values({
          userId,
          scanIntervalSeconds: defaults.scanIntervalSeconds,
          autoAnalyze: defaults.autoAnalyze ? 1 : 0,
          autoMatch: defaults.autoMatch ? 1 : 0,
          autobidEnabled: defaults.autobidEnabled ? 1 : 0,
          minMatchScore: defaults.minMatchScore,
          minBid: defaults.minBid,
          maxBid: defaults.maxBid,
          dailyCap: defaults.dailyCap,
          bidsToday: defaults.bidsToday,
          capDate: defaults.capDate,
          paused: defaults.paused ? 1 : 0,
          consecutiveErrors: 0,
          rejectStaleJobs: defaults.rejectStaleJobs ? 1 : 0,
          cheapScreeningEnabled: defaults.cheapScreeningEnabled ? 1 : 0,
          rejectIgnoredCountries: defaults.rejectIgnoredCountries ? 1 : 0,
          rejectNotWants: defaults.rejectNotWants ? 1 : 0,
          rejectMissingWants: defaults.rejectMissingWants ? 1 : 0,
          rejectBadReputation: defaults.rejectBadReputation ? 1 : 0,
          aiDeliveryTimeline: defaults.aiDeliveryTimeline ? 1 : 0,
          preferredDeliveryDays: defaults.preferredDeliveryDays,
          // Stored as JSON so the user's edited list survives a round trip.
          deliveryTimelineOptions: JSON.stringify(defaults.deliveryTimelineOptions),
          deliveryTimelineInstructions: defaults.deliveryTimelineInstructions,
          aiBidAmount: defaults.aiBidAmount ? 1 : 0,
          bidAmountFractions: JSON.stringify(defaults.bidAmountFractions),
          bidAmountInstructions: defaults.bidAmountInstructions,
          defaultBidMarkupPct: defaults.defaultBidMarkupPct,
          bidAmountMarkupInstructions: defaults.bidAmountMarkupInstructions,
          roundBidUpTo: defaults.roundBidUpTo,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      log.info(`Created default automation settings for user ${userId}`);
      return defaults;
    }

    return rowToSettings(row);
  } catch (error) {
    log.error("Failed to get/create automation settings:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to get automation settings: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function saveSettings(
  userId: string,
  settings: Partial<Omit<AutomationSettings, "userId" | "createdAt" | "updatedAt" | "bidsToday" | "capDate" | "consecutiveErrors">>
): Promise<AutomationSettings> {
  try {
    const existing = getDb()
      .select()
      .from(automationSettingsTable)
      .where(eq(automationSettingsTable.userId, userId))
      .get();

    const now = new Date().toISOString();

    if (!existing) {
      await getOrCreateSettings(userId);
      return saveSettings(userId, settings);
    }

    const updates: Record<string, unknown> = { updatedAt: now };

    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === "boolean") {
        updates[key] = value ? 1 : 0;
      } else if (key === "deliveryTimelineOptions") {
        // The one number-array setting: it lives in a TEXT column as JSON, so
        // it needs serializing (and sanitizing) before Drizzle sees it.
        updates[key] = JSON.stringify(
          sanitizeDeliveryDaysList(Array.isArray(value) ? (value as number[]) : null)
        );
      } else if (key === "bidAmountFractions") {
        // The one string-array setting: TEXT column as JSON, serialized +
        // sanitized so a broken list can never reach the gate.
        updates[key] = JSON.stringify(
          sanitizeBidAmountFractions(Array.isArray(value) ? (value as string[]) : null)
        );
      } else {
        updates[key] = value;
      }
    }

    getDb()
      .update(automationSettingsTable)
      .set(updates)
      .where(eq(automationSettingsTable.userId, userId))
      .run();

    log.info(`Updated automation settings for user ${userId}`, settings);
    return getOrCreateSettings(userId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    log.error("Failed to save automation settings:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to save automation settings: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Reset today's auto-bid usage counter so the worker can keep bidding the same
 * day. Zeroes `bidsToday` and re-anchors `capDate` to today, mirroring what
 * `checkAndResetDailyCap` does when the calendar date rolls over — so the next
 * `runAutoBidCheck` treats the day as fresh instead of blocked at the cap.
 */
export async function resetDailyUsage(userId: string): Promise<AutomationSettings> {
  try {
    const current = await getOrCreateSettings(userId);
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    getDb()
      .update(automationSettingsTable)
      .set({ bidsToday: 0, capDate: today, updatedAt: now })
      .where(eq(automationSettingsTable.userId, userId))
      .run();

    log.info(
      `Reset daily bid usage for user ${userId} (was ${current.bidsToday}/${current.dailyCap})`
    );
    await logRun(
      userId,
      "Quota reset",
      `Daily bid usage reset to 0/${current.dailyCap} for today`,
      "ok"
    );

    return getOrCreateSettings(userId);
  } catch (error) {
    log.error("Failed to reset daily bid usage:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to reset daily bid usage: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function listRuns(userId: string, limit = 50): Promise<AutomationRunResponse[]> {
  try {
    const rows = getDb()
      .select()
      .from(automationRunsTable)
      .where(eq(automationRunsTable.userId, userId))
      .orderBy(desc(automationRunsTable.createdAt))
      .limit(limit)
      .all();

    return rows.map(rowToRun);
  } catch (error) {
    log.error("Failed to list automation runs:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to list automation runs: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function logRun(
  userId: string,
  action: string,
  detail: string,
  result: AutomationRunResult
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const runId = `run-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    getDb()
      .insert(automationRunsTable)
      .values({
        id: runId,
        userId,
        action,
        detail,
        result,
        createdAt: now,
      })
      .run();

    log.debug(`Automation run: ${action} — ${detail} (${result})`);
  } catch (error) {
    log.error("Failed to log automation run:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/** Reset daily bid count if the date window has changed. */
function checkAndResetDailyCap(settings: AutomationSettings): AutomationSettings {
  const today = new Date().toISOString().slice(0, 10);
  if (settings.capDate !== today) {
    return { ...settings, bidsToday: 0, capDate: today };
  }
  return settings;
}

/** Core auto-bid engine. */
export async function runAutoBidCheck(userId: string): Promise<void> {
  const persistedSettings = await getOrCreateSettings(userId);
  const settings = checkAndResetDailyCap(persistedSettings);

  // Persist the daily cap reset even when paused, so a worker that was
  // auto-paused at yesterday's cap can resume the next day with a clean slate.
  if (persistedSettings.capDate !== settings.capDate) {
    getDb()
      .update(automationSettingsTable)
      .set({
        bidsToday: settings.bidsToday,
        capDate: settings.capDate,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(automationSettingsTable.userId, userId))
      .run();
  }

  if (settings.paused) {
    await logRun(userId, "Auto-bid check", "Worker is paused", "skipped");
    return;
  }

  if (!settings.autobidEnabled) {
    await logRun(userId, "Auto-bid check", "Auto-bid is disabled", "skipped");
    return;
  }

  if (settings.bidsToday >= settings.dailyCap) {
    await logRun(
      userId,
      "Auto-bid check",
      `Daily cap reached (${settings.bidsToday}/${settings.dailyCap}) — auto-bidding paused until tomorrow`,
      "skipped"
    );
    // Deliberately do NOT pause the whole worker here: the cap only gates
    // bidding. `checkAndResetDailyCap` resets `bidsToday` when the date rolls
    // over, so auto-bidding resumes tomorrow while scanning/analyzing/drafting
    // keep running in the meantime.
    return;
  }

  // Find analyzed jobs with match score >= threshold that don't have a user bid
  // and haven't already had a failed automatic bid attempt (never retry those —
  // the user handles them manually).
  const candidateJobs = getDb()
    .select()
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.status, "analyzed"),
        sql`${jobsTable.matchScore} >= ${settings.minMatchScore}`,
        isNull(jobsTable.autoBidFailedAt)
      )
    )
    .all();

  let bidsPlaced = 0;
  for (const job of candidateJobs) {
    if (bidsPlaced >= settings.dailyCap - settings.bidsToday) break;

    // Check if we already bid on this project
    const existingBid = getDb()
      .select()
      .from(userBids)
      .where(eq(userBids.projectId, job.projectId))
      .get();

    if (existingBid) continue;

    // Get the proposal for this job (must be approved/queued)
    const proposal = getDb()
      .select()
      .from(proposalsTable)
      .where(
        and(
          eq(proposalsTable.jobId, job.id),
          eq(proposalsTable.userId, userId),
          eq(proposalsTable.status, "approved")
        )
      )
      .get();

    if (!proposal) continue;

    // Trust gate: never auto-bid a project that needs a signature (NDA/IP
    // contract) or a client whose payment method isn't verified. Those bids
    // either fail upstream or land on a client we can't trust — the user
    // handles them manually. A stored snapshot takes priority; legacy rows
    // fall back to the raw project blob so they're still evaluated (no forced
    // re-analyze).
    const parsedJob = parseJobRawData(job.rawData);
    const quality = jobTrustQuality(job);
    if (!isAutoBidEligible(quality, parsedJob.projectType)) {
      await logRun(
        userId,
        "Auto-bid skipped",
        `Project ${job.projectId}: not auto-bid eligible — client payment unverified or NDA/IP needs signing (handle manually)`,
        "skipped"
      );
      continue;
    }

    // Bid amount = the project's minimum budget (for hourly projects, its
    // hourly minimum). No budget listed → skip; auto-bid can't price it.
    const { minimumBudget, budgetMaximum } = parsedJob;
    if (minimumBudget === null) {
      await logRun(
        userId,
        "Auto-bid skipped",
        `Project ${job.projectId}: no budget minimum — skipped`,
        "skipped"
      );
      continue;
    }
    // The relevance gate's per-project pick when AI bid-amount selection is
    // on and it produced one; otherwise the minimum budget plus a user-set
    // markup percentage of the project maximum, clamped to the safety bounds.
    const bidAmount = resolveBidAmount(
      settings,
      job.bidAmount,
      minimumBudget,
      budgetMaximum,
      parsedJob.projectType
    );

    // Delivery time: the relevance gate's per-project pick when AI selection is
    // on and it produced one, otherwise the user's preferred number.
    const deliveryDays = resolveDeliveryDays(settings, job.deliveryDays);

    // Get bidder id and an authenticated client (shared helpers).
    try {
      const bidderId = await getBidderId();
      const client = getFreelancerClient();

      // Keep the response: it carries Freelancer's own bid id, which is what a
      // later update is sent against.
      const placed = await client.placeBid(
        job.projectId,
        bidderId,
        bidAmount,
        deliveryDays,
        DEFAULT_MILESTONE_PERCENTAGE,
        proposal.content
      );
      const freelancerBidId = readBidId(placed);
      if (freelancerBidId === null) {
        log.warn(
          `Auto-bid placed on project ${job.projectId} but Freelancer.com returned no bid id — it can only be updated if the id is entered by hand`
        );
      }

      // Record the auto-bid
      const now = new Date().toISOString();
      const bidId = `bid-${job.projectId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      getDb()
        .insert(userBids)
        .values({
          id: bidId,
          userId,
          projectId: job.projectId,
          proposalId: proposal.id,
          freelancerBidId,
          jobTitle: proposal.jobTitle,
          client: proposal.client,
          amount: bidAmount,
          period: deliveryDays,
          milestonePercentage: DEFAULT_MILESTONE_PERCENTAGE,
          description: proposal.content,
          status: "submitted",
          outcome: "in_review",
          via: "auto",
          submittedAt: now,
          updatedAt: now,
        })
        .run();

      bidsPlaced++;
      settings.bidsToday++;

      await logRun(
        userId,
        "Auto-bid placed",
        `Project ${job.projectId}: $${bidAmount}, ${deliveryDays} day${deliveryDays === 1 ? "" : "s"} delivery (score ${job.matchScore}, ${settings.bidsToday}/${settings.dailyCap} today)`,
        "ok"
      );

      log.info(
        `Auto-bid placed: ${bidId} for project ${job.projectId} at $${bidAmount} over ${deliveryDays} day(s)`
      );

      void sendDiscordEvent(
        userId,
        "bid_placed",
        `✅ Auto-bid placed on **${job.title}** for **$${bidAmount}** (score ${job.matchScore}). https://www.freelancer.com/projects/${job.projectId}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const failedAt = new Date().toISOString();

      // Mark the job so the auto engine never retries it; the user handles it
      // manually. The failure stays visible in the matches list.
      getDb()
        .update(jobsTable)
        .set({
          autoBidFailedAt: failedAt,
          autoBidError: message.slice(0, 500),
          updatedAt: failedAt,
        })
        .where(eq(jobsTable.projectId, job.projectId))
        .run();

      await logRun(
        userId,
        "Auto-bid failed",
        `Project ${job.projectId}: ${message}`,
        "error"
      );
      log.error(`Auto-bid failed for project ${job.projectId}:`, { error: message });

      void sendDiscordEvent(
        userId,
        "bid_failed",
        `⚠️ Auto-bid failed on **${job.title}** — ${message}. It won't be retried automatically; handle it manually. https://www.freelancer.com/projects/${job.projectId}`
      );
    }
  }

  // Update bidsToday in settings
  if (bidsPlaced > 0) {
    getDb()
      .update(automationSettingsTable)
      .set({ bidsToday: settings.bidsToday, updatedAt: new Date().toISOString() })
      .where(eq(automationSettingsTable.userId, userId))
      .run();
  }

  if (bidsPlaced === 0) {
    await logRun(userId, "Auto-bid check", "No eligible jobs found", "skipped");
  }
}

export async function setPaused(userId: string, paused: boolean): Promise<void> {
  try {
    const now = new Date().toISOString();
    getDb()
      .update(automationSettingsTable)
      .set({ paused: paused ? 1 : 0, updatedAt: now })
      .where(eq(automationSettingsTable.userId, userId))
      .run();

    await logRun(userId, paused ? "Worker paused" : "Worker resumed", paused ? "Auto-bid paused by user" : "Auto-bid resumed by user", "ok");
    log.info(`Automation ${paused ? "paused" : "resumed"} for user ${userId}`);
  } catch (error) {
    log.error("Failed to toggle automation pause:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to toggle pause: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/** Increment the consecutive error counter for a user. Returns the new count. */
async function incrementConsecutiveErrors(userId: string): Promise<number> {
  const settings = await getOrCreateSettings(userId);
  const next = settings.consecutiveErrors + 1;
  getDb()
    .update(automationSettingsTable)
    .set({ consecutiveErrors: next, updatedAt: new Date().toISOString() })
    .where(eq(automationSettingsTable.userId, userId))
    .run();
  return next;
}

/** Reset the consecutive error counter to 0. */
async function resetConsecutiveErrors(userId: string): Promise<void> {
  getDb()
    .update(automationSettingsTable)
    .set({ consecutiveErrors: 0, updatedAt: new Date().toISOString() })
    .where(eq(automationSettingsTable.userId, userId))
    .run();
}

/** Parse a job row's raw JSON to extract the fields needed for proposal drafting. */
function parseJobRawData(rawData: string | null): {
  description: string[];
  jobSkills: string[];
  projectType: string | null;
  bidPeriod: number | null;
  minimumBudget: number | null;
  /** The project's maximum budget — used for the default bid markup rule. */
  budgetMaximum: number | null;
  upgrades?: { featured: boolean; urgent: boolean; sealed: boolean };
} {
  if (!rawData) {
    return {
      description: [],
      jobSkills: [],
      projectType: null,
      bidPeriod: null,
      minimumBudget: null,
      budgetMaximum: null,
    };
  }
  try {
    const project = JSON.parse(rawData) as FreelancerProject;
    const description = splitParagraphs(project.description ?? project.preview_description ?? "");
    const jobSkills =
      project.jobs?.map((j) => j.name).filter((n): n is string => Boolean(n)) ?? [];
    const upgrades = project.upgrades
      ? {
          featured: project.upgrades.featured ?? false,
          urgent: project.upgrades.urgent ?? false,
          sealed: project.upgrades.sealed ?? false,
        }
      : undefined;
    return {
      description,
      jobSkills,
      projectType: project.type ?? null,
      bidPeriod: project.bidperiod ?? null,
      // The project's minimum budget — for hourly projects this is the hourly
      // minimum. Auto-bid prices off this, so missing/zero means "can't price".
      minimumBudget:
        typeof project.budget?.minimum === "number" && project.budget.minimum > 0
          ? project.budget.minimum
          : null,
      // The project's maximum budget — used for the default markup rule so the
      // bid can land above the bare minimum when the user has set a markup %.
      budgetMaximum:
        typeof project.budget?.maximum === "number" && project.budget.maximum > 0
          ? project.budget.maximum
          : null,
      upgrades,
    };
  } catch {
    return {
      description: [],
      jobSkills: [],
      projectType: null,
      bidPeriod: null,
      minimumBudget: null,
      budgetMaximum: null,
    };
  }
}

/**
 * The client-trust snapshot for a job row. A stored snapshot (client_quality,
 * written at analyze time) takes priority; legacy rows saved before the column
 * existed fall back to the raw project blob so they still pass through the same
 * trust gates without a forced re-analyze.
 */
function jobTrustQuality(job: {
  clientQuality: string | null;
  rawData: string | null;
}): ClientQuality | null {
  return parseClientQuality(job.clientQuality) ?? qualityFromRawData(job.rawData);
}

/** ✅/❌/— rendering of a verification boolean for a Discord message. */
function checkMark(value: boolean | null): string {
  if (value === true) return "✅ Yes";
  if (value === false) return "❌ No";
  return "— unknown";
}

/**
 * The fields from a jobs row that a Discord "needs_review" alert is built from.
 */
export interface ReviewableJob {
  projectId: number;
  title: string;
  client: string;
  clientCountry: string;
  budgetLabel: string;
  postedLabel: string;
  bidCount: number;
  matchScore: number | null;
  clientQuality: string | null;
  rawData: string | null;
  analysis: string | null;
}

/**
 * Rich Discord content for a job the pipeline refused to auto-bid. Two tiers:
 * NDA/IP projects (auto-bid would fail until the user signs) get the urgent
 * header; everything else is a client-trust problem worth a manual look. The
 * message carries the score, budget, posting time, bid count, every client
 * verification signal we stored, and the Model A one-liner.
 */
export function buildNeedsReviewMessage(job: ReviewableJob, threshold: number): string {
  const quality = jobTrustQuality(job);
  const stored = parseStoredAnalysis(job.analysis);
  const projectType = parseJobRawData(job.rawData).projectType;
  const blocked = quality !== null && isBidBlocked(quality);

  const part: string[] = [];
  part.push(
    blocked
      ? `🚨 **Manual action required: ${job.title}**`
      : `⚠️ **Needs your review: ${job.title}**`
  );
  part.push(
    blocked
      ? "Auto-bid can't place this — it carries an **NDA / IP contract** that must be signed before Freelancer.com accepts a bid. It's on you."
      : "This job scored well enough to matter, but the client isn't trustworthy enough to auto-bid — decide whether to handle it manually."
  );
  part.push(
    "",
    `**Score:** ${job.matchScore ?? "—"}/100 (auto-bid threshold: ${threshold})`,
    `**Budget:** ${job.budgetLabel}`,
    `**Posted:** ${job.postedLabel} — **${job.bidCount} bid${job.bidCount === 1 ? "" : "s"}**`,
    `**Client:** ${job.client}${job.clientCountry ? ` (${job.clientCountry})` : ""}`
  );

  if (quality !== null) {
    part.push(
      "",
      "Client check:",
      `• Payment method verified: ${checkMark(quality.paymentVerified)}`,
      `• Escrow deposit history: ${checkMark(quality.depositMade)}`,
      `• Email verified: ${checkMark(quality.emailVerified)}`,
      `• ${accountAgeLabel(quality)}`,
      `• ${reputationLabel(quality)}`
    );
    const upgrades = presentUpgradeLabels(quality);
    if (upgrades.length > 0) {
      part.push(`• Upgrades: ${upgrades.join(", ")}`);
    }
  }

  const concerns =
    stored?.concerns ??
    (quality !== null ? clientTrustConcerns(quality, projectType) : []);
  if (concerns.length > 0) {
    part.push("", ...concerns.map((c) => `⚠️ ${c}`));
  }
  if (stored?.summary && !blocked) {
    part.push("", `**Model A's read:** ${stored.summary}`);
  }

  part.push("", `🔗 https://www.freelancer.com/projects/${job.projectId}`);
  return part.join("\n");
}

export interface PipelineResult {
  status: "ok" | "skipped" | "paused" | "error";
  jobsFound: number;
  analyzed: number;
  drafted: number;
  bidsPlaced: number;
}

/**
 * Pipeline orchestration: poll → deduplicate → relevancy filter (analyze) → draft → auto-bid.
 *
 * - Checks pause state and resets the daily cap window
 * - Validates Freelancer.com credentials via /self
 * - Polls for jobs matching the user's profile skills/wants
 * - Analyzes new jobs if autoAnalyze is on (relevancy filter + AI analysis in `analyzeJob`)
 * - Drafts a proposal for each analyzed job that clears the auto-bid threshold — but only
 *   while auto-bid is on, since a proposal is written solely so the pipeline can bid on it
 * - Runs the auto-bid engine (`runAutoBidCheck`) which respects daily cap, autobid flag, etc.
 * - Tracks consecutive errors and auto-pauses after MAX_CONSECUTIVE_ERRORS failures
 */
async function runPipelineInner(userId: string): Promise<PipelineResult> {
  // Step 1: Get settings with daily cap reset.
  const persistedSettings = await getOrCreateSettings(userId);
  const settings = checkAndResetDailyCap(persistedSettings);

  // Persist the daily cap reset even when paused (so a worker auto-paused at
  // yesterday's cap can resume the next day with a clean slate).
  if (persistedSettings.capDate !== settings.capDate) {
    getDb()
      .update(automationSettingsTable)
      .set({
        bidsToday: settings.bidsToday,
        capDate: settings.capDate,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(automationSettingsTable.userId, userId))
      .run();
  }

  // Step 2: If paused, skip.
  if (settings.paused) {
    await logRun(userId, "Pipeline", "Worker is paused", "skipped");
    return { status: "skipped", jobsFound: 0, analyzed: 0, drafted: 0, bidsPlaced: 0 };
  }

  // Step 3: Validate credentials — this hits /self and caches the bidder id.
  try {
    await getBidderId();
  } catch (error) {
    // Bad credentials — auto-pause so we don't hammer a dead token.
    await saveSettings(userId, { paused: true });
    const count = await incrementConsecutiveErrors(userId);
    await logRun(
      userId,
      "Pipeline",
      `Credentials invalid: ${error instanceof Error ? error.message : "Unknown error"} — worker paused`,
      "error"
    );
    log.error("Pipeline credentials invalid:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    if (count >= MAX_CONSECUTIVE_ERRORS) {
      await logRun(
        userId,
        "Pipeline",
        `Auto-paused after ${count} consecutive errors`,
        "error"
      );
    }
    void sendDiscordEvent(
      userId,
      "api_error",
      `🚨 Freelance Copilot hit an API issue: credentials invalid — ${
        error instanceof Error ? error.message : "Unknown error"
      }. The worker paused itself.`
    );
    return { status: "error", jobsFound: 0, analyzed: 0, drafted: 0, bidsPlaced: 0 };
  }

  // Step 4: Get profile for search filters.
  const profile = getProfile(userId);
  if (profile === null) {
    await logRun(
      userId,
      "Pipeline",
      "No profile found — cannot run poll/analyze/draft",
      "skipped"
    );
    return { status: "skipped", jobsFound: 0, analyzed: 0, drafted: 0, bidsPlaced: 0 };
  }

  // Steps 5–9: Poll, analyze, draft, auto-bid.
  try {
    // Step 5: Poll for new jobs from Freelancer.com (dedup is built into searchJobs).
    const searchFilters: JobSearchFilters = {
      skills: profile.skills.length > 0 ? profile.skills : undefined,
      skillIds: profile.skillIds.length > 0 ? profile.skillIds : undefined,
      keywords: profile.wants.length > 0 ? profile.wants : undefined,
      limit: 20,
      ignoredCountries: profile.ignoredCountries,
      userId,
    };

    const foundJobs = await searchJobs(searchFilters);
    await logRun(
      userId,
      "Pipeline poll",
      `Found ${foundJobs.length} jobs on Freelancer.com`,
      "ok"
    );

    // Step 6: Analyze new jobs.
    let analyzed = 0;
    const newJobs = foundJobs.filter((j) => j.status === "new");
    if (settings.autoAnalyze && newJobs.length > 0) {
      for (const job of newJobs) {
        try {
          await analyzeJob(job.projectId, userId);
          analyzed++;

          // Notify on just-analyzed jobs. Trustworthy clients that clear the
          // auto-bid threshold fire the plain "match" (auto-bid follows). Jobs
          // the pipeline must NOT auto-bid — NDA/IP signature required, or a
          // client whose payment isn't verified — go to "needs_review" so the
          // user decides manually. Blocked jobs always surface (auto-bid would
          // fail); the rest only when they're worth a look (score at or above
          // the manual review floor).
          const analyzedRow = getDb()
            .select()
            .from(jobsTable)
            .where(eq(jobsTable.projectId, job.projectId))
            .get();
          if (
            analyzedRow !== undefined &&
            analyzedRow.status === "analyzed" &&
            analyzedRow.matchScore !== null
          ) {
            const quality = jobTrustQuality(analyzedRow);
            const projectType = parseJobRawData(analyzedRow.rawData).projectType;
            const eligible = isAutoBidEligible(quality, projectType);
            const blocked = quality !== null && isBidBlocked(quality);
            if (eligible && analyzedRow.matchScore >= settings.minMatchScore) {
              void sendDiscordEvent(
                userId,
                "match",
                `🎯 New match: **${analyzedRow.title}** — score ${analyzedRow.matchScore} (threshold ${settings.minMatchScore}). https://www.freelancer.com/projects/${analyzedRow.projectId}`
              );
            } else if (
              !eligible &&
              (blocked || analyzedRow.matchScore >= MANUAL_REVIEW_FLOOR)
            ) {
              void sendDiscordEvent(
                userId,
                "needs_review",
                buildNeedsReviewMessage(analyzedRow, settings.minMatchScore)
              );
            }
          }
        } catch (error) {
          await logRun(
            userId,
            "Pipeline analyze",
            `Job ${job.projectId}: ${error instanceof Error ? error.message : "Unknown error"}`,
            "error"
          );
        }
      }
      await logRun(
        userId,
        "Pipeline analyze",
        `Analyzed ${analyzed}/${newJobs.length} new jobs`,
        "ok"
      );
    } else if (newJobs.length === 0) {
      await logRun(userId, "Pipeline analyze", "No new jobs to analyze", "ok");
    }

    // Step 7: Draft proposals — but only for jobs the pipeline is about to bid
    // on. Auto-proposals are coupled to auto-bid: when auto-bid is off, no
    // proposals are written; the user generates them and places bids manually.
    let drafted = 0;
    if (settings.autobidEnabled) {
      const candidates = getDb()
        .select()
        .from(jobsTable)
        .where(
          and(
            eq(jobsTable.status, "analyzed"),
            sql`${jobsTable.matchScore} >= ${settings.minMatchScore}`,
            isNull(jobsTable.autoBidFailedAt)
          )
        )
        .all();

      for (const job of candidates) {
        // Skip jobs that already have a proposal.
        const existing = getDb()
          .select({ id: proposalsTable.id })
          .from(proposalsTable)
          .where(
            and(
              eq(proposalsTable.jobId, job.id),
              eq(proposalsTable.userId, userId)
            )
          )
          .get();
        if (existing) continue;

        // Trust gate: only auto-draft for jobs the pipeline is allowed to
        // auto-bid (verified client payment, no NDA/IP signature). Writing a
        // proposal for a blocked or risky job would waste a Model B call and
        // produce a bid we'd refuse anyway.
        const quality = jobTrustQuality(job);
        if (!isAutoBidEligible(quality, parseJobRawData(job.rawData).projectType)) {
          continue;
        }

        try {
          const parsed = parseJobRawData(job.rawData);
          const bidStats: { bidCount?: number; avgBid?: string } = {
            bidCount: job.bidCount,
          };
          if (job.avgBidLabel) bidStats.avgBid = job.avgBidLabel;

          // Resolve the exact commercial values Step 9 will submit so the
          // proposal cannot contradict the bid amount or delivery time.
          const bidAmount = resolveBidAmount(
            settings,
            job.bidAmount,
            parsed.minimumBudget ?? 0,
            parsed.budgetMaximum,
            parsed.projectType
          );
          const deliveryDays = resolveDeliveryDays(settings, job.deliveryDays);

          await generateProposal(
            userId,
            job.id,
            job.projectId,
            job.title,
            job.client,
            parsed.description,
            parsed.jobSkills,
            bidStats,
            parsed.projectType,
            parsed.bidPeriod,
            parsed.upgrades,
            null, // competition — not fetched during pipeline draft
            job.budgetLabel,
            bidAmount,
            deliveryDays
          );
          drafted++;

          // Approve the draft immediately so Step 9 places the bid this run.
          getDb()
            .update(proposalsTable)
            .set({ status: "approved", updatedAt: new Date().toISOString() })
            .where(
              and(
                eq(proposalsTable.jobId, job.id),
                eq(proposalsTable.userId, userId)
              )
            )
            .run();
          await logRun(
            userId,
            "Pipeline draft",
            `Job ${job.projectId}: proposal auto-approved (score ${job.matchScore} >= ${settings.minMatchScore})`,
            "ok"
          );
        } catch (error) {
          // A 409 means another run (or a manual generate) already drafted this
          // job — not a failure, just nothing left to do this run.
          if (error instanceof AppError && error.status === 409) {
            await logRun(
              userId,
              "Pipeline draft",
              `Job ${job.projectId}: proposal already exists — skipped`,
              "skipped"
            );
          } else {
            await logRun(
              userId,
              "Pipeline draft",
              `Job ${job.projectId}: ${error instanceof Error ? error.message : "Unknown error"}`,
              "error"
            );
          }
        }
      }

      await logRun(
        userId,
        "Pipeline draft",
        `Drafted ${drafted} proposal(s) for jobs meeting the auto-bid threshold`,
        "ok"
      );
    }

    // Step 8: Reset consecutive errors on success.
    await resetConsecutiveErrors(userId);

    // Step 9: Run auto-bid check (respects daily cap, autobid flag, etc.).
    const bidsTodayBefore = settings.bidsToday;
    await runAutoBidCheck(userId);
    const settingsAfter = await getOrCreateSettings(userId);
    const bidsPlaced = settingsAfter.bidsToday - bidsTodayBefore;

    await logRun(
      userId,
      "Pipeline",
      `Cycle complete: ${foundJobs.length} found, ${analyzed} analyzed, ${drafted} drafted, ${bidsPlaced} bids placed`,
      "ok"
    );

    return {
      status: "ok",
      jobsFound: foundJobs.length,
      analyzed,
      drafted,
      bidsPlaced: Math.max(0, bidsPlaced),
    };
  } catch (error) {
    const count = await incrementConsecutiveErrors(userId);
    await logRun(
      userId,
      "Pipeline",
      `Pipeline error: ${error instanceof Error ? error.message : "Unknown error"}`,
      "error"
    );
    log.error("Pipeline error:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    if (count >= MAX_CONSECUTIVE_ERRORS) {
      await saveSettings(userId, { paused: true });
      await logRun(
        userId,
        "Pipeline",
        `Auto-paused after ${count} consecutive errors`,
        "error"
      );
    }

    void sendDiscordEvent(
      userId,
      "api_error",
      `🚨 Freelance Copilot hit an API issue: ${
        error instanceof Error ? error.message : "Unknown error"
      }.`
    );

    return {
      status: "error",
      jobsFound: 0,
      analyzed: 0,
      drafted: 0,
      bidsPlaced: 0,
    };
  }
}

/**
 * Single-flight guard around the pipeline. A manual "Run pipeline now" must
 * not overlap a scheduled tick: two overlapping runs both pass the proposal-
 * existence check before the slow AI call, then the second insert trips the
 * proposals UNIQUE constraint (user_id, job_id).
 */
let pipelineInProgress = false;

export async function runPipeline(userId: string): Promise<PipelineResult> {
  if (pipelineInProgress) {
    await logRun(userId, "Pipeline", "Another pipeline run is in progress — skipped", "skipped");
    return { status: "skipped", jobsFound: 0, analyzed: 0, drafted: 0, bidsPlaced: 0 };
  }
  pipelineInProgress = true;
  try {
    return await runPipelineInner(userId);
  } finally {
    pipelineInProgress = false;
  }
}