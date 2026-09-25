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
import { readBidId } from "../jobs/jobs.client.js";
import { saveProposal } from "../proposals/proposals.service.js";

const log = createLogger("bid");

/**
 * Bid period recorded for a bid the app did not place. Freelancer's update
 * endpoint takes no period, so this is bookkeeping to satisfy the column —
 * nothing is sent upstream with it.
 */
const ASSUMED_BID_PERIOD_DAYS = 7;

export type BidStatus = "pending" | "submitted" | "accepted" | "rejected" | "cancelled";

export type BidOutcome = "in_review" | "won" | "lost";

export type BidVia = "manual" | "auto";

export interface UserBid {
  id: string;
  userId: string;
  projectId: number;
  proposalId: string | null;
  /** Freelancer.com's bid id, when known — the handle an update is sent against. */
  freelancerBidId: number | null;
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
  freelancerBidId: number | null;
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

  // Place the bid on Freelancer.com, keeping the response: it carries the
  // platform's own bid id, which is what a later update is sent against.
  // No initialiser: every path out of the catch below throws, so the only way
  // past this block is the try assigning it.
  let freelancerBidId: number | null;
  try {
    const placed = await client.placeBid(
      proposal.projectId,
      bidderId,
      amount,
      period,
      milestonePercentage,
      proposal.content
    );
    freelancerBidId = readBidId(placed);
    if (freelancerBidId === null) {
      log.warn(
        `Bid placed on project ${proposal.projectId} but Freelancer.com returned no bid id — it can only be updated if the id is entered by hand`,
        { jobTitle: proposal.jobTitle }
      );
    }
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
      freelancerBidId,
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
    freelancerBidId,
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
        freelancerBidId: row.freelancerBidId ?? null,
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
      freelancerBidId: row.freelancerBidId ?? null,
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

export interface ReviseBidInput {
  /** Freelancer.com's bid id — the bid being updated. */
  freelancerBidId: number;
  description: string;
  amount: number;
  milestonePercentage: number;
}

export interface FoundBid {
  id: number;
  amount: number | null;
  description: string | null;
}

/**
 * Ask Freelancer.com for the user's own bid on a project.
 *
 * Called only from the Update bid dialog's Find button. Nothing here runs on
 * page load or dialog open: the `bidders[]` filter is one more upstream call,
 * and the user asked for it to be their choice rather than an automatic one.
 */
export async function findMyBidOnFreelancer(
  projectId: number
): Promise<FoundBid | null> {
  const bidderId = await getBidderId();
  const client = getFreelancerClient();
  const bids = await client.getBidsForProject(projectId, 10, bidderId);

  const mine = bids.find(
    (bid) => bid.bidder?.id === bidderId && typeof bid.id === "number"
  );
  if (mine === undefined || typeof mine.id !== "number") return null;

  return {
    id: mine.id,
    amount: typeof mine.amount === "number" ? mine.amount : null,
    description: typeof mine.description === "string" ? mine.description : null,
  };
}

/**
 * Revise a bid already on Freelancer.com.
 *
 * The upstream call happens first and the local record only follows it: if
 * Freelancer rejects the change, nothing here should suggest it took effect.
 *
 * A bid we have no row for (placed outside the app, with the id typed in by
 * hand) is recorded once the update lands, so it shows on the Bids page and the
 * id is remembered. Its `submittedAt` is when it was first recorded here, not
 * the true submission time, which the app has no way to know.
 */
export async function reviseBid(
  userId: string,
  projectId: number,
  input: ReviseBidInput
): Promise<UserBid> {
  const job = getDb()
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.projectId, projectId))
    .get();

  if (!job) {
    throw notFound(`Job with project ID ${projectId} not found`);
  }

