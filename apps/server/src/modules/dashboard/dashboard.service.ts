import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import {
  automationSettings,
  jobs as jobsTable,
  logs as logsTable,
  platformCredentials,
  proposals as proposalsTable,
  userBids,
} from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import { getBidAmountSettings } from "../../lib/delivery-timeline.js";
import { getProfile } from "../profile/profile.service.js";
import { parseStoredAnalysis } from "../jobs/jobs.service.js";
import { getDiscordSettings } from "../discord/discord.service.js";

const log = createLogger("system");

const DAY_MS = 24 * 60 * 60 * 1000;

/* --------------------------- Shapes (mirror web) --------------------------- */

export type ConnectionStatus = "connected" | "needs_attention" | "not_connected";
export type MatchBand = "strong" | "good" | "fair";
export type ActivityKind =
  | "bid_won"
  | "bid_submitted"
  | "strong_match"
  | "proposal_shortlisted"
  | "sync_completed"
  | "automation_paused";

export interface KpiDelta {
  value: string;
  direction: "up" | "down";
  tone: "positive" | "negative" | "neutral";
  comparison: string;
}

export interface KpiMetric {
  id: string;
  label: string;
  value: string;
  context?: string;
  delta?: KpiDelta;
}

export interface MatchQualityBand {
  band: MatchBand;
  label: string;
  rangeLabel: string;
  count: number;
}

export interface MatchQualitySnapshot {
  windowLabel: string;
  averageScore: number;
  jobsAnalyzed: number;
  strongMatches: number;
  bands: MatchQualityBand[];
}

export interface JobAttentionItem {
  id: string;
  title: string;
  client: string;
  platform: string;
  matchScore: number;
  budgetLabel: string;
  reason: string;
  severity: "urgent" | "warning" | "info";
}

export interface ProposalSummary {
  id: string;
  jobTitle: string;
  client: string;
  bidAmount: number;
  status: string;
  updatedLabel: string;
}

export interface BidSummary {
  id: string;
  jobTitle: string;
  amount: number;
  recurring: boolean;
  outcome: "in_review" | "won" | "lost";
  submittedLabel: string;
  via: "manual" | "auto";
}

export interface PlatformConnection {
  id: "freelancer" | "openrouter" | "discord";
  name: string;
  username?: string;
  status: ConnectionStatus;
  lastSyncLabel?: string;
  newJobsToday?: number;
  note?: string;
}

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  message: string;
  timeLabel: string;
}

export interface BidAmountSettingsSummary {
  /** Whether the relevance gate picks a bid amount per project. */
  aiBidAmount: boolean;
  /** The fraction strings the AI may choose from, e.g. ["1/2","1/3","2/3","full"]. */
  bidAmountFractions: string[];
  /** Percentage (0–100) applied to the project max as a markup on the minimum,
   * when AI selection is off. */
  defaultBidMarkupPct: number;
  /** User's min/max bid bounds. */
  minBid: number;
  maxBid: number;
  /** Non-empty guidance text. */
  bidAmountInstructions: string;
  bidAmountMarkupInstructions: string;
  /** Round bid up to nearest N dollars (0 = no rounding). */
  roundBidUpTo: number;
}

export interface DashboardSnapshot {
  kpis: KpiMetric[];
  matchQuality: MatchQualitySnapshot;
  jobsRequiringAttention: JobAttentionItem[];
  recentProposals: ProposalSummary[];
  recentBids: BidSummary[];
  bidWinRate: { rate: number; windowLabel: string; submitted: number };
  platforms: PlatformConnection[];
  activity: ActivityEvent[];
  bidAmount: BidAmountSettingsSummary | null;
}

/* ------------------------------- Helpers ---------------------------------- */

