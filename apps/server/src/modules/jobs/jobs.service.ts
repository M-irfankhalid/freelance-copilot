import { getDb } from "../../db/index.js";
import { AppError, notFound } from "../../lib/errors.js";
import { decrypt } from "../../lib/crypto.js";
import { createLogger } from "../../lib/logger.js";
import { eq } from "drizzle-orm";
import { platformCredentials, jobs as jobsTable, bids as bidsTable } from "../../db/schema.js";
import { getProfile } from "../profile/profile.service.js";
import { analyzeJob as analyzeJobWithAI } from "../ai/ai.service.js";
import {
  type FreelancerProject,
  type FreelancerBid,
  type JobSearchFilters,
  type JobSummary,
  type JobAnalysis,
  type JobDetailData,
  type StoredAnalysis,
  type CompetitionSummary,
  FreelancerApiClient,
  deriveSkillIds,
  splitParagraphs,
  formatBudget,
} from "./jobs.client.js";

const log = createLogger("sync");

export type { JobSummary as JobResponse };

export type JobDetailResponse = JobDetailData;

/**
 * Turn a Unix-seconds timestamp into a short relative label. We compute this
 * server-side so the UI doesn't need Date math and a stale `postedLabel`
 * doesn't leak through.
 */
export function relativeLabel(unixSeconds: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "Recently posted";
  const diffMs = nowMs - unixSeconds * 1000;
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function postedLabelFor(project: FreelancerProject): string {
  return relativeLabel(project.time_submitted ?? 0);
}

function requireFreelancerToken(): string {
  const row = getDb()
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "freelancer"))
    .get();
  if (row === undefined) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Save a Freelancer.com access token first (Platforms page)"
    );
  }
  return decrypt(row);
}

export function parseStoredAnalysis(raw: string | null): StoredAnalysis | null {
  if (raw === null || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (
      (o.verdict !== "strong" && o.verdict !== "good" && o.verdict !== "fair") ||
      typeof o.score !== "number" ||
      typeof o.summary !== "string" ||
      !Array.isArray(o.reasons) ||
      !Array.isArray(o.concerns)
    ) {
      return null;
    }
    return {
      verdict: o.verdict,
      score: o.score,
      summary: o.summary,
      reasons: o.reasons.filter((r): r is string => typeof r === "string"),
      concerns: o.concerns.filter((c): c is string => typeof c === "string"),
      recommendedBidLabel: typeof o.recommendedBidLabel === "string" ? o.recommendedBidLabel : "—",
      competitorNote: typeof o.competitorNote === "string" ? o.competitorNote : "",
    };
  } catch {
    return null;
  }
}

/**
 * Persist the latest bid list for a project. Clears old rows for this project
 * so stale data doesn't linger. Each bid is stored with its bidder id (when
 * available) for deduplication.
 */
function storeBids(projectId: number, bids: FreelancerBid[], fetchedAt: string): void {
  getDb()
    .delete(bidsTable)
    .where(eq(bidsTable.projectId, projectId))
    .run();

  for (let i = 0; i < bids.length; i++) {
    const bid = bids[i];
    if (bid === undefined) continue;
    const bidder = bid.bidder;
    const bidId = `bid-${projectId}-${i}`;
    getDb()
      .insert(bidsTable)
      .values({
        id: bidId,
        projectId,
        bidderId: bidder?.id ?? null,
        bidderName: bidder?.name ?? bidder?.username ?? null,
        amount: bid.amount ?? null,
        currencyCode: bid.currency?.code ?? null,
        isCheapest: bid.is_cheapest ? 1 : 0,
        timeSubmitted: bid.time_submitted ?? null,
        description: bid.description ?? null,
        fetchedAt,
      })
      .run();
  }
  log.info(`Stored ${bids.length} bids for project ${projectId}`);
}

export async function searchJobs(filters: JobSearchFilters = {}): Promise<JobSummary[]> {
  const token = requireFreelancerToken();
  const client = new FreelancerApiClient(token);
  const skillIds = filters.skillIds ?? deriveSkillIds(filters.skills);

  let projects: FreelancerProject[];
  try {
    projects = await client.searchJobs({ ...filters, skillIds });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Failed to search jobs: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  const now = new Date().toISOString();
  const summaries: JobSummary[] = [];

  for (const project of projects) {
    const postedLabel = postedLabelFor(project);
    const summary = client.mapToJobSummary(project, postedLabel);
    const rawData = JSON.stringify(project);

    const existing = getDb()
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.projectId, project.id))
      .get();

    if (existing === undefined) {
      getDb()
        .insert(jobsTable)
        .values({
          id: summary.id,
          projectId: project.id,
          title: summary.title,
          client: summary.client,
          clientCountry: summary.clientCountry,
          budgetLabel: summary.budgetLabel,
          skills: JSON.stringify(summary.skills),
          postedLabel: summary.postedLabel,
          bidCount: summary.bidCount,
          avgBidLabel: summary.avgBidLabel,
          status: "new",
          rawData,
          importedAt: now,
          updatedAt: now,
        })
        .run();
      log.info(`Stored new job ${summary.id}: ${summary.title}`);
      summaries.push(summary);
    } else {
      // Refresh the live fields, but keep the user's analysis state.
      getDb()
        .update(jobsTable)
        .set({
          title: summary.title,
          client: summary.client,
          clientCountry: summary.clientCountry,
          budgetLabel: summary.budgetLabel,
          skills: JSON.stringify(summary.skills),
          postedLabel: summary.postedLabel,
          bidCount: summary.bidCount,
          avgBidLabel: summary.avgBidLabel,
          rawData,
          updatedAt: now,
        })
        .where(eq(jobsTable.projectId, project.id))
        .run();
      summaries.push({
        ...summary,
        status: existing.status as JobSummary["status"],
        matchScore: existing.matchScore ?? undefined,
        severity: (existing.severity as JobSummary["severity"] | null) ?? undefined,
      });
    }
  }

  log.info(`Search returned ${summaries.length} jobs`);
  return summaries;
}

