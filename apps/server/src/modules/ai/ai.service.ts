import { AppError } from "../../lib/errors.js";
import { decrypt } from "../../lib/crypto.js";
import { getDb } from "../../db/index.js";
import { platformCredentials, userProfile } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { createLogger } from "../../lib/logger.js";
import { applyRelevancyFilter } from "./relevancy.js";
import { checkRelevancyWithJev, readAnalysisEngine } from "./jev.service.js";
import { getProfile } from "../profile/profile.service.js";

const log = createLogger("analysis");

/** The model we use when the user has not picked one. */
const DEFAULT_MODEL = "openai/gpt-4o-mini";


/**
 * Output-token cap for the fast relevance gate (Model A). It returns one score
 * plus a short reason, so a generous-but-finite cap stops a verbose model from
 * padding the bill on what is meant to be a cheap call.
 */
const RELEVANCE_MAX_TOKENS = 500;

/** Output-token cap for the full job analysis. Bounds the deep-analysis call. */
const ANALYSIS_MAX_TOKENS = 1000;

/**
 * OpenAI-style `response_format` that asks the provider to enforce a JSON
 * schema on the reply (structured outputs). The user's analysis model supports
 * it; models without `response_format` support are handled by NOT sending one
 * (proposal calls stay free-form, and the two analysis calls below opt in via
 * these constants).
 */
export interface JsonSchemaResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    strict: boolean;
    schema: Record<string, unknown>;
  };
}

/** Build a strict JSON-schema response_format. */
function jsonSchemaResponseFormat(
  name: string,
  schema: Record<string, unknown>
): JsonSchemaResponseFormat {
  return { type: "json_schema", json_schema: { name, strict: true, schema } };
}

/**
 * Output contract for the fast relevance gate (Model A). Guarantees the model
 * emits exactly {score: 0-100 integer, reason: short string} and nothing else,
 * so the gate decision never has to be recovered from prose.
 *
 * `deliveryDays` is added only when the user has AI timeline selection on (see
 * `buildRelevancyResponseFormat`). `additionalProperties: false` means the
 * property must be absent from the schema when the feature is off, not merely
 * left unrequested — so the schema is built per call rather than shared.
 */
export function buildRelevancyResponseFormat(
  deliveryDayOptions: number[] | null,
  bidAmountOptions: number[] | null = null
): JsonSchemaResponseFormat {
  const properties: Record<string, unknown> = {
    score: {
      type: "integer",
      description:
        "0-100. How worth pursuing this job is, combining profile fit with client trustworthiness.",
    },
    reason: {
      type: "string",
      description: "One short sentence (under 25 words) naming the single deciding factor.",
    },
  };
  const required = ["score", "reason"];

  if (deliveryDayOptions !== null && deliveryDayOptions.length > 0) {
    properties["deliveryDays"] = {
      type: "integer",
      enum: deliveryDayOptions,
      description:
        "Delivery time to quote, in days. Pick the SHORTEST value you can honestly commit to for this project's actual scope.",
    };
    required.push("deliveryDays");
  }

  // The bid-amount question is asked only when the user turned it on AND the
  // project has a usable maximum budget. The schema enum carries the concrete
  // dollar values the model may pick from (computed from its fraction list at
  // screening time), so a chosen value is always a number auto-bid can send.
  if (bidAmountOptions !== null && bidAmountOptions.length > 0) {
    properties["bidAmount"] = {
      type: "integer",
      enum: bidAmountOptions,
      description:
        "Bid amount to quote, in dollars. Choose the value that best matches the actual scope and the client's budget window.",
    };
    required.push("bidAmount");
  }

  return jsonSchemaResponseFormat("relevancy_check", {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  });
}

/** The gate's schema with no timeline question — the pre-feature behavior. */
export const RELEVANCY_RESPONSE_FORMAT: JsonSchemaResponseFormat =
  buildRelevancyResponseFormat(null);

/**
 * Output contract for the deep job analysis. Mirrors AnalysisResult so every
 * required field is present and correctly typed before the code ever reads it.
 */
export const ANALYSIS_RESPONSE_FORMAT: JsonSchemaResponseFormat = jsonSchemaResponseFormat(
  "job_analysis",
  {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["strong", "good", "fair"] },
      score: { type: "integer", description: "0-100 overall quality of the opportunity." },
      summary: { type: "string", description: "2-3 sentences on why it does or does not fit." },
      reasons: {
        type: "array",
        items: { type: "string" },
        description: "Why the job matches the profile.",
      },
      concerns: {
        type: "array",
        items: { type: "string" },
        description: "Risks or gaps, e.g. missing skills or client concerns.",
      },
      recommendedBidLabel: { type: "string", description: "Suggested bid amount or range." },
      competitorNote: { type: "string", description: "Brief note on the competition." },
    },
    required: [
      "verdict",
      "score",
      "summary",
      "reasons",
      "concerns",
      "recommendedBidLabel",
      "competitorNote",
    ],
  }
);

interface CredentialMeta {
  /** Legacy single model selection — fallback for both roles. */
  modelId?: string;
  /** Model used for relevance screening / analysis (Model A). */
  analysisModelId?: string;
  /** Model used for proposal writing (Model B). */
  proposalModelId?: string;
  lastTestMessage?: string;
  usage?: { label: string; used: number; limit: number };
}

