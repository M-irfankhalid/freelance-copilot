import { getDb } from "../../db/index.js";
import { AppError, notFound } from "../../lib/errors.js";
import { decrypt } from "../../lib/crypto.js";
import { createLogger } from "../../lib/logger.js";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { platformCredentials, jobs as jobsTable, bids as bidsTable, userBids } from "../../db/schema.js";
import { getProfile } from "../profile/profile.service.js";
import { checkRelevancyWithAI } from "../ai/ai.service.js";
import { applyRelevancyFilter, isCountryIgnored } from "../ai/relevancy.js";
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

/**
 * List locally stored jobs from the database cache. Supports optional pagination
 * (offset/limit) and a skills name-substring filter. Unlike searchJobs, this
 * never calls the Freelancer.com API — it only reads what has been previously
 * synced.
 */
export function listStoredJobs(
  userId: string,
  filters: {
    limit?: number;
    offset?: number;
    skills?: string[];
    status?: "new" | "analyzed" | "ignored";
  } = {}
): JobSummary[] {
  const { limit: rawLimit, offset: rawOffset, skills, status } = filters;

  const effectiveLimit = Number.isFinite(rawLimit ?? 0) ? rawLimit! : 50;
  const effectiveOffset = Number.isFinite(rawOffset ?? 0) ? rawOffset! : 0;

  const db = getDb();

  // Build WHERE conditions (only status is filterable at the DB level;
  // skills name-substring filtering is applied in-memory after retrieval).
  const conditions: SQL[] = [];
  if (status) {
    conditions.push(eq(jobsTable.status, status));
  }

  const rows = conditions.length > 0
    ? db
        .select()
        .from(jobsTable)
        .where(and(...conditions))
        .orderBy(desc(jobsTable.updatedAt))
        .limit(effectiveLimit)
        .offset(effectiveOffset)
        .all()
    : db
        .select()
        .from(jobsTable)
        .orderBy(desc(jobsTable.updatedAt))
        .limit(effectiveLimit)
        .offset(effectiveOffset)
        .all();

  let summaries: JobSummary[] = rows.map((row) => {
    let parsedSkills: string[] = [];
    if (row.skills) {
      try {
        const parsed = JSON.parse(row.skills);
        if (Array.isArray(parsed)) parsedSkills = parsed.filter((s): s is string => typeof s === "string");
      } catch {
        // fall through with empty array
      }
    }
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      client: row.client,
      clientCountry: row.clientCountry,
      budgetLabel: row.budgetLabel,
      skills: parsedSkills,
      postedLabel: row.postedLabel,
      bidCount: row.bidCount,
      avgBidLabel: row.avgBidLabel,
      matchScore: row.matchScore ?? undefined,
      severity: (row.severity ?? undefined) as "urgent" | "warning" | "info" | undefined,
      status: row.status as "new" | "analyzed" | "ignored",
      rejectionReason: row.rejectionReason ?? null,
      bidded: false,
      bidVia: null,
      bidOutcome: null,
    };
  });

  // A placed bid lives in user_bids — the record written whenever a manual or
  // automatic bid is submitted. Surface it so the UI can label jobs the user
  // has already acted on. Newest bid wins when several exist.
  const projectIds = summaries.map((job) => job.projectId);
  const bidsByProject = new Map<
    number,
    { via: "manual" | "auto"; outcome: "in_review" | "won" | "lost" | null }
  >();
  if (projectIds.length > 0) {
    const placedBids = getDb()
      .select({
        projectId: userBids.projectId,
        via: userBids.via,
        outcome: userBids.outcome,
      })
      .from(userBids)
      .where(and(eq(userBids.userId, userId), inArray(userBids.projectId, projectIds)))
      .orderBy(desc(userBids.submittedAt))
      .all();
    for (const bid of placedBids) {
      if (!bidsByProject.has(bid.projectId)) {
        bidsByProject.set(bid.projectId, {
          via: bid.via === "auto" ? "auto" : "manual",
          outcome:
            bid.outcome === "won" || bid.outcome === "lost"
              ? bid.outcome
              : bid.outcome === "in_review"
                ? "in_review"
                : null,
        });
      }
    }
  }
  summaries = summaries.map((job) => ({
    ...job,
    bidded: bidsByProject.has(job.projectId),
    bidVia: bidsByProject.get(job.projectId)?.via ?? null,
    bidOutcome: bidsByProject.get(job.projectId)?.outcome ?? null,
  }));

  // Apply skills filter (name substring match) after retrieving from DB.
  if (skills && skills.length > 0) {
    const needles = skills.map((s) => s.toLowerCase());
    summaries = summaries.filter((job) =>
      needles.some((n) => job.skills.some((js) => js.toLowerCase().includes(n)))
    );
  }

  return summaries;
}

