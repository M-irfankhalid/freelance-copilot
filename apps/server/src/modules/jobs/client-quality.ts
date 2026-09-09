/**
 * Client-trust snapshot for a job.
 *
 * A Freelancer project's `owner_info` is deep and noisy. We keep only the
 * signals that decide whether a client is worth auto-bidding on: payment /
 * deposit / email verification, account age, the overall reputation history,
 * and the upgrade flags that indicate signing requirements or recruiter posts.
 *
 * The snapshot is stored as JSON in `jobs.client_quality` at ingest / analyze
 * time and is what Model A, the auto-bid gates, and the Discord alert builder
 * read. Pure functions here so the rules are unit-testable.
 */
import type { FreelancerProject } from "./jobs.client.js";

export interface ClientQualityUpgrades {
  /** NDA — the bidder must accept the NDA before bidding. */
  nda: boolean;
  /** IP contract — requires signing; API bids are refused. */
  ipContract: boolean;
  nonCompete: boolean;
  /** Staffing/agency post ("we hire on behalf of a client"). */
  recruiter: boolean;
  assisted: boolean;
  sealed: boolean;
  featured: boolean;
  urgent: boolean;
  fulltime: boolean;
  premium: boolean;
  enterprise: boolean;
}

export interface ClientQuality {
  country: string | null;
  /** owner_info.status.payment_verified. */
  paymentVerified: boolean | null;
  emailVerified: boolean | null;
  /** owner_info.status.deposit_made — the client has funded escrow before. */
  depositMade: boolean | null;
  phoneVerified: boolean | null;
  identityVerified: boolean | null;
  /** owner_info.registration_date, Unix seconds. */
  registeredAt: number | null;
  /** reputation.entire_history.overall, 0–5. */
  reputationOverall: number | null;
  /** reputation.entire_history.all — number of ratings. */
  reputationCount: number | null;
  /** reputation.entire_history.positive, 0–1. */
  positiveRate: number | null;
  upgrades: ClientQualityUpgrades;
}

function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** The upgrade flags that matter to our decisions, from the raw API `upgrades`. */
export function extractClientQuality(project: FreelancerProject): ClientQuality {
  const owner = project.owner_info;
  const status = owner?.status;
  const reputation = owner?.reputation?.entire_history;
  const upgrades = project.upgrades;

  return {
    country: owner?.country?.name ?? null,
    paymentVerified: flag(status?.payment_verified),
    emailVerified: flag(status?.email_verified),
    depositMade: flag(status?.deposit_made),
    phoneVerified: flag(status?.phone_verified),
    identityVerified: flag(status?.identity_verified),
    registeredAt:
      typeof owner?.registration_date === "number" && owner.registration_date > 0
        ? owner.registration_date
        : null,
    reputationOverall: typeof reputation?.overall === "number" ? reputation.overall : null,
    reputationCount: typeof reputation?.all === "number" ? reputation.all : null,
    positiveRate: typeof reputation?.positive === "number" ? reputation.positive : null,
    upgrades: {
      nda: upgrades?.NDA === true,
      ipContract: upgrades?.ip_contract === true,
      nonCompete: upgrades?.non_compete === true,
      recruiter: upgrades?.recruiter === true,
      assisted: upgrades?.assisted === true,
      sealed: upgrades?.sealed === true,
      featured: upgrades?.featured === true || project.featured === true,
      urgent: upgrades?.urgent === true || project.urgent === true,
      fulltime: upgrades?.fulltime === true,
      premium: upgrades?.premium === true,
      enterprise: upgrades?.enterprise === true,
    },
  };
}

export function parseClientQuality(raw: string | null): ClientQuality | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ClientQuality;
  } catch {
    return null;
  }
}

/**
 * Derive the snapshot from a stored raw project blob. Fallback for rows saved
 * before the client_quality column existed, so legacy jobs still run through
 * the same trust gates without forcing a re-analyze.
 */
export function qualityFromRawData(rawData: string | null): ClientQuality | null {
  if (!rawData) return null;
  try {
    return extractClientQuality(JSON.parse(rawData) as FreelancerProject);
  } catch {
    return null;
  }
}

export function serializeClientQuality(q: ClientQuality): string {
  return JSON.stringify(q);
}

/** NDA + IP-contract projects need a signature Freelancer.com won't accept via the bid API. */
export function isBidBlocked(q: ClientQuality): boolean {
  return q.upgrades.nda || q.upgrades.ipContract;
}

/** A client worth trusting with auto-bid: verified payment and (for fixed price) escrow history. */
export function isPaymentVerified(q: ClientQuality): boolean {
  return q.paymentVerified === true;
}

export function accountAgeDays(q: ClientQuality): number | null {
  if (q.registeredAt === null) return null;
  const seconds = Math.floor(Date.now() / 1000) - q.registeredAt;
  if (seconds < 0) return null;
  return Math.floor(seconds / 86400);
}

