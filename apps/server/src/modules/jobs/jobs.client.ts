import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
const log = createLogger("bid");

/**
 * The fields we actually read off a Freelancer.com project object. The real
 * shape is much wider — we keep this narrow so our code can reason about
 * what's present vs missing, and so the formatter falls back gracefully when
 * a field is absent.
 */
export interface FreelancerCategory {
  id: number;
  name: string;
}

export interface FreelancerSkill {
  id: number;
  name: string;
  category?: FreelancerCategory;
  seo_url?: string;
  local?: boolean;
}

export interface FreelancerCurrency {
  id: number;
  code: string;
  sign: string;
  name: string;
  exchange_rate: number;
  country: string;
  is_external: boolean;
  is_escrowcom_supported: boolean;
}

export interface FreelancerBudget {
  minimum?: number;
  maximum?: number;
  name?: string | null;
  project_type?: string | null;
}

export interface FreelancerBidStats {
  bid_count?: number;
  bid_avg?: number | null;
  min_amount?: number | null;
  max_amount?: number | null;
}

export interface FreelancerReputationCategoryRatings {
  clarity_spec?: number;
  communication?: number;
  payment_prom?: number;
  professionalism?: number;
  work_for_again?: number;
}

export interface FreelancerReputationPeriod {
  overall?: number;
  positive?: number;
  category_ratings?: FreelancerReputationCategoryRatings;
}

export interface FreelancerReputation {
  entire_history?: FreelancerReputationPeriod;
  last3months?: FreelancerReputationPeriod;
  last12months?: FreelancerReputationPeriod;
  role?: string;
  earnings_score?: number;
}

export interface FreelancerOwnerStatus {
  payment_verified?: boolean;
  email_verified?: boolean;
  deposit_made?: boolean;
  profile_complete?: boolean;
  phone_verified?: boolean;
  identity_verified?: boolean;
  facebook_connected?: boolean;
  freelancer_verified_user?: boolean;
  linkedin_connected?: boolean;
  custom_charge_verified?: boolean;
}

export interface FreelancerOwnerInfo {
  city?: string;
  country?: {
    name?: string;
    flag_url?: string;
    code?: string;
    highres_flag_url?: string;
    flag_url_cdn?: string;
    highres_flag_url_cdn?: string;
  };
  reputation?: FreelancerReputation;
  status?: FreelancerOwnerStatus;
  registration_date?: number;
}

export interface FreelancerProjectUpgrades {
  featured?: boolean;
  sealed?: boolean;
  nonpublic?: boolean;
  fulltime?: boolean;
  urgent?: boolean;
  qualified?: boolean;
  NDA?: boolean;
  assisted?: boolean;
  active_prepaid_milestone?: Record<string, unknown>;
  ip_contract?: boolean;
  non_compete?: boolean;
  project_management?: boolean;
  pf_only?: boolean;
  recruiter?: boolean;
  listed?: boolean;
  premium?: boolean;
  enterprise?: boolean;
}

export interface FreelancerLocation {
  country?: {
    name?: string;
    flag_url?: string;
    code?: string;
    highres_flag_url?: string;
    flag_url_cdn?: string;
    highres_flag_url_cdn?: string;
  };
  timezone?: Record<string, unknown>;
}

export interface FreelancerProject {
  id: number;
  title?: string;
  description?: string;
  preview_description?: string;
  currency?: FreelancerCurrency;
  budget?: FreelancerBudget;
  bid_stats?: FreelancerBidStats;
  time_submitted?: number; // Unix seconds
  submitdate?: number; // Unix seconds
  time_updated?: number;
  jobs?: FreelancerSkill[];
  location?: FreelancerLocation;
  true_location?: FreelancerLocation;
  /** Project type: "fixed" | "hourly" */
  type?: string;
  /** Bid period in days. */
  bidperiod?: number;
  /** Whether the project is deleted/nonpublic/hidebids. */
  deleted?: boolean;
  nonpublic?: boolean;
  hidebids?: boolean;
  /** Minimum and maximum bid values. */
  budget_details?: FreelancerBudget;
  /** Upgrade flags (featured, urgent, etc.). */
  upgrades?: FreelancerProjectUpgrades;
  /** Language code of the project. */
  language?: string;
  /** Whether the client is hiring directly. */
  hireme?: boolean;
  /** Owner info with reputation and status. */
  owner_info?: FreelancerOwnerInfo;
  /** SEO-friendly URL slug. */
  seo_url?: string;
  /** When free bids expire (Unix seconds). */
  time_free_bids_expire?: number;
  /** Pool / enterprise identifiers. */
  pool_ids?: string[];
  enterprise_ids?: number[];
  is_escrow_project?: boolean;
  is_seller_kyc_required?: boolean;
  is_buyer_kyc_required?: boolean;
  frontend_project_status?: string;
  local?: boolean;
  status?: string;
}

