/**
 * Bid delivery timeline — the `period` (days) Freelancer.com shows the client as
 * the delivery time.
 *
 * Auto-bid used to quote a hardcoded number for every project. It is now either
 * the user's preferred number or a value the relevance gate picked for that
 * specific project from a closed list the user controls.
 *
 * These constants live in `lib` rather than inside a module because four modules
 * need them (`ai`, `jobs`, `platforms`, `automation`) and `jobs` cannot import
 * `automation.service` without closing an import cycle — the same problem
 * `modules/jobs/preanalysis-gates.ts` documents. This file imports only the DB
 * layer, so importing it from anywhere is safe.
 */

import { eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { automationSettings } from "../db/schema.js";

/** Freelancer.com accepts a delivery period in this range. */
export const MIN_DELIVERY_DAYS = 1;
export const MAX_DELIVERY_DAYS = 365;

/** The fixed delivery time (days) used until the user changes it. */
export const DEFAULT_PREFERRED_DELIVERY_DAYS = 4;

/** The day values the AI may choose from until the user edits the list. */
export const DEFAULT_DELIVERY_TIMELINE_OPTIONS: readonly number[] = [1, 3, 5, 7, 10];

/**
 * Prefilled guidance for the pick. Users edit this freely — it is only a
 * starting point. It is written to counter the two ways a decision model goes
 * wrong on its own: quoting a safe round number instead of the shortest honest
 * one, and ignoring a deadline the client already stated.
 */
export const DEFAULT_DELIVERY_TIMELINE_INSTRUCTIONS = [
  "Choose the delivery time to quote for this project. Clients on Freelancer.com prefer fast delivery, and a shorter honest timeline wins more work — so pick the SHORTEST time you can genuinely commit to, not a safe-sounding round number.",
  "A small, well-defined task (a bug fix, a small script, one page, a simple integration) should be 1 day. Go longer only when the scope truly needs it: several screens or integrations, unclear or multi-part requirements, or third-party review. Never quote longer than the deadline the client themselves asked for.",
].join("\n\n");

export interface DeliveryTimelineSettings {
  /** Whether the relevance gate picks a per-project delivery time. */
  aiDeliveryTimeline: boolean;
  /** Used as-is when `aiDeliveryTimeline` is off. */
  preferredDeliveryDays: number;
  /** The closed list the AI may choose from. Never empty. */
  deliveryTimelineOptions: number[];
  /** Free-text guidance for the pick. Never empty. */
  deliveryTimelineInstructions: string;
}

export const DEFAULT_DELIVERY_TIMELINE_SETTINGS: DeliveryTimelineSettings = {
  aiDeliveryTimeline: false,
  preferredDeliveryDays: DEFAULT_PREFERRED_DELIVERY_DAYS,
  deliveryTimelineOptions: [...DEFAULT_DELIVERY_TIMELINE_OPTIONS],
  deliveryTimelineInstructions: DEFAULT_DELIVERY_TIMELINE_INSTRUCTIONS,
};

/**
 * Clean a day list: keep whole numbers in range, drop duplicates, sort ascending.
 *
 * An empty or unusable result falls back to the default rather than staying
 * empty. That matters beyond tidiness — the list becomes a JSON-schema `enum`
 * (which rejects an empty array) and the Decisions API's `criteria` (which would
 * leave the model nothing to answer), so "no list" is never a valid state.
 */
export function sanitizeDeliveryDaysList(
  values: readonly unknown[] | null | undefined
): number[] {
  if (!Array.isArray(values)) return [...DEFAULT_DELIVERY_TIMELINE_OPTIONS];

  const cleaned = values.filter(
    (value): value is number =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= MIN_DELIVERY_DAYS &&
      value <= MAX_DELIVERY_DAYS
  );

  const unique = [...new Set(cleaned)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : [...DEFAULT_DELIVERY_TIMELINE_OPTIONS];
}

/** A stored day count, clamped to the range Freelancer.com accepts. */
function readPreferredDays(value: number | null): number {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_DELIVERY_DAYS &&
    value <= MAX_DELIVERY_DAYS
  ) {
    return value;
  }
  return DEFAULT_PREFERRED_DELIVERY_DAYS;
}

/** Parse the options column (JSON array in TEXT), tolerating anything. */
function parseStoredOptions(raw: string | null): number[] | null {
  if (raw === null || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

/**
 * Read the timeline settings for a user. A pure DB read: it never creates the
 * settings row, and a missing row (the user has never opened Automation) means
 * the defaults — AI selection off, which is also the pre-feature behavior.
 */
export function getDeliveryTimelineSettings(userId: string): DeliveryTimelineSettings {
  if (userId.length === 0) return DEFAULT_DELIVERY_TIMELINE_SETTINGS;

  const row = getDb()
    .select({
      aiDeliveryTimeline: automationSettings.aiDeliveryTimeline,
      preferredDeliveryDays: automationSettings.preferredDeliveryDays,
      deliveryTimelineOptions: automationSettings.deliveryTimelineOptions,
      deliveryTimelineInstructions: automationSettings.deliveryTimelineInstructions,
    })
    .from(automationSettings)
    .where(eq(automationSettings.userId, userId))
    .get();

  if (row === undefined) return DEFAULT_DELIVERY_TIMELINE_SETTINGS;

  const instructions = (row.deliveryTimelineInstructions ?? "").trim();

  return {
    aiDeliveryTimeline: row.aiDeliveryTimeline === 1,
    preferredDeliveryDays: readPreferredDays(row.preferredDeliveryDays),
    deliveryTimelineOptions: sanitizeDeliveryDaysList(
      parseStoredOptions(row.deliveryTimelineOptions)
    ),
    deliveryTimelineInstructions:
      instructions.length > 0 ? instructions : DEFAULT_DELIVERY_TIMELINE_INSTRUCTIONS,
  };
}

/**
 * The delivery time to quote for one job.
 *
 * The gate's per-project pick wins only when the feature is on AND it actually
 * produced a value for this job. Every other case — the feature is off, the job
 * was screened before it existed, the answer was unusable — falls back to the
 * user's preferred number, so a bid is never blocked by a missing timeline.
 */
export function resolveDeliveryDays(
  settings: Pick<DeliveryTimelineSettings, "aiDeliveryTimeline" | "preferredDeliveryDays">,
  jobDeliveryDays: number | null | undefined
): number {
  if (
    settings.aiDeliveryTimeline &&
    typeof jobDeliveryDays === "number" &&
    Number.isInteger(jobDeliveryDays) &&
    jobDeliveryDays >= MIN_DELIVERY_DAYS &&
    jobDeliveryDays <= MAX_DELIVERY_DAYS
  ) {
    return jobDeliveryDays;
  }
  return settings.preferredDeliveryDays;
}

/* ------------------------------------------------------------------ *
 * Bid amount — the sibling feature to delivery timeline. Same shape:
 * a switch, an editable list of choices, and an editable instruction.
 * *------------------------------------------------------------------- */

/**
 * The fraction strings the AI may choose from until the user edits the list.
 * Each is a fraction of the project's maximum budget (e.g. "1/2" → half of the
 * project max); "full" means the entire maximum. Kept as literal strings so the
 * UI shows the user something readable and editable, and so the values are
 * stable even if the project's budget changes between analysis and bidding.
 */
export const DEFAULT_BID_AMOUNT_FRACTIONS: readonly string[] = [
  "1/4",
  "0.5",
  "0.8",
  "2",
  "full",
];

/**
 * Prefilled guidance for the pick, fully editable by the user. Mirrors the
 * wording the delivery-timeline instructions use: short, specific, and focused
 * on picking the honest value rather than a safe default.
 */
export const DEFAULT_BID_AMOUNT_INSTRUCTIONS = [
  "Quote a bid that balances win probability with profit for this specific project.",
  "The options you offer are fractions of the client's stated maximum budget. A small, well-defined task that the client priced with room to spare can be bid at the lower fraction; a large, clearly-scoped project with a trustworthy client can take the higher fraction or the full maximum.",
  "Never quote the project minimum out of habit — pick the fraction that best matches the actual scope and the client's budget window. When in doubt, the middle option (2/3) is the safe default.",
].join("\n\n");

/**
 * Default markup percentage applied to the project minimum when AI bid-amount
 * selection is off and auto-bid needs a concrete price. 0 reproduces the
 * original behaviour (bid the minimum, clamped to [minBid, maxBid]).
 */
export const DEFAULT_BID_AMOUNT_MARKUP_PCT = 0;

/** Round the final bid amount up to the nearest multiple of this value. 0 = no rounding. */
export const DEFAULT_BID_AMOUNT_ROUND_UP_TO = 0;

/**
 * Prefilled guidance for the default markup rule, fully editable by the user.
 */
export const DEFAULT_BID_AMOUNT_MARKUP_INSTRUCTIONS = [
  "When AI bid-amount selection is off, auto-bid prices each project at the project's minimum budget plus this percentage of the project's maximum budget.",
  "A 0% markup reproduces the original behaviour (bid the minimum, clamped to your bounds). Raise it to bid more aggressively on projects with headroom between their minimum and maximum.",
].join("\n\n");

export interface BidAmountSettings {
  /** Whether the relevance gate picks a per-project bid amount. */
  aiBidAmount: boolean;
  /** The fraction strings the AI may choose from. Never empty. */
  bidAmountFractions: string[];
  /** Free-text guidance the AI follows when picking. Never empty. */
  bidAmountInstructions: string;
  /** Percentage (0–100) applied to the project max as a markup on the minimum. */
  defaultBidMarkupPct: number;
  /** Guidance for the default markup rule. Never empty. */
  bidAmountMarkupInstructions: string;
  /**
   * Round the final bid amount UP to the nearest multiple of this value.
   * 0 or 1 means no rounding (default). E.g. 10 rounds $187 → $190.
   */
  roundBidUpTo: number;
}

export const DEFAULT_BID_AMOUNT_SETTINGS: BidAmountSettings = {
  aiBidAmount: false,
  bidAmountFractions: [...DEFAULT_BID_AMOUNT_FRACTIONS],
  bidAmountInstructions: DEFAULT_BID_AMOUNT_INSTRUCTIONS,
  defaultBidMarkupPct: DEFAULT_BID_AMOUNT_MARKUP_PCT,
  bidAmountMarkupInstructions: DEFAULT_BID_AMOUNT_MARKUP_INSTRUCTIONS,
  roundBidUpTo: DEFAULT_BID_AMOUNT_ROUND_UP_TO,
};

/**
 * Clean a fraction list: keep only valid `"X/Y"` or `"full"` strings, drop
 * duplicates (case-insensitive), and preserve the order the user typed. An
 * empty or unusable result falls back to the default list — same invariant as
 * `sanitizeDeliveryDaysList`, since the list becomes the model's whole answer
 * space (a JSON-schema enum / Decisions criteria) and must never be empty.
 */
export function sanitizeBidAmountFractions(
  values: readonly unknown[] | null | undefined
): string[] {
  if (!Array.isArray(values)) return [...DEFAULT_BID_AMOUNT_FRACTIONS];

  const cleaned: string[] = [];
  for (const value of values) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text.length === 0) continue;
    if (parseBidAmountFraction(text, 1) !== null) cleaned.push(text);
  }

  // De-dup case-insensitively while keeping the first-seen spelling.
  const seen = new Set<string>();
  const unique = cleaned.filter((text) => {
    const key = text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.length > 0 ? unique : [...DEFAULT_BID_AMOUNT_FRACTIONS];
}

/**
 * Turn one fraction/marker string into a concrete dollar value from the project's max
 * budget. Recognised forms:
 *   `"1/2"`        → half the max
 *   `"2/3"`        → two-thirds of the max
 *   `"full"`       → the entire max
 *   `"0.25"`       → 25% of the max (decimal multiplier, 0–1)
 *   `"0.5"`        → 50% of the max
 *   `"2"`          → 200% of the max (integer multiplier)
 *   `"0.8"`        → 80% of the max
 *
 * Returns null when the string is not a recognised form, or when the budget is
 * missing/zero (no basis to compute against).
 */
export function parseBidAmountFraction(
  text: string,
  budgetMaximum: number | null | undefined
): number | null {
  const trimmed = text.trim();
  if (typeof budgetMaximum !== "number" || budgetMaximum <= 0 || !Number.isFinite(budgetMaximum)) {
    return null;
  }

  if (trimmed.toLowerCase() === "full") {
    return Math.round(budgetMaximum);
  }

  // Fraction form: "X/Y"
  const match = /^(\d+)\/(\d+)$/.exec(trimmed);
  if (match !== null) {
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    if (denominator === 0 || numerator < 0 || numerator > denominator) return null;
    return Math.round((budgetMaximum * numerator) / denominator);
  }

  // Plain number form: decimal multiplier (0.25, 0.5) or integer multiplier (2, 3)
  const asNumber = Number(trimmed);
  if (
    typeof asNumber === "number" &&
    Number.isFinite(asNumber) &&
    asNumber > 0 &&
    /^\d+(\.\d+)?$/.test(trimmed)
  ) {
    return Math.round(budgetMaximum * asNumber);
  }

  return null;
}

/**
 * Extract a client-mentioned budget from the project description text. Looks
 * for patterns like "my max budget is $50", "budget: 500 USD", "I can pay up to
 * 500 dollars", etc. Only returns a value when it falls within the project's
 * stated budget range [minimum, maximum] — otherwise it could be a typo or a
 * different currency.
 */
export function extractClientMentionedBudget(
  description: string,
  budgetMinimum: number | null | undefined,
  budgetMaximum: number | null | undefined
): number | null {
  if (!description || (!budgetMinimum && !budgetMaximum)) return null;

  // Match dollar amounts: $50, 50 USD, 50 dollars, 50usd, etc.
  const regex = /\$?(\d{1,4}(?:[.,]\d{0,2})?)\s*(?:USD|usd|dollars|dollar|dls|dl)?/gi;
  let match: RegExpExecArray | null;
  const candidates: number[] = [];

  while ((match = regex.exec(description)) !== null) {
    const raw = match[1];
    if (raw === undefined) continue;
    const value = Number(raw.replace(/[,.]/g, ""));
    if (Number.isFinite(value) && value > 0) {
      candidates.push(value);
    }
  }

  if (candidates.length === 0) return null;

  // Find the candidate that falls within the project's budget range.
  const min = budgetMinimum ?? 0;
  const max = budgetMaximum ?? Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate >= min && candidate <= max && candidate > 0) {
      return Math.round(candidate);
    }
  }

  return null;
}

/**
 * Compute the concrete dollar values offered to the gate from the user's
 * fraction list and the project's max budget. Returns null (meaning "no bid
 * question") when the budget is missing/unusable or nothing survives parsing.
 *
 * When `clientMentionedBudget` is provided and falls within the project's
 * budget range, it is appended as an explicit target option the AI can pick
 * (e.g. if the client says "max budget $50" and the project is $30–$250,
 * $50 becomes a choice alongside the fraction-derived values).
 */
export function resolveBidAmountOptions(
  fractions: string[],
  budgetMaximum: number | null | undefined,
  clientMentionedBudget?: number | null
): number[] | null {
  if (typeof budgetMaximum !== "number" || budgetMaximum <= 0) return null;
  const values: number[] = [];
  for (const fraction of fractions) {
    const value = parseBidAmountFraction(fraction, budgetMaximum);
    if (value !== null) values.push(value);
  }

  // Add the client-mentioned budget as an explicit option if it hasn't
  // already been produced by a fraction and falls in a sensible range.
  if (
    typeof clientMentionedBudget === "number" &&
    Number.isFinite(clientMentionedBudget) &&
    clientMentionedBudget > 0 &&
    !values.includes(clientMentionedBudget)
  ) {
    values.push(clientMentionedBudget);
  }

  return values.length > 0 ? values : null;
}

/**
 * Read the bid-amount settings for a user. A pure DB read: defaults when no row
 * exists (the user has never opened Automation, so AI selection is off — also
 * the pre-feature behavior).
 */
export function getBidAmountSettings(userId: string): BidAmountSettings {
  if (userId.length === 0) return DEFAULT_BID_AMOUNT_SETTINGS;

  const row = getDb()
    .select({
      aiBidAmount: automationSettings.aiBidAmount,
      bidAmountFractions: automationSettings.bidAmountFractions,
      bidAmountInstructions: automationSettings.bidAmountInstructions,
      defaultBidMarkupPct: automationSettings.defaultBidMarkupPct,
      bidAmountMarkupInstructions: automationSettings.bidAmountMarkupInstructions,
      roundBidUpTo: automationSettings.roundBidUpTo,
    })
    .from(automationSettings)
    .where(eq(automationSettings.userId, userId))
    .get();

  if (row === undefined) return DEFAULT_BID_AMOUNT_SETTINGS;

  const instructions = (row.bidAmountInstructions ?? "").trim();
  const markupInstructions = (row.bidAmountMarkupInstructions ?? "").trim();

  return {
    aiBidAmount: row.aiBidAmount === 1,
    bidAmountFractions: sanitizeBidAmountFractions(
      parseStoredJsonArray(row.bidAmountFractions)
    ),
    bidAmountInstructions:
      instructions.length > 0 ? instructions : DEFAULT_BID_AMOUNT_INSTRUCTIONS,
    defaultBidMarkupPct: clampMarkupPct(row.defaultBidMarkupPct),
    bidAmountMarkupInstructions:
      markupInstructions.length > 0
        ? markupInstructions
        : DEFAULT_BID_AMOUNT_MARKUP_INSTRUCTIONS,
    roundBidUpTo: clampRoundUpTo(row.roundBidUpTo),
  };
}

/**
 * Clamp the round-up setting: must be a non-negative integer. 0 or 1 = no rounding.
 */
function clampRoundUpTo(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_BID_AMOUNT_ROUND_UP_TO;
  }
  return Math.max(0, Math.round(value));
}