export async function getJobById(projectId: number): Promise<JobDetailResponse> {
  const existing = getDb()
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.projectId, projectId))
    .get();
  if (existing === undefined) {
    throw notFound(`Job with project ID ${projectId} not found`);
  }

  const token = requireFreelancerToken();
  const client = new FreelancerApiClient(token);

  let project: FreelancerProject;
  try {
    project = await client.getJobById(projectId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Failed to fetch job details: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  const postedLabel = postedLabelFor(project);
  const now = new Date().toISOString();

  // Refresh live fields; leave analysis and status alone.
  getDb()
    .update(jobsTable)
    .set({
      title: project.title ?? existing.title,
      client: project.location?.country?.name
        ? `Client in ${project.location.country.name}`
        : existing.client,
      clientCountry: project.location?.country?.name ?? existing.clientCountry,
      budgetLabel: formatBudget(project.budget, project.currency?.code),
      skills: JSON.stringify(
        project.jobs?.map((j) => j.name).filter((n): n is string => Boolean(n)) ?? []
      ),
      postedLabel,
      bidCount: project.bid_stats?.bid_count ?? existing.bidCount,
      avgBidLabel:
        project.bid_stats?.bid_avg !== undefined && project.bid_stats.bid_avg !== null
          ? `$${Math.round(project.bid_stats.bid_avg).toLocaleString("en-US")}`
          : existing.avgBidLabel,
      rawData: JSON.stringify(project),
      updatedAt: now,
    })
    .where(eq(jobsTable.projectId, projectId))
    .run();

  // Fetch and store bids for competition insights.
  let competition: CompetitionSummary | null = null;
  try {
    const bids = await client.getBidsForProject(projectId);
    storeBids(projectId, bids, now);
    competition = client.mapToCompetitionSummary(bids);
  } catch (error) {
    if (error instanceof AppError) {
      log.warn(`Could not fetch bids for job ${projectId}: ${error.message}`);
    } else {
      log.warn(`Could not fetch bids for job ${projectId}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  const refreshed = getDb()
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.projectId, projectId))
    .get();
  if (refreshed === undefined) {
    throw notFound(`Job with project ID ${projectId} not found after refresh`);
  }

  const storedAnalysis = parseStoredAnalysis(refreshed.analysis);
  return client.mapToJobDetail(
    project,
    postedLabel,
    storedAnalysis,
    refreshed.status as JobDetailResponse["status"],
    refreshed.matchScore,
    competition
  );
}

export async function getJobByUrl(url: string): Promise<JobDetailResponse> {
  const token = requireFreelancerToken();
  const client = new FreelancerApiClient(token);

  let project: FreelancerProject;
  try {
    project = await client.getJobByUrl(url);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Failed to fetch job from URL: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  // Ensure the project is in our local store so analyze + ignore work.
  const now = new Date().toISOString();
  const postedLabel = postedLabelFor(project);
  const existing = getDb()
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.projectId, project.id))
    .get();

  if (existing === undefined) {
    const country = project.location?.country?.name;
    getDb()
      .insert(jobsTable)
      .values({
        id: `job-${project.id}`,
        projectId: project.id,
        title: project.title ?? "(untitled project)",
        client: country ? `Client in ${country}` : "Client",
        clientCountry: country ?? "Unknown",
        budgetLabel: formatBudget(project.budget, project.currency?.code),
        skills: JSON.stringify(
          project.jobs?.map((j) => j.name).filter((n): n is string => Boolean(n)) ?? []
        ),
        postedLabel,
        bidCount: project.bid_stats?.bid_count ?? 0,
        avgBidLabel:
          project.bid_stats?.bid_avg !== undefined && project.bid_stats.bid_avg !== null
            ? `$${Math.round(project.bid_stats.bid_avg).toLocaleString("en-US")}`
            : "—",
        status: "new",
        rawData: JSON.stringify(project),
        importedAt: now,
        updatedAt: now,
      })
      .run();
    log.info(`Stored manually added job job-${project.id}: ${project.title}`);
  }

  return getJobById(project.id);
}

/**
 * Run the AI analysis pipeline against a job. Requires a saved profile and a
 * saved OpenRouter key. Returns the same shape as the legacy local analyzer
 * so the rest of the app can keep using it.
 */
export async function analyzeJob(
  projectId: number,
  userId: string
): Promise<JobAnalysis> {
  const profile = getProfile(userId);
  if (profile === null) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Save your profile before running an analysis"
    );
  }

  // Pre-flight: Freelancer token must be present locally.
  const token = requireFreelancerToken();
  const client = new FreelancerApiClient(token);
  let project: FreelancerProject;
  try {
    project = await client.getJobById(projectId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Failed to fetch job for analysis: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  const jobSkills = project.jobs?.map((j) => j.name).filter((n): n is string => Boolean(n)) ?? [];
  const jobDescription = splitParagraphs(project.description ?? project.preview_description ?? "");
  const bidAvg = project.bid_stats?.bid_avg ?? null;

  // Fetch competition data for the AI analysis.
  let competition: CompetitionSummary | null = null;
  try {
    const bids = await client.getBidsForProject(projectId);
    competition = client.mapToCompetitionSummary(bids);
  } catch (error) {
    if (error instanceof AppError) {
      log.warn(`Could not fetch bids for analysis of job ${projectId}: ${error.message}`);
    } else {
      log.warn(`Could not fetch bids for analysis of job ${projectId}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  const result = await analyzeJobWithAI({
    jobTitle: project.title ?? "(untitled project)",
    jobDescription,
    skills: jobSkills,
    profileSkills: profile.skills,
    wants: profile.wants,
    notWants: profile.notWants,
    hourlyRate: profile.hourlyRate,
    budgetLabel: formatBudget(project.budget, project.currency?.code),
    clientName: project.location?.country?.name ? `Client in ${project.location.country.name}` : "Client",
    bidCount: project.bid_stats?.bid_count ?? 0,
    avgBid:
      bidAvg !== null ? `$${Math.round(bidAvg).toLocaleString("en-US")}` : "—",
    projectType: project.type,
    bidPeriod: project.bidperiod,
    upgrades: project.upgrades
      ? {
          featured: project.upgrades.featured ?? false,
          urgent: project.upgrades.urgent ?? false,
          sealed: project.upgrades.sealed ?? false,
        }
      : undefined,
    competition,
  });

  const matchedSkills = jobSkills.filter((s) => profile.skills.includes(s));
  const missingSkills = profile.skills.filter((s) => !jobSkills.includes(s));
  const storedAnalysis: StoredAnalysis = {
    verdict: result.verdict,
    score: result.score,
    summary: result.summary,
    reasons: result.reasons,
    concerns: result.concerns,
    recommendedBidLabel: result.recommendedBidLabel,
    competitorNote: result.competitorNote,
  };

  const now = new Date().toISOString();
  const existing = getDb()
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(eq(jobsTable.projectId, projectId))
    .get();
  if (existing === undefined) {
    getDb()
      .insert(jobsTable)
      .values({
        id: `job-${projectId}`,
        projectId,
        title: project.title ?? "(untitled project)",
        client: project.location?.country?.name
          ? `Client in ${project.location.country.name}`
          : "Client",
        clientCountry: project.location?.country?.name ?? "Unknown",
        budgetLabel: formatBudget(project.budget, project.currency?.code),
        skills: JSON.stringify(jobSkills),
        postedLabel: postedLabelFor(project),
        bidCount: project.bid_stats?.bid_count ?? 0,
        avgBidLabel: bidAvg !== null ? `$${Math.round(bidAvg).toLocaleString("en-US")}` : "—",
        status: "analyzed",
        matchScore: result.score,
        analysis: JSON.stringify(storedAnalysis),
        lastAnalyzedAt: now,
        importedAt: now,
        updatedAt: now,
      })
      .run();
  } else {
    getDb()
      .update(jobsTable)
      .set({
        status: "analyzed",
        matchScore: result.score,
        analysis: JSON.stringify(storedAnalysis),
        lastAnalyzedAt: now,
        updatedAt: now,
      })
      .where(eq(jobsTable.projectId, projectId))
      .run();
  }

  log.info(`Analyzed job ${projectId}: ${result.verdict} (${result.score}%)`);
  return {
    jobId: `job-${projectId}`,
    projectId,
    relevancyScore: result.score,
    matchedSkills,
    missingSkills,
    concerns: result.concerns,
    analysis: result.summary,
    recommendedBid: result.recommendedBidLabel,
  };
}

export async function ignoreJob(projectId: number): Promise<void> {
  const result = getDb()
    .update(jobsTable)
    .set({ status: "ignored", ignoredAt: new Date().toISOString() })
    .where(eq(jobsTable.projectId, projectId))
    .run();
  if (result.changes === 0) {
    throw notFound(`Job with project ID ${projectId} not found`);
  }
  log.info(`Ignored job ${projectId}`);
}
