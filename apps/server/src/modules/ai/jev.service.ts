/**
 * Jev (TypeSafe "System One" decision model) as the relevance-gate engine.
 *
 * Jev is a decision model, not a chat model: it takes a `state` plus typed
 * `questions` and returns typed probabilistic answers. It cannot generate text.
 * OpenRouter exposes it on a separate Decisions endpoint rather than
 * `/chat/completions`, so this module carries its own transport and reuses the
 * user's existing OpenRouter key — no extra credential is involved.
 *
 * The gate returns the same `RelevancyCheck` shape the LLM gate does
 * (`{score, reason}`), so the caller in `jobs.service.ts` is engine-agnostic.
 * Jev supplies the score; the human-readable reason is rendered here from a
 * `choice` answer over a fixed factor list, because the model cannot write one.
 */

import { eq } from "drizzle-orm";

import { decrypt } from "../../lib/crypto.js";
import { getDb } from "../../db/index.js";
import { platformCredentials } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import type {
  BidAmountRequest,
  DeliveryTimelineRequest,
  RelevancyCheck,
  RelevancyPromptData,
} from "./ai.service.js";

const log = createLogger("analysis");

/** Model id used when the user has not picked a Jev model. */
export const JEV_DEFAULT_MODEL = "typesafe/jev-1.13";

const JEV_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

/**
 * The gate is a single forward pass (70–500ms in practice), so a short budget
 * is plenty. A timeout falls back to the LLM gate rather than stalling the
 * pipeline.
 */
const JEV_TIMEOUT_MS = 30_000;

/** Whether the relevance gate runs on the chat model or on Jev. */
export type AnalysisEngine = "llm" | "jev";

/** Read the configured gate engine. Absent means "llm" (pre-Jev installs). */
export function readAnalysisEngine(): AnalysisEngine {
  const row = getDb()
    .select({ meta: platformCredentials.meta })
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "openrouter"))
    .get();
  if (row === undefined) return "llm";
  return parseEngine(row.meta);
}

function parseEngine(raw: string | null): AnalysisEngine {
  if (raw === null) return "llm";
  try {
    const meta = JSON.parse(raw) as { analysisEngine?: unknown };
    return meta.analysisEngine === "jev" ? "jev" : "llm";
  } catch {
    return "llm";
  }
}

/** The Jev model id, falling back to the default when unset. */
export function readJevModel(): string {
  const row = getDb()
    .select({ meta: platformCredentials.meta })
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "openrouter"))
    .get();
  if (row === undefined || row.meta === null) return JEV_DEFAULT_MODEL;
  try {
    const meta = JSON.parse(row.meta) as { jevModelId?: unknown };
    return typeof meta.jevModelId === "string" && meta.jevModelId.trim().length > 0
      ? meta.jevModelId.trim()
      : JEV_DEFAULT_MODEL;
  } catch {
    return JEV_DEFAULT_MODEL;
  }
}

/* ------------------------------------------------------------------ *
 * Decisions API transport
 * ------------------------------------------------------------------ */

/**
 * A typed question for the Decisions API. Each question carries `instructions`
 * in plain language. `criteria` defines the answer space, and its SHAPE is
 * enforced by the API: `choice` takes an object of named options (they are
 * unordered), while `score` takes an ORDERED ARRAY of level descriptions and
 * rejects a score question without one.
 */
export type JevQuestion =
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string };

/** A `state` is an object of named inputs the model reasons over. */
export type JevState = Record<string, string>;