/** A single bid placed on a project by another freelancer. */
export interface FreelancerBid {
  id?: number;
  bidder?: {
    id?: number;
    username?: string;
    name?: string;
    reputation?: number;
    display_info?: Record<string, unknown>;
  };
  amount?: number;
  currency?: { code?: string };
  is_cheapest?: boolean;
  is_highlighted?: boolean;
  is_sealed?: boolean;
  is_urgent?: boolean;
  time_submitted?: number;
  description?: string;
  qualifications?: unknown[];
  bid_period?: number;
  period?: number;
}

/** The user's own profile from the /self endpoint. */
export interface FreelancerSelf {
  id: number;
  username?: string;
  name?: string;
  email?: string | { email: string; verified: boolean };
}

/** Response shape from POST /bids. */
export interface FreelancerBidResponse {
  bid_id?: number;
  message?: string;
  [key: string]: unknown;
}

export interface JobSearchFilters {
  /** Skill names (best effort — mapped to category ids where possible). */
  skills?: string[];
  /** Free text joined into a single `query=` param. */
  keywords?: string[];
  /** Numeric Freelancer category ids used as `jobs[]=` filters. */
  skillIds?: number[];
  /** Country names/codes whose jobs should be marked ignored on ingest. */
  ignoredCountries?: string[];
  limit?: number;
  offset?: number;
}

export interface JobSummary {
  id: string;
  projectId: number;
  title: string;
  client: string;
  clientCountry: string;
  budgetLabel: string;
  skills: string[];
  postedLabel: string;
  bidCount: number;
  avgBidLabel: string;
  matchScore?: number;
  severity?: "urgent" | "warning" | "info";
  status: "new" | "analyzed" | "ignored";
}

/** Competition snapshot from stored bid data. */
export interface CompetitionSummary {
  bidCount: number;
  minBid: number | null;
  maxBid: number | null;
  medianBid: number | null;
  isCheapest: boolean;
}

export interface JobDetailData {
  id: string;
  projectId: number;
  title: string;
  client: string;
  clientCountry: string;
  budgetLabel: string;
  skills: string[];
  postedLabel: string;
  bidCount: number;
  avgBidLabel: string;
  matchScore?: number;
  severity?: "urgent" | "warning" | "info";
  status: "new" | "analyzed" | "ignored";
  description: string[];
  clientInfo: {
    name: string;
    country: string;
    memberSinceLabel: string;
    projectsPosted: number;
    hireRateLabel: string;
    /** Overall reputation score (0–1) from the owner's profile, if available. */
    reputationScore?: number | null;
  };
  /** Upgrade flags surfaced by the API. */
  upgrades?: {
    featured: boolean;
    urgent: boolean;
    sealed: boolean;
  };
  /** Project billing type: "fixed" | "hourly". */
  projectType?: string | null;
  /** Bid period in days, if the project specifies one. */
  bidPeriod?: number | null;
  attachments: Array<{ name: string; sizeLabel: string; kind: string }>;
  /** Aggregate competition data from stored bids, if fetched. */
  competition?: CompetitionSummary | null;
  insights: {
    bidCount: number;
    avgBidLabel: string;
    highBidLabel: string;
    lowBidLabel: string;
    refreshedLabel: string;
  };
  suggestion: {
    verdict: "strong" | "good" | "fair";
    score: number;
    summary: string;
    reasons: string[];
    concerns: string[];
    recommendedBidLabel: string;
    competitorNote: string;
  };
}

