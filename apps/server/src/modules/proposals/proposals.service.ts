import { and, desc, eq, type SQL } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { proposals, jobs as jobsTable } from "../../db/schema.js";
import { AppError, notFound } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import { generateProposalWithAI } from "../ai/ai.service.js";
import type { ProjectUpgrades, CompetitionData } from "../ai/ai.service.js";
import { getProfile } from "../profile/profile.service.js";
import { parseStoredAnalysis } from "../jobs/jobs.service.js";
import type { StoredAnalysis } from "../jobs/jobs.client.js";

const log = createLogger("proposals");

export const proposalStatusEnum = [
  "draft",
  "queued",
  "awaiting_approval",
  "approved",
  "submitted",
  "viewed",
  "shortlisted",
  "declined",
  "won",
] as const;

export type ProposalStatus = (typeof proposalStatusEnum)[number];

export interface ProposalData {
  id: string;
  userId: string;
  jobId: string;
  projectId: number;
  jobTitle: string;
  client: string;
  bidAmount?: number | null;
  status: ProposalStatus;
  content: string;
  competitorNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProposalInput {
  jobId: string;
  projectId: number;
  jobTitle: string;
  client: string;
  content: string;
  bidAmount?: number;
  competitorNote?: string;
}

export interface ProposalResponse {
  id: string;
  jobTitle: string;
  client: string;
  bidAmount: number | null;
  status: ProposalStatus;
  content: string;
  competitorNote: string | null;
  updatedLabel: string;
  createdAtLabel: string;
}

export function getProposalStatusLabel(status: ProposalStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "queued":
      return "Queued";
    case "awaiting_approval":
      return "Awaiting approval";
    case "approved":
      return "Approved";
    case "submitted":
      return "Submitted";
    case "viewed":
      return "Viewed";
    case "shortlisted":
      return "Shortlisted";
    case "declined":
      return "Declined";
    case "won":
      return "Won";
    default:
      return status;
  }
}

