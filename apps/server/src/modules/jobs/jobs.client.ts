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
  /** Total ratings received in the period. */
  all?: number;
  reviews?: number;
  complete?: number;
  incomplete?: number;
  completion_rate?: number;
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
  /** Top-level convenience flags the API mirrors alongside `upgrades`. */
  featured?: boolean;
  urgent?: boolean;
  assisted?: boolean;
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

/**
 * Response shape from POST /bids and PUT /bids/{id}/.
 *
 * Freelancer's own convention nests the payload under `result`, but the flat
 * `bid_id` is tolerated too — `readBidId` reads whichever is present rather than
 * assuming, because a bid stored without its platform id cannot be updated
 * later and that failure would be silent.
 */
export interface FreelancerBidResponse {
  bid_id?: number;
  message?: string;
  result?: { bid_id?: number; id?: number; [key: string]: unknown };
  error?: { message?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * Pull the platform bid id out of a place-bid response. Returns null when the
 * response carries no usable id, so the caller can record a bid that cannot yet
 * be updated instead of losing the bid entirely.
 */
export function readBidId(body: FreelancerBidResponse): number | null {
  const candidates = [body.result?.bid_id, body.result?.id, body.bid_id];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return null;
}

/** The upstream error message from a failed bid request, when it sent one. */
function upstreamMessage(body: FreelancerBidResponse, status: number): string {
  return (
    body.error?.message ??
    body.message ??
    `Freelancer.com responded with status ${status}`
  );
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
  /**
   * Owning user. When present, ingest honors that user's pre-analysis toggles
   * (reject >12h, reject ignored countries). Absent callers get the defaults.
   */
  userId?: string;
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
  /** Why the job was rejected/ignored, when status is "ignored". */
  rejectionReason?: string | null;
  /** True when a bid for this project was already placed (user_bids row). */
  bidded?: boolean;
  /** How the placed bid was made, when bidded. */
  bidVia?: "manual" | "auto" | null;
  /** Latest outcome of the placed bid, when bidded. */
  bidOutcome?: "in_review" | "won" | "lost" | null;
}

/** Competition snapshot from stored bid data. */
export interface CompetitionSummary {
  bidCount: number;
  minBid: number | null;
  maxBid: number | null;
  medianBid: number | null;
  isCheapest: boolean;
}

/** The user's own bid on a project, as stored in `user_bids`. */
export interface MyBid {
  /** The app's internal bid id (`bid-{projectId}-{timestamp}`). */
  id: string;
  /** Freelancer.com's bid id — what an update is sent against. Null when unrecorded. */
  freelancerBidId: number | null;
  amount: number;
  milestonePercentage: number;
  description: string;
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
  /** Why the job was rejected/ignored, when status is "ignored". */
  rejectionReason?: string | null;
  /** Error from the last failed automatic bid attempt, if any. */
  bidError?: string | null;
  /**
   * The user's own bid on this project, when one is on record. Drives the
   * Update bid dialog, which prefills from it. Null when the user has not bid
   * through the app — the dialog still opens, and they supply the bid id.
   */
  myBid?: MyBid | null;
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
  /**
   * Delivery time (days) the relevance gate picked for this project, when AI
   * timeline selection was on at analysis time. Null otherwise.
   */
  deliveryDays?: number | null;
  /**
   * Bid amount (dollars) the relevance gate picked for this project, only while
   * AI bid-amount selection is enabled. Null otherwise.
   */
  bidAmount?: number | null;
  /**
   * Suggested bid amount pre-filled on the manual bid page. When AI bid-amount
   * selection was on this is the gate's pick; when off it is the default-markup
   * amount (minimum + the user's markup% of the project max). Null when no
   * usable suggestion exists.
   */
  suggestedBidAmount?: number | null;
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
   *
   * `bidderId` adds Freelancer's `bidders[]` filter, which is how the Update
   * bid dialog's Find button locates the user's own bid on a project. Passed
   * only on that explicit request — the competition-insight call in
   * `getJobById` wants every bidder.
   */
  async getBidsForProject(
    projectId: number,
    limit = 10,
    bidderId?: number
  ): Promise<FreelancerBid[]> {
    const filter = bidderId !== undefined ? `&bidders[]=${bidderId}` : "";
    const url = `${this.baseUrl}/projects/${projectId}/bids/?limit=${limit}${filter}`;

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
    const minBid = sorted[0];
    const maxBid = sorted[sorted.length - 1];
    const midIdx = Math.floor(sorted.length / 2);
    const medianBid =
      sorted.length === 0
        ? undefined
        : sorted.length % 2 === 1
          ? sorted[midIdx]
          : ((sorted[midIdx - 1] ?? 0) + (sorted[midIdx] ?? 0)) / 2;
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
    competition: CompetitionSummary | null,
    storedState: {
      rejectionReason: string | null;
      bidError: string | null;
      myBid?: MyBid | null;
      /** Delivery time (days) the gate picked for this project, if any. */
      deliveryDays?: number | null;
      /** Bid amount (dollars) the gate picked for this project, if any. */
      bidAmount?: number | null;
  /**
   * Suggested bid amount shown on the manual bid page. When AI bid-amount
   * selection is enabled this is the gate's pick (if it made one); otherwise it
   * is the default-markup amount (minimum + markup% of max). Rounded and
   * clamped to the user's bounds. Null when neither is computable.
   */
  suggestedBidAmount?: number | null;
    } = {
      rejectionReason: null,
      bidError: null,
      myBid: null,
      deliveryDays: null,
    }
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
      rejectionReason: storedState.rejectionReason ?? null,
      bidError: storedState.bidError ?? null,
      myBid: storedState.myBid ?? null,
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
      deliveryDays: storedState.deliveryDays ?? null,
      bidAmount: storedState.bidAmount ?? null,
      suggestedBidAmount: storedState.suggestedBidAmount ?? null,
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
      throw new AppError(400, "BID_REJECTED", upstreamMessage(body, response.status));
    }

    this.noteRateLimit(response);
    return body;
  }

  /**
   * Update an existing bid.
   * Endpoint: PUT /api/projects/0.1/bids/{bid_id}/
   * Body: { description, amount, milestone_percentage }
   *
   * The body uses snake_case `milestone_percentage` while this app calls the
   * same field `milestonePercentage`; the translation happens here and nowhere
   * else. `period` is deliberately absent — the endpoint does not accept it.
   */
  async updateBid(
    bidId: number,
    patch: { description: string; amount: number; milestonePercentage: number }
  ): Promise<FreelancerBidResponse> {
    const url = `${this.baseUrl}/bids/${bidId}/`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "PUT",
        headers: {
          ...this.authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: patch.description,
          amount: patch.amount,
          milestone_percentage: patch.milestonePercentage,
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
    if (response.status === 404) {
      throw new AppError(
        404,
        "NOT_FOUND",
        `Freelancer.com has no bid with id ${bidId} — check the bid id belongs to one of your bids on this project`
      );
    }

    const body = (await response.json().catch(() => ({}))) as FreelancerBidResponse;
    if (!response.ok) {
      // A rejected update is usually a bad bid id or a value Freelancer refuses
      // (milestone outside 20-100, amount below its minimum). Pass its own
      // wording through — it is more specific than anything we could infer.
      throw new AppError(400, "BID_REJECTED", upstreamMessage(body, response.status));
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