/**
 * Round a dollar amount to the nearest multiple of `step`. When `step` is 0
 * or 1, the value is returned unchanged (no rounding). E.g. step=10 rounds
 * $563 → $560, $567 → $570.
 */
export function roundUpToStep(value: number, step: number): number {
  if (step <= 1) return value;
  return Math.round(value / step) * step;
}

/** Clamp a stored markup percentage to [0, 100], defaulting to 0 on bad input. */
function clampMarkupPct(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BID_AMOUNT_MARKUP_PCT;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Parse the options column (JSON array in TEXT), tolerating anything. */
function parseStoredJsonArray(raw: string | null): unknown[] | null {
  if (raw === null || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Compute the default bid amount from the project's budget window and a markup
 * percentage. The result is `minimum + (maximum × markupPct / 100)`, rounded to
 * the nearest dollar. When `maximumBudget` is missing or non-positive it is
 * treated as 0, so a 0% markup returns exactly the minimum — reproducing the
 * original behaviour where auto-bid priced off the bare minimum.
 */
export function resolveDefaultBidAmount(
  minimumBudget: number,
  maximumBudget: number | null | undefined,
  markupPct: number
): number {
  const pct = Math.max(0, Math.min(100, markupPct));
  const max =
    typeof maximumBudget === "number" &&
    maximumBudget > 0 &&
    Number.isFinite(maximumBudget)
      ? maximumBudget
      : 0;
  return Math.round(minimumBudget + (max * pct) / 100);
}

/**
 * The bid amount to submit for one job.
 *
 * The gate's per-project pick wins only when the feature is on AND it actually
 * produced a value for this job. That pick is clamped up to at least
 * `minimumBudget` so the AI can never produce a bid Freelancer.com would reject
 * (it rejects anything below the project's stated minimum). Every other case
 * falls back to the default markup rule: the project minimum plus a percentage
 * of the project maximum, clamped to the user's `[minBid, maxBid]` bounds — so
 * the bid is never blocked by a missing amount and auto-bid still has
 * `minimumBudget` to price from. Finally, for fixed-price projects only, the
 * result is rounded to the nearest multiple of `roundBidUpTo` (when > 1).
 * Hourly projects skip rounding so the hourly rate precision is preserved.
 */
export function resolveBidAmount(
  settings: Pick<
    BidAmountSettings,
    "aiBidAmount" | "defaultBidMarkupPct" | "roundBidUpTo"
  > &
    Pick<AutomationSettingsShape, "minBid" | "maxBid">,
  jobBidAmount: number | null | undefined,
  minimumBudget: number,
  maximumBudget: number | null | undefined,
  projectType?: string | null
): number {
  let amount: number;
  if (
    settings.aiBidAmount &&
    typeof jobBidAmount === "number" &&
    Number.isFinite(jobBidAmount) &&
    jobBidAmount > 0
  ) {
    // Guard: never let the AI pick below the project's minimum budget —
    // Freelancer.com rejects bids below it.
    amount = Math.round(Math.max(minimumBudget, jobBidAmount));
  } else {
    amount = resolveDefaultBidAmount(
      minimumBudget,
      maximumBudget,
      settings.defaultBidMarkupPct
    );
  }
  const clamped = Math.max(settings.minBid, Math.min(settings.maxBid, amount));
  // Only round fixed-price projects; hourly projects use exact amounts.
  if (projectType === "fixed") {
    return roundUpToStep(clamped, settings.roundBidUpTo);
  }
  return clamped;
}

/** Minimal shape of the automation bounds used by `resolveBidAmount`. */
interface AutomationSettingsShape {
  minBid: number;
  maxBid: number;
  defaultBidMarkupPct: number;
}
