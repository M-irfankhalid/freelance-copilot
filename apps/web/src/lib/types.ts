/**
 * Domain types shared across the app. They describe the data the backend will
 * eventually serve; UI components consume only these shapes, so swapping the
 * mock data layer for real API calls never touches the components.
 */

/** Connected services. Freelancer.com and OpenRouter ship first. */
export type PlatformId = "freelancer" | "openrouter";

export type MatchBand = "strong" | "good" | "fair";

/* ---------------------------------- User --------------------------------- */

export interface CurrentUser {
  name: string;
  email: string;
  initials: string;
}

/* ---------------------------------- Jobs --------------------------------- */

export type JobSeverity = "urgent" | "warning" | "info";

export type JobStatus = "new" | "analyzed" | "ignored";

export interface JobSummary {
  id: string;
  /** Freelancer.com project id once synced; internal id before that. */
  projectId: number;
  title: string;
  client: string;
  clientCountry: string;
  budgetLabel: string;
  skills: string[];
  /** Preformatted relative time, e.g. "2h ago". */
  postedLabel: string;
  bidCount: number;
  avgBidLabel: string;
  matchScore?: number;
  severity?: JobSeverity;
  status: JobStatus;
  /** Why the job was rejected/ignored, when status is "ignored". */
  rejectionReason?: string | null;
  /** True when a bid for this project was already placed (user_bids row). */
  bidded?: boolean;
  /** How the placed bid was made, when bidded. */
  bidVia?: "manual" | "auto" | null;
  /** Latest outcome of the placed bid, when bidded. */
  bidOutcome?: "in_review" | "won" | "lost" | null;
}

export interface JobClientInfo {
  name: string;
  country: string;
  memberSinceLabel: string;
  projectsPosted: number;
  hireRateLabel: string;
  /** Overall reputation score (0–1) from the owner's profile, if available. */
  reputationScore?: number | null;
}

export interface JobAttachment {
  name: string;
  sizeLabel: string;
  kind: "pdf" | "docx" | "zip" | "image" | "code";
}

/**
 * Aggregate bid statistics for a job. Cached, never fetched on page view —
 * the UI shows when it was last refreshed and offers a manual refresh.
 */
export interface BidInsights {
  bidCount: number;
  avgBidLabel: string;
  highBidLabel: string;
  lowBidLabel: string;
  /** Preformatted age of this snapshot, e.g. "12m ago". */
  refreshedLabel: string;
}

/** Competition snapshot from stored bid data. */
export interface CompetitionSummary {
  bidCount: number;
  minBid: number | null;
  maxBid: number | null;
  medianBid: number | null;
  isCheapest: boolean;
}

/** The agent's read on a job. Grounded in the profile only — no invented facts. */
export interface JobAiSuggestion {
  verdict: MatchBand | "poor";
  score: number;
  summary: string;
  reasons: string[];
  concerns: string[];
  recommendedBidLabel: string;
  /** AI summary of aggregate competitor statistics, if bid insights exist. */
  competitorNote?: string;
}

export interface ProjectUpgrades {
  featured: boolean;
  urgent: boolean;
  sealed: boolean;
}

export interface JobDetailData extends JobSummary {
  /** Description paragraphs as provided by the client. */
  description: string[];
  clientInfo: JobClientInfo;
  /** Upgrade flags surfaced by the API. */
  upgrades?: ProjectUpgrades;
  /** Project billing type: "fixed" | "hourly". */
  projectType?: string | null;
  /** Bid period in days, if the project specifies one. */
  bidPeriod?: number | null;
  attachments: JobAttachment[];
  /** Aggregate competition data from stored bids, if fetched. */
  competition?: CompetitionSummary | null;
  insights: BidInsights;
  suggestion: JobAiSuggestion;
  /** Error from the last failed automatic bid attempt, if any. */
  bidError?: string | null;
}

/* -------------------------------- Matches -------------------------------- */