export async function createProposal(
  userId: string,
  data: CreateProposalInput
): Promise<ProposalData> {
  try {
    const existing = getDb()
      .select()
      .from(proposals)
      .where(and(eq(proposals.userId, userId), eq(proposals.jobId, data.jobId)))
      .get();

    if (existing) {
      throw new AppError(
        409,
        "CONFLICT",
        `A proposal for this job (${data.jobTitle}) already exists. Use regenerate or edit instead.`
      );
    }

    const now = new Date().toISOString();
    const proposalId = `prop-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    getDb()
      .insert(proposals)
      .values({
        id: proposalId,
        userId,
        jobId: data.jobId,
        projectId: data.projectId,
        jobTitle: data.jobTitle,
        client: data.client,
        bidAmount: data.bidAmount ?? null,
        status: "draft",
        content: data.content,
        competitorNote: data.competitorNote ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    log.info(`Created proposal ${proposalId} for job ${data.jobId}`);

    return {
      id: proposalId,
      userId,
      jobId: data.jobId,
      projectId: data.projectId,
      jobTitle: data.jobTitle,
      client: data.client,
      bidAmount: data.bidAmount ?? null,
      status: "draft",
      content: data.content,
      competitorNote: data.competitorNote ?? null,
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : "Unknown error";
    // Same job generated twice in overlapping calls — the UNIQUE index wins.
    if (
      error instanceof Error &&
      ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE" ||
        message.includes("UNIQUE constraint failed"))
    ) {
      throw new AppError(
        409,
        "CONFLICT",
        `A proposal for this job (${data.jobTitle}) already exists. Use regenerate or edit instead.`
      );
    }
    log.error("Failed to create proposal:", { error: message });
    throw new AppError(500, "DATABASE_ERROR", `Failed to create proposal: ${message}`);
  }
}

export async function listProposals(
  userId: string,
  statusFilter?: ProposalStatus
): Promise<ProposalResponse[]> {
  try {
    // Build WHERE conditions so we can apply the status filter in a single
    // .where() call (Drizzle's query builder is immutable — chaining .where()
    // twice produces a type error and a no-op at runtime).
    const conditions: SQL[] = [eq(proposals.userId, userId)];
    if (statusFilter && statusFilter !== "draft") {
      conditions.push(eq(proposals.status, statusFilter));
    }

    // Sort by updatedAt descending at the DB level — the old code sorted by
    // the relative time label ("2h ago") which produced Invalid Date + NaN.
    const rows = getDb()
      .select()
      .from(proposals)
      .where(and(...conditions))
      .orderBy(desc(proposals.updatedAt))
      .all();

    const now = Date.now();

    const formatLabel = (iso: string): string => {
      const diffMs = now - new Date(iso).getTime();
      const minutes = Math.round(diffMs / 60000);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.round(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.round(hours / 24);
      if (days < 7) return `${days}d ago`;
      const weeks = Math.round(days / 7);
      return `${weeks}w ago`;
    };

    return rows.map((row) => ({
      id: row.id,
      jobTitle: row.jobTitle,
      client: row.client,
      bidAmount: row.bidAmount ?? null,
      status: row.status as ProposalStatus,
      content: row.content,
      competitorNote: row.competitorNote ?? null,
      updatedLabel: formatLabel(row.updatedAt),
      createdAtLabel: formatLabel(row.createdAt),
    }));
  } catch (error) {
    log.error("Failed to list proposals:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to list proposals: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function getProposal(
  userId: string,
  proposalId: string
): Promise<ProposalData | null> {
  try {
    const row = getDb()
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.userId, userId)))
      .get();

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      jobId: row.jobId,
      projectId: row.projectId,
      jobTitle: row.jobTitle,
      client: row.client,
      bidAmount: row.bidAmount ?? null,
      status: row.status as ProposalStatus,
      content: row.content,
      competitorNote: row.competitorNote ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  } catch (error) {
    log.error("Failed to get proposal:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to get proposal: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function getProposalByJob(
  userId: string,
  jobId: string
): Promise<ProposalData | null> {
  try {
    const row = getDb()
      .select()
      .from(proposals)
      .where(and(eq(proposals.userId, userId), eq(proposals.jobId, jobId)))
      .get();

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      jobId: row.jobId,
      projectId: row.projectId,
      jobTitle: row.jobTitle,
      client: row.client,
      bidAmount: row.bidAmount ?? null,
      status: row.status as ProposalStatus,
      content: row.content,
      competitorNote: row.competitorNote ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  } catch (error) {
    log.error("Failed to get proposal by job:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to get proposal by job: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function updateProposalStatus(
  userId: string,
  proposalId: string,
  status: ProposalStatus
): Promise<void> {
  try {
    const row = getDb()
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.userId, userId)))
      .get();

    if (!row) {
      throw notFound(`Proposal ${proposalId} not found`);
    }

    getDb()
      .update(proposals)
      .set({
        status,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(proposals.id, proposalId), eq(proposals.userId, userId)))
      .run();

    log.info(`Updated proposal ${proposalId} status to ${status}`);
  } catch (error) {
    if (error instanceof AppError) throw error;
    log.error("Failed to update proposal status:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to update proposal status: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function saveProposal(
  userId: string,
  proposalId: string,
  content: string,
  bidAmount?: number
): Promise<void> {
  try {
    const row = getDb()
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.userId, userId)))
      .get();

    if (!row) {
      throw notFound(`Proposal ${proposalId} not found`);
    }

    getDb()
      .update(proposals)
      .set({
        content,
        ...(bidAmount !== undefined ? { bidAmount } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(proposals.id, proposalId), eq(proposals.userId, userId)))
      .run();

    log.info(`Saved proposal ${proposalId}`);
  } catch (error) {
    if (error instanceof AppError) throw error;
    log.error("Failed to save proposal:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to save proposal: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Generate proposal content using real profile facts and job details.
 * Never invents skills, experience, or portfolio items.
 */
export async function generateProposal(
  userId: string,
  jobId: string,
  projectId: number,
  jobTitle: string,
  clientName: string,
  description: string[],
  jobSkills: string[],
  bidStats?: { bidCount?: number; avgBid?: string; highBid?: string; lowBid?: string },
  projectType?: string | null,
  bidPeriod?: number | null,
  upgrades?: ProjectUpgrades,
  competition?: CompetitionData | null
): Promise<{ proposal: ProposalData; competitorNote: string }> {
  try {
    // Prevent duplicate proposals for the same job — return a clean 409
    // instead of letting the DB UNIQUE constraint surface as a 500.
    const existing = getDb()
      .select()
      .from(proposals)
      .where(and(eq(proposals.userId, userId), eq(proposals.jobId, jobId)))
      .get();
    if (existing) {
      throw new AppError(
        409,
        "CONFLICT",
        `A proposal for this job already exists. Use regenerate or edit instead.`
      );
    }

    // Load the real user profile — the AI may only use these facts.
    const profile = getProfile(userId);
    if (profile === null) {
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Save your profile before generating a proposal"
      );
    }

    // Load any prior AI analysis for this job (provides score + recommended bid).
    let analysis: StoredAnalysis | null = null;
    const jobRow = getDb()
      .select({ analysis: jobsTable.analysis })
      .from(jobsTable)
      .where(eq(jobsTable.projectId, projectId))
      .get();
    if (jobRow) {
      analysis = parseStoredAnalysis(jobRow.analysis);
    }

    const { content, competitorNote } = await generateProposalWithAI(
      {
        jobTitle,
        jobDescription: description,
        skills: jobSkills,
        bidCount: bidStats?.bidCount,
        avgBid: bidStats?.avgBid,
        highBid: bidStats?.highBid,
        lowBid: bidStats?.lowBid,
        projectType,
        bidPeriod,
        upgrades,
        competition,
        profile: {
          name: profile.name,
          title: profile.title,
          hourlyRate: profile.hourlyRate,
          about: profile.about,
          skills: profile.skills,
          experience: profile.experience,
          portfolio: profile.portfolio,
          certifications: profile.certifications,
          wants: profile.wants,
          notWants: profile.notWants,
          customInstructions: profile.customInstructions,
          userSummary: profile.userSummary,
          portfolioSummary: profile.portfolioSummary,
          proposalTemplates: profile.proposalTemplates,
        },
        analysis: analysis
          ? { score: analysis.score, recommendedBidLabel: analysis.recommendedBidLabel, summary: analysis.summary }
          : null,
      },
      undefined,
      userId
    );

    const proposalId = `prop-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const now = new Date().toISOString();

    getDb()
      .insert(proposals)
      .values({
        id: proposalId,
        userId,
        jobId,
        projectId,
        jobTitle,
        client: clientName,
        bidAmount: null,
        status: "draft",
        content,
        competitorNote,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    log.info(`Generated proposal ${proposalId} for job ${jobId}`);

    return {
      proposal: {
        id: proposalId,
        userId,
        jobId,
        projectId,
        jobTitle,
        client: clientName,
        bidAmount: null,
        status: "draft",
        content,
        competitorNote,
        createdAt: now,
        updatedAt: now,
      },
      competitorNote,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : "Unknown error";

    // Two overlapping generations for the same job can both pass the existence
    // check before the slow AI call; the DB UNIQUE index is the final arbiter.
    // Report that as a clean conflict, not a server error.
    const isUniqueViolation =
      error instanceof Error &&
      ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE" ||
        message.includes("UNIQUE constraint failed"));

    // The OpenRouter request was cut off by its timeout — explain instead of
    // leaking the raw DOMException text.
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" ||
        error.name === "AbortError" ||
        message.includes("aborted due to timeout"));

    if (isUniqueViolation) {
      throw new AppError(
        409,
        "CONFLICT",
        `A proposal for this job (${jobTitle}) already exists. Use regenerate or edit instead.`
      );
    }
    if (isTimeout) {
      throw new AppError(
        504,
        "UPSTREAM_TIMEOUT",
        "The AI request timed out — the model may be slow or overloaded. Try again, or pick a faster proposal model on the Platforms page."
      );
    }

    log.error("Failed to generate proposal:", { error: message });
    throw new AppError(500, "PROPOSAL_ERROR", `Failed to generate proposal: ${message}`);
  }
}

/**
 * Regenerate a proposal's content using AI. Reloads the profile and job context
 * fresh so the new version reflects any updated facts. Does not create a new
 * proposal row — updates the existing one in place.
 */
export async function regenerateProposal(
  userId: string,
  proposalId: string,
  projectType?: string | null,
  bidPeriod?: number | null,
  upgrades?: ProjectUpgrades,
  competition?: CompetitionData | null
): Promise<{ content: string; competitorNote: string }> {
  try {
    const proposal = await getProposal(userId, proposalId);
    if (proposal === null) {
      throw notFound(`Proposal ${proposalId} not found`);
    }

    // Reload the job's raw data from the DB cache, if available.
    // If the job was never stored, proceed with empty context arrays —
    // generateProposalWithAI loads the profile internally via userId.
    let description: string[] = [];
    let jobSkills: string[] = [];
    let bidStats: { bidCount?: number; avgBid?: string } = {};
    let analysis: StoredAnalysis | null = null;

    const jobRow = getDb()
      .select({
        rawData: jobsTable.rawData,
        bidCount: jobsTable.bidCount,
        avgBidLabel: jobsTable.avgBidLabel,
        analysis: jobsTable.analysis,
      })
      .from(jobsTable)
      .where(eq(jobsTable.projectId, proposal.projectId))
      .get();

    if (jobRow) {
      if (jobRow.rawData) {
        try {
          const project = JSON.parse(jobRow.rawData) as {
            description?: string;
            preview_description?: string;
            jobs?: Array<{ name?: string }>;
          };
          const desc = project.description ?? project.preview_description ?? "";
          description = desc
            .split(/\n{2,}|(?<=\.)\n/)
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
          jobSkills = (project.jobs ?? []).map((j) => j.name).filter((n): n is string => Boolean(n));
        } catch {
          // fall through with empty arrays
        }
      }
      bidStats = { bidCount: jobRow.bidCount, avgBid: jobRow.avgBidLabel };
      analysis = parseStoredAnalysis(jobRow.analysis);
    }

    // Call the AI directly (bypasses generateProposal's duplicate check).
    // generateProposalWithAI loads the profile internally via userId, so we
    // only need to pass job context.
    const { content, competitorNote } = await generateProposalWithAI(
      {
        jobTitle: proposal.jobTitle,
        jobDescription: description,
        skills: jobSkills,
        bidCount: bidStats.bidCount,
        avgBid: bidStats.avgBid,
        projectType,
        bidPeriod,
        upgrades,
        competition,
        profile: {
          name: null,
          title: null,
          hourlyRate: null,
          about: null,
          skills: [],
          experience: [],
          portfolio: [],
          certifications: [],
          wants: [],
          notWants: [],
          customInstructions: null,
          userSummary: null,
        },
        analysis: analysis
          ? { score: analysis.score, recommendedBidLabel: analysis.recommendedBidLabel, summary: analysis.summary }
          : null,
      },
      undefined,
      userId
    );

    // Update the existing proposal's content and competitorNote.
    const now = new Date().toISOString();
    getDb()
      .update(proposals)
      .set({ content, competitorNote, updatedAt: now })
      .where(eq(proposals.id, proposalId))
      .run();

    log.info(`Regenerated proposal ${proposalId}`);
    return { content, competitorNote };
  } catch (error) {
    if (error instanceof AppError) throw error;
    log.error("Failed to regenerate proposal:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "PROPOSAL_ERROR",
      `Failed to regenerate proposal: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