export interface JevUsage {
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface JevResponse {
  model?: string;
  provider?: string;
  usage?: JevUsage;
  answers?: Record<string, unknown>;
}

/**
 * One Decisions call. Pure transport — takes the plaintext key so the
 * credential tester in `testers.ts` can reuse it without touching the DB.
 */
export async function callJevApi(
  key: string,
  model: string,
  state: JevState,
  questions: Record<string, JevQuestion>,
  timeoutMs = JEV_TIMEOUT_MS
): Promise<JevResponse> {
  const response = await fetch(JEV_DECISIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://freelance-copilot.local",
      "X-Title": "Freelance Copilot",
    },
    body: JSON.stringify({ model, state, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 401) {
    throw new AppError(401, "UNAUTHORIZED", "OpenRouter key was rejected");
  }
  if (response.status === 429) {
    throw new AppError(429, "RATE_LIMITED", "Jev rate limit exceeded");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Jev responded with status ${response.status}: ${text.slice(0, 200)}`
    );
  }

  const body = (await response.json()) as JevResponse;
  if (body.answers === undefined || typeof body.answers !== "object") {
    throw new AppError(502, "UPSTREAM_ERROR", "Jev returned no answers");
  }
  return body;
}

/* ------------------------------------------------------------------ *
 * The gate itself
 * ------------------------------------------------------------------ */

/**
 * Fixed set of deciding factors. Jev picks one; we render the sentence. Keeping
 * the vocabulary closed means the reason stays honest (the model classifies, it
 * does not write) and every factor maps to wording we control.
 */
export const JEV_DECIDING_FACTORS = [
  "good_fit",
  "skill_gap",
  "budget_below_rate",
  "client_untrusted",
  "too_many_bids",
  "needs_signature",
  "unclear_scope",
] as const;

export type JevDecidingFactor = (typeof JEV_DECIDING_FACTORS)[number];

const FACTOR_REASONS: Record<JevDecidingFactor, string> = {
  good_fit: "Strong match with your profile skills.",
  skill_gap: "Requires skills that are not on your profile.",
  budget_below_rate: "Budget looks below your hourly rate.",
  client_untrusted:
    "Client trust signals are weak — payment unverified with no deposit history.",
  too_many_bids: "Heavy competition — many bids already placed.",
  needs_signature: "NDA or IP-contract project, which needs a signature to bid.",
  unclear_scope: "Scope is too vague to judge confidently.",
};

/** Plain-language definitions shown to the model for each choice option. */
const FACTOR_CRITERIA: Record<JevDecidingFactor, string> = {
  good_fit: "The job matches the freelancer's skills and stated preferences well.",
  skill_gap: "The job needs skills the freelancer's profile does not list.",
  budget_below_rate: "The budget is too low for the freelancer's hourly rate.",
  client_untrusted:
    "The client looks untrustworthy: payment unverified, or a new account with no deposit or upgrades.",
  too_many_bids: "The project already has so many bids that winning is unlikely.",
  needs_signature: "The project carries an NDA or IP-contract upgrade.",
  unclear_scope: "The description is too vague to judge fit or risk.",
};

/**
 * Pre-computed bid-volume band. Jev is reported to be weak with raw numbers, so
 * the count is classified here rather than left for the model to compare.
 */
function bidVolumeLabel(count: number | undefined): string {
  if (count === undefined) return "unknown";
  if (count === 0) return "none";
  if (count <= 5) return "low";
  if (count <= 15) return "moderate";
  if (count <= 30) return "high";
  return "very high";
}

/** Whether the project carries an upgrade that needs a signature to bid. */
function requiresSignature(upgrades: RelevancyPromptData["client"]): boolean {
  const flags = upgrades?.upgrades ?? [];
  return flags.some((u) => {
    const value = u.toLowerCase();
    return value.includes("nda") || value.includes("ip contract");
  });
}

function yesNo(value: boolean | null | undefined): string {
  return value === true ? "Yes" : value === false ? "No" : "Unknown";
}

/**
 * Build the `state` for the gate. Everything is a string, and every comparison
 * the model would otherwise have to do on numbers is resolved here first.
 */
export function buildJevState(data: RelevancyPromptData): JevState {
  const client = data.client;
  return {
    user_summary: data.userSummary?.trim() || "No user summary provided.",
    relevancy_instructions: data.relevancyInstructions?.trim() || "None.",
    job_title: data.jobTitle,
    job_description: data.jobDescription.join("\n"),
    client_country: client?.country ?? "Unknown",
    client_payment_verified: yesNo(client?.paymentVerified),
    client_email_verified: yesNo(client?.emailVerified),
    client_deposit_made: yesNo(client?.depositMade),
    client_account_age: client?.accountAgeLabel ?? "Unknown",
    client_reputation: client?.reputationLabel ?? "Unknown",
    client_upgrades: client?.upgrades?.length ? client.upgrades.join(", ") : "none",
    budget: data.budgetLabel ?? "Not specified",
    project_type: data.projectType ?? "Unknown",
    bid_count: String(data.bidCount ?? 0),
    bid_volume: bidVolumeLabel(data.bidCount),
    requires_signature: requiresSignature(client) ? "Yes" : "No",
    client_requested_deadline: data.bidPeriod
      ? `${data.bidPeriod} days`
      : "Not specified",
  };
}

/**
 * The ordered answer scale for the score question, worst first.
 *
 * A `score` question is answered as a POSITION on this list, not as a 0–100
 * number: with six levels the answer runs from 0 to 5, and 1.99 sits almost
 * exactly on the third level. The bands the rest of the app depends on
 * (`RELEVANCE_IGNORE_FLOOR` at 50, `minMatchScore` at 80) therefore have to sit
 * on level boundaries, which is why there are six evenly spaced levels: index 3
 * is the manual-review band, index 4 the lowest level eligible for automatic
 * bidding. See `scoreFromLevelIndex` for the conversion back to 0–100.
 */
export const JEV_SCORE_LEVELS = [
  "Unusable — the work is outside the freelancer's skills entirely, or the client shows clear red flags (spam, a scam, or a request for unpaid work).",
  "Poor fit — most of the required skills are missing from the freelancer's profile.",
  "Weak — some overlap, but the core skills or the budget are wrong for this freelancer.",
  "Borderline, worth a human look and never automatic bidding — the fit is reasonable but the client's payment is unverified, or the paid signals (Recruiter, NDA, IP-contract) do not make up for thin trust.",
  "Strong — the skills match well AND the client's payment is verified. This is the lowest level eligible for automatic bidding.",
  "Ideal — an excellent skills match, a fully trusted client (payment verified, established account, good reputation) and a budget at or above the freelancer's rate.",
] as const;

/**
 * Framing for the score question. The bands themselves live in the level
 * descriptions above; this carries only the rules that cut across them.
 */
const SCORE_INSTRUCTIONS = `How worth the freelancer's time is this job, placed on the scale of levels below. Weigh profile fit together with client trustworthiness, and never place a job higher than its client trustworthiness allows: unverified payment holds a job at the borderline level unless the project carries real paid signals, and an NDA or IP-contract project is never eligible for automatic bidding. Account age is one factor among several, never a rule on its own, and a short description is not a reason to reject a job. The freelancer's own relevancy instructions override all of the above.`;

/**
 * The gate's score question. Exported so the connectivity probe in `testers.ts`
 * sends the exact shape the gate depends on — a probe that exercises a simpler
 * question would report success while every real screening call fails.
 */
export const JEV_SCORE_QUESTION: JevQuestion = {
  type: "score",
  instructions: SCORE_INSTRUCTIONS,
  criteria: [...JEV_SCORE_LEVELS],
};

/* ------------------------------------------------------------------ *
 * Delivery timeline question
 * ------------------------------------------------------------------ */

/**
 * Task-size wording for the timeline choice, smallest first. The user chooses
 * which day values are on offer, so these are spread across whatever list they
 * configured by position rather than tied to specific numbers — the same
 * even-spacing idea as `JEV_SCORE_LEVELS`, and the reason a custom list like
 * 2/4/6 still gets sensible per-option wording.
 */
const DELIVERY_SIZE_LABELS = [
  "A small, well-defined task — a bug fix, a small script, one page, or a simple integration.",
  "A modest task with a few parts — a small feature, a handful of components, or a light integration.",
  "A medium task — a full small app, several screens, or an integration that needs testing.",
  "A substantial task — a complete feature set or app with several moving parts.",
  "A large task — multi-part scope, multiple integrations, or requirements needing clarification.",
];

/** The size wording for option `index` of `count`, spread across the labels. */
function deliverySizeLabel(index: number, count: number): string {
  if (count < 2) return DELIVERY_SIZE_LABELS[2]!;
  const position = Math.round((index / (count - 1)) * (DELIVERY_SIZE_LABELS.length - 1));
  return DELIVERY_SIZE_LABELS[position]!;
}

/**
 * The timeline question, or null when there is nothing valid to ask.
 *
 * A `choice` question is answered by KEY, and the keys here ARE the day values —
 * so the answer converts straight to a number with no lookup table that could
 * drift out of step with the user's edited list.
 */
export function buildDeliveryPeriodQuestion(
  timeline: DeliveryTimelineRequest
): JevQuestion | null {
  const options = [...new Set(timeline.options)]
    .filter((days) => Number.isInteger(days) && days > 0)
    .sort((a, b) => a - b);
  if (options.length === 0) return null;

  const criteria: Record<string, string> = {};
  options.forEach((days, index) => {
    criteria[String(days)] = `${deliverySizeLabel(index, options.length)} Roughly ${days} day${days === 1 ? "" : "s"}.`;
  });

  return {
    type: "choice",
    instructions: `${timeline.instructions}\n\nWhich single delivery time should be quoted for this project, in days? Choose exactly one of the offered values.`,
    criteria,
  };
}

/**
 * Read a `choice` answer as one of `allowed`. Mirrors how the deciding factor is
 * read (the key sits on the answer object; a bare string is tolerated in case
 * the probabilities wrapper is dropped). Null when the answer is missing or is
 * not one of the offered keys — a bad timeline must never fail the gate.
 */
export function readAnswerChoice(
  answer: unknown,
  allowed: readonly string[]
): string | null {
  const obj =
    answer !== null && typeof answer === "object"
      ? (answer as Record<string, unknown>)
      : {};
  const candidate = obj["choice"] ?? answer;
  return typeof candidate === "string" && allowed.includes(candidate)
    ? candidate
    : null;
}

/**
 * The full question set the gate sends: the two it always asks, plus the
 * timeline question when the user has that on. Exported so `testers.ts` probes
 * with the gate's own request — the failure that shape-checking exists to catch
 * is one where the probe passes and every real screening call is rejected.
 */
/**
 * Build the bid-amount question, or null when there is nothing valid to ask.
 *
 * A `choice` question is answered by KEY, and the keys here ARE the dollar values
 * — so the answer converts straight to a number with no lookup table that could
 * drift out of step with the user's edited fraction list.
 */
export function buildBidAmountQuestion(
  bidAmount: BidAmountRequest
): JevQuestion | null {
  const options = [...new Set(bidAmount.options)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
  if (options.length === 0) return null;

  const criteria: Record<string, string> = {};
  options.forEach((value) => {
    criteria[String(value)] = `Quote $${value} for this project.`;
  });

  return {
    type: "choice",
    instructions: `${bidAmount.instructions}\n\nWhich single bid amount should be quoted for this project, in dollars? Choose exactly one of the offered values.`,
    criteria,
  };
}

export function buildJevGateQuestions(
  timeline?: DeliveryTimelineRequest,
  bidAmount?: BidAmountRequest
): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {
    score: JEV_SCORE_QUESTION,
    deciding_factor: {
      type: "choice",
      instructions:
        "Which single factor most determined the score you just gave? Choose exactly one.",
      criteria: FACTOR_CRITERIA,
    },
  };

  if (timeline !== undefined) {
    const question = buildDeliveryPeriodQuestion(timeline);
    if (question !== null) {
      questions["delivery_period"] = question;
    }
  }

  if (bidAmount !== undefined) {
    const question = buildBidAmountQuestion(bidAmount);
    if (question !== null) {
      questions["bid_amount"] = question;
    }
  }

  return questions;
}

/** Run the relevance gate on Jev and return the shared `RelevancyCheck` shape. */
export async function checkRelevancyWithJev(
  data: RelevancyPromptData,
  timeline?: DeliveryTimelineRequest,
  bidAmount?: BidAmountRequest
): Promise<RelevancyCheck> {
  const credRow = getDb()
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "openrouter"))
    .get();

  if (credRow === undefined) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Save an OpenRouter API key first (Platforms page)"
    );
  }

  const model = readJevModel();
  const questions = buildJevGateQuestions(timeline, bidAmount);
  const response = await callJevApi(
    decrypt(credRow),
    model,
    buildJevState(data),
    questions
  );

  const { score, factor, confidence, deliveryDays, bidAmount: chosenBidAmount } =
    validateJevGateOutput(
      response,
      timeline === undefined ? null : timeline.options,
      bidAmount === undefined ? null : bidAmount.options
    );

  const timelineNote =
    deliveryDays !== undefined && deliveryDays !== null
      ? ` timeline=${deliveryDays}d`
      : "";
  const bidNote =
    chosenBidAmount !== undefined && chosenBidAmount !== null
      ? ` bid=$${chosenBidAmount}`
      : "";

  if (response.usage?.cost !== undefined) {
    log.info(
      `Jev gate: score=${score} factor=${factor}${timelineNote}${bidNote} (model: ${model}, cost: $${response.usage.cost})`,
      { jobTitle: data.jobTitle }
    );
  } else {
    log.info(
      `Jev gate: score=${score} factor=${factor}${timelineNote}${bidNote} (model: ${model})`,
      { jobTitle: data.jobTitle }
    );
  }
  if (confidence !== null && confidence < 0.5) {
    log.warn(
      `Jev gate picked "${factor}" with low confidence (${confidence}) — worth a look`,
      { jobTitle: data.jobTitle }
    );
  }

  // A missing timeline or bid amount is not a failure: the bid falls back to the
  // user's preferred delivery time / minimum budget. Only the score and reason
  // are load-bearing.
  const result: RelevancyCheck = { score, reason: FACTOR_REASONS[factor] };
  if (deliveryDays !== undefined) {
    result.deliveryDays = deliveryDays;
  }
  if (chosenBidAmount !== undefined) {
    result.bidAmount = chosenBidAmount;
  }
  return result;
}

/**
 * Read the numeric position out of an answer. A `score` answer arrives as an
 * object (`{type, score, probabilities, confidence, legend}`), so its `score`
 * key is what is read; a bare number is tolerated so a minor response-shape
 * change does not break the gate. `noul` is deliberately NOT accepted — reading
 * a 0-1 yes-probability as a scale position would silently mis-score.
 */
function readAnswerNumber(answer: unknown): number | null {
  if (typeof answer === "number") return Number.isFinite(answer) ? answer : null;
  if (answer !== null && typeof answer === "object") {
    const obj = answer as Record<string, unknown>;
    for (const key of ["score", "value"]) {
      const candidate = obj[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Convert Jev's position on the level scale into the 0–100 score the rest of
 * the app uses. The levels are evenly spaced, so the position maps straight
 * across: with six levels, 0 → 0, 3 → 60, 4 → 80, 5 → 100.
 *
 * This step is what keeps Jev's answer on the same scale as
 * `automationSettings.minMatchScore` and `RELEVANCE_IGNORE_FLOOR`. Treating the
 * position as if it were already 0–100 would score a perfect job at about 5.
 */
export function scoreFromLevelIndex(index: number, levelCount: number): number {
  if (levelCount < 2) {
    throw new AppError(
      500,
      "INTERNAL",
      "The Jev score scale needs at least two levels"
    );
  }
  // A position outside the scale is a broken answer, not a rounding artifact.
  if (!Number.isFinite(index) || index < 0 || index > levelCount - 1) {
    throw new AppError(
      500,
      "INTERNAL",
      `Jev score ${index} is outside the 0-${levelCount - 1} level scale`
    );
  }
  return Math.round((index / (levelCount - 1)) * 100);
}

/** The gate's 0–100 score from a Jev response, or a throw if it is unusable. */
export function readJevScore(response: JevResponse): number {
  const raw = readAnswerNumber(response.answers?.["score"]);
  if (raw === null) {
    throw new AppError(
      500,
      "INTERNAL",
      `Jev score is missing or not a number: ${JSON.stringify(response.answers?.["score"])}`
    );
  }
  return scoreFromLevelIndex(raw, JEV_SCORE_LEVELS.length);
}

export interface JevGateResult {
  score: number;
  factor: JevDecidingFactor;
  /** The model's own confidence in its choice, when it reports one. */
  confidence: number | null;
  /**
   * The delivery time (days) chosen, when a timeline question was asked. Absent
   * when the feature is off; null when it was asked but the answer was unusable.
   */
  deliveryDays?: number | null;
  /**
   * The bid amount (dollars) chosen, when a bid-amount question was asked. Absent
   * when the feature is off; null when it was asked but the answer was unusable.
   */
  bidAmount?: number | null;
}

function isDecidingFactor(value: unknown): value is JevDecidingFactor {
  return (
    typeof value === "string" &&
    (JEV_DECIDING_FACTORS as readonly string[]).includes(value)
  );
}

/**
 * Validate a Jev gate response before any of it reaches application logic.
 * Anything unusable throws, which is what sends the caller to the LLM fallback.
 *
 * `deliveryDayOptions`, when given, means a timeline question was asked: the
 * answer is read and kept only if it is one of the offered values. An unusable
 * timeline yields null instead of throwing — it has a safe fallback (the user's
 * preferred delivery time), and losing a whole screening over it would be worse.
 */
export function validateJevGateOutput(
  response: JevResponse,
  deliveryDayOptions?: readonly number[] | null,
  bidAmountOptions?: readonly number[] | null
): JevGateResult {
  const answers = response.answers ?? {};

  // Jev answers with a position on the level scale, converted to 0-100 here.
  const score = readJevScore(response);

  const factorAnswer = answers["deciding_factor"];
  const factorObj =
    factorAnswer !== null && typeof factorAnswer === "object"
      ? (factorAnswer as Record<string, unknown>)
      : {};
  // A bare string is accepted too, in case the endpoint returns the choice
  // without its probabilities wrapper.
  const factor = isDecidingFactor(factorObj["choice"])
    ? factorObj["choice"]
    : isDecidingFactor(factorAnswer)
      ? factorAnswer
      : null;

  if (factor === null) {
    throw new AppError(
      500,
      "INTERNAL",
      `Jev deciding factor is missing or not one of the known factors: ${JSON.stringify(factorAnswer)}`
    );
  }

  const rawConfidence = factorObj["confidence"];
  const confidence =
    typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
      ? rawConfidence
      : null;

  const base: JevGateResult = { score, factor, confidence };

  if (
    (deliveryDayOptions === undefined || deliveryDayOptions === null) &&
    (bidAmountOptions === undefined || bidAmountOptions === null)
  ) {
    return base;
  }

  const result: JevGateResult = { ...base };

  if (deliveryDayOptions !== undefined && deliveryDayOptions !== null) {
    const chosen = readAnswerChoice(
      answers["delivery_period"],
      deliveryDayOptions.map(String)
    );
    result.deliveryDays = chosen === null ? null : Number(chosen);
  }

  if (bidAmountOptions !== undefined && bidAmountOptions !== null) {
    const chosen = readAnswerChoice(
      answers["bid_amount"],
      bidAmountOptions.map(String)
    );
    result.bidAmount = chosen === null ? null : Number(chosen);
  }

  return result;
}
