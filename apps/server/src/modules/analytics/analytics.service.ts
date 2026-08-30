import { eq, sql } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { jobs as jobsTable, proposals as proposalsTable, userBids } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("system");

const NUM_WEEKS = 8;

export interface SeriesPoint {
  label: string;
  value: number;
}

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

export interface AnalyticsSnapshot {
  kpis: KpiMetric[];
  bidsPerWeek: SeriesPoint[];
  outcomes: { won: number; lost: number; inReview: number };
  proposalsByStatus: SeriesPoint[];
}

/** Convert a number to a dollar label like "$2,080". */
function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

/**
 * Aggregate analytics for the owner user from jobs, proposals, and user_bids.
 * All queries are scoped to this user's rows.
 */
export async function getAnalytics(userId: string): Promise<AnalyticsSnapshot> {
  try {
    const db = getDb();

    // --- Job-level aggregates ---
    const jobsAnalyzed =
      db
        .select({ count: sql`count(*)` })
        .from(jobsTable)
        .where(eq(jobsTable.status, "analyzed"))
        .get()?.count ?? 0;

    const strongMatches =
      db
        .select({ count: sql`count(*)` })
        .from(jobsTable)
        .where(
          sql`${jobsTable.matchScore} >= 80 AND ${jobsTable.status} = 'analyzed'`
        )
        .get()?.count ?? 0;

    // --- Proposal aggregates ---
    const proposalsTotal =
      db
        .select({ count: sql`count(*)` })
        .from(proposalsTable)
        .where(eq(proposalsTable.userId, userId))
        .get()?.count ?? 0;

    // --- Bid aggregates ---
    const allBids = db
      .select({
        amount: userBids.amount,
        outcome: userBids.outcome,
        submittedAt: userBids.submittedAt,
      })
      .from(userBids)
      .where(eq(userBids.userId, userId))
      .all();

    const bidsPlaced = allBids.length;
    const wonBids = allBids.filter((b) => b.outcome === "won").length;
    const lostBids = allBids.filter((b) => b.outcome === "lost").length;
    const inReviewBids = allBids.filter((b) => b.outcome === "in_review").length;

    // Average bid amount (only on bids that have a positive amount).
    const avgBid =
      allBids.length > 0
        ? allBids.reduce((sum, b) => sum + (b.amount ?? 0), 0) / allBids.length
        : 0;

    const wonValue = allBids
      .filter((b) => b.outcome === "won")
      .reduce((sum, b) => sum + (b.amount ?? 0), 0);

    const successRate =
      wonBids + lostBids > 0 ? Math.round((wonBids / (wonBids + lostBids)) * 100) : 0;

    // --- KPIs ---
    const kpis: KpiMetric[] = [
      {
        id: "jobs-analyzed",
        label: "Jobs analyzed",
        value: String(jobsAnalyzed),
        context: `${strongMatches} strong matches`,
      },
      {
        id: "proposals",
        label: "Proposals drafted",
        value: String(proposalsTotal),
      },
      {
        id: "bids-placed",
        label: "Bids placed",
        value: String(bidsPlaced),
        context: `${successRate}% success rate`,
      },
      {
        id: "won-projects",
        label: "Won projects",
        value: String(wonBids),
        context: wonValue > 0 ? `$${Math.round(wonValue).toLocaleString()} total` : undefined,
      },
      {
        id: "avg-bid",
        label: "Average bid",
        value: avgBid > 0 ? money(avgBid) : "—",
      },
    ];

    // --- Bids per week (last 8 weeks, 7-day windows from now) ---
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const bidsPerWeek: SeriesPoint[] = [];

    for (let i = 0; i < NUM_WEEKS; i++) {
      const startStr = new Date(nowMs - (NUM_WEEKS - i) * msPerWeek).toISOString();
      const endStr = new Date(nowMs - (NUM_WEEKS - i - 1) * msPerWeek).toISOString();
      const count =
        db
          .select({ count: sql`count(*)` })
          .from(userBids)
          .where(
            sql`${userBids.submittedAt} >= ${startStr} AND ${userBids.submittedAt} < ${endStr}`
          )
          .get()?.count ?? 0;
      // W1 = oldest week, W8 = current week (last 7 days)
      bidsPerWeek.push({ label: `W${i + 1}`, value: Number(count) });
    }

    // --- Proposal status breakdown ---
    const statusRows = db
      .select({ status: proposalsTable.status, count: sql`count(*)` })
      .from(proposalsTable)
      .where(eq(proposalsTable.userId, userId))
      .groupBy(proposalsTable.status)
      .all();

    const statusLabelMap: Record<string, string> = {
      draft: "Draft",
      queued: "Queued",
      awaiting_approval: "Awaiting approval",
      approved: "Approved",
      submitted: "Submitted",
      viewed: "Viewed",
      shortlisted: "Shortlisted",
      declined: "Declined",
      won: "Won",
    };

    const proposalsByStatus: SeriesPoint[] = statusRows
      .map((row) => ({
        label: statusLabelMap[row.status] ?? row.status,
        value: Number(row.count),
      }))
      .sort((a, b) => b.value - a.value);

    return {
      kpis,
      bidsPerWeek,
      outcomes: {
        won: wonBids,
        lost: lostBids,
        inReview: inReviewBids,
      },
      proposalsByStatus,
    };
  } catch (error) {
    log.error("Failed to compute analytics:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to compute analytics: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