function parseMeta(raw: string | null): CredentialMeta {
  if (raw === null) return {};
  try {
    return JSON.parse(raw) as CredentialMeta;
  } catch {
    return {};
  }
}

/**
 * Read the user's saved OpenRouter credential and return the model for a
 * given role, falling back to the legacy single `modelId` then the default.
 * Returns `null` if no credential is stored at all (caller decides how to
 * react).
 */
function readModel(get: (meta: CredentialMeta) => string | undefined): string | null {
  const row = getDb()
    .select({ meta: platformCredentials.meta })
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "openrouter"))
    .get();
  if (row === undefined) return null;
  const meta = parseMeta(row.meta);
  return get(meta) ?? meta.modelId ?? null;
}

/** Model for relevance screening / analysis — the cheap, fast one. */
function readAnalysisModel(): string | null {
  return readModel((m) => m.analysisModelId);
}

/** Model for proposal writing — the strong one. */
function readProposalModel(): string | null {
  return readModel((m) => m.proposalModelId);
}

export interface ProjectUpgrades {
  featured?: boolean;
  urgent?: boolean;
  sealed?: boolean;
}

export interface CompetitionData {
  bidCount: number;
  minBid: number | null;
  maxBid: number | null;
  medianBid: number | null;
  isCheapest: boolean;
}

export interface AnalysisPrompt {
  jobTitle: string;
  jobDescription: string[];
  skills: string[];
  profileSkills: string[];
  wants: string[];
  notWants: string[];
  hourlyRate?: string | null;
  budgetLabel?: string;
  clientName?: string;
  bidCount?: number;
  avgBid?: string;
  /** Project billing type: "fixed" | "hourly". */
  projectType?: string | null;
  /** Bid period in days, if specified. */
  bidPeriod?: number | null;
  /** Upgrade flags (featured, urgent, sealed). */
  upgrades?: ProjectUpgrades;
  /** Aggregate competition data from stored bids, if fetched. */
  competition?: CompetitionData | null;
}

export interface AnalysisResult {
  verdict: "strong" | "good" | "fair";
  score: number;
  summary: string;
  reasons: string[];
  concerns: string[];
  recommendedBidLabel: string;
  competitorNote: string;
}

/**
 * Fast relevance gate (Model A). Kept intentionally small — output tokens cost
 * money on every analyzed job, so the model returns only a score and one short
 * reason. The score already folds in client trustworthiness (see the prompt
 * rubric); everything else is derived deterministically in code.
 */
export interface RelevancyCheck {
  /** 0–100: relevance combined with client trust. */
  score: number;
  /** One short sentence explaining the deciding factor. */
  reason: string;
  /**
   * Delivery time (days) the gate picked for this project, when the user has AI
   * timeline selection on. Absent or null means "no pick" — the bid then uses
   * the user's preferred delivery time.
   *
   * Optional on purpose: callers that never ask for a timeline must keep
   * getting exactly `{score, reason}`, so the field stays off the object rather
   * than being present-and-null.
   */
  deliveryDays?: number | null;
  /**
   * Bid amount the gate picked for this project, when the user has AI bid-amount
   * selection on and the project has a usable maximum budget. Absent or null
   * means "no pick" — auto-bid then prices off the minimum budget.
   *
   * Optional on purpose, mirroring `deliveryDays`: present only when a bid-amount
   * question was asked, so callers that never ask keep getting `{score, reason}`.
   */
  bidAmount?: number | null;
}

/** Client trust + project signals the relevance model should weigh. */
export interface RelevancyClientData {
  country?: string | null;
  paymentVerified: boolean | null;
  emailVerified: boolean | null;
  depositMade: boolean | null;
  /** Human label, e.g. "account is established (registered ~14 years ago)". */
  accountAgeLabel?: string;
  /** Human label, e.g. "5.0/5 from 10 ratings" or "no public rating history". */
  reputationLabel?: string;
  /** Human names of upgrades present, e.g. ["Recruiter", "NDA"]. */
  upgrades?: string[];
}

/** Inputs the relevance model sees: title, description, user summary, trust data. */
export interface RelevancyPromptData {
  jobTitle: string;
  jobDescription: string[];
  /** Verified user summary from the profile. */
  userSummary?: string | null;
  /** Free-text relevancy instructions, e.g. "no web3 or WordPress". */
  relevancyInstructions?: string | null;
  /** Client trust signals, if known. */
  client?: RelevancyClientData | null;
  /** Pre-formatted budget label, e.g. "$100 – $500". */
  budgetLabel?: string | null;
  /**
   * The project's maximum budget, when the project has one. The gate needs a
   * concrete number to compute bid-amount fraction options from. Absent means
   * "no bid-amount question".
   */
  budgetMaximum?: number | null;
  /** Project billing type: "fixed" | "hourly". */
  projectType?: string | null;
  bidCount?: number;
  /**
   * The delivery time the client themselves asked for, in days. The single
   * strongest signal for picking a timeline — a client who stated a deadline
   * should never be quoted longer than it.
   */
  bidPeriod?: number | null;
}

/** How the gate should pick a delivery timeline, when the user has it on. */
export interface DeliveryTimelineRequest {
  /** The closed list of day values the model may choose from. Never empty. */
  options: number[];
  /** The user's own guidance, already defaulted when they left it blank. */
  instructions: string;
}