export function accountAgeLabel(q: ClientQuality): string {
  const days = accountAgeDays(q);
  if (days === null) return "account age unknown";
  if (days < 30) return "account is brand new (under a month)";
  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30));
    return `account is new (registered ~${months} month${months === 1 ? "" : "s"} ago)`;
  }
  const years = Math.floor(days / 365);
  return `account is established (registered ~${years} year${years === 1 ? "" : "s"} ago)`;
}

export function reputationLabel(q: ClientQuality): string {
  if (q.reputationOverall === null || q.reputationOverall <= 0) {
    return "no public rating history";
  }
  const count = q.reputationCount ?? 0;
  return `${q.reputationOverall.toFixed(1)}/5 from ${count} rating${count === 1 ? "" : "s"}`;
}

const UPGRADE_LABELS: Array<{ key: keyof ClientQualityUpgrades; label: string }> = [
  { key: "nda", label: "NDA" },
  { key: "ipContract", label: "IP contract" },
  { key: "nonCompete", label: "Non-compete" },
  { key: "recruiter", label: "Recruiter" },
  { key: "assisted", label: "Assisted" },
  { key: "sealed", label: "Sealed" },
  { key: "featured", label: "Featured" },
  { key: "urgent", label: "Urgent" },
  { key: "fulltime", label: "Full-time" },
  { key: "premium", label: "Premium" },
  { key: "enterprise", label: "Enterprise" },
];

export function presentUpgradeLabels(q: ClientQuality): string[] {
  return UPGRADE_LABELS.filter((u) => q.upgrades[u.key] === true).map((u) => u.label);
}

/**
 * Auto-bid eligibility — deterministic, independent of the AI score. A job is
 * only safe to auto-bid when it needs no signature and the client's payment
 * method is verified. Escrow deposit history is NOT a hard gate: Freelancer.com
 * escrows the milestone before work starts either way, so a verified client who
 * hasn't hired before (no deposit yet) is still safe to auto-bid. Deposit and
 * account age are signals Model A weighs when scoring, and concerns list them
 * for manual review — they are not vetoes.
 */
export function isAutoBidEligible(
  q: ClientQuality | null,
  _projectType?: string | null | undefined
): boolean {
  if (q === null) return false;
  if (isBidBlocked(q)) return false;
  if (q.paymentVerified !== true) return false;
  return true;
}

/**
 * Human-readable client-trust concerns, used for the Discord "needs review"
 * alert and as `concerns` on the stored analysis. Empty when the client looks
 * trustworthy. `projectType` controls whether a missing escrow deposit counts.
 */
export function clientTrustConcerns(
  q: ClientQuality,
  projectType: string | null | undefined
): string[] {
  const out: string[] = [];
  if (q.paymentVerified !== true) {
    out.push("Client payment method is not verified");
  }
  if (projectType === "fixed" && q.depositMade === false) {
    out.push("Client has never funded an escrow milestone (fixed-price project)");
  }
  const days = accountAgeDays(q);
  if (days !== null && days < 365) {
    out.push(
      days < 30
        ? "Client account is brand new"
        : "Client account is new (under a year old)"
    );
  }
  if (
    q.reputationCount !== null &&
    q.reputationCount > 0 &&
    q.reputationCount < 5 &&
    (q.reputationOverall ?? 0) < 4.5
  ) {
    out.push("Client has a thin or low reputation history");
  }
  if (q.upgrades.recruiter && q.paymentVerified !== true) {
    out.push("Posted through a recruiter upgrade by an unverified client");
  }
  if (q.upgrades.nda || q.upgrades.ipContract) {
    out.push(
      "Project carries an NDA / IP contract that must be signed before bidding"
    );
  }
  return out;
}

/**
 * True when the project carries none of the paid/signing upgrades Freelancer.com
 * exposes. "No upgrades on the job" is one leg of the bad-reputation rule.
 */
export function hasNoProjectUpgrades(q: ClientQuality): boolean {
  return Object.values(q.upgrades).every((v) => v === false);
}

/**
 * "Completely bad" client gate — run BEFORE the AI analysis model so we never
 * spend a call on a client with no redeemable signals. Rejects only when we can
 * prove every signal is bad: a brand-new account (under `maxAgeDays`, default
 * 30) whose payment method is unverified, that has never funded an escrow
 * deposit, and whose project carries no upgrades. Any verified payment, any
 * deposit history, any project upgrade, or an account we can't prove is new
 * lets the job proceed to analysis.
 */
export function isBadReputationClient(
  q: ClientQuality | null,
  maxAgeDays = 30
): boolean {
  if (q === null) return false;
  if (q.paymentVerified === true) return false;
  if (q.depositMade === true) return false;
  if (!hasNoProjectUpgrades(q)) return false;
  const days = accountAgeDays(q);
  // Don't reject on unknown age — only when we can prove the account is brand new.
  if (days === null || days >= maxAgeDays) return false;
  return true;
}