export interface JobAnalysis {
  jobId: string;
  projectId: number;
  relevancyScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  concerns: string[];
  analysis: string;
  recommendedBid: string;
}

/** Format a USD amount as `$123`. `null`/`undefined` → `"—"`. */
function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Format a budget range using Freelancer's `budget.minimum`/`maximum` fields. */
export function formatBudget(
  budget: FreelancerProject["budget"],
  currencyCode: string | undefined
): string {
  if (budget === undefined) return "Budget not specified";
  const min = typeof budget.minimum === "number" ? budget.minimum : null;
  const max = typeof budget.maximum === "number" ? budget.maximum : null;
  const sign = currencyCode === "USD" ? "$" : currencyCode ? `${currencyCode} ` : "$";
  if (min !== null && max !== null) return `${sign}${min.toLocaleString("en-US")} – ${sign}${max.toLocaleString("en-US")}`;
  if (min !== null) return `from ${sign}${min.toLocaleString("en-US")}`;
  if (max !== null) return `up to ${sign}${max.toLocaleString("en-US")}`;
  return "Budget not specified";
}

/** Split a description into paragraphs, falling back to a one-element array. */
export function splitParagraphs(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  return trimmed
    .split(/\n{2,}|(?<=\.)\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export class FreelancerApiClient {
  private token: string;
  private baseUrl = "https://www.freelancer.com/api/projects/0.1";

  constructor(token: string) {
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  /** Log a rate-limit snapshot if the upstream exposed the headers. */
  private noteRateLimit(response: Response): void {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const limit = response.headers.get("x-ratelimit-limit");
    if (remaining !== null && limit !== null) {
      log.info(`Freelancer.com rate limit: ${remaining}/${limit} remaining`);
    }
  }

  async searchJobs(filters: JobSearchFilters = {}): Promise<FreelancerProject[]> {
    const params = new URLSearchParams();

    const query = filters.keywords?.filter(Boolean).join(" ").trim() ?? "";
    if (query.length > 0) params.append("query", query);

    const ids = filters.skillIds?.filter((n) => Number.isInteger(n) && n > 0) ?? [];
    for (const id of ids) params.append("jobs[]", String(id));

    params.append("limit", String(filters.limit ?? 20));
    if (filters.offset !== undefined) params.append("offset", String(filters.offset));
    params.append("full_description", "true");
    params.append("job_details", "true");
    params.append("upgrade_details", "true");
    params.append("attachment_details", "true");
    params.append("qualification_details", "true");
    params.append("location_details", "true");
    params.append("owner_info", "true");
    params.append("user_details", "true");
    params.append("user_avatar", "true");
    params.append("user_country_details", "true");
    params.append("user_profile_description", "true");
    params.append("user_display_info", "true");
    params.append("user_jobs", "true");
    params.append("user_reputation", "true");
    params.append("compact", "true");

    const url = `${this.baseUrl}/projects/active/?${params.toString()}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new AppError(
        502,
        "UPSTREAM_ERROR",
        `Failed to reach Freelancer.com: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new AppError(401, "UNAUTHORIZED", "Freelancer.com token was rejected or expired");
    }
    if (response.status === 429) {
      throw new AppError(429, "RATE_LIMITED", "Freelancer.com rate limit exceeded");
    }
    if (!response.ok) {
      throw new AppError(
        502,
        "UPSTREAM_ERROR",
        `Freelancer.com responded with status ${response.status}`
      );
    }

    const body = (await response.json()) as {
      status?: string;
      result?: { projects?: FreelancerProject[] };
    };

    if (body.status !== "success" || body.result === undefined) {
      throw new AppError(502, "UPSTREAM_ERROR", "Freelancer.com returned an invalid search response");
    }

    this.noteRateLimit(response);
    return body.result.projects ?? [];
  }

  async getJobById(projectId: number): Promise<FreelancerProject> {
    const url = `${this.baseUrl}/projects/${projectId}?full_description=true&job_details=true&upgrade_details=true&attachment_details=true&qualification_details=true&location_details=true&owner_info=true&user_details=true&user_avatar=true&user_country_details=true&user_profile_description=true&user_display_info=true&user_jobs=true&user_reputation=true&compact=true`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new AppError(
        502,
        "UPSTREAM_ERROR",
        `Failed to reach Freelancer.com: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    if (response.status === 404) {
      throw new AppError(404, "NOT_FOUND", `Job with project ID ${projectId} not found or not accessible`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError(401, "UNAUTHORIZED", "Freelancer.com token was rejected or expired");
    }
    if (!response.ok) {
      throw new AppError(
        502,
        "UPSTREAM_ERROR",
        `Freelancer.com responded with status ${response.status}`
      );
    }

    const body = (await response.json()) as {
      status?: string;
      result?: FreelancerProject;
    };
    if (body.status !== "success" || body.result === undefined) {
      throw new AppError(502, "UPSTREAM_ERROR", "Freelancer.com returned an invalid job detail");
    }

    this.noteRateLimit(response);
    return body.result;
  }

  /**
   * Fetch the list of bids on a project. Returns typed bids; callers format
   * what they need. Endpoint shape: `result: { bids: Bid[] }`.
   */
  async getBidsForProject(
    projectId: number,
    limit = 10
  ): Promise<FreelancerBid[]> {
    const url = `${this.baseUrl}/projects/${projectId}/bids/?limit=${limit}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new AppError(
        502,
        "UPSTREAM_ERROR",
        `Failed to reach Freelancer.com: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    if (response.status === 404) {
      return [];
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError(401, "UNAUTHORIZED", "Freelancer.com token was rejected or expired");
    }
    if (!response.ok) {
      throw new AppError(
        502,
        "UPSTREAM_ERROR",
        `Freelancer.com responded with status ${response.status}`
      );
    }

    const body = (await response.json()) as {
      status?: string;
      result?: { bids?: unknown[] };
    };
    return (body.result?.bids ?? []) as FreelancerBid[];
  }

  /**
   * Build a compact competition summary from a list of bids — enough for the
   * AI to reason about competition and for the UI to show a quick snapshot.
   */
  mapToCompetitionSummary(bids: FreelancerBid[]): CompetitionSummary {
    const amounts = bids
      .map((b) => (typeof b.amount === "number" ? b.amount : null))
      .filter((n): n is number => n !== null && n > 0);
    const sorted = [...amounts].sort((a, b) => a - b);
    const [minBid, , , maxBid] = sorted;
    const midIdx = Math.floor(sorted.length / 2);
    const medianBid = sorted[midIdx];
    return {
      bidCount: bids.length,
      minBid: minBid ?? null,
      maxBid: maxBid ?? null,
      medianBid: medianBid ?? null,
      isCheapest: bids.some((b) => b.is_cheapest === true),
    };
  }

  async getJobByUrl(url: string): Promise<FreelancerProject> {
    // Accept either a full URL or a bare numeric id.
    const trimmed = url.trim();
    const numericMatch = /^\d+$/.test(trimmed);
    if (numericMatch) {
      return this.getJobById(parseInt(trimmed, 10));
    }

    // Try to extract the project id from the last path segment. Freelancer
    // URLs look like /projects/{id} or /contest/{id} (we only support projects).
    const pathMatch = trimmed.match(/\/projects\/(\d+)/);
    if (pathMatch && pathMatch[1] !== undefined) {
      return this.getJobById(parseInt(pathMatch[1], 10));
    }

    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Invalid Freelancer.com job URL — could not extract project id"
    );
  }

  // ---------------------------------------------------------------------
  // Mappers — pure functions from the raw project + server-computed label
  // onto our internal shapes.
  // ---------------------------------------------------------------------

  /**
   * Map a real Freelancer project onto our summary card. The `postedLabel`
   * is pre-formatted by the caller because formatting needs the current
   * time, which doesn't belong in this module.
   */
  mapToJobSummary(
    project: FreelancerProject,
    postedLabel: string
  ): JobSummary {
    const country = project.owner_info?.country?.name;
    const skills = project.jobs?.map((j) => j.name).filter((n): n is string => Boolean(n)) ?? [];
    return {
      id: `job-${project.id}`,
      projectId: project.id,
      title: project.title ?? "(untitled project)",
      client: country ? `Client in ${country}` : "Client",
      clientCountry: country ?? "Unknown",
      budgetLabel: formatBudget(project.budget, project.currency?.code),
      skills,
      postedLabel,
      bidCount: project.bid_stats?.bid_count ?? 0,
      avgBidLabel: formatMoney(project.bid_stats?.bid_avg ?? null),
      status: "new",
    };
  }

  /**
   * Map a real Freelancer project onto the detail-page shape. The
   * `suggestion` block is filled by the service once analysis has run.
   */
  mapToJobDetail(
    project: FreelancerProject,
    postedLabel: string,
    storedAnalysis: StoredAnalysis | null,
    storedStatus: "new" | "analyzed" | "ignored",
    storedMatchScore: number | null,
    competition: CompetitionSummary | null
  ): JobDetailData {
    const summary = this.mapToJobSummary(project, postedLabel);
    const description = splitParagraphs(project.description ?? project.preview_description ?? "");

    const bidAvg = project.bid_stats?.bid_avg ?? null;
    const minAmt = project.bid_stats?.min_amount ?? null;
    const maxAmt = project.bid_stats?.max_amount ?? null;

    // Extract owner info from the API response when available.
    const owner = project.owner_info;
    const ownerCountry = owner?.country?.name ?? summary.clientCountry;
    const memberSinceLabel =
      owner?.registration_date && owner.registration_date > 0
        ? new Date(owner.registration_date * 1000).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
          })
        : "—";
    const overallRep = owner?.reputation?.entire_history?.overall;
    const hireRateLabel = overallRep !== undefined ? `${Math.round(overallRep * 100)}%` : "—";
    const reputationScore = overallRep ?? null;

    return {
      ...summary,
      status: storedStatus,
      matchScore: storedMatchScore ?? undefined,
      description:
        description.length > 0
          ? description
          : [`No description provided for project ${project.id}.`],
      clientInfo: {
        name: owner?.country?.name
          ? `Client in ${owner.country.name}`
          : summary.client,
        country: ownerCountry,
        memberSinceLabel,
        projectsPosted: 0,
        hireRateLabel,
        reputationScore,
      },
      upgrades: project.upgrades
        ? {
            featured: project.upgrades.featured ?? false,
            urgent: project.upgrades.urgent ?? false,
            sealed: project.upgrades.sealed ?? false,
          }
        : undefined,
      projectType: project.type ?? null,
      bidPeriod: project.bidperiod ?? null,
      attachments: [],
      competition: competition
        ? {
            bidCount: competition.bidCount,
            minBid: competition.minBid,
            maxBid: competition.maxBid,
            medianBid: competition.medianBid,
            isCheapest: competition.isCheapest,
          }
        : undefined,
      insights: {
        bidCount: summary.bidCount,
        avgBidLabel: summary.avgBidLabel,
        highBidLabel: formatMoney(maxAmt),
        lowBidLabel: formatMoney(minAmt),
        refreshedLabel: postedLabel,
      },
      suggestion: storedAnalysis
        ? {
            verdict: storedAnalysis.verdict,
            score: storedAnalysis.score,
            summary: storedAnalysis.summary,
            reasons: storedAnalysis.reasons,
            concerns: storedAnalysis.concerns,
            recommendedBidLabel: storedAnalysis.recommendedBidLabel,
            competitorNote: storedAnalysis.competitorNote,
          }
        : {
            verdict: "fair",
            score: 0,
            summary: "Not analyzed yet — click Analyze to evaluate this job.",
            reasons: [],
            concerns: ["Job has not been analyzed yet."],
            recommendedBidLabel: "—",
            competitorNote: `${summary.bidCount} bids so far${bidAvg !== null ? ` (avg ${formatMoney(bidAvg)})` : ""}.`,
          },
    };
  }

  /**
   * Fetch the authenticated user's own profile (bidder info) from Freelancer.com.
   * Returns the numeric user id needed for placing bids.
   */
  async getSelf(): Promise<FreelancerSelf> {
    const url = "https://www.freelancer.com/api/users/0.1/self/?compact=true";

    let response: Response;
    try {
      response = await fetch(url, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new AppError(
        502,
        "UPSTREAM_ERROR",
        `Failed to reach Freelancer.com: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new AppError(401, "UNAUTHORIZED", "Freelancer.com token was rejected or expired");
    }
    if (response.status === 429) {
      throw new AppError(429, "RATE_LIMITED", "Freelancer.com rate limit exceeded");
    }
    if (!response.ok) {
      throw new AppError(
        502,
        "UPSTREAM_ERROR",
        `Freelancer.com responded with status ${response.status}`
      );
    }

    const body = (await response.json()) as {
      status?: string;
      result?: FreelancerSelf;
    };
    if (body.status !== "success" || body.result === undefined) {
      throw new AppError(502, "UPSTREAM_ERROR", "Freelancer.com returned an invalid self response");
    }

    this.noteRateLimit(response);
    return body.result;
  }

  /**
   * Place a bid on a project.
   * Endpoint: POST /api/projects/0.1/bids
   * Body: { project_id, bidder_id, amount, period, milestone_percentage, description }
   */
  async placeBid(
    projectId: number,
    bidderId: number,
    amount: number,
    period: number,
    milestonePercentage: number,
    description: string
  ): Promise<FreelancerBidResponse> {
    const url = `${this.baseUrl}/bids`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          ...this.authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: projectId,
          bidder_id: bidderId,
          amount,
          period,
          milestone_percentage: milestonePercentage,
          description,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new AppError(
        502,
        "UPSTREAM_ERROR",
        `Failed to reach Freelancer.com: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new AppError(401, "UNAUTHORIZED", "Freelancer.com token was rejected or expired");
    }
    if (response.status === 429) {
      throw new AppError(429, "RATE_LIMITED", "Freelancer.com rate limit exceeded");
    }

    const body = (await response.json()) as FreelancerBidResponse;
    if (!response.ok) {
      const message = body.message ?? `Freelancer.com responded with status ${response.status}`;
      throw new AppError(400, "BID_REJECTED", message);
    }

    this.noteRateLimit(response);
    return body;
  }
}

/** The shape we persist in the `jobs.analysis` JSON column. */
export interface StoredAnalysis {
  verdict: "strong" | "good" | "fair";
  score: number;
  summary: string;
  reasons: string[];
  concerns: string[];
  recommendedBidLabel: string;
  competitorNote: string;
}

/**
 * Best-effort mapping of a skill name to a Freelancer category id. The IDs
 * below were taken from the live /self response and the active list — they
 * cover the skills we most likely encounter for a developer profile. Unknown
 * skills are skipped so the search just falls back to keyword text.
 */
const SKILL_NAME_TO_ID: Record<string, number> = {
  "JavaScript": 9,
  "PHP": 9, // same bucket in the test data
  "React.js": 759,
  "React": 759,
  "Node.js": 500,
  "NodeJS": 500,
  "TypeScript": 504,
  "Python": 17,
  "Next.js": 902,
  "Vue.js": 280,
  "Angular": 20,
  "MongoDB": 39,
  "PostgreSQL": 13,
  "MySQL": 11,
  "Laravel": 32,
  "Django": 29,
  "Express": 8,
  "REST API": 28,
  "GraphQL": 1342,
  "HTML5": 7,
  "CSS": 6,
  "Tailwind CSS": 1263,
  "Sass": 25,
  "Docker": 248,
  "AWS": 248,
  "GCP": 921,
  "Azure": 953,
};

export function deriveSkillIds(names: string[] | undefined): number[] {
  if (names === undefined) return [];
  const lowerToId = new Map<string, number>();
  for (const [name, id] of Object.entries(SKILL_NAME_TO_ID)) {
    lowerToId.set(name.toLowerCase(), id);
  }
  const ids = new Set<number>();
  for (const raw of names) {
    const id = lowerToId.get(raw.trim().toLowerCase());
    if (id !== undefined) ids.add(id);
  }
  return Array.from(ids);
}