/**
 * How the gate should pick a bid amount, when the user has it on. The
 * `options` are concrete dollar values (computed from the user's fraction list
 * × the project's max budget at screening time), so a choice is always a number
 * auto-bid can send straight to Freelancer.com.
 */
export interface BidAmountRequest {
  /** The closed list of dollar values the model may choose from. Never empty. */
  options: number[];
  /** The user's own guidance, already defaulted when they left it blank. */
  instructions: string;
}

/** Data needed to generate a proposal via AI. */
export interface ProposalPromptData {
  jobTitle: string;
  jobDescription: string[];
  skills: string[];
  bidCount?: number;
  avgBid?: string;
  highBid?: string;
  lowBid?: string;
  /** Project billing type: "fixed" | "hourly". */
  projectType?: string | null;
  /** Bid period in days, if specified. */
  bidPeriod?: number | null;
  /** Upgrade flags (featured, urgent, sealed). */
  upgrades?: ProjectUpgrades;
  /** Aggregate competition data from stored bids, if fetched. */
  competition?: CompetitionData | null;
  /** The user's saved profile facts (loaded server-side). */
  profile: {
    name: string | null;
    title: string | null;
    hourlyRate: string | null;
    about: string | null;
    skills: string[];
    experience: Array<{ role: string; company: string; periodLabel: string; summary?: string | null }>;
    portfolio: Array<{ title: string; url?: string | null; description?: string | null }>;
    certifications: string[];
    wants: string[];
    notWants: string[];
    customInstructions: string | null;
    userSummary?: string | null;
    /** Markdown summary of the user's portfolio projects. */
    portfolioSummary?: string | null;
    /** Markdown block holding all the user's proposal templates. */
    proposalTemplates?: string | null;
  };
  /** The AI analysis result for this job, if previously analyzed. */
  analysis?: {
    score: number;
    recommendedBidLabel: string;
    summary: string;
  } | null;
}

/**
 * Build the AI prompt for proposal generation using real profile facts, job
 * details, and competition context. The proposal must be grounded only in the
 * facts provided — never invent skills, experience, or client history.
 */
export function buildProposalPrompt(data: ProposalPromptData): string {
  const p = data.profile;
  const skillsText = p.skills.length ? p.skills.join(", ") : "No skills listed";
  const experienceLines = p.experience.length
    ? p.experience.map((e) => `  • ${e.role} at ${e.company} (${e.periodLabel})${e.summary ? ` — ${e.summary}` : ""}`).join("\n")
    : "  (No experience entries on file)";
  const portfolioLines = p.portfolio.length
    ? p.portfolio.map((item) => `  • "${item.title}"${item.description ? ` — ${item.description}` : ""}${item.url ? ` (${item.url})` : ""}`).join("\n")
    : "  (No portfolio items on file)";
  const certsText = p.certifications.length ? p.certifications.join(", ") : "None listed";
  const customInstr = p.customInstructions?.trim() || "No proposal instructions set.";
  const portfolioSummaryText = p.portfolioSummary?.trim() || "No portfolio summary provided.";
  const templatesText = p.proposalTemplates?.trim() || "No proposal templates provided.";

  const competitionLines: string[] = [];
  if (data.competition) {
    const parts = [
      `${data.competition.bidCount} bids`,
      data.competition.minBid !== null ? `lowest $${data.competition.minBid}` : null,
      data.competition.maxBid !== null ? `highest $${data.competition.maxBid}` : null,
      data.competition.medianBid !== null ? `median $${data.competition.medianBid}` : null,
    ].filter(Boolean);
    competitionLines.push(`Competition: ${parts.join(", ")}`);
    if (data.competition.isCheapest) competitionLines.push("You are currently the cheapest bidder.");
  }
  if (data.bidCount !== undefined) competitionLines.push(`Bid count: ${data.bidCount}`);
  if (data.projectType) competitionLines.push(`Project type: ${data.projectType}`);
  if (data.bidPeriod !== null && data.bidPeriod !== undefined)
    competitionLines.push(`Bid period: ${data.bidPeriod} days`);
  if (data.upgrades) {
    const flags = [];
    if (data.upgrades.featured) flags.push("Featured");
    if (data.upgrades.urgent) flags.push("Urgent");
    if (data.upgrades.sealed) flags.push("Sealed");
    if (flags.length > 0) competitionLines.push(`Upgrades: ${flags.join(", ")}`);
  }

  const contextBlock = competitionLines.length > 0 ? competitionLines.join("\n") : "No additional project context available.";
  const analysisBlock = data.analysis
    ? `AI Analysis (score ${data.analysis.score}/100): ${data.analysis.summary}\nSuggested bid: ${data.analysis.recommendedBidLabel}`
    : "No prior analysis available. Use the budget range to propose a competitive bid.";

  return `
You are a professional freelancer assistant writing a winning proposal. Use ONLY the verified facts below. Never invent skills, experience, portfolio items, certifications, previous work, or client history.

=== USER PROFILE (VERIFIED) ===
Name: ${p.name || "Not set"}
Title: ${p.title || "Not set"}
Hourly rate: ${p.hourlyRate || "Not set"}
About: ${p.about || "No description provided"}
Skills: ${skillsText}
Experience:
${experienceLines}
Portfolio:
${portfolioLines}
Certifications: ${certsText}
${p.userSummary ? `Profile summary: ${p.userSummary}` : ""}
Portfolio summary:
${portfolioSummaryText}

=== YOUR PROPOSAL INSTRUCTIONS (follow these for tone, content, pricing, and commitments) ===
${customInstr}

=== PROPOSAL TEMPLATES (reference these for tone and structure) ===
${templatesText}

=== JOB ===
Title: ${data.jobTitle}
Budget: ${data.bidCount !== undefined || data.avgBid ? `Bids: ${data.bidCount ?? "?"}, avg: ${data.avgBid ?? "?"}, range: ${data.highBid ?? "?"}–${data.lowBid ?? "?"}` : "Not specified"}

=== PROJECT CONTEXT ===
${contextBlock}

=== ANALYSIS ===
${analysisBlock}

=== JOB DESCRIPTION ===
${data.jobDescription.join("\n")}

=== INSTRUCTION ===
Write a proposal cover message that:
1. Shows the client you read their project description
2. Highlights 1–2 matching skills from YOUR profile that directly address their needs
3. References a specific relevant experience or portfolio item from your profile (if any exist)
4. Follows YOUR PROPOSAL INSTRUCTIONS above — including what you say about pricing, timeline, delivery, and any offers or commitments
5. Matches the tone and structure of the proposal templates provided (if any)
6. Stays grounded in the facts above — never invent skills, experience, portfolio items, certifications, previous work, or client history

Return ONLY the proposal text. Do not include headings, code blocks, or meta-commentary. Write it as the freelancer would send it on Freelancer.com.
`.trim();
}