  const client = getFreelancerClient();
  try {
    await client.updateBid(input.freelancerBidId, {
      description: input.description,
      amount: input.amount,
      milestonePercentage: input.milestonePercentage,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Failed to update bid: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  const now = new Date().toISOString();
  const existing = getDb()
    .select()
    .from(userBids)
    .where(and(eq(userBids.userId, userId), eq(userBids.projectId, projectId)))
    .orderBy(desc(userBids.submittedAt))
    .get();

  let bid: UserBid;
  if (existing !== undefined) {
    getDb()
      .update(userBids)
      .set({
        // Recorded now if it was missing, so the next update needs no typing.
        freelancerBidId: input.freelancerBidId,
        description: input.description,
        amount: input.amount,
        milestonePercentage: input.milestonePercentage,
        updatedAt: now,
      })
      .where(eq(userBids.id, existing.id))
      .run();

    bid = {
      id: existing.id,
      userId: existing.userId,
      projectId: existing.projectId,
      proposalId: existing.proposalId,
      freelancerBidId: input.freelancerBidId,
      jobTitle: existing.jobTitle,
      client: existing.client,
      amount: input.amount,
      period: existing.period,
      milestonePercentage: input.milestonePercentage,
      description: input.description,
      status: existing.status as BidStatus,
      outcome: existing.outcome as BidOutcome | null,
      via: existing.via as BidVia,
      submittedAt: existing.submittedAt,
      updatedAt: now,
    };
    log.info(
      `Revised bid ${existing.id} (Freelancer bid ${input.freelancerBidId}) on project ${projectId}`
    );
  } else {
    const id = `bid-${projectId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const period = readBidPeriod(job.rawData) ?? ASSUMED_BID_PERIOD_DAYS;

    getDb()
      .insert(userBids)
      .values({
        id,
        userId,
        projectId,
        proposalId: null,
        freelancerBidId: input.freelancerBidId,
        jobTitle: job.title,
        client: job.client,
        amount: input.amount,
        period,
        milestonePercentage: input.milestonePercentage,
        description: input.description,
        status: "submitted",
        outcome: "in_review",
        via: "manual",
        submittedAt: now,
        updatedAt: now,
      })
      .run();

    bid = {
      id,
      userId,
      projectId,
      proposalId: null,
      freelancerBidId: input.freelancerBidId,
      jobTitle: job.title,
      client: job.client,
      amount: input.amount,
      period,
      milestonePercentage: input.milestonePercentage,
      description: input.description,
      status: "submitted",
      outcome: "in_review",
      via: "manual",
      submittedAt: now,
      updatedAt: now,
    };
    log.info(
      `Recorded bid ${id} (Freelancer bid ${input.freelancerBidId}) for project ${projectId} — updated but not placed by this app`
    );
  }

  syncProposalAfterRevision(userId, projectId, bid.proposalId, input);

  return bid;
}

/**
 * Keep the local proposal in step with the bid that was just edited, so the job
 * page's proposal box does not show text the client never received. Best effort:
 * the upstream bid is already updated, and a missing or deleted proposal must
 * not turn a successful revision into a failure.
 */
function syncProposalAfterRevision(
  userId: string,
  projectId: number,
  proposalId: string | null,
  input: ReviseBidInput
): void {
  let target = proposalId;
  if (target === null) {
    const forJob = getDb()
      .select({ id: proposalsTable.id })
      .from(proposalsTable)
      .where(
        and(
          eq(proposalsTable.userId, userId),
          eq(proposalsTable.jobId, `job-${projectId}`)
        )
      )
      .get();
    target = forJob?.id ?? null;
  }
  if (target === null) return;

  void saveProposal(userId, target, input.description, input.amount).catch(
    (error: unknown) => {
      log.warn(
        `Bid updated on Freelancer.com but proposal ${target} could not be synced: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  );
}

/** The project's own bid period from the stored raw response, when present. */
function readBidPeriod(rawData: string | null): number | null {
  if (rawData === null) return null;
  try {
    const parsed = JSON.parse(rawData) as { bidperiod?: unknown };
    return typeof parsed.bidperiod === "number" && parsed.bidperiod > 0
      ? parsed.bidperiod
      : null;
  } catch {
    return null;
  }
}