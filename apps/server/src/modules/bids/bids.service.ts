import { and, desc, eq } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { AppError, notFound } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import {
  proposals as proposalsTable,
  jobs as jobsTable,
  userBids,
} from "../../db/schema.js";
import { getBidderId, getFreelancerClient } from "../jobs/jobs.service.js";

const log = createLogger("bid");

export type BidStatus = "pending" | "submitted" | "accepted" | "rejected" | "cancelled";

export type BidOutcome = "in_review" | "won" | "lost";

export type BidVia = "manual" | "auto";

export interface UserBid {
  id: string;
  userId: string;
  projectId: number;
  proposalId: string | null;
  jobTitle: string;
  client: string;
  amount: number;
  period: number;
  milestonePercentage: number;
  description: string;
  status: BidStatus;
  outcome: BidOutcome | null;
  via: BidVia;
  submittedAt: string;
  updatedAt: string;
}

export interface BidResponse {
  id: string;
  jobTitle: string;
  client: string;
  amount: number;
  period: number;
  milestonePercentage: number;
  status: BidStatus;
  outcome: BidOutcome | null;
  via: BidVia;
  submittedLabel: string;
  updatedLabel: string;
  proposalExcerpt?: string | null;
}

export async function placeBid(
  userId: string,
  proposalId: string,
  amount: number,
  period: number,
  milestonePercentage: number = 50
): Promise<UserBid> {
  // Verify the proposal exists and belongs to the user
  const proposal = getDb()
    .select()
    .from(proposalsTable)
    .where(and(eq(proposalsTable.id, proposalId), eq(proposalsTable.userId, userId)))
    .get();

  if (!proposal) {
    throw notFound(`Proposal ${proposalId} not found`);
  }

  // Only approved proposals may be submitted as actual bids.
  if (proposal.status !== "approved") {
    throw new AppError(
      400,
      "BID_ERROR",
      `Proposal must be approved before submitting a bid (current status: ${proposal.status})`
    );
  }

  // Get the job's raw data for projectId, title, client
  const job = getDb()
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.projectId, proposal.projectId))
    .get();

  if (!job) {
    throw notFound(`Job for proposal ${proposalId} not found`);
  }

  // Get bidder id and an authenticated client (shared helpers).
  const bidderId = await getBidderId();
  const client = getFreelancerClient();

  // Place the bid on Freelancer.com
  try {
    await client.placeBid(
      proposal.projectId,
      bidderId,
      amount,
      period,
      milestonePercentage,
      proposal.content
    );
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "BID_REJECTED") {
        throw new AppError(400, "BID_REJECTED", error.message);
      }
      throw error;
    }
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Failed to place bid: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  // Record the bid in our database
  const now = new Date().toISOString();
  const bidId = `bid-${proposal.projectId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  getDb()
    .insert(userBids)
    .values({
      id: bidId,
      userId,
      projectId: proposal.projectId,
      proposalId: proposal.id,
      jobTitle: proposal.jobTitle,
      client: proposal.client,
      amount,
      period,
      milestonePercentage,
      description: proposal.content,
      status: "submitted",
      outcome: "in_review",
      via: "manual",
      submittedAt: now,
      updatedAt: now,
    })
    .run();

  log.info(`Placed bid ${bidId} for project ${proposal.projectId} (manual)`);

  return {
    id: bidId,
    userId,
    projectId: proposal.projectId,
    proposalId: proposal.id,
    jobTitle: proposal.jobTitle,
    client: proposal.client,
    amount,
    period,
    milestonePercentage,
    description: proposal.content,
    status: "submitted",
    outcome: "in_review",
    via: "manual",
    submittedAt: now,
    updatedAt: now,
  };
}

export async function listBids(userId: string, outcomeFilter?: BidOutcome): Promise<BidResponse[]> {
  try {
    let rows = getDb()
      .select()
      .from(userBids)
      .where(eq(userBids.userId, userId))
      .orderBy(desc(userBids.submittedAt))
      .all();

    if (outcomeFilter) {
      rows = rows.filter((row) => row.outcome === outcomeFilter);
    }

    const now = Date.now();
    return rows.map((row) => {
      const submittedAt = new Date(row.submittedAt);
      const updatedAt = new Date(row.updatedAt);
      const diffMsSubmitted = now - submittedAt.getTime();
      const diffMsUpdated = now - updatedAt.getTime();

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
        jobTitle: row.jobTitle,
        client: row.client,
        amount: row.amount,
        period: row.period,
        milestonePercentage: row.milestonePercentage,
        status: row.status as BidStatus,
        outcome: row.outcome as BidOutcome | null,
        via: row.via as BidVia,
        submittedLabel: formatLabel(diffMsSubmitted),
        updatedLabel: formatLabel(diffMsUpdated),
        proposalExcerpt: (row.description?.split("\n")[0] ?? "").slice(0, 100),
      };
    });
  } catch (error) {
    log.error("Failed to list bids:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to list bids: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function getBid(userId: string, bidId: string): Promise<UserBid | null> {
  try {
    const row = getDb()
      .select()
      .from(userBids)
      .where(and(eq(userBids.id, bidId), eq(userBids.userId, userId)))
      .get();

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      projectId: row.projectId,
      proposalId: row.proposalId,
      jobTitle: row.jobTitle,
      client: row.client,
      amount: row.amount,
      period: row.period,
      milestonePercentage: row.milestonePercentage,
      description: row.description,
      status: row.status as BidStatus,
      outcome: row.outcome as BidOutcome | null,
      via: row.via as BidVia,
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
    };
  } catch (error) {
    log.error("Failed to get bid:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to get bid: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function updateBidOutcome(
  userId: string,
  bidId: string,
  outcome: BidOutcome
): Promise<void> {
  try {
    const row = getDb()
      .select()
      .from(userBids)
      .where(and(eq(userBids.id, bidId), eq(userBids.userId, userId)))
      .get();

    if (!row) {
      throw notFound(`Bid ${bidId} not found`);
    }

    getDb()
      .update(userBids)
      .set({
        outcome,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(userBids.id, bidId), eq(userBids.userId, userId)))
      .run();

    log.info(`Updated bid ${bidId} outcome to ${outcome}`);
  } catch (error) {
    if (error instanceof AppError) throw error;
    log.error("Failed to update bid outcome:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to update bid outcome: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}