/**
 * Build the AI analysis prompt using real profile facts, job details, and
 * competition context. Grounded only in the facts provided.
 */
export function buildAnalysisPrompt(data: AnalysisPrompt): string {
  const skillsList = data.profileSkills.join(", ");
  const wantsList = data.wants.length ? data.wants.join("; ") : "None specified";
  const notWantsList = data.notWants.length ? data.notWants.join("; ") : "None specified";

  // Build competition and project context lines.
  const compLines: string[] = [];
  if (data.competition) {
    compLines.push(
      `Competition: ${data.competition.bidCount} bids recorded, ` +
      `median $${data.competition.medianBid ?? "—"}, range $${data.competition.minBid ?? "—"}–$${data.competition.maxBid ?? "—"}`
    );
    if (data.competition.isCheapest) compLines.push(`You are currently the cheapest bidder.`);
  }
  if (data.projectType) compLines.push(`Project type: ${data.projectType}`);
  if (data.bidPeriod !== null && data.bidPeriod !== undefined) compLines.push(`Bid period: ${data.bidPeriod} days`);
  if (data.upgrades) {
    const flags = [];
    if (data.upgrades.featured) flags.push("Featured");
    if (data.upgrades.urgent) flags.push("Urgent");
    if (data.upgrades.sealed) flags.push("Sealed");
    if (flags.length > 0) compLines.push(`Upgrades: ${flags.join(", ")}`);
  }
  const contextLines = compLines.length > 0 ? compLines.join("\n") : "No additional project context available.";

  return `
You are an AI assistant helping a freelancer evaluate a job opportunity. Use ONLY the facts provided below — never invent skills, experience, or client history.

=== USER PROFILE ===
Skills: ${skillsList}
Wants: ${wantsList}
Not-wants: ${notWantsList}
Hourly rate: ${data.hourlyRate || "Not set"}

=== JOB DETAILS ===
Title: ${data.jobTitle}
Client: ${data.clientName || "Unknown"}
Skills required: ${data.skills.join(", ")}
Budget: ${data.budgetLabel || "Not specified"}
Bids: ${data.bidCount !== undefined ? data.bidCount : "Unknown"}, avg: ${data.avgBid || "Unknown"}

=== PROJECT CONTEXT ===
${contextLines}

=== JOB DESCRIPTION ===
${data.jobDescription.join("\n")}

=== INSTRUCTION ===
Analyze the job based ONLY on the facts above. Return a JSON object with exactly these keys:
- verdict: "strong" | "good" | "fair"
- score: number (0-100)
- summary: one-paragraph explanation
- reasons: array of strings (why it matches)
- concerns: array of strings (risks or gaps)
- recommendedBidLabel: string (suggested bid amount or range)
- competitorNote: string (brief note on competition based on bid stats)

Validate your output against the profile facts. If the user lacks required skills, say so. If budget is below their rate, flag it. Never invent previous work or client relationships.
`.trim();
}

/**
 * Optional transport control for an OpenRouter call. Analysis calls send a
 * bounded output so the model keeps its answer short and on-point; proposal
 * generation stays uncapped so long-form text is never truncated. Calls that
 * must return structured JSON (relevance gate, deep analysis) opt into
 * `responseFormat`, an enforced JSON schema; everything else stays plain text.
 */
export interface AiCallOptions {
  /** Hard cap on generated output tokens (`max_tokens`). */
  maxTokens?: number;
  /**
   * Provider-enforced JSON-schema response format. Only set this when the
   * selected model supports structured outputs AND the expected reply is an
   * object; sending it to a model without `response_format` support fails the
   * request (OpenRouter 400), so free-form calls must leave it undefined.
   */
  responseFormat?: JsonSchemaResponseFormat;
}

/**
 * Call OpenRouter using the user's saved API key and selected model.
 * `userPreferredModel` overrides the saved selection (used by the API route
 * to honor a per-request override if the UI ever needs it).
 */