export interface MatchItem {
  id: string;
  jobId: string;
  title: string;
  client: string;
  budgetLabel: string;
  postedLabel: string;
  score: number;
  band: "strong" | "good" | "fair";
  matchedSkills: string[];
  missingSkills: string[];
  concerns: string[];
  explanation: string;
  /** True when the last automatic bid attempt failed and won't be retried. */
  bidFailed: boolean;
  /** Error message from the failed automatic bid attempt, when present. */
  bidError: string | null;
  /** True when a bid for this project was already placed (user_bids row). */
  bidded: boolean;
  /** How the placed bid was made, when bidded. */
  bidVia: "manual" | "auto" | null;
  /** Latest outcome of the placed bid, when bidded. */
  bidOutcome: "in_review" | "won" | "lost" | null;
}

/**
 * Strongest analyzed jobs, scored against the saved profile. Never calls the
 * API or the AI — it reads the cached analysis already stored per job and
 * recomputes matched/missing skills from the profile as the source of truth.
 */
export function listMatches(userId: string): MatchItem[] {
  const profile = getProfile(userId);
  const profileSkills = (profile?.skills ?? []).map((s) => s.trim().toLowerCase());

  const rows = getDb()
    .select()
    .from(jobsTable)
    .where(sql`${jobsTable.status} = 'analyzed' AND ${jobsTable.matchScore} > 0`)
    .orderBy(desc(jobsTable.matchScore))
    .limit(100)
    .all();

  // A placed bid lives in user_bids — the record written whenever a manual or
  // automatic bid is submitted. Surface it so the UI can label or hide jobs
  // the user has already acted on. Newest bid wins when several exist.
  const projectIds = rows.map((r) => r.projectId);
  const bidsByProject = new Map<
    number,
    { via: "manual" | "auto"; outcome: "in_review" | "won" | "lost" | null }
  >();
  if (projectIds.length > 0) {
    const placedBids = getDb()
      .select({
        projectId: userBids.projectId,
        via: userBids.via,
        outcome: userBids.outcome,
      })
      .from(userBids)
      .where(and(eq(userBids.userId, userId), inArray(userBids.projectId, projectIds)))
      .orderBy(desc(userBids.submittedAt))
      .all();
    for (const bid of placedBids) {
      if (!bidsByProject.has(bid.projectId)) {
        bidsByProject.set(bid.projectId, {
          via: bid.via === "auto" ? "auto" : "manual",
          outcome:
            bid.outcome === "won" || bid.outcome === "lost"
              ? bid.outcome
              : bid.outcome === "in_review"
                ? "in_review"
                : null,
        });
      }
    }
  }

  return rows.map((row) => {
    const score = Number(row.matchScore);
    const stored = parseStoredAnalysis(row.analysis);

    let jobSkills: string[] = [];
    if (row.skills) {
      try {
        const parsed = JSON.parse(row.skills) as unknown;
        if (Array.isArray(parsed)) {
          jobSkills = parsed.filter((s): s is string => typeof s === "string");
        }
      } catch {
        // fall through with an empty skill list
      }
    }
    const jobSkillsLower = jobSkills.map((s) => s.trim().toLowerCase());

    const matchedSkills = jobSkills.filter((s) =>
      profileSkills.includes(s.trim().toLowerCase())
    );
    const missingSkills = (profile?.skills ?? []).filter(
      (s) => !jobSkillsLower.includes(s.trim().toLowerCase())
    );

    return {
      id: `match-${row.projectId}`,
      jobId: String(row.projectId),
      title: row.title,
      client: row.client,
      budgetLabel: row.budgetLabel,
      postedLabel: row.postedLabel,
      score,
      band: score >= 90 ? "strong" : score >= 75 ? "good" : "fair",
      matchedSkills,
      missingSkills,
      concerns: stored?.concerns ?? [],
      explanation: stored?.summary ?? "",
      bidFailed: row.autoBidFailedAt !== null,
      bidError: row.autoBidError ?? null,
      bidded: bidsByProject.has(row.projectId),
      bidVia: bidsByProject.get(row.projectId)?.via ?? null,
      bidOutcome: bidsByProject.get(row.projectId)?.outcome ?? null,
    };
  });
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
    // Jobs from ignored countries are excluded entirely — stored as a minimal
    // marker row (status "ignored", no rawData) and never surfaced as analysis
    // candidates. The API can report the country under either `location` or
    // `owner_info`, so check both (each call is a no-op when the country is
    // missing).
    const ignored =
      isCountryIgnored(project?.location?.country, filters.ignoredCountries ?? []) ||
      isCountryIgnored(project?.owner_info?.country, filters.ignoredCountries ?? []);
    const storedStatus: JobSummary["status"] = ignored ? "ignored" : "new";

    const existing = getDb()
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.projectId, project.id))
      .get();

    if (existing === undefined) {
      if (ignored) {
        // Minimal marker: keep only what identifies the job. NOT NULL columns
        // are padded with empties; the heavy rawData is never stored so we
        // don't waste resources on jobs we'll never process.
        getDb()
          .insert(jobsTable)
          .values({
            id: summary.id,
            projectId: project.id,
            title: summary.title,
            client: summary.client,
            clientCountry: summary.clientCountry,
            budgetLabel: "",
            postedLabel: "",
            bidCount: 0,
            avgBidLabel: "",
            status: "ignored",
            ignoredAt: now,
            rejectionReason: `Excluded — the client is in ${summary.clientCountry}, a country on your ignore list.`,
            importedAt: now,
            updatedAt: now,
          })
          .run();
      } else {
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
            status: storedStatus,
            rawData: JSON.stringify(project),
            importedAt: now,
            updatedAt: now,
          })
          .run();
      }
      log.info(
        ignored
          ? `Project ${project.id} (${summary.title}): IGNORED — client is in ${summary.clientCountry}, a country on your ignore list`
          : `Project ${project.id} (${summary.title}): stored as new — country check passed`
      );
      summaries.push({ ...summary, status: storedStatus });
    } else {
      if (ignored) {
        // Re-mark ignored and drop any stored rawData so the job is never
        // reprocessed. Previously-new rows are pulled out of the queue.
        getDb()
          .update(jobsTable)
          .set({
            clientCountry: summary.clientCountry,
            status: "ignored",
            rawData: null,
            ignoredAt: now,
            rejectionReason: `Excluded — the client is in ${summary.clientCountry}, a country on your ignore list.`,
            updatedAt: now,
          })
          .where(eq(jobsTable.projectId, project.id))
          .run();
        log.info(
          `Project ${project.id} (${summary.title}): IGNORED — client is in ${summary.clientCountry}, a country on your ignore list`
        );
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
            status: existing.status,
            rawData: JSON.stringify(project),
            updatedAt: now,
          })
          .where(eq(jobsTable.projectId, project.id))
          .run();
        log.info(
          `Project ${project.id} (${summary.title}): already stored (${existing.status}) — refreshed live data`
        );
      }
      summaries.push({
        ...summary,
        status: ignored ? "ignored" : (existing.status as JobSummary["status"]),
        matchScore: existing.matchScore ?? undefined,
        severity: (existing.severity as JobSummary["severity"] | null) ?? undefined,
      });
    }
  }

  log.info(`Found ${summaries.length} project(s) on Freelancer.com`);
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
      client: project.owner_info?.country?.name
        ? `Client in ${project.owner_info.country.name}`
        : existing.client,
      clientCountry: project.owner_info?.country?.name ?? existing.clientCountry,
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
    competition,
    {
      rejectionReason: refreshed.rejectionReason ?? null,
      bidError: refreshed.autoBidError ?? null,
    }
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

  // Defense in depth: even if a job slipped through the ingest filter, never
  // spend AI tokens on a country the user asked to exclude entirely.
  const country = project.location?.country;
  if (isCountryIgnored(country, profile.ignoredCountries)) {
    const countryLabel = country?.name ?? country?.code ?? "unknown";
    const now = new Date().toISOString();
    getDb()
      .update(jobsTable)
      .set({
        status: "ignored",
        ignoredAt: now,
        rejectionReason: `Excluded — the client is in ${countryLabel}, a country on your ignore list.`,
        updatedAt: now,
      })
      .where(eq(jobsTable.projectId, projectId))
      .run();
    log.info(
      `Project ${projectId} (${project.title ?? "(untitled project)"}): IGNORED — client country ${countryLabel} is on your ignore list`
    );
    return {
      jobId: `job-${projectId}`,
      projectId,
      relevancyScore: 0,
      matchedSkills: [],
      missingSkills: profile.skills,
      concerns: [`Ignored country: ${countryLabel}`],
      analysis: "This job is from a country on your ignore list and was not analyzed.",
      recommendedBid: "—",
    };
  }

  const jobSkills = project.jobs?.map((j) => j.name).filter((n): n is string => Boolean(n)) ?? [];
  const jobDescription = splitParagraphs(project.description ?? project.preview_description ?? "");
  const bidAvg = project.bid_stats?.bid_avg ?? null;
  const now = new Date().toISOString();

  // Save helper: mark the job ignored and return its analysis shape. Used by
  // both reject gates (keyword filter and the relevance model) so we never
  // spend proposal/bid work on a job the user doesn't want.
  const storeIgnored = (
    score: number,
    concerns: string[],
    summary: string,
    reason: string
  ): JobAnalysis => {
    getDb()
      .update(jobsTable)
      .set({
        status: "ignored",
        matchScore: score,
        ignoredAt: now,
        rejectionReason: reason,
        updatedAt: now,
      })
      .where(eq(jobsTable.projectId, projectId))
      .run();
    return {
      jobId: `job-${projectId}`,
      projectId,
      relevancyScore: score,
      matchedSkills: [],
      missingSkills: profile.skills,
      concerns,
      analysis: summary,
      recommendedBid: "—",
    };
  };

  // Step 1: deterministic keyword filter (free) — rejects obvious mismatches
  // before spending even the cheap relevance model call.
  const decision = applyRelevancyFilter({
    jobTitle: project.title ?? "",
    jobDescription,
    jobSkills,
    wants: profile.wants,
    notWants: profile.notWants,
    profileSkills: profile.skills,
  });
  if (!decision.relevant) {
    log.info(
      `Project ${projectId} (${project.title ?? "(untitled project)"}): IGNORED — ${decision.reasons.join("; ")}`
    );
    return storeIgnored(
      0,
      decision.reasons,
      "This job was filtered out by your profile filters before any AI analysis was run. Update your wants, not-wants, or skills to re-evaluate it.",
      `Filtered out by your profile filters: ${decision.reasons.join("; ")}`
    );
  }

  // Step 2: fast relevance model (Model A) — its score becomes matchScore and
  // gates the auto-bid (and, while auto-bid is on, the auto-proposal) step.
  const check = await checkRelevancyWithAI({
    jobTitle: project.title ?? "(untitled project)",
    jobDescription,
    userSummary: profile.userSummary,
    relevancyInstructions: profile.relevancyInstructions,
  });

  if (!check.relevant) {
    log.info(
      `Project ${projectId} (${project.title ?? "(untitled project)"}): IGNORED — relevance model: ${check.reasons.join("; ")}`
    );
    return storeIgnored(
      check.score,
      check.reasons,
      check.summary || "Marked irrelevant by the relevance model.",
      `Marked irrelevant by the relevance model: ${check.summary || check.reasons.join("; ")}`
    );
  }

  const matchedSkills = jobSkills.filter((s) => profile.skills.includes(s));
  const missingSkills = profile.skills.filter((s) => !jobSkills.includes(s));
  const storedAnalysis: StoredAnalysis = {
    verdict: check.score >= 80 ? "strong" : check.score >= 60 ? "good" : "fair",
    score: check.score,
    summary: check.summary,
    reasons: check.reasons,
    concerns: [],
    recommendedBidLabel: "—",
    competitorNote: "",
  };

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
        matchScore: check.score,
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
        matchScore: check.score,
        analysis: JSON.stringify(storedAnalysis),
        lastAnalyzedAt: now,
        updatedAt: now,
      })
      .where(eq(jobsTable.projectId, projectId))
      .run();
  }

  log.info(
    `Project ${projectId} (${project.title ?? "(untitled project)"}): PASSED — relevance score ${check.score}/100 (${storedAnalysis.verdict})`
  );
  return {
    jobId: `job-${projectId}`,
    projectId,
    relevancyScore: check.score,
    matchedSkills,
    missingSkills,
    concerns: storedAnalysis.concerns,
    analysis: check.summary,
    recommendedBid: "—",
  };
}

