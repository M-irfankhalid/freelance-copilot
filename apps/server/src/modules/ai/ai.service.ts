import { AppError } from "../../lib/errors.js";
import { decrypt } from "../../lib/crypto.js";
import { getDb } from "../../db/index.js";
import { platformCredentials, userProfile } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { createLogger } from "../../lib/logger.js";
import { applyRelevancyFilter } from "./relevancy.js";
import { getProfile } from "../profile/profile.service.js";

const log = createLogger("analysis");

/** The model we use when the user has not picked one. */
const DEFAULT_MODEL = "openai/gpt-4o-mini";

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

/** Fast relevance gate (Model A). The score becomes the job's match score. */
export interface RelevancyCheck {
  relevant: boolean;
  /** 0–100 match strength. */
  score: number;
  reasons: string[];
  /** One short paragraph explaining the decision. */
  summary: string;
}

/** Inputs the relevance model sees: title, description, user summary, instructions. */
export interface RelevancyPromptData {
  jobTitle: string;
  jobDescription: string[];
  /** Verified user summary from the profile. */
  userSummary?: string | null;
  /** Free-text relevancy instructions, e.g. "no web3 or WordPress". */
  relevancyInstructions?: string | null;
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
  const customInstr = p.customInstructions || "None";
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
Custom instructions: ${customInstr}
${p.userSummary ? `Profile summary: ${p.userSummary}` : ""}
Portfolio summary:
${portfolioSummaryText}

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
Write a proposal cover message (2–3 paragraphs) that:
1. Addresses the client by name ("Hi,") and shows you read their project description
2. Highlights 1–2 matching skills from YOUR profile that directly address their needs
3. References a specific relevant experience or portfolio item from your profile (if any exist)
4. Mentions that price and duration can be discussed later, offering the best price with quality work and fast delivery — do NOT commit to a specific rate or delivery date
5. Incorporates your custom instructions (if any)
6. Matches the tone and structure of the proposal templates provided (if any)
7. Stays grounded in the facts above — do NOT invent new skills, projects, or client history

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
 * Call OpenRouter using the user's saved API key and selected model.
 * `userPreferredModel` overrides the saved selection (used by the API route
 * to honor a per-request override if the UI ever needs it).
 */
export async function callOpenRouter(
  systemPrompt: string,
  userPrompt: string,
  userPreferredModel?: string,
  timeoutMs?: number
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
      "HTTP-Referer": "https://freelancer-agent.local",
      "X-Title": "Freelancer Agent",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
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
 * Validate that AI output is properly structured JSON matching RelevancyCheck.
 * The fast relevance model (Model A) returns a gate decision, never free-form.
 */
export function validateRelevancyOutput(rawText: string): RelevancyCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    const match = rawText.match(/```json\n([\s\S]*?)\n```/);
    if (match && match[1] !== undefined) {
      try {
        parsed = JSON.parse(match[1].trim());
      } catch {
        parsed = null;
      }
    } else {
      parsed = null;
    }
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new AppError(
      500,
      "INTERNAL",
      "AI relevance output could not be parsed as JSON. The model may have refused or returned an invalid format."
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj["relevant"] !== "boolean") {
    throw new AppError(
      500,
      "INTERNAL",
      `AI relevance verdict is invalid: expected boolean, got ${JSON.stringify(obj["relevant"])}`
    );
  }

  const score = Number(obj["score"]);
  if (isNaN(score) || score < 0 || score > 100) {
    throw new AppError(
      500,
      "INTERNAL",
      `AI relevance score is out of range (0-100): ${JSON.stringify(obj["score"])}`
    );
  }

  const reasons = Array.isArray(obj["reasons"])
    ? obj["reasons"].filter((r) => typeof r === "string" && r.trim().length > 0)
    : [];

  const summary = typeof obj["summary"] === "string" ? obj["summary"].trim() : "";

  return { relevant: obj["relevant"], score, reasons, summary };
}

/**
 * Build the fast relevance prompt. Only the job title, description, the user's
 * verified summary, and their relevancy instructions reach the model — this is
 * the cheap gate that runs before any expensive work.
 */
export function buildRelevancyPrompt(data: RelevancyPromptData): string {
  const userSummary = data.userSummary?.trim() || "No user summary provided.";
  const instructions = data.relevancyInstructions?.trim() || "None.";
  return `
You are a fast, low-cost relevance screener for a freelance agent. Decide whether the job below is worth a freelancer's time given their summary and instructions.

=== USER SUMMARY ===
${userSummary}

=== USER RELEVANCY INSTRUCTIONS ===
${instructions}

=== JOB TITLE ===
${data.jobTitle}

=== JOB DESCRIPTION ===
${data.jobDescription.join("\n")}

Return ONLY a JSON object with exactly these keys:
- relevant: boolean (true if the job matches, false otherwise)
- score: number (0-100, how strong the match is)
- reasons: array of strings (why it does or does not match)
- summary: string (one short paragraph)

Judge strictly using ONLY the job details and user facts above. Never invent facts about the user. A short description is not a reason to reject a job.
`.trim();
}

/**
 * Run the fast relevance gate (Model A) against a job. The model used is the
 * user's selected analysis model — the cheap/fast one. Output is strictly
 * validated before it is used for any decision.
 */
export async function checkRelevancyWithAI(
  data: RelevancyPromptData
): Promise<RelevancyCheck> {
  const systemPrompt =
    "You are a fast, low-cost job relevance screener. Decide whether the job matches the user using ONLY the job details and the user's own summary/instructions. Never invent facts about the user.";
  const rawResponse = await callOpenRouter(
    systemPrompt,
    buildRelevancyPrompt(data),
    readAnalysisModel() ?? undefined
  );
  const result = validateRelevancyOutput(rawResponse);
  log.info(
    `Relevance gate: relevant=${result.relevant}, score=${result.score}`,
    { jobTitle: data.jobTitle }
  );
  return result;
}

/**
 * Validate that AI output is properly structured JSON matching AnalysisResult.
 * The AI must not invent facts — this validates before use.
 */
export function validateAnalysisOutput(rawText: string): AnalysisResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    // Try extracting JSON from markdown code blocks
    const match = rawText.match(/```json\n([\s\S]*?)\n```/);
    if (match && match[1] !== undefined) {
      try {
        parsed = JSON.parse(match[1].trim());
      } catch {
        parsed = null;
      }
    } else {
      parsed = null;
    }
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new AppError(
      500,
      "INTERNAL",
      "AI output could not be parsed as JSON. The model may have refused or returned invalid format."
    );
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

  const rawResponse = await callOpenRouter(systemPrompt, userPrompt, preferredModel);
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