export async function callOpenRouter(
  systemPrompt: string,
  userPrompt: string,
  userPreferredModel?: string,
  timeoutMs?: number,
  opts?: AiCallOptions
): Promise<string> {
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

  const plaintextKey = decrypt(credRow);
  const model = userPreferredModel ?? readAnalysisModel() ?? DEFAULT_MODEL;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${plaintextKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://freelance-copilot.local",
      "X-Title": "Freelance Copilot",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      ...(opts?.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(opts?.responseFormat !== undefined
        ? { response_format: opts.responseFormat }
        : {}),
    }),
    // LLM generation takes far longer than a REST fetch — the prompt includes
    // the full job description and the response is a structured analysis, so
    // give the model a generous budget instead of the 30s used for API calls.
    signal: AbortSignal.timeout(timeoutMs ?? 120_000),
  });

  if (response.status === 401) {
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "OpenRouter key was rejected"
    );
  }

  if (response.status === 429) {
    throw new AppError(
      429,
      "RATE_LIMITED",
      "OpenRouter rate limit exceeded"
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `OpenRouter responded with status ${response.status}: ${text.slice(0, 200)}`
    );
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      "OpenRouter returned an empty or invalid response"
    );
  }

  const remaining = response.headers.get("x-ratelimit-remaining");
  const limit = response.headers.get("x-ratelimit-limit");
  if (remaining && limit) {
    log.info(
      `OpenRouter rate limit: ${remaining}/${limit} remaining (model: ${model})`
    );
  }

  return content;
}

/**
 * Best-effort JSON-object extraction from an LLM reply. Backstop for any model
 * or provider that does not honor `response_format`: some wrap the object in
 * prose or a code fence, or leave a trailing comma. Before giving up we try, in
 * order: the raw text as-is, the contents of every fenced code block, and the
 * outermost {...} span when prose surrounds the object. Returns the parsed
 * value, or null when nothing usable is found.
 */