export async function ignoreJob(projectId: number): Promise<void> {
  const result = getDb()
    .update(jobsTable)
    .set({
      status: "ignored",
      ignoredAt: new Date().toISOString(),
      rejectionReason: "Marked ignored by you.",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(jobsTable.projectId, projectId))
    .run();
  if (result.changes === 0) {
    throw notFound(`Job with project ID ${projectId} not found`);
  }
  log.info(`Ignored job ${projectId}`);
}

/**
 * Decrypt the stored Freelancer.com token and return an authenticated API
 * client. Shared by any module that needs to make a live API call.
 */
export function getFreelancerClient(): FreelancerApiClient {
  const credRow = getDb()
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "freelancer"))
    .get();

  if (credRow === undefined) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Save a Freelancer.com access token first (Platforms page)"
    );
  }

  return new FreelancerApiClient(decrypt(credRow));
}

/**
 * Fetch and cache the bidder id (the numeric Freelancer user id needed for
 * placing bids). The id is cached in the credential row's `meta` JSON so we
 * only call the /self endpoint once. Shared by bids.service and
 * automation.service to avoid duplicate code.
 */
export async function getBidderId(): Promise<number> {
  const credRow = getDb()
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "freelancer"))
    .get();

  if (credRow === undefined) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Save a Freelancer.com access token first (Platforms page)"
    );
  }

  const meta = credRow.meta ? JSON.parse(credRow.meta) : {};
  if (meta.bidderId !== undefined) {
    return meta.bidderId as number;
  }

  const client = getFreelancerClient();
  const self = await client.getSelf();

  const newMeta = { ...meta, bidderId: self.id };
  getDb()
    .update(platformCredentials)
    .set({
      meta: JSON.stringify(newMeta),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(platformCredentials.id, "freelancer"))
    .run();

  log.info(`Cached Freelancer bidder id: ${self.id}`);
  return self.id;
}