export interface MatchItem {
  id: string;
  jobId: string;
  title: string;
  client: string;
  budgetLabel: string;
  postedLabel: string;
  score: number;
  band: MatchBand;
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

/* ------------------------------- Proposals ------------------------------- */

export type ProposalStatus =
  | "awaiting_approval"
  | "approved"
  | "draft"
  | "queued"
  | "submitted"
  | "viewed"
  | "shortlisted"
  | "declined"
  | "won";

export interface ProposalSummary {
  id: string;
  jobTitle: string;
  client: string;
  bidAmount: number;
  status: ProposalStatus;
  /** Preformatted relative time, e.g. "2h ago". */
  updatedLabel: string;
}

export interface ProposalRecord extends ProposalSummary {
  /** Current draft text shown in the editor. */
  content: string;
  /** AI note about bid competition, shown in the list/editor. */
  competitorNote?: string | null;
  createdAtLabel: string;
}

/* ---------------------------------- Bids --------------------------------- */

export type BidOutcome = "in_review" | "won" | "lost";

export interface BidSummary {
  id: string;
  jobTitle: string;
  amount: number;
  /** True when the amount is a monthly rate rather than a fixed price. */
  recurring: boolean;
  outcome: BidOutcome;
  submittedLabel: string;
  /** How the bid was placed. */
  via: "manual" | "auto";
  proposalExcerpt?: string;
}

/* ---------------------------------- Logs --------------------------------- */

export type LogLevel = "debug" | "info" | "success" | "warn" | "error";

export type LogCategory =
  | "sync"
  | "analysis"
  | "proposal"
  | "proposals"
  | "ai"
  | "bid"
  | "auth"
  | "system";

export interface LogEntry {
  id: string;
  timeLabel: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
}

/* ------------------------------- Analytics ------------------------------- */

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface AnalyticsSnapshot {
  kpis: KpiMetric[];
  bidsPerWeek: SeriesPoint[];
  outcomes: { won: number; lost: number; inReview: number };
  proposalsByStatus: SeriesPoint[];
}

/* -------------------------------- Platforms ------------------------------ */

export type ConnectionStatus = "connected" | "needs_attention" | "not_connected";

/** What the credentials API returns — never plaintext values. */
export interface CredentialSummary {
  id: PlatformId;
  connected: boolean;
  status: "untested" | "ok" | "failed";
  /** Masked preview like "frl_••••3f9a". */
  keyPreview: string | null;
  lastTestedAt: string | null;
  lastTestMessage: string | null;
  /** Legacy single model id (mirrors proposalModelId when set). */
  modelId: string | null;
  /** Model used for relevance screening / analysis (cheap & fast). */
  analysisModelId: string | null;
  /** Model used for proposal writing (strong). */
  proposalModelId: string | null;
  usage?: { label: string; used: number; limit: number };
}

export interface CredentialTestResult {
  ok: boolean;
  message: string;
  usage?: { label: string; used: number; limit: number };
}

export interface AiModelOption {
  id: string;
  label: string;
  provider: string;
  contextLabel: string;
}

export interface PlatformCredential {
  id: PlatformId;
  name: string;
  description: string;
  status: ConnectionStatus;
  /** Masked credential preview, never the real value, e.g. "frl_••••3f9a". */
  keyPreview?: string;
  keyInputLabel: string;
  lastTestedLabel?: string;
  note?: string;
  usage?: { label: string; used: number; limit: number };
}

export interface OpenRouterState {
  selectedModelId: string;
  models: AiModelOption[];
  creditLabel: string;
  usageThisMonthLabel: string;
}

export interface AutomationSettings {
  /** Seconds between job scans. Minimum 30, default 60. */
  scanIntervalSeconds: number;
  autoAnalyze: boolean;
  autoMatch: boolean;
  autobidEnabled: boolean;
  /** Minimum relevance score to auto-bid (also the auto-proposal gate). */
  minMatchScore: number;
  minBid: number;
  maxBid: number;
  dailyCap: number;
  bidsToday: number;
  paused: boolean;
}

export type AutomationRunResult = "ok" | "skipped" | "error";

export interface AutomationRun {
  id: string;
  timeLabel: string;
  action: string;
  detail: string;
  result: AutomationRunResult;
}

/* -------------------------------- Discord -------------------------------- */

/** Events the worker can push to a Discord channel. */
export type DiscordEvent = "match" | "bid_placed" | "bid_failed" | "api_error";

/** Discord config as returned by the API — never contains the webhook URL. */
export interface DiscordSettings {
  configured: boolean;
  /** Masked webhook preview, e.g. "https••••••ook". */
  webhookPreview: string | null;
  events: DiscordEvent[];
}

/* --------------------------------- Profile ------------------------------- */

export interface ProfileExperience {
  role: string;
  company: string;
  periodLabel: string;
  summary: string;
}

export interface ProfilePortfolioItem {
  title: string;
  url: string;
  description: string;
}

export interface UserProfile {
  name: string;
  email: string;
  freelancerUsername?: string;
  title: string;
  hourlyRateLabel: string;
  about: string;
  skills: string[];
  /** Numeric Freelancer.com skill IDs paired 1:1 with skills. */
  skillIds?: number[];
  experience: ProfileExperience[];
  portfolio: ProfilePortfolioItem[];
  certifications: string[];
  preferredProjectTypes: string[];
  wants: string[];
  notWants: string[];
  /** Country names/codes whose jobs are excluded before any analysis. */
  ignoredCountries: string[];
  customInstructions: string;
  importedFromFreelancer: boolean;
  userSummary?: string;
  /** Free-text guidance for the relevance model, e.g. "no web3 projects". */
  relevancyInstructions?: string;
  /** Markdown summary of portfolio projects, used during proposal generation. */
  portfolioSummary?: string;
  /** Markdown block holding all proposal templates, used during proposal generation. */
  proposalTemplates?: string;
}

/* -------------------------------- Dashboard ------------------------------ */

/** A job surfaced in "jobs requiring attention". */
export interface JobAttentionItem {
  id: string;
  title: string;
  client: string;
  platform: string;
  /** Composite match score, 0–100. */
  matchScore: number;
  budgetLabel: string;
  /** Why this job is flagged, e.g. "Closes in 5 hours". */
  reason: string;
  severity: "urgent" | "warning" | "info";
}

export type ActivityKind =
  | "bid_won"
  | "bid_submitted"
  | "strong_match"
  | "proposal_shortlisted"
  | "sync_completed"
  | "automation_paused";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  message: string;
  /** Preformatted relative time, e.g. "12 min ago". */
  timeLabel: string;
}

