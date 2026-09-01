import { and, desc, eq, sql } from "drizzle-orm";

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
} from "../jobs/jobs.service.js";
import { getProfile } from "../profile/profile.service.js";
import { generateProposal } from "../proposals/proposals.service.js";
import {
  splitParagraphs,
  type FreelancerProject,
  type JobSearchFilters,
} from "../jobs/jobs.client.js";
import { MAX_CONSECUTIVE_ERRORS } from "../logs/logs.service.js";

const log = createLogger("bid");

/** Default bid delivery period (days) and milestone percentage for auto-bids. */
const DEFAULT_BID_PERIOD = 1;
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
  const candidateJobs = getDb()
    .select()
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.status, "analyzed"),
        sql`${jobsTable.matchScore} >= ${settings.minMatchScore}`
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

    // Bid amount = the project's minimum budget (for hourly projects, its
    // hourly minimum). No budget listed → skip; auto-bid can't price it.
    const { minimumBudget } = parseJobRawData(job.rawData);
    if (minimumBudget === null) {
      await logRun(
        userId,
        "Auto-bid skipped",
        `Project ${job.projectId}: no budget minimum — skipped`,
        "skipped"
      );
      continue;
    }
    // Clamp the project minimum within the user's configured safety bounds.
    const bidAmount = Math.max(settings.minBid, Math.min(settings.maxBid, minimumBudget));

    // Get bidder id and an authenticated client (shared helpers).
    try {
      const bidderId = await getBidderId();
      const client = getFreelancerClient();

      await client.placeBid(
        job.projectId,
        bidderId,
        bidAmount,
        DEFAULT_BID_PERIOD,
        DEFAULT_MILESTONE_PERCENTAGE,
        proposal.content
      );

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
          jobTitle: proposal.jobTitle,
          client: proposal.client,
          amount: bidAmount,
          period: DEFAULT_BID_PERIOD,
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
        `Project ${job.projectId}: $${bidAmount} (score ${job.matchScore}, ${settings.bidsToday}/${settings.dailyCap} today)`,
        "ok"
      );

      log.info(`Auto-bid placed: ${bidId} for project ${job.projectId} at $${bidAmount}`);
    } catch (error) {
      await logRun(
        userId,
        "Auto-bid failed",
        `Project ${job.projectId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        "error"
      );
      log.error(`Auto-bid failed for project ${job.projectId}:`, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
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
  upgrades?: { featured: boolean; urgent: boolean; sealed: boolean };
} {
  if (!rawData) {
    return { description: [], jobSkills: [], projectType: null, bidPeriod: null, minimumBudget: null };
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
      upgrades,
    };
  } catch {
    return { description: [], jobSkills: [], projectType: null, bidPeriod: null, minimumBudget: null };
  }
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
            sql`${jobsTable.matchScore} >= ${settings.minMatchScore}`
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

        try {
          const parsed = parseJobRawData(job.rawData);
          const bidStats: { bidCount?: number; avgBid?: string } = {
            bidCount: job.bidCount,
          };
          if (job.avgBidLabel) bidStats.avgBid = job.avgBidLabel;

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
            null // competition — not fetched during pipeline draft
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