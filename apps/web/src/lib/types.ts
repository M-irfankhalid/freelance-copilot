/**
 * Domain types shared across the app. They describe the data the backend will
 * eventually serve; UI components consume only these shapes, so swapping the
 * mock data layer for real API calls never touches the components.
 */

/** Platforms the aggregator can connect to. Freelancer.com ships first. */
export type PlatformId = "freelancer" | "upwork" | "guru";

export type MatchBand = "strong" | "good" | "fair";

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

export type ProposalStatus =
  | "awaiting_approval"
  | "queued"
  | "submitted"
  | "viewed"
  | "shortlisted"
  | "declined";

export interface ProposalSummary {
  id: string;
  jobTitle: string;
  client: string;
  bidAmount: number;
  status: ProposalStatus;
  /** Preformatted relative time, e.g. "2h ago". */
  updatedLabel: string;
}

export type BidOutcome = "in_review" | "won" | "lost";

export interface BidSummary {
  id: string;
  jobTitle: string;
  amount: number;
  /** True when the amount is a monthly rate rather than a fixed price. */
  recurring: boolean;
  outcome: BidOutcome;
  submittedLabel: string;
}

export type ConnectionStatus = "connected" | "needs_attention" | "not_connected";

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

/** Everything the dashboard renders, fetched as one payload. */
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