function extractJsonObject(rawText: string): unknown {
  const candidates: string[] = [rawText.trim()];

  // Every fenced code block, whatever the language tag (json, jsonc, none, …).
  const fence = /```[a-zA-Z]*\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(rawText)) !== null) {
    if (match[1] !== undefined && match[1].trim().length > 0) {
      candidates.push(match[1].trim());
    }
  }

  // The outermost brace span — covers "Here is the result: {…}" style output.
  const open = rawText.indexOf("{");
  const close = rawText.lastIndexOf("}");
  if (open !== -1 && close > open) {
    const span = rawText.slice(open, close + 1);
    if (span.length > 0) candidates.push(span);
  }

  for (const candidate of candidates) {
    const parsed = tryParseJsonObject(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

/** Parse one candidate as a JSON object, repairing a trailing comma if needed. */
function tryParseJsonObject(text: string): unknown {
  let attempt = text;
  for (let pass = 0; pass < 5; pass++) {
    try {
      const value: unknown = JSON.parse(attempt);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return value;
      }
      return null; // Valid JSON, but not an object we can use.
    } catch {
      // Strip one "…," right before the final } or ] and try again.
      const repaired = attempt.replace(/,\s*([}\]])$/, "$1");
      if (repaired === attempt) return null;
      attempt = repaired;
    }
  }
  return null;
}

/** Parse failure message that previews what the model actually returned. */
function unparsableJsonMessage(kind: string, rawText: string): string {
  const preview = rawText.trim().replace(/\s+/g, " ").slice(0, 120);
  return `AI ${kind} output could not be parsed as JSON. The model may have refused or returned an invalid format. Raw start: ${JSON.stringify(preview)}`;
}

/**
 * Validate that AI output is properly structured JSON matching RelevancyCheck.
 * The fast relevance model (Model A) returns a gate decision, never free-form.
 *
 * `deliveryDayOptions` is passed only when the gate asked for a timeline. The
 * value is then read and accepted ONLY if it is one of the offered values; an
 * unusable answer yields `null` rather than throwing. A bad timeline must never
 * fail the gate — the job would go unscreened over a number that has a safe
 * fallback (the user's preferred delivery time).
 */
export function validateRelevancyOutput(
  rawText: string,
  deliveryDayOptions?: number[] | null,
  bidAmountOptions?: number[] | null
): RelevancyCheck {
  const parsed = extractJsonObject(rawText);

  if (parsed === null) {
    throw new AppError(500, "INTERNAL", unparsableJsonMessage("relevance", rawText));
  }

  const obj = parsed as Record<string, unknown>;

  const score = Number(obj["score"]);
  if (isNaN(score) || score < 0 || score > 100) {
    throw new AppError(
      500,
      "INTERNAL",
      `AI relevance score is out of range (0-100): ${JSON.stringify(obj["score"])}`
    );
  }

  const reason = typeof obj["reason"] === "string" ? obj["reason"].trim() : "";
  if (reason.length === 0) {
    throw new AppError(
      500,
      "INTERNAL",
      "AI relevance output is missing its one-line reason"
    );
  }

  // No timeline requested → keep the return shape exactly as it was.
  if (deliveryDayOptions === undefined || deliveryDayOptions === null) {
    // But only return bidAmount when a bid-amount question was asked (mirroring
    // the timeline rule — the field is off the object when the feature is off).
    if (bidAmountOptions === undefined || bidAmountOptions === null) {
      return { score, reason };
    }
    return { score, reason, bidAmount: readBidAmount(obj["bidAmount"], bidAmountOptions) };
  }

  const result: RelevancyCheck = {
    score,
    reason,
    deliveryDays: readDeliveryDays(obj["deliveryDays"], deliveryDayOptions),
  };
  if (bidAmountOptions !== undefined && bidAmountOptions !== null) {
    result.bidAmount = readBidAmount(obj["bidAmount"], bidAmountOptions);
  }
  return result;
}

/**
 * A model's chosen delivery time, or null when it is missing, not a whole
 * number, or not one of the values we offered. Never throws.
 */
export function readDeliveryDays(
  raw: unknown,
  options: readonly number[]
): number | null {
  // Tolerate a numeric string ("3"): the schema asks for an integer, but a
  // model that ignores the enum should not cost us the whole timeline.
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(value)) return null;
  return options.includes(value) ? value : null;
}

/**
 * A model's chosen bid amount, or null when it is missing, not a whole
 * number, or not one of the offered dollar values. Never throws — a bad
 * amount has a safe fallback (the minimum budget).
 */
export function readBidAmount(
  raw: unknown,
  options: readonly number[]
): number | null {
  // Tolerate a numeric string: the schema asks for an integer, but a model
  // that ignores the enum should not cost us the whole amount.
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(value)) return null;
  return options.includes(value) ? value : null;
}

/**
 * Build the fast relevance prompt. The model sees the job plus the client's
 * verified trust signals and project context, and returns ONE score (job
 * relevance folded together with client trustworthiness) plus a short reason.
 * Output tokens are the main cost of this call, so the answer is kept to a
 * single line.
 */
export function buildRelevancyPrompt(
  data: RelevancyPromptData,
  timeline?: DeliveryTimelineRequest,
  bidAmount?: BidAmountRequest
): string {
  const userSummary = data.userSummary?.trim() || "No user summary provided.";
  const instructions = data.relevancyInstructions?.trim() || "None.";

  const client = data.client;
  let clientBlock = "Not available.";
  if (client) {
    const yesNo = (v: boolean | null): string =>
      v === true ? "Yes" : v === false ? "No" : "Unknown";
    clientBlock = [
      client.country ? `Country: ${client.country}` : null,
      `Payment method verified: ${yesNo(client.paymentVerified)}`,
      `Email verified: ${yesNo(client.emailVerified)}`,
      `Deposit made (escrow history): ${yesNo(client.depositMade)}`,
      client.accountAgeLabel ? `Account: ${client.accountAgeLabel}` : null,
      client.reputationLabel ? `Reputation: ${client.reputationLabel}` : null,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");
  }

  const upgrades = client?.upgrades?.length ? client.upgrades.join(", ") : "none";
  const projectBlock = [
    data.budgetLabel ? `Budget: ${data.budgetLabel}` : null,
    data.projectType ? `Type: ${data.projectType}` : null,
    data.bidCount !== undefined ? `Bids: ${data.bidCount}` : null,
    data.bidPeriod ? `Delivery time the client asked for: ${data.bidPeriod} days` : null,
    `Upgrades: ${upgrades}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  // The timeline question is asked only when the user turned it on. Kept out of
  // the prompt entirely otherwise, so the gate's output stays a pure
  // score+reason decision for everyone who has not opted in.
  const timelineBlock =
    timeline === undefined
      ? ""
      : `

=== DELIVERY TIMELINE ===
${timeline.instructions}

Choose the delivery time to quote, in days, from exactly these values: ${timeline.options.join(", ")}. Never quote longer than the delivery time the client asked for, when they stated one.`;

  // The bid-amount question is asked only when the user turned it on AND the
  // project has a usable maximum budget (the options are fractions of that max,
  // resolved to concrete dollars at screening time).
  const bidAmountBlock =
    bidAmount === undefined
      ? ""
      : `

=== BID AMOUNT ===
${bidAmount.instructions}

Choose the bid amount to quote, in dollars, from exactly these values: ${bidAmount.options.join(", ")}. Pick the value that best matches the actual scope and the client's budget window — never quote the project minimum out of habit.`;

  return `
You are a fast, low-cost job screener for a freelance agent. Decide whether the job is worth the freelancer's time AND whether the client is trustworthy enough to auto-bid on. Use ONLY the facts below. Never invent facts about the user or the client.

=== USER SUMMARY ===
${userSummary}

=== USER RELEVANCY INSTRUCTIONS ===
${instructions}

=== JOB TITLE ===
${data.jobTitle}

=== JOB DESCRIPTION ===
${data.jobDescription.join("\n")}

=== CLIENT (VERIFIED SIGNALS) ===
${clientBlock}

=== PROJECT SIGNALS ===
${projectBlock}

=== SCORING RULES ===
Return ONE score (0-100) plus a one-sentence reason. A score of 80+ makes the job auto-bid eligible, so trust problems must pull the score down:
- Client payment verified AND a strong match => 80+, EVEN IF the account is new.
- Payment unverified but the project carries real paid signals (Recruiter, NDA, IP contract upgrades) => 60-79: worth a human look, NEVER auto-bid.
- New account with unverified payment and no deposit => below 60: too risky.
- Old account with no payment verification and no upgrades is still risky — keep it below the auto-bid range.
- Account age is only ONE factor combined with the others, never a hard rule by itself.
- NDA / IP-contract projects are never auto-bid regardless of score (they need a signature); score them anyway for manual review.
- A short description is not a reason to reject a job.
${timelineBlock}
${bidAmountBlock}
Respond with ONLY a single valid JSON object and nothing else — no markdown, no code fences, no text before or after. Format: {"score": number 0-100, "reason": "one short sentence (under 25 words) naming the deciding factor"${
    timeline === undefined
      ? ""
      : `, "deliveryDays": one of ${timeline.options.join("|")}`
  }${
    bidAmount === undefined
      ? ""
      : `, "bidAmount": one of ${bidAmount.options.join("|")}`
  }}
`.trim();
}