function isoBefore(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** Preformatted relative time for an ISO timestamp, e.g. "2h ago". */
export function relativeFromIso(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return `${weeks}w ago`;
}

/** Signed delta chip. `inverse` flips the tone (fewer pending = good news). */
function buildDelta(
  current: number,
  previous: number,
  comparison: string,
  inverse = false
): KpiDelta | undefined {
  if (current === 0 && previous === 0) return undefined;
  const diff = current - previous;
  const value = diff > 0 ? `+${diff}` : String(diff);
  const direction: KpiDelta["direction"] = diff >= 0 ? "up" : "down";
  let tone: KpiDelta["tone"] = "neutral";
  if (diff !== 0) {
    const good = diff > 0;
    tone = inverse ? (good ? "negative" : "positive") : good ? "positive" : "negative";
  }
  return { value, direction, tone, comparison };
}

function countWhere(db: ReturnType<typeof getDb>, where: SQL): number {
  const row = db.select({ count: sql`count(*)` }).from(jobsTable).where(where).get();
  return Number(row?.count ?? 0);
}

interface CredentialRow {
  id: string;
  status: string;
  meta: string | null;
}

function platformStatus(row: CredentialRow | undefined): ConnectionStatus {
  if (row === undefined) return "not_connected";
  if (row.status === "ok") return "connected";
  if (row.status === "failed") return "needs_attention";
  return "not_connected";
}

function parseMeta(raw: string | null): { modelId?: string } {
  if (raw === null || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return {};
    const o = parsed as Record<string, unknown>;
    return { modelId: typeof o.modelId === "string" ? o.modelId : undefined };
  } catch {
    return {};
  }
}

/* ------------------------------ Aggregation ------------------------------- */

/**
 * The dashboard snapshot — everything the home page shows, aggregated from
 * the local database in one pass. No live API calls: all numbers are derived
 * from cached jobs, proposals, bids, logs, and credential state.
 */
export async function getDashboard(userId: string): Promise<DashboardSnapshot> {
  try {
    const db = getDb();
    const now = Date.now();
    const iso7d = isoBefore(7);
    const iso14d = isoBefore(14);

    // --- KPIs ---
    const jobs7d = countWhere(
      db,
      sql`${jobsTable.importedAt} >= ${iso7d}`
    );
    const jobsPrev7d = countWhere(
      db,
      sql`${jobsTable.importedAt} >= ${iso14d} AND ${jobsTable.importedAt} < ${iso7d}`
    );
    const analyzed7d = countWhere(
      db,
      sql`${jobsTable.status} = 'analyzed' AND ${jobsTable.lastAnalyzedAt} >= ${iso7d}`
    );

    const strong7d = countWhere(
      db,
      sql`${jobsTable.status} = 'analyzed' AND ${jobsTable.matchScore} >= 90 AND ${jobsTable.lastAnalyzedAt} >= ${iso7d}`
    );
    const strongPrev7d = countWhere(
      db,
      sql`${jobsTable.status} = 'analyzed' AND ${jobsTable.matchScore} >= 90 AND ${jobsTable.lastAnalyzedAt} >= ${iso14d} AND ${jobsTable.lastAnalyzedAt} < ${iso7d}`
    );

    const pendingStatuses = ["awaiting_approval", "queued", "draft"];
    const pendingRows = db
      .select({ status: proposalsTable.status })
      .from(proposalsTable)
      .where(eq(proposalsTable.userId, userId))
      .all();
    const pendingCount = pendingRows.filter((p) =>
      pendingStatuses.includes(p.status)
    ).length;
    const awaitingCount = pendingRows.filter(
      (p) => p.status === "awaiting_approval"
    ).length;
    const queuedCount = pendingRows.filter((p) => p.status === "queued").length;
    const proposalsCreated7d = db
      .select({ count: sql`count(*)` })
      .from(proposalsTable)
      .where(
        and(
          eq(proposalsTable.userId, userId),
          gte(proposalsTable.createdAt, iso7d)
        )
      )
      .get()?.count ?? 0;
    const proposalsCreatedPrev7d = db
      .select({ count: sql`count(*)` })
      .from(proposalsTable)
      .where(
        and(
          eq(proposalsTable.userId, userId),
          gte(proposalsTable.createdAt, iso14d),
          lt(proposalsTable.createdAt, iso7d)
        )
      )
      .get()?.count ?? 0;

    const bidsAll = db
      .select({ outcome: userBids.outcome, submittedAt: userBids.submittedAt })
      .from(userBids)
      .where(eq(userBids.userId, userId))
      .all();
    const bids30d = bidsAll.filter(
      (b) => new Date(b.submittedAt).getTime() >= now - 30 * DAY_MS
    ).length;
    const bidsPrev30d = bidsAll.filter((b) => {
      const t = new Date(b.submittedAt).getTime();
      return t >= now - 60 * DAY_MS && t < now - 30 * DAY_MS;
    }).length;

    // Daily-cap context from automation settings (present once saved).
    let bidsContext: string | undefined;
    const autoRow = db
      .select()
      .from(automationSettings)
      .where(eq(automationSettings.userId, userId))
      .get();
    if (autoRow !== undefined && autoRow.dailyCap > 0 && autoRow.bidsToday > 0) {
      bidsContext =
        autoRow.bidsToday >= autoRow.dailyCap
          ? `Daily limit reached ${autoRow.bidsToday}/${autoRow.dailyCap}`
          : `${autoRow.bidsToday}/${autoRow.dailyCap} today`;
    }

    const kpis: KpiMetric[] = [
      {
        id: "jobs-found",
        label: "Jobs found",
        value: String(jobs7d),
        context: `${analyzed7d} analyzed · last 7 days`,
        delta: buildDelta(jobs7d, jobsPrev7d, "vs previous week"),
      },
      {
        id: "strong-matches",
        label: "Strong matches",
        value: String(strong7d),
        context: "Score 90+ · last 7 days",
        delta: buildDelta(strong7d, strongPrev7d, "vs previous week"),
      },
      {
        id: "pending-proposals",
        label: "Pending proposals",
        value: String(pendingCount),
        context: `${awaitingCount} awaiting approval · ${queuedCount} queued`,
        // Fewer pending is progress, so a drop reads as good news.
        delta: buildDelta(
          Number(proposalsCreated7d),
          Number(proposalsCreatedPrev7d),
          "vs previous week",
          true
        ),
      },
      {
        id: "submitted-bids",
        label: "Submitted bids",
        value: String(bidsAll.length),
        context: bidsContext,
        delta: buildDelta(bids30d, bidsPrev30d, "vs previous 30 days"),
      },
    ];

    // --- Match quality (analyzed jobs in the last 7 days, score > 0) ---
    const analyzedWindow = db
      .select({ matchScore: jobsTable.matchScore })
      .from(jobsTable)
      .where(
        sql`${jobsTable.status} = 'analyzed' AND ${jobsTable.matchScore} > 0 AND ${jobsTable.lastAnalyzedAt} >= ${iso7d}`
      )
      .all();
    const scores = analyzedWindow
      .map((r) => Number(r.matchScore))
      .filter((s) => Number.isFinite(s) && s > 0);
    const jobsAnalyzed = scores.length;
    const averageScore =
      jobsAnalyzed > 0
        ? Math.round(scores.reduce((sum, s) => sum + s, 0) / jobsAnalyzed)
        : 0;
    const strongMatches = scores.filter((s) => s >= 90).length;
    const bandCount = (band: (s: number) => boolean): number =>
      scores.filter(band).length;
    const matchQuality: MatchQualitySnapshot = {
      windowLabel: "Last 7 days",
      averageScore,
      jobsAnalyzed,
      strongMatches,
      bands: [
        { band: "strong", label: "Strong", rangeLabel: "90–100", count: bandCount((s) => s >= 90) },
        { band: "good", label: "Good", rangeLabel: "75–89", count: bandCount((s) => s >= 75 && s < 90) },
        { band: "fair", label: "Fair", rangeLabel: "Below 75", count: bandCount((s) => s < 75) },
      ],
    };

    // --- Jobs requiring attention (analyzed, score >= 80, top 5) ---
    const attentionRows = db
      .select()
      .from(jobsTable)
      .where(
        sql`${jobsTable.status} = 'analyzed' AND ${jobsTable.matchScore} >= 80`
      )
      .orderBy(desc(jobsTable.matchScore))
      .limit(5)
      .all();
    const jobsRequiringAttention: JobAttentionItem[] = attentionRows.map((row) => {
      const score = Number(row.matchScore);
      const stored = parseStoredAnalysis(row.analysis);
      const reason =
        (stored?.concerns?.[0] ?? "").trim().length > 0
          ? (stored?.concerns?.[0] ?? "").trim()
          : `Strong match — score ${score}`;
      return {
        id: String(row.projectId),
        title: row.title,
        client: row.client,
        platform: "Freelancer.com",
        matchScore: score,
        budgetLabel: row.budgetLabel,
        reason,
        severity: score >= 90 ? "urgent" : score >= 80 ? "warning" : "info",
      };
    });

    // --- Recent proposals (top 5 by last update) ---
    const proposalRows = db
      .select()
      .from(proposalsTable)
      .where(eq(proposalsTable.userId, userId))
      .orderBy(desc(proposalsTable.updatedAt))
      .limit(5)
      .all();
    const recentProposals: ProposalSummary[] = proposalRows.map((row) => ({
      id: row.id,
      jobTitle: row.jobTitle,
      client: row.client,
      bidAmount: row.bidAmount ?? 0,
      status: row.status,
      updatedLabel: relativeFromIso(row.updatedAt),
    }));

    // --- Recent bids (top 5 by submission) ---
    const bidRows = db
      .select()
      .from(userBids)
      .where(eq(userBids.userId, userId))
      .orderBy(desc(userBids.submittedAt))
      .limit(5)
      .all();
    const recentBids: BidSummary[] = bidRows.map((row) => ({
      id: row.id,
      jobTitle: row.jobTitle,
      amount: row.amount,
      recurring: false,
      outcome: (row.outcome as BidSummary["outcome"] | null) ?? "in_review",
      submittedLabel: relativeFromIso(row.submittedAt),
      via: (row.via as BidSummary["via"] | null) ?? "manual",
    }));

    // --- Bid win rate ---
    const won = bidsAll.filter((b) => b.outcome === "won").length;
    const decided = bidsAll.filter((b) => b.outcome !== null).length;
    const bidWinRate = {
      rate: decided > 0 ? Math.round((won / decided) * 100) : 0,
      windowLabel: "Last 30 days",
      submitted: decided,
    };

    // --- Platforms ---
    const credRows = db.select().from(platformCredentials).all();
    const credById = new Map(credRows.map((r) => [r.id, r] as const));
    const profile = getProfile(userId);

    const frCred = credById.get("freelancer");
    const frStatus = platformStatus(frCred as CredentialRow | undefined);
    const syncRow = db
      .select({ time: logsTable.time })
      .from(logsTable)
      .where(eq(logsTable.category, "sync"))
      .orderBy(desc(logsTable.time))
      .limit(1)
      .get();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const newJobsToday = Number(
      db
        .select({ count: sql`count(*)` })
        .from(jobsTable)
        .where(gte(jobsTable.importedAt, todayStart.toISOString()))
        .get()?.count ?? 0
    );

    const orCred = credById.get("openrouter");
    const orStatus = platformStatus(orCred as CredentialRow | undefined);
    const aiRow = db
      .select({ time: logsTable.time })
      .from(logsTable)
      .where(eq(logsTable.category, "ai"))
      .orderBy(desc(logsTable.time))
      .limit(1)
      .get();
    const orModel = orCred !== undefined ? parseMeta(orCred.meta).modelId : undefined;

    const discordSettings = getDiscordSettings(userId);
    const discordStatus: ConnectionStatus = discordSettings.configured
      ? "connected"
      : "not_connected";

    const platforms: PlatformConnection[] = [
      {
        id: "freelancer",
        name: "Freelancer.com",
        username: profile?.freelancerUsername ?? undefined,
        status: frStatus,
        lastSyncLabel: syncRow !== undefined ? relativeFromIso(syncRow.time) : undefined,
        newJobsToday,
        note:
          frStatus === "not_connected"
            ? "Connect Freelancer.com to start finding jobs"
            : undefined,
      },
      {
        id: "openrouter",
        name: "OpenRouter",
        status: orStatus,
        lastSyncLabel: aiRow !== undefined ? relativeFromIso(aiRow.time) : undefined,
        note:
          orStatus === "not_connected"
            ? "Add your OpenRouter API key"
            : orModel !== undefined
              ? `Model: ${orModel}`
              : undefined,
      },
      {
        id: "discord",
        name: "Discord",
        status: discordStatus,
        note: discordSettings.configured
          ? discordSettings.webhookPreview !== null
            ? `Webhook ${discordSettings.webhookPreview}`
            : "Notifications connected"
          : "Connect Discord for job notifications",
      },
    ];

    // --- Activity feed (latest log entries) ---
    const activityRows = db
      .select()
      .from(logsTable)
      .orderBy(desc(logsTable.time))
      .limit(6)
      .all();
    const kindMap: Record<string, ActivityKind> = {
      bid: "bid_submitted",
      sync: "sync_completed",
      analysis: "strong_match",
      proposal: "proposal_shortlisted",
      proposals: "proposal_shortlisted",
    };
    const activity: ActivityEvent[] = activityRows.map((row) => ({
      id: row.id,
      kind: kindMap[row.category] ?? "automation_paused",
      message: row.message,
      timeLabel: relativeFromIso(row.time),
    }));

    // Bid-amount settings summary — pure read (defaults when the row is absent).
    const bidAmountSettings = getBidAmountSettings(userId);
    const bidAmount: BidAmountSettingsSummary | null = {
      aiBidAmount: bidAmountSettings.aiBidAmount,
      bidAmountFractions: bidAmountSettings.bidAmountFractions,
      defaultBidMarkupPct: bidAmountSettings.defaultBidMarkupPct,
      minBid: autoRow?.minBid ?? 0,
      maxBid: autoRow?.maxBid ?? 0,
      bidAmountInstructions: bidAmountSettings.bidAmountInstructions,
      bidAmountMarkupInstructions: bidAmountSettings.bidAmountMarkupInstructions,
      roundBidUpTo: bidAmountSettings.roundBidUpTo,
    };

    return {
      kpis,
      matchQuality,
      jobsRequiringAttention,
      recentProposals,
      recentBids,
      bidWinRate,
      platforms,
      activity,
      bidAmount,
    };
  } catch (error) {
    log.error("Failed to compute dashboard snapshot:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to compute dashboard snapshot: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