/** Signed change versus a named comparison period. */
export interface KpiDelta {
  /** Preformatted signed value, e.g. "+9". */
  value: string;
  direction: "up" | "down";
  /** Whether the movement is good for the business — "down" can be positive. */
  tone: "positive" | "negative" | "neutral";
  comparison: string;
}

export interface KpiMetric {
  id: string;
  label: string;
  /** Preformatted value, e.g. "47" or "$4.2K". */
  value: string;
  /** Optional supporting context under the label. */
  context?: string;
  delta?: KpiDelta;
}

export interface MatchQualityBand {
  band: MatchBand;
  label: string;
  /** Score range the band covers, e.g. "90–100". */
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

export interface DashboardSnapshot {
  kpis: KpiMetric[];
  matchQuality: MatchQualitySnapshot;
  jobsRequiringAttention: JobAttentionItem[];
  recentProposals: ProposalSummary[];
  recentBids: BidSummary[];
  bidWinRate: { rate: number; windowLabel: string; submitted: number };
  platforms: PlatformConnection[];
  activity: ActivityEvent[];
}

/** Lightweight per-platform line used on the dashboard status card. */
export interface PlatformConnection {
  id: PlatformId;
  name: string;
  username?: string;
  status: ConnectionStatus;
  /** Preformatted, e.g. "12 min ago". Present when connected. */
  lastSyncLabel?: string;
  newJobsToday?: number;
  /** Call to action shown for unconnected platforms. */
  note?: string;
}