/**
 * Run the fast relevance gate against a job. The model used is the user's
 * selected analysis model — the cheap/fast one. Output is strictly validated
 * before it is used for any decision.
 *
 * When the gate engine is set to Jev, Jev is the only engine used. The
 * relevance model is deliberately NOT a fallback: silently re-screening on it
 * would mean the engine actually in use is not the one configured, and a
 * broken Jev setup would look like a working one. A Jev failure is logged and
 * raised instead, so it is visible in Logs and on the job.
 *
 * `timeline` and `bidAmount` are passed only when the user has the
 * corresponding AI selection on. Omitted, the gate is exactly what it was
 * before those features existed.
 */
export async function checkRelevancyWithAI(
  data: RelevancyPromptData,
  timeline?: DeliveryTimelineRequest,
  bidAmount?: BidAmountRequest
): Promise<RelevancyCheck> {
  if (readAnalysisEngine() === "jev") {
    try {
      return await checkRelevancyWithJev(data, timeline, bidAmount);
    } catch (error) {
      log.warn(
        `Jev relevance gate failed — job not screened (engine is set to Jev): ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        { jobTitle: data.jobTitle }
      );
      throw error;
    }
  }

  const systemPrompt =
    "You are a fast, low-cost job screener. Score whether the job is worth pursuing for the freelancer, combining how well it matches with how trustworthy the client is. Use ONLY the facts provided. Never invent facts about the user or the client.";
  const rawResponse = await callOpenRouter(
    systemPrompt,
    buildRelevancyPrompt(data, timeline, bidAmount),
    readAnalysisModel() ?? undefined,
    undefined,
    {
      maxTokens: RELEVANCE_MAX_TOKENS,
      responseFormat: buildRelevancyResponseFormat(
        timeline?.options ?? null,
        bidAmount?.options ?? null
      ),
    }
  );
  const result = validateRelevancyOutput(rawResponse, timeline?.options, bidAmount?.options);
  log.info(
    `Relevance gate: score=${result.score}${
      result.deliveryDays !== undefined && result.deliveryDays !== null
        ? ` timeline=${result.deliveryDays}d`
        : ""
    }${
      result.bidAmount !== undefined && result.bidAmount !== null
        ? ` bid=$${result.bidAmount}`
        : ""
    }`,
    {
      jobTitle: data.jobTitle,
      reason: result.reason,
    }
  );
  return result;
}

/**
 * Validate that AI output is properly structured JSON matching AnalysisResult.
 * The AI must not invent facts — this validates before use.
 */
export function validateAnalysisOutput(rawText: string): AnalysisResult {
  const parsed = extractJsonObject(rawText);

  if (parsed === null) {
    throw new AppError(500, "INTERNAL", unparsableJsonMessage("analysis", rawText));
  }

  const obj = parsed as Record<string, unknown>;

  // Required fields
  const verdict = obj["verdict"];
  if (verdict !== "strong" && verdict !== "good" && verdict !== "fair") {
    throw new AppError(
      500,
      "INTERNAL",
      `AI verdict is invalid: expected "strong" | "good" | "fair", got ${JSON.stringify(verdict)}`
    );
  }

  const score = Number(obj["score"]);
  if (isNaN(score) || score < 0 || score > 100) {
    throw new AppError(
      500,
      "INTERNAL",
      `AI score is out of range (0-100): ${JSON.stringify(obj["score"])}`
    );
  }

  if (typeof obj["summary"] !== "string" || obj["summary"].trim().length < 10) {
    throw new AppError(
      500,
      "INTERNAL",
      "AI summary is missing or too short"
    );
  }

  const reasons = Array.isArray(obj["reasons"])
    ? obj["reasons"].filter((r) => typeof r === "string" && r.trim().length > 0)
    : [];

  const concerns = Array.isArray(obj["concerns"])
    ? obj["concerns"].filter((c) => typeof c === "string" && c.trim().length > 0)
    : [];

  if (reasons.length === 0) {
    throw new AppError(
      500,
      "INTERNAL",
      "AI did not provide any matching reasons"
    );
  }

  const recommendedBidLabel = typeof obj["recommendedBidLabel"] === "string"
    ? obj["recommendedBidLabel"].trim()
    : "Not specified";

  const competitorNote = typeof obj["competitorNote"] === "string"
    ? obj["competitorNote"].trim()
    : "";

  return {
    verdict: verdict as "strong" | "good" | "fair",
    score,
    summary: obj["summary"].trim(),
    reasons,
    concerns,
    recommendedBidLabel,
    competitorNote,
  };
}

/**
 * Call OpenRouter to generate a proposal cover message grounded in real
 * profile facts, job details, and competition context. Falls back to a
 * template-based proposal if OpenRouter is unavailable (e.g. no key saved).
 *
 * Returns the proposal content and a competitor note.
 */
export async function generateProposalWithAI(
  data: ProposalPromptData,
  preferredModel?: string,
  userId?: string
): Promise<{ content: string; competitorNote: string }> {
  const profile = getProfile(userId ?? "");
  if (profile === null) {
    throw new AppError(400, "BAD_REQUEST", "Save your profile before generating a proposal");
  }

  const promptData: ProposalPromptData = {
    ...data,
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
  };

  const userPrompt = buildProposalPrompt(promptData);
  const systemPrompt =
    "You are a professional freelancer assistant writing proposals. Use ONLY the verified facts provided. Never invent skills, experience, portfolio items, certifications, previous work, or client history.";

  const rawResponse = await callOpenRouter(
    systemPrompt,
    userPrompt,
    preferredModel ?? readProposalModel() ?? undefined,
    // Proposals are long-form and can run a big, slow model — give them more
    // headroom than the fast relevance gate.
    180_000
  );

  // The proposal is free-form text, not JSON. Strip surrounding code fences
  // if the model wrapped it, and trim.
  const content = rawResponse
    .replace(/^```(?:json|text|markdown)?\n/, "")
    .replace(/\n```\s*$/, "")
    .trim();

  if (content.length < 20) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      "AI-generated proposal was too short — try regenerating"
    );
  }

  // Build a competitor note from the competition data.
  let competitorNote: string;
  if (data.competition && data.competition.bidCount > 0) {
    const parts: string[] = [];
    parts.push(`${data.competition.bidCount} bids recorded`);
    if (data.competition.minBid !== null) parts.push(`lowest $${data.competition.minBid}`);
    if (data.competition.maxBid !== null) parts.push(`highest $${data.competition.maxBid}`);
    if (data.competition.medianBid !== null) parts.push(`median $${data.competition.medianBid}`);
    competitorNote = `Competition: ${parts.join(", ")}.`;
    if (data.competition.isCheapest) competitorNote += ` You are currently the cheapest bidder.`;
  } else if (data.bidCount !== undefined && data.bidCount > 0) {
    competitorNote = `${data.bidCount} bids so far, average around ${data.avgBid ?? "unknown"}.`;
  } else {
    competitorNote = "No bids have been placed yet on this project.";
  }

  log.info(`AI proposal generated for job "${data.jobTitle}"`, { userId });
  return { content, competitorNote };
}

/**
 * Main analysis pipeline: filter by relevancy first, then call AI.
 *
 * If the relevancy filter rejects the job (a not-wants term matched, or the
 * job fails the wants/keywords screen), we return a synthetic
 * `AnalysisResult` with score 0 and a clear "reasons" list. We do NOT call
 * OpenRouter in that case — the user has already told us not to bother.
 */
export async function analyzeJob(
  promptData: AnalysisPrompt,
  preferredModel?: string,
  userId?: string
): Promise<AnalysisResult> {
  const decision = applyRelevancyFilter({
    jobTitle: promptData.jobTitle,
    jobDescription: promptData.jobDescription,
    jobSkills: promptData.skills,
    wants: promptData.wants,
    notWants: promptData.notWants,
    profileSkills: promptData.profileSkills,
  });

  if (!decision.relevant) {
    log.info(
      `Job filtered out before AI call: ${decision.reasons.join("; ")}`,
      { jobTitle: promptData.jobTitle }
    );
    return {
      verdict: "fair",
      score: 0,
      summary:
        "This job was filtered out by your profile filters before any AI analysis was run. Update your wants, not-wants, or skills to re-evaluate it.",
      reasons: [],
      concerns: decision.reasons,
      recommendedBidLabel: "—",
      competitorNote: "",
    };
  }

  // Read saved user summary from profile (if userId provided and summary exists)
  let userSummaryText = "";
  if (userId) {
    const profileRow = getDb()
      .select({ userSummary: userProfile.userSummary })
      .from(userProfile)
      .where(eq(userProfile.userId, userId))
      .get();
    if (profileRow?.userSummary) {
      userSummaryText = profileRow.userSummary;
    }
  }

  const systemPrompt = userSummaryText
    ? `You are a senior freelancing consultant. Analyze job opportunities using ONLY the user's verified profile facts, the user summary below, and the job description. Never invent skills, experience, portfolio items, certifications, previous work, or client history. If a skill is missing from the profile, state it clearly. Validate your output before responding.\n\n=== USER SUMMARY (verified profile) ===\n${userSummaryText}\n=== END USER SUMMARY ===`
    : `You are a senior freelancing consultant. Analyze job opportunities using ONLY the user's verified profile facts and the job description. Never invent skills, experience, portfolio items, certifications, previous work, or client history. If a skill is missing from the profile, state it clearly. Validate your output before responding.`;

  const userPrompt = buildAnalysisPrompt(promptData);

  const rawResponse = await callOpenRouter(
    systemPrompt,
    userPrompt,
    preferredModel,
    undefined,
    { maxTokens: ANALYSIS_MAX_TOKENS, responseFormat: ANALYSIS_RESPONSE_FORMAT }
  );
  const result = validateAnalysisOutput(rawResponse);

  log.info(
    `AI analysis completed: verdict=${result.verdict}, score=${result.score}`,
    {
      jobTitle: promptData.jobTitle,
      model: preferredModel ?? "saved-selection",
    }
  );

  return result;
}
