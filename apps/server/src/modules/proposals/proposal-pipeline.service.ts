import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import type {
  CandidateLane,
  FlowStep,
  ProposalEngineConfig,
} from "../../lib/proposal-defaults.js";
import {
  evaluateProposalQuality,
  stripCommercialMentions,
  type ProposalQualityResult,
} from "../../lib/proposal-quality.js";
import {
  ensureReadableParagraphs,
  evaluateBriefCoverage,
  evaluateDeletionCandidate,
  genericClaims,
  hasGenericOpening,
  type BriefCoverageResult,
} from "../../lib/proposal-rubric.js";
import { allowedEvidenceUrls, selectEvidence } from "../../lib/proposal-evidence.js";
import {
  buildStructuredResponseFormat,
  callOpenRouter,
  callOpenRouterStructured,
  type JsonSchemaResponseFormat,
  type ProposalPromptData,
} from "../ai/ai.service.js";
import { getAiSettingsView } from "../ai/ai-settings.service.js";
import { getProfile } from "../profile/profile.service.js";
import { buildProposalFactSheet } from "../profile/profile-brief.js";
import {
  getProposalEngineConfig,
  playbookText,
  renderTemplate,
  selectPlaybook,
  selectVoiceSamples,
  type PlaybookView,
  type SampleView,
} from "./proposal-config.service.js";
import { getVoiceGuide, voiceGuideText } from "./proposal-voice.service.js";
import type {
  ProposalTraceEmitter,
  ProposalTraceEvent,
} from "./proposal-trace.service.js";

const log = createLogger("proposal");

/* --------------------------------- Types --------------------------------- */

const angleTypeSchema = z.enum([
  "de_risk",
  "speed",
  "quality",
  "cost",
  "communication",
  "technical_depth",
  "simplicity",
  "compliance",
]);

const briefRiskSchema = z.union([
  z.string(),
  z
    .object({
      type: z.string().default("other"),
      severity: z.string().default("medium"),
      reason: z.string().default(""),
    })
    .catchall(z.unknown()),
]);

export const jobBriefSchema = z.object({
  relationship: z
    .enum(["client_buys_service", "candidate_opportunity"])
    .default("client_buys_service"),
  goal: z.string().min(1),
  facts: z.array(z.string()).default([]),
  hypotheses: z.array(z.string()).default([]),
  deliverables: z.array(z.string()).default([]),
  explicitQuestions: z.array(z.string()).default([]),
  applicationRequirements: z.array(z.string()).default([]),
  mustAddress: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  unresolved: z.array(z.string()).default([]),
  risks: z.array(briefRiskSchema).default([]),
  avoidAssumptions: z.array(z.string()).default([]),
  bestQuestion: z.string().default(""),
  bestQuestionWhy: z.string().default(""),
  angle: z.object({
    type: angleTypeSchema,
    statement: z.string().min(1),
    why: z.string().default(""),
  }),
  shape: z.string().min(1),
  omit: z.array(z.string()).default([]),
  evidenceNeeds: z.array(z.string()).default([]),
  toneHints: z.array(z.string()).default([]),
  clarificationNeeded: z.boolean().default(false),
  complexity: z
    .object({
      level: z.string().default("moderate"),
      reason: z.string().default(""),
    })
    .optional(),
  urgency: z
    .object({
      level: z.string().default("unknown"),
      evidence: z.string().default(""),
    })
    .optional(),
  clientPriorities: z.array(z.string()).optional(),
  targetWords: z
    .object({
      min: z.number().int().min(0),
      max: z.number().int().min(0),
      target: z.number().int().min(0),
    })
    .optional(),
  proposalStructure: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
  portfolioDecision: z
    .object({
      mention: z.boolean().default(false),
      projectNames: z.array(z.string()).default([]),
      reason: z.string().default(""),
    })
    .optional(),
  questionDecision: z
    .object({
      ask: z.boolean().default(false),
      reason: z.string().default(""),
    })
    .optional(),
  safetyDecision: z
    .object({
      status: z.string().default("normal"),
      reason: z.string().default(""),
    })
    .optional(),
});

export type JobBrief = z.infer<typeof jobBriefSchema>;

const reviewIssueSchema = z.object({
  severity: z.enum(["blocker", "major", "minor"]),
  category: z.string().min(1),
  quote: z.string().default(""),
  problem: z.string().min(1),
  fix: z.string().min(1),
});

export const proposalReviewSchema = z.object({
  verdict: z.enum(["accept", "revise", "reject"]),
  dimensions: z.object({
    jobUnderstanding: z.number().int().min(0).max(2).default(1),
    specificity: z.number().int().min(0).max(2).default(1),
    technicalJudgment: z.number().int().min(0).max(2).default(1),
    evidence: z.number().int().min(0).max(2).default(1),
    voiceMatch: z.number().int().min(0).max(2).default(1),
    naturalness: z.number().int().min(0).max(2).default(1),
    conciseness: z.number().int().min(0).max(2).default(1),
    grounding: z.number().int().min(0).max(2).default(1),
    policy: z.number().int().min(0).max(2).default(1),
    relevance: z.number().int().min(0).max(2).default(1),
    coverage: z.number().int().min(0).max(2).default(1),
    safety: z.number().int().min(0).max(2).default(1),
  }),
  issues: z.array(reviewIssueSchema).default([]),
  coverage: z
    .array(
      z.object({
        deliverable: z.string().min(1),
        covered: z.boolean(),
        evidence: z.string().default(""),
      })
    )
    .default([]),
  criticalDefects: z.array(z.string()).default([]),
  revisionInstructions: z.array(z.string()).default([]),
  mustKeep: z.array(z.string()).default([]),
});

export type ProposalReview = z.infer<typeof proposalReviewSchema>;

const judgeSchema = z.object({
  winnerIndex: z.number().int().min(0),
  ranking: z
    .array(
      z.object({
        index: z.number().int().min(0),
        score: z.number().min(0).max(100),
        reasons: z.array(z.string()).default([]),
        risks: z.array(z.string()).default([]),
      })
    )
    .default([]),
  summary: z.string().default(""),
});

/**
 * Provider-enforced JSON schemas for the stages that must return objects.
 * Derived from the same Zod schemas used to validate the reply, so the contract
 * and the validator cannot drift. Writer/reviser/deleter stay free-form text.
 */
const briefResponseFormat = buildStructuredResponseFormat(
  "job_brief",
  z.toJSONSchema(jobBriefSchema) as Record<string, unknown>
);
const reviewResponseFormat = buildStructuredResponseFormat(
  "proposal_review",
  z.toJSONSchema(proposalReviewSchema) as Record<string, unknown>
);
const judgeResponseFormat = buildStructuredResponseFormat(
  "proposal_judge",
  z.toJSONSchema(judgeSchema) as Record<string, unknown>
);

export type ReviewStatus =
  | "accepted"
  | "needs_revision"
  | "rejected"
  | "unavailable"
  | "disabled";

export interface PipelineResult {
  content: string;
  competitorNote: string;
  review: ProposalReview | null;
  reviewStatus: ReviewStatus;
  jobBrief: JobBrief;
  playbook: PlaybookView | null;
  samples: SampleView[];
  evidence: string;
  coverage: BriefCoverageResult;
  candidates: string[];
  winnerIndex: number;
  /** True only when hard checks pass and the final review accepted the draft. */
  approvable: boolean;
  quality: ProposalQualityResult;
}

/* ------------------------------- Utilities ------------------------------- */

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function extractJson(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseStage<T>(raw: string, schema: z.ZodType<T>, stage: string): T {
  const parsed = schema.safeParse(extractJson(raw));
  if (!parsed.success) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `The ${stage} stage returned invalid JSON. Try regenerating or use a model with reliable JSON output.`,
      parsed.error.flatten()
    );
  }
  return parsed.data;
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function paragraphCount(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean).length;
}

/** Trace writes are diagnostic and must never break generation. */
function emitTrace(
  trace: ProposalTraceEmitter | undefined,
  event: ProposalTraceEvent
): void {
  if (trace === undefined) return;
  try {
    trace(event);
  } catch (error) {
    log.warn("Proposal trace callback failed", {
      phase: event.phase,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Persist the exact request and raw response for one pipeline model call.
 * This is deliberately separate from the short progress events so debugging a
 * bad phase does not require guessing which prompt produced which output.
 */
async function tracedModelCall(
  onTrace: ProposalTraceEmitter | undefined,
  phase: string,
  label: string,
  system: string,
  user: string,
  model: string | undefined,
  timeoutMs: number | undefined,
  opts?: { temperature?: number; responseFormat?: JsonSchemaResponseFormat }
): Promise<string> {
  const startedAt = Date.now();
  const request = {
    model: model ?? null,
    temperature: opts?.temperature ?? null,
    timeoutMs: timeoutMs ?? null,
    system,
    user,
    responseFormat: opts?.responseFormat ?? null,
  };

  try {
    const response =
      opts?.responseFormat !== undefined
        ? await callOpenRouterStructured(system, user, opts.responseFormat, model, timeoutMs, {
            temperature: opts.temperature,
          })
        : await callOpenRouter(system, user, model, timeoutMs, {
            temperature: opts?.temperature,
          });
    emitTrace(onTrace, {
      phase,
      title: `${label} API response`,
      status: "completed",
      detail: `${Date.now() - startedAt}ms`,
      data: { kind: "model-call", request, response, durationMs: Date.now() - startedAt },
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    emitTrace(onTrace, {
      phase,
      title: `${label} API error`,
      status: "failed",
      detail: message,
      data: { kind: "model-call", request, error: message, durationMs: Date.now() - startedAt },
    });
    throw error;
  }
}

function reviewTraceDetail(review: ProposalReview): string {
  const scores = Object.values(review.dimensions);
  const average =
    scores.length === 0
      ? 0
      : scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const verdict =
    review.verdict === "accept"
      ? "Accepted"
      : review.verdict === "reject"
        ? "Rejected"
        : "Revision requested";
  const issues = review.issues.length;
  return `${verdict} - ${issues} issue${issues === 1 ? "" : "s"}, ${average.toFixed(
    1
  )}/2 average.`;
}

export type ProposalJobInput = Omit<ProposalPromptData, "profile">;

function jobText(data: ProposalJobInput): string {
  return [data.jobTitle, data.budgetLabel ?? "", ...data.skills, ...data.jobDescription]
    .join("\n")
    .toLowerCase();
}

export function detectJobRelationship(data: ProposalJobInput): JobBrief["relationship"] {
  const text = jobText(data);
  const candidateSignals = [
    /\bwhat our team offers\b/,
    /\bwhat we offer\b/,
    /\bgrow your income\b/,
    /\bcandidates? based in\b/,
    /\bpartnership with our team\b/,
    /\blooking to connect with\b/,
    /\bjoin our team\b/,
    /\bcareer opportunities?\b/,
    /\bwe(?:'ll| will) (?:support|help|guide) you\b/,
    /\bhelp you succeed\b/,
    /\bseeking (?:software|full[- ]stack|frontend|backend|developers?|engineers?)\b/,
    /\bwe(?:'re| are) hiring\b/,
  ];
  const projectSignals = [
    /\bbuild (?:me|us|our|a|an|the)\b/,
    /\bcreate (?:me|us|our|a|an|the)\b/,
    /\bdevelop (?:me|us|our|a|an|the)\b/,
    /\bdesign (?:me|us|our|a|an|the)\b/,
    /\bfix (?:me|us|our|a|an|the)\b/,
    /\bneed (?:a|an|someone|help)\b/,
    /\bi need\b/,
    /\bi want\b/,
    /\bfor my (?:business|store|website|app|project)\b/,
    /\bproject\b/,
    /\bdeliverables?\b/,
    /\bdeadline\b/,
    /\btimeline\b/,
  ];

  const candidateScore = candidateSignals.filter((pattern) => pattern.test(text)).length;
  const projectScore = projectSignals.filter((pattern) => pattern.test(text)).length;

  if (candidateScore >= 2) return "candidate_opportunity";
  if (candidateScore >= 1 && projectScore === 0) return "candidate_opportunity";
  return "client_buys_service";
}

/**
 * A job can be a client buying a service, or a team offering a role or
 * partnership to a developer. The second kind must not be answered with a
 * consultant-style plan for the client's program.
 */
export function adaptBriefForRelationship(brief: JobBrief): JobBrief {
  if (brief.relationship !== "candidate_opportunity") return brief;

  const fitItems = [
    "relevant hands-on frontend or backend experience",
    "clear communication and ownership",
    "availability for a long-term or ongoing engagement",
  ];

  return {
    ...brief,
    goal: "Show the client why you are a credible developer for their team or developer network.",
    deliverables: fitItems,
    mustAddress: [...fitItems],
    acceptanceCriteria: [],
    dependencies: [],
    risks: ["Do not claim location eligibility or experience the profile does not verify."],
    unresolved: [],
    explicitQuestions: [],
    bestQuestion: "",
    bestQuestionWhy: "",
    clarificationNeeded: false,
    angle: {
      type: "quality",
      statement: "I can contribute as a hands-on developer from the first project.",
      why: "The client is recruiting developers for ongoing work, so verified fit matters more than a plan for their program.",
    },
    shape: "short_note",
    omit: Array.from(
      new Set([
        ...brief.omit,
        "consultant-style advice about the client's program",
        "deliverables the applicant is not delivering",
        "location claims",
        "program risks or partnership structure",
      ])
    ),
    evidenceNeeds: ["one verified project showing relevant frontend or backend work"],
    toneHints: [
      "first person, confident, direct, personable",
      "applicant voice, not consultant voice",
    ],
  };
}

function writerRelationshipGuidance(brief: JobBrief): string {
  return brief.relationship === "candidate_opportunity"
    ? "The client is offering a role or partnership to a developer. Write as the applicant, not as a consultant advising the client. Do not evaluate or improve their program."
    : "If the brief asks for a plan, give the smallest concrete plan that proves you understand the work. Do not pad it into a proposal document.";
}

function reviewerRelationshipGuidance(brief: JobBrief): string {
  return brief.relationship === "candidate_opportunity"
    ? "The client is offering a role or partnership. Judge whether the applicant makes a credible personal fit. Do not penalize the proposal for failing to deliver or improve the client's program, and do not ask for program-level analysis."
    : "For a project, reward a short concrete plan and one relevant verified proof. Do not require a long proposal.";
}

function appendContract(prompt: string, contract: string): string {
  const trimmed = contract.trim();
  return trimmed.length === 0 ? prompt : `${prompt}\n\n${trimmed}`;
}

function jobForPrompt(data: ProposalJobInput, includeCommercials: boolean): string {
  return json({
    title: data.jobTitle,
    client: data.clientName ?? null,
    ...(includeCommercials
      ? {
          budgetLabel: data.budgetLabel ?? null,
          clientRequestedDeliveryDays: data.bidPeriod ?? null,
          bidAmountToSubmit: data.bidAmount ?? null,
          deliveryDaysToSubmit: data.deliveryDays ?? null,
        }
      : {
          budgetLabel: null,
          clientRequestedDeliveryDays: null,
          bidAmountToSubmit: null,
          deliveryDaysToSubmit: null,
        }),
    projectType: data.projectType ?? null,
    skills: data.skills,
    description: data.jobDescription,
  });
}

function clientAskedForCommercials(data: ProposalJobInput): boolean {
  const text = `${data.jobTitle}\n${data.jobDescription.join("\n")}`.toLowerCase();
  return /(price|budget|rate|cost|quote|estimate|delivery (?:time|date|window)|timeline|how long|deadline|turnaround|timeframe|when can you|as soon as possible|\basap\b|\b\d+\s*(?:days?|weeks?|hours?)\b)/i.test(
    text
  );
}

function competitorNoteFor(data: ProposalJobInput): string {
  if (data.competition && data.competition.bidCount > 0) {
    const parts: string[] = [`${data.competition.bidCount} bids recorded`];
    if (data.competition.minBid !== null) parts.push(`lowest $${data.competition.minBid}`);
    if (data.competition.maxBid !== null) parts.push(`highest $${data.competition.maxBid}`);
    if (data.competition.medianBid !== null) parts.push(`median $${data.competition.medianBid}`);
    let note = `Competition: ${parts.join(", ")}.`;
    if (data.competition.isCheapest) note += " You are currently the cheapest bidder.";
    return note;
  }
  if (data.bidCount !== undefined && data.bidCount > 0) {
    return `${data.bidCount} bids so far, average around ${data.avgBid ?? "unknown"}.`;
  }
  return "No bids have been placed yet on this project.";
}

export function fallbackBrief(data: ProposalJobInput): JobBrief {
  const joined = data.jobDescription.join("\n").trim();
  const paragraphs = data.jobDescription.map((part) => part.trim()).filter(Boolean);
  const firstParagraph = paragraphs.find((part) => part.length > 20) ?? data.jobTitle;
  const lines = joined.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const bulletItems = lines
    .filter((line) => /^(?:[-*â€¢]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^(?:[-*â€¢]|\d+[.)])\s+/, "").trim())
    .filter((line) => line.length > 3);
  const sentences = joined
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 8);
  const questions = sentences.filter((sentence) => sentence.endsWith("?")).slice(0, 3);
  const cleanJobLine = (line: string): string =>
    line
      .replace(/^(?:[-*\u2022]|\d+[.)])\s+/, "")
      .replace(/\*\*/g, "")
      .replace(/^[“”"'`]+|[“”"'`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const applicationStart = lines.findIndex((line) =>
    /\b(?:to apply|how to apply|when applying|application instructions?)\b/i.test(line)
  );
  const applicationSection = applicationStart >= 0 ? lines.slice(applicationStart) : [];
  const applicationRequirements: string[] = [];
  const addApplicationRequirement = (value: string): void => {
    const cleaned = cleanJobLine(value);
    if (cleaned.split(/\s+/).length < 3) return;
    if (applicationRequirements.some((item) => normalizeForMatch(item) === normalizeForMatch(cleaned))) {
      return;
    }
    applicationRequirements.push(cleaned);
  };
  for (const line of applicationSection) {
    const cleaned = cleanJobLine(line);
    if (cleaned.length === 0) continue;
    if (/^(?:to apply|how to apply|when applying|application instructions?)\b[^.!?]*:?$/i.test(cleaned)) {
      continue;
    }
    for (const part of cleaned.split(/(?<=[.!?])\s+/)) addApplicationRequirement(part);
  }
  const applicationCue =
    /\b(?:start|begin) (?:your|the|each) (?:message|proposal|reply|application)\b|\b(?:use|mention) the word\b|\bsubject line\b|\bfirst (?:line|word)\b/i;
  const applicationRequest =
    /\b(?:please|kindly)?\s*(?:share|send|provide|include|attach|paste|link|show|tell us|tell me|answer|describe)\b[^.!?\n]{0,100}\b(?:example|sample|portfolio|case study|document|diagram|link|rate|availability|experience)\b/i;
  for (const sentence of sentences) {
    if (applicationCue.test(sentence) || applicationRequest.test(sentence)) {
      addApplicationRequirement(sentence);
    }
  }
  const actionWords =
    /\b(build|create|update|replace|migrate|move|fix|debug|integrate|set ?up|configure|deploy|design|develop|add|remove|improve|test|review|audit|manage|implement|install|restore|optimize|optimi[sz]e)\b/i;
  const constraintWords =
    /\b(must|should|need|needs|required|require|ensure|include|including|within|without|only|keep|preserve|acceptance|test|verify|no |not )\b/i;
  const actionItems = (bulletItems.length > 0 ? bulletItems : sentences).filter((item) =>
    actionWords.test(item)
  );
  const applicationKeys = new Set(
    applicationRequirements.map((item) => normalizeForMatch(item))
  );
  const deliverables = (actionItems.length > 0 ? actionItems : bulletItems)
    .filter((item) => !applicationKeys.has(normalizeForMatch(item)))
    .slice(0, 10)
    .map((item) => item.replace(/\s+/g, " ").trim());
  const mustAddress = sentences
    .filter((sentence) => constraintWords.test(sentence))
    .filter((sentence) => !applicationKeys.has(normalizeForMatch(sentence)))
    .slice(0, 8);
  const acceptanceCriteria = sentences
    .filter(
      (sentence) =>
        /\b(done when|task ends|acceptance|verify|test|returns?|works?|working|complete|launch|deliver)\b/i.test(
          sentence
        )
    )
    .slice(0, 5);
  const dependencies: string[] = [];
  if (/\b(hosting|dns|domain|nameserver|email|mx|ssl|server|host)\b/i.test(joined)) {
    dependencies.push("Hosting, DNS, SSL, and email records must be checked before cutover.");
  }
  if (/\b(access|credentials|admin|login|repository|repo|staging|logs?)\b/i.test(joined)) {
    dependencies.push("Site, repository, hosting, or log access may be required before work starts.");
  }
  if (/\b(design|figma|assets?|images?|copy|content|photos?)\b/i.test(joined)) {
    dependencies.push("Final content and design assets must be available.");
  }
  if (/\b(api|webhook|third[- ]party|stripe|payment|integration)\b/i.test(joined)) {
    dependencies.push("Third-party API keys, webhook secrets, and sandbox access may be required.");
  }

  const risks: string[] = [];
  if (/\b(live|production|current site|existing site|real users|business email)\b/i.test(joined)) {
    risks.push("The work touches a live system; cutover and rollback should be tested before the switch.");
  }
  if (/\b(api|webhook|payment|auth|login|integration)\b/i.test(joined)) {
    risks.push("External integrations can fail on auth, retries, validation, or webhook ordering.");
  }
  if (deliverables.length >= 5) {
    risks.push("The brief has several independent deliverables; sequencing and scope need to stay explicit.");
  }
  if (/\b(not sure|unknown|maybe|might|investigate|diagnose|figure out|why)\b/i.test(joined)) {
    risks.push("The cause is not confirmed yet; the first step should be diagnosis, not a promised fix.");
  }
  if (risks.length === 0) {
    risks.push("The main risk is missing context or an unstated acceptance criterion.");
  }

  const text = `${data.jobTitle} ${joined}`.toLowerCase();
  const angleType = /\b(migrat|move|dns|email|cutover|live site|production)\b/.test(text)
    ? "de_risk"
    : /\b(bug|error|broken|slow|debug|not working|issue)\b/.test(text)
      ? "de_risk"
      : /\b(design|brand|classic|timeless|ux|user experience)\b/.test(text)
        ? "quality"
        : /\b(api|integration|security|auth|webhook)\b/.test(text)
          ? "technical_depth"
          : /\b(shopify|woocommerce|payment|checkout|platform)\b/.test(text)
            ? "technical_depth"
            : "simplicity";

  const shape =
    /\b(plan|roadmap|steps|phases|milestones)\b/i.test(joined) || deliverables.length >= 7
      ? "plan"
      : /\b(bug|error|broken|slow|debug|not working|diagnose|investigate|why)\b/i.test(joined)
        ? "diagnostic"
        : data.skills.length >= 4 && deliverables.length >= 4
          ? "technical_brief"
          : "short_note";

  const evidenceNeeds: string[] = [];
  if (/\b(migrat|hosting|dns|wordpress)\b/i.test(joined)) {
    evidenceNeeds.push("a migration or hosting project with a tested cutover");
  }
  if (/\b(shopify|woocommerce|ecommerce|e-commerce|checkout|payment)\b/i.test(joined)) {
    evidenceNeeds.push("an e-commerce or payment project with a real store flow");
  }
  if (/\b(api|webhook|integration|ai|llm)\b/i.test(joined)) {
    evidenceNeeds.push("an API or integration project with validation and error handling");
  }
  if (/\b(performance|slow|latency|cache|redis)\b/i.test(joined)) {
    evidenceNeeds.push("a performance investigation with before-and-after evidence");
  }
  if (evidenceNeeds.length === 0) {
    evidenceNeeds.push("the closest verified project described in the profile");
  }

  const toneHints: string[] = [];
  if (/\b(simple|plain english|non[- ]technical|easy)\b/i.test(joined)) {
    toneHints.push("plain language, no jargon");
  }
  if (/\b(urgent|asap|quick|fast)\b/i.test(joined)) {
    toneHints.push("direct and efficient");
  }

  return {
    relationship: detectJobRelationship(data),
    goal: firstParagraph.trim().slice(0, 400),
    facts: paragraphs.slice(0, 6),
    hypotheses: [],
    deliverables,
    explicitQuestions: questions,
    applicationRequirements,
    mustAddress,
    acceptanceCriteria,
    dependencies,
    unresolved: deliverables.length === 0 ? ["The scope is not clearly stated."] : [],
    risks,
    avoidAssumptions: [
      "Do not claim the cause is known before diagnosis.",
      "Do not promise a result that is not supported by the profile.",
    ],
    bestQuestion: "",
    bestQuestionWhy: "",
    angle: {
      type: angleType,
      statement:
        angleType === "de_risk"
          ? "Show how you will reduce the main delivery risk before making changes."
          : "Show that you understand the actual job and can solve it without unnecessary work.",
      why: "The structured brief could not be generated, so this fallback keeps the proposal tied to the job.",
    },
    shape,
    omit: [
      "generic introduction",
      "credentials paragraph",
      "exhaustive technology list",
      "repeating the job description",
    ],
    evidenceNeeds,
    toneHints,
    clarificationNeeded: false,
  };
}

function withoutCommercials(text: string): string {
  return stripCommercialMentions(text).trim();
}

function sanitizeBriefCommercials(brief: JobBrief): JobBrief {
  const list = (items: string[]): string[] =>
    items.map(withoutCommercials).filter((item) => item.length > 0);

  return {
    ...brief,
    goal: withoutCommercials(brief.goal),
    facts: list(brief.facts),
    hypotheses: list(brief.hypotheses),
    deliverables: list(brief.deliverables),
    explicitQuestions: list(brief.explicitQuestions),
    applicationRequirements: list(brief.applicationRequirements),
    mustAddress: list(brief.mustAddress),
    acceptanceCriteria: list(brief.acceptanceCriteria),
    dependencies: list(brief.dependencies),
    unresolved: list(brief.unresolved),
    risks: brief.risks.map((risk) =>
      typeof risk === "string"
        ? withoutCommercials(risk)
        : { ...risk, reason: withoutCommercials(risk.reason) }
    ),
    avoidAssumptions: list(brief.avoidAssumptions),
    bestQuestion: withoutCommercials(brief.bestQuestion),
    bestQuestionWhy: withoutCommercials(brief.bestQuestionWhy),
    angle: {
      ...brief.angle,
      statement: withoutCommercials(brief.angle.statement),
      why: withoutCommercials(brief.angle.why),
    },
    omit: list(brief.omit),
    evidenceNeeds: list(brief.evidenceNeeds),
    toneHints: list(brief.toneHints),
  };
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function evidenceAnchors(items: Array<{ title: string }>): string[] {
  return items
    .map((item) => item.title.replace(/^\s*\d+[.)]\s*/, ""))
    .map((title) => title.split(/\s+[—|-]\s+/)[0]?.trim() ?? title)
    .map((title) => title.split(/\s+/)[0] ?? title)
    .filter((title) => title.length >= 3 && !/^portfolio$/i.test(title));
}

/**
 * The model occasionally drops a field or reuses the job's skill tags as
 * deliverables. Fill only missing/clearly-wrong fields from the deterministic
 * extraction so a malformed brief cannot silently shrink the proposal.
 */
function enrichBrief(brief: JobBrief, data: ProposalJobInput): JobBrief {
  const fallback = fallbackBrief(data);
  const skillSet = new Set(data.skills.map((skill) => skill.toLowerCase().trim()));
  const looksLikeSkills =
    brief.deliverables.length > 0 &&
    brief.deliverables.every((item) => {
      const value = item.toLowerCase().trim();
      return skillSet.has(value) || (!value.includes(" ") && value.length < 24);
    });
  const deliverables =
    brief.deliverables.length === 0 || looksLikeSkills ? fallback.deliverables : brief.deliverables;
  const questionAnswered =
    brief.bestQuestion.length > 0 &&
    normalizeForMatch(jobText(data)).includes(normalizeForMatch(brief.bestQuestion));

  return {
    ...brief,
    relationship: detectJobRelationship(data),
    facts: brief.facts.length > 0 ? brief.facts : fallback.facts,
    deliverables,
    applicationRequirements:
      brief.applicationRequirements.length > 0
        ? brief.applicationRequirements
        : fallback.applicationRequirements,
    mustAddress: brief.mustAddress.length > 0 ? brief.mustAddress : fallback.mustAddress,
    acceptanceCriteria:
      brief.acceptanceCriteria.length > 0 ? brief.acceptanceCriteria : fallback.acceptanceCriteria,
    dependencies: brief.dependencies.length > 0 ? brief.dependencies : fallback.dependencies,
    risks: brief.risks.length > 0 ? brief.risks : fallback.risks,
    bestQuestion: questionAnswered ? "" : brief.bestQuestion,
    bestQuestionWhy: questionAnswered ? "" : brief.bestQuestionWhy,
    clarificationNeeded: !questionAnswered && brief.bestQuestion.length > 0,
  };
}

export function withCoverageGate(
  review: ProposalReview,
  deterministic?: BriefCoverageResult
): ProposalReview {
  const coverage = review.coverage.map((item) => ({ ...item }));
  if (deterministic !== undefined) {
    for (const item of deterministic.items) {
      const key = normalizeForMatch(item.item);
      const match = coverage.find((candidate) => {
        const other = normalizeForMatch(candidate.deliverable);
        return other === key || other.includes(key) || key.includes(other);
      });
      if (match === undefined) {
        coverage.push({
          deliverable: item.item,
          covered: item.covered,
          evidence: item.covered ? "detected in draft" : "missing",
        });
        continue;
      }
      if (!match.covered && item.covered) {
        match.covered = true;
        if (match.evidence.trim().length === 0) match.evidence = "detected in draft";
      }
    }
  }

  const missing = coverage.filter((item) => !item.covered);
  const issues = [...review.issues];
  const instructions = [...review.revisionInstructions];
  for (const item of missing) {
    const problem = `Missing deliverable: ${item.deliverable}`;
    if (!issues.some((issue) => issue.problem === problem)) {
      issues.push({
        severity: "major",
        category: "coverage",
        quote: "",
        problem,
        fix: `Address this deliverable concisely: ${item.deliverable}`,
      });
    }
    const instruction = `Cover this missing deliverable: ${item.deliverable}`;
    if (!instructions.includes(instruction)) instructions.push(instruction);
  }

  const criticalDimensions = new Set(["coverage", "grounding", "safety", "policy"]);
  const dimensions = Object.entries(review.dimensions) as Array<[string, number]>;
  const average =
    dimensions.length === 0
      ? 0
      : dimensions.reduce((sum, [, score]) => sum + score, 0) / dimensions.length;
  const zeroCritical = dimensions.filter(
    ([name, score]) => criticalDimensions.has(name) && score === 0
  );
  const lowReview = average < 1.5 || zeroCritical.length > 0;
  if (lowReview) {
    const problem =
      zeroCritical.length > 0
        ? `Critical review dimension is too low: ${zeroCritical.map(([name]) => name).join(", ")}`
        : `Review scores are too low (${average.toFixed(1)}/2 average)`;
    if (!issues.some((issue) => issue.problem === problem)) {
      issues.push({
        severity: zeroCritical.length > 0 ? "blocker" : "major",
        category: "review",
        quote: "",
        problem,
        fix: "Revise the draft to raise the weak review dimensions before accepting it.",
      });
    }
    const instruction =
      zeroCritical.length > 0
        ? `Fix the weak dimensions: ${zeroCritical.map(([name]) => name).join(", ")}`
        : `Raise the review score (${average.toFixed(1)}/2 average)`;
    if (!instructions.includes(instruction)) instructions.push(instruction);
  }

  for (const defect of review.criticalDefects) {
    const problem = `Critical defect: ${defect}`;
    if (!issues.some((issue) => issue.problem === problem)) {
      issues.push({
        severity: "blocker",
        category: "review",
        quote: "",
        problem,
        fix: "Resolve this critical defect before accepting the draft.",
      });
    }
    const instruction = `Resolve this critical defect: ${defect}`;
    if (!instructions.includes(instruction)) instructions.push(instruction);
  }

  const reconciledIssues =
    deterministic === undefined
      ? issues
      : issues.filter((issue) => {
          if (issue.category !== "coverage") return true;
          const problem = normalizeForMatch(issue.problem.replace(/^missing deliverable[:\s]+/i, ""));
          return !deterministic.items.some((item) => {
            if (!item.covered) return false;
            const key = normalizeForMatch(item.item);
            return problem === key || problem.includes(key) || key.includes(problem);
          });
        });

  const hasMajorIssue = reconciledIssues.some((issue) => issue.severity !== "minor");
  const verdict =
    review.verdict === "reject"
      ? "reject"
      : missing.length > 0 || lowReview || hasMajorIssue
        ? "revise"
        : review.verdict === "revise" && reconciledIssues.length > 0
          ? "revise"
          : review.verdict === "revise"
            ? "accept"
            : review.verdict;

  return {
    ...review,
    verdict,
    coverage,
    issues: reconciledIssues,
    revisionInstructions: [...new Set(instructions)].slice(0, 5),
  };
}

const STYLE_WARNING_IDS = new Set([
  "generic",
  "generic-opening",
  "generic-claims",
  "repetition",
  "consultant-framing",
  "self-disqualification",
  "vague-example",
]);

/**
 * Turn deterministic naturalness warnings into review findings so the reviser
 * removes AI-sounding language even when the human-style reviewer was happy.
 * This is deliberately separate from coverage: a fluent draft can still sound
 * like a consultant and should not be accepted unchanged.
 */
export function withStyleGate(
  review: ProposalReview,
  quality: ProposalQualityResult
): ProposalReview {
  const warnings = quality.warnings.filter((warning) =>
    STYLE_WARNING_IDS.has(warning.id)
  );
  if (warnings.length === 0) return review;

  const issues = [...review.issues];
  const instructions = [...review.revisionInstructions];
  for (const warning of warnings) {
    const problem = `Generic writing: ${warning.message}`;
    if (!issues.some((issue) => issue.problem === problem)) {
      issues.push({
        severity: "major",
        category: "generic",
        quote: "",
        problem,
        fix: "Rewrite the generic sentence with a job-specific, verifiable detail, or remove it.",
      });
    }
    const instruction = `Remove generic writing: ${warning.message}`;
    if (!instructions.includes(instruction)) instructions.push(instruction);
  }

  return {
    ...review,
    verdict: review.verdict === "reject" ? "reject" : "revise",
    issues,
    revisionInstructions: [...new Set(instructions)].slice(0, 6),
  };
}

/* ------------------------------ Custom flow ------------------------------ */

function flowStepModel(
  step: FlowStep,
  ai: ReturnType<typeof getAiSettingsView>,
  override?: string
): string | undefined {
  return step.model ?? override ?? ai.proposalModelId ?? undefined;
}

function flowStepTemperature(
  step: FlowStep,
  ai: ReturnType<typeof getAiSettingsView>
): number {
  return step.temperature ?? ai.proposalTemperature;
}

function flowStepTimeoutMs(step: FlowStep): number {
  const fallback = step.type === "write" || step.type === "revise" || step.type === "custom" ? 180 : 120;
  return (step.timeoutSeconds ?? fallback) * 1000;
}

async function generateWithCustomFlow(
  data: ProposalJobInput,
  userId: string,
  config: ProposalEngineConfig,
  options?: { model?: string; onTrace?: ProposalTraceEmitter }
): Promise<PipelineResult> {
  const onTrace = options?.onTrace;
  const ai = getAiSettingsView(userId);
  const profile = getProfile(userId);
  if (profile === null) {
    throw new AppError(400, "BAD_REQUEST", "Save your profile before generating a proposal");
  }

  const enabledSteps = config.engine.flow.steps.filter((step) => step.enabled);
  if (enabledSteps.length === 0) {
    throw new AppError(400, "BAD_REQUEST", "Enable at least one custom flow step");
  }

  const text = jobText(data);
  const playbook = selectPlaybook(userId, text);
  emitTrace(onTrace, {
    phase: "setup",
    title: "Preparing proposal context",
    status: "started",
    detail: `Loading profile, playbook, and ${enabledSteps.length} flow step${
      enabledSteps.length === 1 ? "" : "s"
    }.`,
  });
  const flowTemplates = enabledSteps
    .map((step) => `${step.system}\n${step.user}`)
    .join("\n");
  const usesVoice = /\{\{\s*(samples|voice|voiceGuide)\s*\}\}/.test(flowTemplates);
  const samples = usesVoice ? selectVoiceSamples(userId, config.engine.maxSampleCount) : [];
  const voiceGuide = usesVoice
    ? await getVoiceGuide({
        userId,
        samples,
        model:
          enabledSteps.find((step) => step.type === "write")?.model ??
          options?.model ??
          ai.proposalModelId ??
          undefined,
        timeoutMs: 120_000,
        onTrace,
      })
    : null;

  emitTrace(onTrace, {
    phase: "setup",
    title: "Proposal context ready",
    status: "completed",
    detail: usesVoice
      ? "Profile, playbook, and voice guide loaded."
      : "Profile and playbook loaded.",
  });

  const amountSuffix = /hour/i.test(data.projectType ?? "") ? "/hour" : " fixed price";
  const includeCommercialsInBody =
    config.policy.commercials === "body_when_set" ||
    (config.policy.commercials === "if_client_asks" && clientAskedForCommercials(data));
  const forbidsCommercials = !includeCommercialsInBody;
  const profileFacts = buildProposalFactSheet(profile, {
    includePortfolio: false,
    includeCommercials: includeCommercialsInBody,
  });
  const enabledFiles = config.engine.flow.files.filter((file) => file.enabled);
  const fileVars = Object.fromEntries(
    enabledFiles.map((file) => [`file_${file.id}`, `[${file.label}]\n${file.content}`])
  );
  const allowedUrls = allowedEvidenceUrls(profile.portfolioSummary ?? null);

  const inspect = (draft: string): ProposalQualityResult =>
    evaluateProposalQuality(draft, {
      jobTitle: data.jobTitle,
      jobDescription: data.jobDescription,
      jobSkills: data.skills,
      profileSkills: profile.skills,
      bidAmount: data.bidAmount,
      deliveryDays: data.deliveryDays,
      allowedUrls,
      targetWords: config.policy.words,
      format: config.policy.format,
      requireCta: config.policy.askQuestion === "always",
      forbidCommercials: forbidsCommercials,
      bannedPhrases: config.policy.bannedPhrases,
      aiTells: config.checks.antiAiTells,
      forbidProjectUrls: config.checks.hard.includes("project_names"),
      forbiddenProjectNames: (profile.portfolioSummary ?? "")
        .split(/\r?\n/)
        .filter((line) => /^#{1,4}\s+/.test(line))
        .map((line) => line.replace(/^#{1,4}\s+/, "").trim()),
      requiredAnswers: brief.explicitQuestions,
    });

  let brief = adaptBriefForRelationship(enrichBrief(fallbackBrief(data), data));
  if (forbidsCommercials) brief = sanitizeBriefCommercials(brief);

  const known = {
    jobJson: jobForPrompt(data, includeCommercialsInBody),
    profileFacts,
    profileSummary: profile.userSummary ?? "",
    ownerInstructions: [
      profile.customInstructions,
      profile.proposalSystemInstructions,
      profile.proposalWritingInstructions,
    ]
      .map((value) => value?.trim() ?? "")
      .filter(Boolean)
      .join("\n\n"),
    ownerTemplates: profile.proposalTemplates ?? "",
    playbook: playbookText(playbook),
    samples: voiceGuide === null ? "" : voiceGuideText(voiceGuide),
    policyJson: json(config.policy),
    antiAiTells: config.checks.antiAiTells.map((tell) => `- ${tell}`).join("\n"),
    hardChecks: config.checks.hard.map((check) => `- ${check}`).join("\n"),
    bidAmountForPrompt:
      !includeCommercialsInBody || data.bidAmount == null
        ? ""
        : `Bid amount to quote: $${data.bidAmount.toLocaleString("en-US")}${amountSuffix}`,
    deliveryForPrompt:
      !includeCommercialsInBody || data.deliveryDays == null
        ? ""
        : `Delivery to quote: ${data.deliveryDays} day${data.deliveryDays === 1 ? "" : "s"}`,
  };

  const outputs = new Map<string, { text: string; data?: unknown }>();
  const candidates: string[] = [];
  let winnerIndex = 0;
  let currentDraft = "";
  let lastText = "";
  let finalText: string | null = null;
  let review: ProposalReview | null = null;
  let reviewUnavailable = false;
  let lastEvidence = "No portfolio evidence selected. Do not invent any.";
  let lastEvidenceItems!: Array<{ title: string }>;

  const assessmentFor = (draft: string) => {
    const quality = inspect(draft);
    const coverage = evaluateBriefCoverage(draft, brief);
    return {
      wordCount: quality.wordCount,
      coverageCount: coverage.coveredCount,
      coverageTotal: coverage.total,
      warnings: quality.warnings.map((warning) => warning.id),
      openingGeneric: hasGenericOpening(draft),
      genericClaims: genericClaims(draft),
      questionCount: (draft.match(/\?/g) ?? []).length,
    };
  };

  for (const step of enabledSteps) {
    const selectedFiles = step.fileIds
      .map((id) => config.engine.flow.files.find((file) => file.id === id))
      .filter((file): file is NonNullable<typeof file> => file !== undefined && file.enabled);
    const evidenceSelection = selectEvidence(
      profile.portfolioSummary ?? null,
      {
        jobTitle: data.jobTitle,
        jobDescription: [
          ...data.jobDescription,
          ...brief.deliverables,
          ...brief.facts,
          ...brief.evidenceNeeds,
        ],
        jobSkills: data.skills,
      },
      Math.min(config.engine.maxEvidenceItems, config.policy.maxEvidence),
      config.policy.includeLinks
    );
    lastEvidence = evidenceSelection.text;
    lastEvidenceItems = evidenceSelection.items;

    const stepOutputs = Object.fromEntries(
      [...outputs.entries()].map(([id, output]) => [`step_${id}`, output.text])
    );
    const candidatesJson = json(
      candidates.map((content, index) => ({
        index,
        content,
        deterministic: assessmentFor(content),
      }))
    );
    const filesText = selectedFiles
      .map((file) => `[${file.label}]\n${file.content}`)
      .join("\n\n---\n\n");
    const vars: Record<string, string | number | null | undefined> = {
      ...known,
      ...fileVars,
      ...stepOutputs,
      stepOutputsJson: json(
        Object.fromEntries([...outputs.entries()].map(([id, output]) => [id, output.text]))
      ),
      evidence: lastEvidence,
      jobBriefJson: json(brief),
      lastOutput: lastText,
      draft: currentDraft,
      candidatesJson,
      reviewJson: review === null ? "" : json(review),
      revisionInstructions:
        review?.revisionInstructions.map((instruction) => `- ${instruction}`).join("\n") ?? "",
      mustKeep: review?.mustKeep.map((item) => `- ${item}`).join("\n") ?? "",
      files: filesText,
    };

    if (step.type === "final") {
      if (lastText.trim().length === 0) {
        throw new AppError(
          400,
          "BAD_REQUEST",
          `Flow step "${step.label}" has no earlier text to finalize`
        );
      }
      finalText = lastText;
      outputs.set(step.id, { text: finalText });
      emitTrace(onTrace, {
        phase: "final",
        title: step.label,
        status: "completed",
        detail: "Final text selected. No model call was needed.",
      });
      continue;
    }

    // A revise step is a targeted response to review findings, not an
    // unconditional rewrite. Leave the draft untouched when review accepted it.
    if (step.type === "revise" && (review === null || review.verdict !== "revise")) {
      outputs.set(step.id, { text: currentDraft });
      emitTrace(onTrace, {
        phase: "revise",
        title: step.label,
        status: "info",
        detail: "Skipped because the latest review did not request a revision.",
      });
      continue;
    }

    const system = renderTemplate(step.system, vars);
    const user = renderTemplate(step.user, vars);
    const model = flowStepModel(step, ai, options?.model);
    const temperature = flowStepTemperature(step, ai);
    const timeoutMs = flowStepTimeoutMs(step);

    emitTrace(onTrace, {
      phase: step.type,
      title: step.label,
      status: "started",
      detail: model ? `Running on ${model}.` : "Running the configured step.",
    });

    try {
      if (step.type === "brief") {
        const raw = await tracedModelCall(
          onTrace,
          "brief",
          step.label,
          system,
          user,
          model,
          timeoutMs,
          { temperature, responseFormat: briefResponseFormat }
        );
        try {
          brief = adaptBriefForRelationship(
            enrichBrief(parseStage(raw, jobBriefSchema, step.label), data)
          );
          if (forbidsCommercials) brief = sanitizeBriefCommercials(brief);
          emitTrace(onTrace, {
            phase: "brief",
            title: step.label,
            status: "completed",
            detail: `${brief.deliverables.length} deliverable${
              brief.deliverables.length === 1 ? "" : "s"
            } and ${brief.risks.length} risk${brief.risks.length === 1 ? "" : "s"} identified.`,
          });
        } catch (error) {
          log.warn("Custom flow brief step failed; using deterministic brief", {
            step: step.label,
            error: error instanceof Error ? error.message : "unknown",
          });
          brief = adaptBriefForRelationship(enrichBrief(fallbackBrief(data), data));
          if (forbidsCommercials) brief = sanitizeBriefCommercials(brief);
          emitTrace(onTrace, {
            phase: "brief",
            title: step.label,
            status: "warning",
            detail: "Structured brief failed; using the deterministic fallback.",
          });
        }
        outputs.set(step.id, { text: json(brief), data: brief });
        continue;
      }

      if (step.type === "judge") {
        if (candidates.length < 2) {
          const chosen = candidates[0] ?? currentDraft;
          if (chosen.length > 0) {
            currentDraft = chosen;
            lastText = chosen;
            winnerIndex = 0;
          }
          outputs.set(step.id, { text: chosen });
          emitTrace(onTrace, {
            phase: "judge",
            title: step.label,
            status: "info",
            detail: "Skipped because fewer than two drafts were available.",
          });
          continue;
        }
        const raw = await tracedModelCall(
          onTrace,
          "judge",
          step.label,
          system,
          user,
          model,
          timeoutMs,
          { temperature, responseFormat: judgeResponseFormat }
        );
        const judge = parseStage(raw, judgeSchema, step.label);
        const chosen = candidates[judge.winnerIndex] ?? candidates[0] ?? "";
        if (chosen.length > 0) {
          currentDraft = chosen;
          lastText = chosen;
          winnerIndex = candidates[judge.winnerIndex] === undefined ? 0 : judge.winnerIndex;
        }
        outputs.set(step.id, { text: json(judge), data: judge });
        emitTrace(onTrace, {
          phase: "judge",
          title: step.label,
          status: "completed",
          detail: `Selected draft ${winnerIndex + 1} of ${candidates.length}.`,
        });
        continue;
      }

      if (step.type === "review") {
        if (currentDraft.trim().length === 0) {
          throw new AppError(
            400,
            "BAD_REQUEST",
            `Flow step "${step.label}" needs an earlier text draft`
          );
        }
        try {
          const raw = await tracedModelCall(
            onTrace,
            "review",
            step.label,
            system,
            user,
            model,
            timeoutMs,
            { temperature, responseFormat: reviewResponseFormat }
          );
          review = withStyleGate(
            withCoverageGate(
              parseStage(raw, proposalReviewSchema, step.label),
              evaluateBriefCoverage(currentDraft, brief)
            ),
            inspect(currentDraft)
          );
          reviewUnavailable = false;
          outputs.set(step.id, { text: json(review), data: review });
          emitTrace(onTrace, {
            phase: "review",
            title: step.label,
            status: "completed",
            detail: reviewTraceDetail(review),
          });

          // A review step controls approval, but custom flows are not required to
          // include a revise step. Apply one targeted revision so review findings
          // are not merely diagnostic unless the owner placed a revise step later.
          const laterReviseStep = enabledSteps
            .slice(enabledSteps.indexOf(step) + 1)
            .some((later) => later.type === "revise");
          if (review.verdict === "revise" && !laterReviseStep) {
            emitTrace(onTrace, {
              phase: "revise",
              title: "Applying review findings",
              status: "started",
              detail: "One targeted revision pass.",
            });
            try {
              const revisionVars = {
                ...known,
                jobBriefJson: json(brief),
                evidence: lastEvidence,
                draft: currentDraft,
                reviewJson: json(review),
                revisionInstructions: review.revisionInstructions
                  .map((instruction) => `- ${instruction}`)
                  .join("\n"),
                mustKeep: review.mustKeep.map((item) => `- ${item}`).join("\n"),
              };
              const revisionSystem = renderTemplate(
                config.prompts.reviser.system,
                revisionVars
              );
              const revisionUser = appendContract(
                renderTemplate(config.prompts.reviser.user, revisionVars),
                config.engine.contracts.reviser
              );
              const rawRevision = await tracedModelCall(
                onTrace,
                "revise",
                "Applying review findings",
                revisionSystem,
                revisionUser,
                config.engine.models.reviser ?? options?.model ?? ai.proposalModelId ?? undefined,
                config.engine.timeoutsSeconds.reviser * 1000,
                { temperature: config.engine.temperatures.reviser }
              );
              const revised = rawRevision.trim();
              if (revised.length > 0 && revised !== currentDraft) {
                const before = evaluateBriefCoverage(currentDraft, brief);
                const after = evaluateBriefCoverage(revised, brief);
                const lost = before.items.filter(
                  (item) =>
                    item.covered &&
                    !after.items.some(
                      (candidate) =>
                        candidate.covered &&
                        normalizeForMatch(candidate.item) === normalizeForMatch(item.item)
                    )
                );
                const lostEvidence = evidenceAnchors(lastEvidenceItems).filter(
                  (anchor) =>
                    currentDraft.toLowerCase().includes(anchor.toLowerCase()) &&
                    !revised.toLowerCase().includes(anchor.toLowerCase())
                );
                if (after.coveredCount < before.coveredCount || lostEvidence.length > 0) {
                  log.warn(
                    "Automatic revision reduced coverage or evidence; keeping the reviewed draft",
                    {
                      lost: lost.map((item) => item.item),
                      lostEvidence,
                    }
                  );
                  emitTrace(onTrace, {
                    phase: "revise",
                    title: "Applying review findings",
                    status: "warning",
                    detail: "Revision reduced coverage or evidence; kept the reviewed draft.",
                  });
                } else {
                  currentDraft = revised;
                  lastText = revised;
                  if (finalText !== null) finalText = revised;
                  emitTrace(onTrace, {
                    phase: "revise",
                    title: "Applying review findings",
                    status: "completed",
                    detail: `Revision applied (${words(revised)} words).`,
                  });
                }
              } else {
                emitTrace(onTrace, {
                  phase: "revise",
                  title: "Applying review findings",
                  status: "info",
                  detail: "The reviser returned no change; kept the reviewed draft.",
                });
              }
            } catch (error) {
              log.warn("Automatic revision failed; keeping the reviewed draft", {
                step: step.label,
                error: error instanceof Error ? error.message : "unknown",
              });
              emitTrace(onTrace, {
                phase: "revise",
                title: "Applying review findings",
                status: "warning",
                detail: "Revision failed; kept the reviewed draft.",
              });
            }
          }
        } catch (error) {
          review = null;
          reviewUnavailable = true;
          log.warn("Custom flow review step failed; the draft will require approval", {
            step: step.label,
            error: error instanceof Error ? error.message : "unknown",
          });
          emitTrace(onTrace, {
            phase: "review",
            title: step.label,
            status: "warning",
            detail: "Review failed; the draft will require human approval.",
          });
        }
        continue;
      }

      if (step.type === "write" || step.type === "revise" || step.type === "custom") {
        if (step.type === "revise" && currentDraft.trim().length === 0) {
          throw new AppError(
            400,
            "BAD_REQUEST",
            `Flow step "${step.label}" needs an earlier text draft`
          );
        }
        const raw = await tracedModelCall(
          onTrace,
          step.type,
          step.label,
          system,
          user,
          model,
          timeoutMs,
          { temperature }
        );
        const rawOutput = raw.trim();
        if (rawOutput.length === 0) {
          throw new AppError(502, "UPSTREAM_ERROR", `Flow step "${step.label}" returned no text`);
        }
        const output = rawOutput;
        if (step.type === "write") {
          candidates.push(output);
          winnerIndex = candidates.length - 1;
        }
        currentDraft = output;
        lastText = output;
        outputs.set(step.id, { text: output, data: output });
        emitTrace(onTrace, {
          phase: step.type,
          title: step.label,
          status: "completed",
          detail: `${words(output)} words in ${paragraphCount(output)} paragraph${
            paragraphCount(output) === 1 ? "" : "s"
          }.`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      emitTrace(onTrace, {
        phase: step.type,
        title: step.label,
        status: "failed",
        detail: message,
      });
      if (error instanceof AppError) throw error;
      throw new AppError(502, "UPSTREAM_ERROR", `Flow step "${step.label}" failed: ${message}`);
    }
  }

  const content = ensureReadableParagraphs(finalText ?? currentDraft ?? lastText);
  if (content.trim().length === 0) {
    throw new AppError(502, "UPSTREAM_ERROR", "The custom flow produced no proposal text");
  }

  const reviewWasConfigured = enabledSteps.some((step) => step.type === "review");
  const reviewStatus: ReviewStatus = !reviewWasConfigured
    ? "disabled"
    : reviewUnavailable || review === null
      ? "unavailable"
      : review.verdict === "accept"
        ? "accepted"
        : review.verdict === "reject"
          ? "rejected"
          : "needs_revision";
  const approvable = reviewStatus === "accepted" || reviewStatus === "disabled";
  const quality = inspect(content);
  const coverage = evaluateBriefCoverage(content, brief);

  emitTrace(onTrace, {
    phase: "final",
    title: "Final draft ready",
    status: "completed",
    detail: `${words(content)} words in ${paragraphCount(content)} paragraph${
      paragraphCount(content) === 1 ? "" : "s"
    }. Review: ${reviewStatus}.`,
    data: { wordCount: words(content), reviewStatus },
  });

  log.info(
    `Custom proposal flow finished for "${data.jobTitle}" (${words(content)} words, ${
      enabledSteps.length
    } step(s), review ${reviewStatus})`,
    { userId }
  );

  return {
    content: content.trim(),
    competitorNote: competitorNoteFor(data),
    review,
    reviewStatus,
    jobBrief: brief,
    playbook,
    samples,
    evidence: lastEvidence,
    coverage,
    candidates,
    winnerIndex,
    approvable,
    quality,
  };
}

/* ------------------------------ Main pipeline ----------------------------- */

export async function generateProposalWithPipeline(
  data: ProposalJobInput,
  userId: string,
  options?: { model?: string; onTrace?: ProposalTraceEmitter }
): Promise<PipelineResult> {
  const config = getProposalEngineConfig(userId);
  const ai = getAiSettingsView(userId);
  const profile = getProfile(userId);
  if (profile === null) {
    throw new AppError(400, "BAD_REQUEST", "Save your profile before generating a proposal");
  }
  if (config.engine.flow.enabled) {
    return generateWithCustomFlow(data, userId, config, options);
  }
  const onTrace = options?.onTrace;

  emitTrace(onTrace, {
    phase: "setup",
    title: "Preparing proposal context",
    status: "started",
    detail: "Loading profile, playbook, and voice guidance.",
  });

  const modelFor = (stage: keyof typeof config.engine.models): string | undefined =>
    config.engine.models[stage] ?? options?.model ?? ai.proposalModelId ?? undefined;
  const secondsFor = (stage: keyof typeof config.engine.timeoutsSeconds): number =>
    config.engine.timeoutsSeconds[stage] * 1000;
  const tempFor = (stage: keyof typeof config.engine.temperatures): number =>
    config.engine.temperatures[stage];

  const text = jobText(data);
  const playbook = selectPlaybook(userId, text);
  const samples = selectVoiceSamples(userId, config.engine.maxSampleCount);
  // The writer never receives raw sample proposals. They are distilled into a
  // style guide so the model can learn the owner's voice without using an old
  // proposal as a template or copying its client-specific content.
  const voiceGuide = await getVoiceGuide({
    userId,
    samples,
    model: modelFor("writer"),
    timeoutMs: secondsFor("brief"),
    onTrace,
  });
  emitTrace(onTrace, {
    phase: "setup",
    title: "Proposal context ready",
    status: "completed",
    detail: "Profile, playbook, and voice guidance loaded.",
  });
  const amountSuffix = /hour/i.test(data.projectType ?? "") ? "/hour" : " fixed price";
  const includeCommercialsInBody =
    config.policy.commercials === "body_when_set" ||
    (config.policy.commercials === "if_client_asks" && clientAskedForCommercials(data));
  const forbidsCommercials = !includeCommercialsInBody;
  const profileFacts = buildProposalFactSheet(profile, {
    includePortfolio: false,
    includeCommercials: includeCommercialsInBody,
  });
  const known = {
    jobJson: jobForPrompt(data, includeCommercialsInBody),
    profileFacts,
    playbook: playbookText(playbook),
    samples: voiceGuideText(voiceGuide),
    evidence: "No portfolio evidence selected. Do not invent any.",
    policyJson: json(config.policy),
    antiAiTells: config.checks.antiAiTells.map((tell) => `- ${tell}`).join("\n"),
    hardChecks: config.checks.hard.map((check) => `- ${check}`).join("\n"),
    bidAmountForPrompt:
      !includeCommercialsInBody || data.bidAmount == null
        ? ""
        : `Bid amount to quote: $${data.bidAmount.toLocaleString("en-US")}${amountSuffix}`,
    deliveryForPrompt:
      !includeCommercialsInBody || data.deliveryDays == null
        ? ""
        : `Delivery to quote: ${data.deliveryDays} day${data.deliveryDays === 1 ? "" : "s"}`,
  };

  // 1. Brief
  let brief: JobBrief;
  let briefSource: "model" | "fallback" | "disabled" = "disabled";
  if (config.engine.stages.brief) {
    emitTrace(onTrace, {
      phase: "brief",
      title: "Building job brief",
      status: "started",
      detail: "Extracting deliverables, questions, risks, and the best angle.",
    });
    try {
      const rawBrief = await tracedModelCall(
        onTrace,
        "brief",
        "Building job brief",
        renderTemplate(config.prompts.brief.system, known),
        renderTemplate(config.prompts.brief.user, known),
        modelFor("brief"),
        secondsFor("brief"),
        { temperature: tempFor("brief"), responseFormat: briefResponseFormat }
      );
      brief = parseStage(rawBrief, jobBriefSchema, "job brief");
      briefSource = "model";
    } catch (error) {
      log.warn("Job brief stage failed; using deterministic fallback", {
        error: error instanceof Error ? error.message : "unknown",
      });
      brief = fallbackBrief(data);
      briefSource = "fallback";
    }
  } else {
    brief = fallbackBrief(data);
  }

  brief = adaptBriefForRelationship(enrichBrief(brief, data));
  if (forbidsCommercials) {
    brief = sanitizeBriefCommercials(brief);
  }
  emitTrace(onTrace, {
    phase: "brief",
    title: "Job brief ready",
    status: briefSource === "fallback" ? "warning" : "completed",
    detail: `${
      briefSource === "model"
        ? "Model brief"
        : briefSource === "fallback"
          ? "Deterministic fallback brief"
          : "Brief stage disabled"
    }: ${brief.deliverables.length} deliverable${
      brief.deliverables.length === 1 ? "" : "s"
    }, ${brief.risks.length} risk${brief.risks.length === 1 ? "" : "s"}.`,
  });

  const policyMin = config.policy.words.min;
  const policyMax = config.policy.words.max;
  const targetMin =
    brief.relationship === "candidate_opportunity"
      ? Math.min(policyMax, Math.max(policyMin, 100))
      : brief.deliverables.length >= 5
        ? Math.min(policyMax, Math.max(policyMin, Math.round(policyMax * 0.85)))
        : Math.min(policyMax, Math.max(policyMin, Math.round(policyMax * 0.75)));
  const wordTarget = `${targetMin}-${policyMax} words`;
  const writerContract = renderTemplate(config.engine.contracts.writer, {
    wordTarget,
    relationshipGuidance: writerRelationshipGuidance(brief),
  });
  const reviewContract = renderTemplate(config.engine.contracts.reviewer, {
    relationshipGuidance: reviewerRelationshipGuidance(brief),
  });
  const revisionContract = config.engine.contracts.reviser;

  const evidenceSelection = selectEvidence(
    profile.portfolioSummary ?? null,
    {
      jobTitle: data.jobTitle,
      jobDescription: [
        ...data.jobDescription,
        ...brief.deliverables,
        ...brief.facts,
        ...brief.evidenceNeeds,
      ],
      jobSkills: data.skills,
    },
    Math.min(config.engine.maxEvidenceItems, config.policy.maxEvidence),
    config.policy.includeLinks
  );
  const evidence = evidenceSelection.text;
  const briefJson = json(brief);
  const briefVars = { ...known, evidence, jobBriefJson: briefJson };
  const allowedUrls = allowedEvidenceUrls(profile.portfolioSummary ?? null);

  const inspect = (draft: string): ProposalQualityResult =>
    evaluateProposalQuality(draft, {
      jobTitle: data.jobTitle,
      jobDescription: data.jobDescription,
      jobSkills: data.skills,
      profileSkills: profile.skills,
      bidAmount: data.bidAmount,
      deliveryDays: data.deliveryDays,
      allowedUrls,
      targetWords: config.policy.words,
      format: config.policy.format,
      requireCta: config.policy.askQuestion === "always",
      forbidCommercials: forbidsCommercials,
      bannedPhrases: config.policy.bannedPhrases,
      aiTells: config.checks.antiAiTells,
      forbidProjectUrls: config.checks.hard.includes("project_names"),
      forbiddenProjectNames: (profile.portfolioSummary ?? "")
        .split(/\r?\n/)
        .filter((line) => /^#{1,4}\s+/.test(line))
        .map((line) => line.replace(/^#{1,4}\s+/, "").trim()),
      requiredAnswers: brief.explicitQuestions,
    });

  const hardFailuresOf = (draftQuality: ProposalQualityResult) =>
    draftQuality.checks.filter(
      (check) => !check.passed && config.checks.hard.includes(check.id)
    );
  const policyFailuresOf = (draftQuality: ProposalQualityResult) =>
    draftQuality.checks.filter(
      (check) => !check.passed && config.checks.policy.includes(check.id)
    );
  const candidateAssessment = (draft: string) => {
    const draftQuality = inspect(draft);
    const draftCoverage = evaluateBriefCoverage(draft, brief);
    return {
      wordCount: draftQuality.wordCount,
      coverageCount: draftCoverage.coveredCount,
      coverageTotal: draftCoverage.total,
      hardFailures: hardFailuresOf(draftQuality).map((check) => check.id),
      policyFailures: policyFailuresOf(draftQuality).map((check) => check.id),
      warnings: draftQuality.warnings.map((warning) => warning.id),
      openingGeneric: hasGenericOpening(draft),
      genericClaims: genericClaims(draft),
      questionCount: (draft.match(/\?/g) ?? []).length,
    };
  };

  const runReview = async (
    draft: string,
    label = "Reviewing draft"
  ): Promise<{ review: ProposalReview | null; failed: boolean }> => {
    if (!config.engine.stages.review) return { review: null, failed: false };
    emitTrace(onTrace, {
      phase: "review",
      title: label,
      status: "started",
      detail: "Checking grounding, coverage, policy, and voice.",
    });
    try {
      const rawReview = await tracedModelCall(
        onTrace,
        "review",
        label,
        renderTemplate(config.prompts.reviewer.system, briefVars),
        appendContract(
          renderTemplate(config.prompts.reviewer.user, {
            ...briefVars,
            draft,
          }),
          reviewContract
        ),
        modelFor("reviewer"),
        secondsFor("reviewer"),
        { temperature: tempFor("reviewer"), responseFormat: reviewResponseFormat }
      );
      const review = withStyleGate(
        withCoverageGate(
          parseStage(rawReview, proposalReviewSchema, "review"),
          evaluateBriefCoverage(draft, brief)
        ),
        inspect(draft)
      );
      emitTrace(onTrace, {
        phase: "review",
        title: label,
        status: "completed",
        detail: reviewTraceDetail(review),
      });
      return { review, failed: false };
    } catch (error) {
      log.warn("Review stage failed; the draft will require human approval", {
        error: error instanceof Error ? error.message : "unknown",
      });
      emitTrace(onTrace, {
        phase: "review",
        title: label,
        status: "warning",
        detail: "Review failed; the draft will require human approval.",
      });
      return { review: null, failed: true };
    }
  };

  // 2. Candidates. Each enabled lane is one writer call, with an optional
  // model/temperature override. Old configs are normalized to lanes on read.
  const configuredLanes = (config.engine.candidateLanes ?? []).filter((lane) => lane.enabled);
  const shapes = config.engine.shapes.length > 0 ? config.engine.shapes : ["short_note"];
  const briefShape = configuredLanes.some((lane) => lane.id === brief.shape)
    ? brief.shape
    : configuredLanes[0]?.id ??
      (shapes.includes(brief.shape) ? brief.shape : (shapes[0] ?? "short_note"));
  const lanePool: CandidateLane[] =
    configuredLanes.length > 0
      ? configuredLanes
      : [
          {
            id: briefShape,
            label: briefShape,
            guidance: config.engine.shapeGuidance[briefShape] ?? "",
            model: null,
            temperature: null,
            timeoutSeconds: null,
            enabled: true,
          },
        ];
  const briefLane = lanePool.find((lane) => lane.id === briefShape) ?? lanePool[0]!;
  const otherLanes = lanePool.filter((lane) => lane.id !== briefLane.id);
  const lanesForRun = config.engine.stages.candidates
    ? [briefLane, ...otherLanes]
    : [briefLane];
  const candidateRelationship = brief.relationship === "candidate_opportunity";
  const relationshipGuidance =
    "A direct personal note. First paragraph: who you are and the exact fit. Second: one verified proof. Third: how you would start or what you offer. Fourth: a simple close. Keep it to 100-150 words. No plan, no advice to the client, no restating their offer.";

  emitTrace(onTrace, {
    phase: "write",
    title: "Drafting proposal",
    status: "started",
    detail: `Writing ${lanesForRun.length} candidate draft${
      lanesForRun.length === 1 ? "" : "s"
    }.`,
  });
  const candidateResults = await Promise.allSettled(
    lanesForRun.map((lane) => {
      const laneGuidance =
        lane.guidance || config.engine.shapeGuidance[lane.id] || `Follow the ${lane.label} candidate style.`;
      const shapeGuidance = candidateRelationship
        ? `${relationshipGuidance}\n\n${laneGuidance}`.trim()
        : laneGuidance;
      const vars = { ...briefVars, shape: lane.id, shapeGuidance };
      return tracedModelCall(
        onTrace,
        "write",
        `Drafting ${lane.label}`,
        renderTemplate(config.prompts.writer.system, {
          ...vars,
          freelancerName: profile.name ?? "the freelancer",
        }),
        appendContract(renderTemplate(config.prompts.writer.user, vars), writerContract),
        lane.model ?? modelFor("writer"),
        (lane.timeoutSeconds ?? config.engine.timeoutsSeconds.writer) * 1000,
        { temperature: lane.temperature ?? tempFor("writer") }
      );
    })
  );

  const candidates = candidateResults
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
    .map((result) => result.value.trim())
    .filter((content) => content.length > 0);

  if (candidates.length === 0) {
    const firstFailure = candidateResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    emitTrace(onTrace, {
      phase: "write",
      title: "Drafting proposal",
      status: "failed",
      detail: "No usable draft was returned by the writer.",
    });
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Proposal generation failed: ${
        firstFailure?.reason instanceof Error ? firstFailure.reason.message : "empty response"
      }`
    );
  }

  emitTrace(onTrace, {
    phase: "write",
    title: "Drafting proposal",
    status: "completed",
    detail: `${candidates.length} draft${candidates.length === 1 ? "" : "s"} ready.`,
  });

  const candidateRecords = candidates.map((content, index) => ({
    index,
    content,
    assessment: candidateAssessment(content),
  }));
  const eligible = candidateRecords.filter(
    (record) =>
      record.assessment.hardFailures.length === 0 &&
      record.assessment.policyFailures.length === 0
  );
  const bestCoverage =
    eligible.length > 0
      ? Math.max(...eligible.map((record) => record.assessment.coverageCount))
      : 0;
  const coveragePool = eligible.filter(
    (record) => record.assessment.coverageCount === bestCoverage
  );
  const judgePool = coveragePool.length > 0 ? coveragePool : eligible.length > 0 ? eligible : candidateRecords;
  const judgedPool = [...judgePool];
  for (let index = judgedPool.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [judgedPool[index], judgedPool[swap]] = [judgedPool[swap]!, judgedPool[index]!];
  }
  let winnerIndex = judgePool[0]?.index ?? 0;

  if (judgePool.length > 1 && config.engine.stages.judge) {
    emitTrace(onTrace, {
      phase: "judge",
      title: "Choosing the strongest draft",
      status: "started",
      detail: `Comparing ${judgedPool.length} eligible drafts.`,
    });
    try {
      const candidatesJson = json(
        judgedPool.map((record, position) => ({
          index: position,
          content: record.content,
          deterministic: record.assessment,
        }))
      );
      const rawJudge = await tracedModelCall(
        onTrace,
        "judge",
        "Choosing the strongest draft",
        renderTemplate(config.prompts.judge.system, briefVars),
        appendContract(
          renderTemplate(config.prompts.judge.user, {
            ...briefVars,
            candidatesJson,
          }),
          reviewContract
        ),
        modelFor("judge"),
        secondsFor("judge"),
        { temperature: tempFor("judge"), responseFormat: judgeResponseFormat }
      );
      const judge = parseStage(rawJudge, judgeSchema, "judge");
      const chosen = judgedPool[judge.winnerIndex];
      if (chosen !== undefined) {
        winnerIndex = chosen.index;
      }
      emitTrace(onTrace, {
        phase: "judge",
        title: "Choosing the strongest draft",
        status: "completed",
        detail: `Selected candidate ${winnerIndex + 1} of ${candidates.length}.`,
      });
    } catch (error) {
      log.warn("Judge stage failed; using the first eligible candidate", {
        error: error instanceof Error ? error.message : "unknown",
      });
      emitTrace(onTrace, {
        phase: "judge",
        title: "Choosing the strongest draft",
        status: "warning",
        detail: "Judge failed; using the first eligible draft.",
      });
    }
  } else {
    emitTrace(onTrace, {
      phase: "judge",
      title: "Choosing the strongest draft",
      status: "info",
      detail:
        judgePool.length > 1
          ? "Judge stage disabled; using the first eligible draft."
          : "Only one eligible draft; no comparison needed.",
    });
  }
  let content = candidates[winnerIndex] ?? candidates[0] ?? "";

  // 3. Review
  const initialReview = await runReview(content, "Reviewing draft");
  let review: ProposalReview | null = initialReview.review;
  let reviewUnavailable = initialReview.failed;
  let contentChanged = false;

  // 4. Targeted revision
  if (
    review !== null &&
    review.verdict === "revise" &&
    config.engine.stages.revision &&
    config.engine.maxRevisionAttempts > 0
  ) {
    emitTrace(onTrace, {
      phase: "revise",
      title: "Applying review findings",
      status: "started",
      detail: "One targeted revision pass.",
    });
    try {
      const rawRevision = await tracedModelCall(
        onTrace,
        "revise",
        "Applying review findings",
        renderTemplate(config.prompts.reviser.system, briefVars),
        appendContract(
          renderTemplate(config.prompts.reviser.user, {
            ...briefVars,
            draft: content,
            reviewJson: json(review),
            revisionInstructions: review.revisionInstructions.map((line) => `- ${line}`).join("\n"),
            mustKeep: review.mustKeep.map((line) => `- ${line}`).join("\n"),
          }),
          revisionContract
        ),
        modelFor("reviser"),
        secondsFor("reviser"),
        { temperature: tempFor("reviser") }
      );
      const revised = rawRevision.trim();
      if (revised.length > 0 && revised !== content) {
        const before = evaluateBriefCoverage(content, brief);
        const after = evaluateBriefCoverage(revised, brief);
        const lost = before.items.filter(
          (item) =>
            item.covered &&
            !after.items.some(
              (candidate) =>
                candidate.covered &&
                normalizeForMatch(candidate.item) === normalizeForMatch(item.item)
            )
        );
        const lostEvidence = evidenceAnchors(evidenceSelection.items).filter(
          (anchor) =>
            content.toLowerCase().includes(anchor.toLowerCase()) &&
            !revised.toLowerCase().includes(anchor.toLowerCase())
        );
        if (after.coveredCount < before.coveredCount || lostEvidence.length > 0) {
          log.warn("Revision reduced coverage or evidence; keeping the reviewed draft", {
            lost: lost.map((item) => item.item),
            lostEvidence,
          });
          emitTrace(onTrace, {
            phase: "revise",
            title: "Applying review findings",
            status: "warning",
            detail: "Revision reduced coverage or evidence; kept the reviewed draft.",
          });
        } else {
          content = revised;
          contentChanged = true;
          emitTrace(onTrace, {
            phase: "revise",
            title: "Applying review findings",
            status: "completed",
            detail: `Revision applied (${words(revised)} words).`,
          });
        }
      } else {
        emitTrace(onTrace, {
          phase: "revise",
          title: "Applying review findings",
          status: "info",
          detail: "The reviser returned no change; kept the reviewed draft.",
        });
      }
    } catch (error) {
      log.warn("Revision stage failed; keeping the reviewed draft", {
        error: error instanceof Error ? error.message : "unknown",
      });
      emitTrace(onTrace, {
        phase: "revise",
        title: "Applying review findings",
        status: "warning",
        detail: "Revision failed; kept the reviewed draft.",
      });
    }
  }

  // 5. Optional deletion pass. Compression is never a quota: it runs only when
  // the draft is over the policy ceiling or carries observable filler, and the
  // result is rejected if it loses coverage or crosses a word boundary.
  const preDeletionQuality = inspect(content);
  const deletionWarnings = new Set(["generic", "generic-opening", "generic-claims", "repetition"]);
  const needsCompression =
    words(content) > config.policy.words.max ||
    preDeletionQuality.warnings.some((warning) => deletionWarnings.has(warning.id)) ||
    (config.engine.minWordsForDeletion > 0 &&
      words(content) >= config.engine.minWordsForDeletion &&
      preDeletionQuality.warnings.length > 0);

  if (config.engine.stages.deletion && needsCompression) {
    emitTrace(onTrace, {
      phase: "delete",
      title: "Compressing draft",
      status: "started",
      detail: "Removing filler while protecting coverage and evidence.",
    });
    try {
      const rawCut = await tracedModelCall(
        onTrace,
        "delete",
        "Compressing draft",
        renderTemplate(config.prompts.deleter.system, briefVars),
        renderTemplate(config.prompts.deleter.user, { ...briefVars, draft: content }),
        modelFor("deleter"),
        secondsFor("deleter"),
        { temperature: tempFor("deleter") }
      );
      const cut = rawCut.trim();
      const guard = evaluateDeletionCandidate({
        before: content,
        after: cut,
        minWords: config.policy.words.min,
        maxWords: config.policy.words.max,
        brief,
      });
      const lostEvidence = evidenceAnchors(evidenceSelection.items).filter(
        (anchor) =>
          content.toLowerCase().includes(anchor.toLowerCase()) &&
          !cut.toLowerCase().includes(anchor.toLowerCase())
      );
      if (cut.length > 0 && cut !== content && guard.accept && lostEvidence.length === 0) {
        content = cut;
        contentChanged = true;
        emitTrace(onTrace, {
          phase: "delete",
          title: "Compressing draft",
          status: "completed",
          detail: `Draft tightened to ${words(cut)} words.`,
        });
      } else {
        log.warn("Deletion candidate rejected; keeping the current draft", {
          reasons:
            lostEvidence.length > 0
              ? [...guard.reasons, `lost evidence: ${lostEvidence.join(", ")}`]
              : guard.reasons,
        });
        emitTrace(onTrace, {
          phase: "delete",
          title: "Compressing draft",
          status: "warning",
          detail: "Compression rejected; kept the current draft.",
        });
      }
    } catch (error) {
      log.warn("Deletion stage failed; keeping the current draft", {
        error: error instanceof Error ? error.message : "unknown",
      });
      emitTrace(onTrace, {
        phase: "delete",
        title: "Compressing draft",
        status: "warning",
        detail: "Compression failed; kept the current draft.",
      });
    }
  } else if (config.engine.stages.deletion) {
    emitTrace(onTrace, {
      phase: "delete",
      title: "Compressing draft",
      status: "info",
      detail: "Skipped because the draft is already within the target length.",
    });
  }

  // 6. One dedicated naturalness rewrite. Reviewers often accept fluent but
  // generic prose; this pass targets only deterministic AI/consultant tells.
  const styleBeforeRepair = inspect(content).warnings.filter((warning) =>
    STYLE_WARNING_IDS.has(warning.id)
  );
  if (
    styleBeforeRepair.length > 0 &&
    config.engine.stages.revision &&
    config.engine.maxRevisionAttempts > 0
  ) {
    emitTrace(onTrace, {
      phase: "revise",
      title: "Removing generic phrasing",
      status: "started",
      detail: styleBeforeRepair.map((warning) => warning.message).join("; "),
    });
    try {
      const styleReview = withStyleGate(
        {
          verdict: "accept",
          dimensions: {
            jobUnderstanding: 2,
            specificity: 2,
            technicalJudgment: 2,
            evidence: 2,
            voiceMatch: 2,
            naturalness: 0,
            conciseness: 2,
            grounding: 2,
            policy: 2,
            relevance: 2,
            coverage: 2,
            safety: 2,
          },
          issues: [],
          coverage: [],
          criticalDefects: [],
          revisionInstructions: [],
          mustKeep: [
            "every covered deliverable",
            "the selected verified evidence",
            "the job-specific opening",
          ],
        },
        inspect(content)
      );
      const rawStyleRevision = await tracedModelCall(
        onTrace,
        "revise",
        "Removing generic phrasing",
        renderTemplate(config.prompts.reviser.system, briefVars),
        appendContract(
          renderTemplate(config.prompts.reviser.user, {
            ...briefVars,
            draft: content,
            reviewJson: json(styleReview),
            revisionInstructions: styleReview.revisionInstructions
              .map((line) => `- ${line}`)
              .join("\n"),
            mustKeep: styleReview.mustKeep.map((line) => `- ${line}`).join("\n"),
          }),
          revisionContract
        ),
        modelFor("reviser"),
        secondsFor("reviser"),
        { temperature: tempFor("reviser") }
      );
      const styleRevised = rawStyleRevision.trim();
      if (styleRevised.length > 0 && styleRevised !== content) {
        const beforeCoverage = evaluateBriefCoverage(content, brief);
        const afterCoverage = evaluateBriefCoverage(styleRevised, brief);
        const lostEvidence = evidenceAnchors(evidenceSelection.items).filter(
          (anchor) =>
            content.toLowerCase().includes(anchor.toLowerCase()) &&
            !styleRevised.toLowerCase().includes(anchor.toLowerCase())
        );
        const remainingStyle = inspect(styleRevised).warnings.filter((warning) =>
          STYLE_WARNING_IDS.has(warning.id)
        );
        if (
          afterCoverage.coveredCount >= beforeCoverage.coveredCount &&
          lostEvidence.length === 0 &&
          remainingStyle.length < styleBeforeRepair.length
        ) {
          content = styleRevised;
          contentChanged = true;
          emitTrace(onTrace, {
            phase: "revise",
            title: "Removing generic phrasing",
            status: "completed",
            detail: `Removed ${styleBeforeRepair.length - remainingStyle.length} generic warning(s).`,
          });
        } else {
          emitTrace(onTrace, {
            phase: "revise",
            title: "Removing generic phrasing",
            status: "warning",
            detail: "Style rewrite did not improve the draft safely; kept the previous version.",
          });
        }
      } else {
        emitTrace(onTrace, {
          phase: "revise",
          title: "Removing generic phrasing",
          status: "info",
          detail: "The editor returned no change.",
        });
      }
    } catch (error) {
      log.warn("Style revision failed; keeping the current draft", {
        error: error instanceof Error ? error.message : "unknown",
      });
      emitTrace(onTrace, {
        phase: "revise",
        title: "Removing generic phrasing",
        status: "warning",
        detail: "Style revision failed; kept the current draft.",
      });
    }
  }

  // 7. Deterministic validation and one targeted repair
  emitTrace(onTrace, {
    phase: "validate",
    title: "Running final checks",
    status: "started",
    detail: "Checking structure, length, grounding, and policy.",
  });
  if (forbidsCommercials) {
    const stripped = stripCommercialMentions(content);
    if (stripped !== content) {
      content = stripped;
      contentChanged = true;
    }
  }

  let quality = inspect(content);
  const failures = () => [...hardFailuresOf(quality), ...policyFailuresOf(quality)];

  for (
    let attempt = 0;
    failures().length > 0 &&
    config.engine.stages.deterministicValidation &&
    attempt < config.engine.maxRepairAttempts;
    attempt++
  ) {
    const current = failures();
    log.warn("Proposal failed validation; repairing", {
      jobTitle: data.jobTitle,
      failures: current.map((check) => check.id),
    });
    try {
      const repairReview: ProposalReview = {
        verdict: "revise",
        dimensions: {
          jobUnderstanding: 1,
          specificity: 1,
          technicalJudgment: 1,
          evidence: 1,
          voiceMatch: 1,
          naturalness: 1,
          conciseness: 1,
          grounding: 1,
          policy: 0,
          relevance: 1,
          coverage: 1,
          safety: 1,
        },
        issues: current.map((check) => ({
          severity: "blocker",
          category: "policy",
          quote: "",
          problem: check.label,
          fix: `Fix this check: ${check.label} (${check.detail}).`,
        })),
        coverage: [],
        criticalDefects: [],
        revisionInstructions: current.map(
          (check) => `Fix ${check.id}: ${check.label} (${check.detail}).`
        ),
        mustKeep: ["the owner's voice", "the strongest specific detail", "the single useful question"],
      };
      const rawRepair = await tracedModelCall(
        onTrace,
        "validate",
        "Repairing failed checks",
        renderTemplate(config.prompts.reviser.system, briefVars),
        renderTemplate(config.prompts.reviser.user, {
          ...briefVars,
          draft: content,
          reviewJson: json(repairReview),
          revisionInstructions: repairReview.revisionInstructions.map((line) => `- ${line}`).join("\n"),
          mustKeep: repairReview.mustKeep.map((line) => `- ${line}`).join("\n"),
        }),
        modelFor("reviser"),
        secondsFor("reviser"),
        { temperature: tempFor("reviser") }
      );
      const repaired = rawRepair.trim();
      if (repaired.length > 0) {
        const nextContent = forbidsCommercials
          ? stripCommercialMentions(repaired)
          : repaired;
        if (nextContent !== content) contentChanged = true;
        content = nextContent;
        quality = inspect(content);
      }
    } catch (error) {
      log.warn("Repair stage failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      break;
    }
  }

  const finalFailures = failures();
  const validationBlocked =
    config.engine.stages.deterministicValidation && finalFailures.length > 0;

  quality = inspect(content);
  const coverage = evaluateBriefCoverage(content, brief);
  emitTrace(onTrace, {
    phase: "validate",
    title: "Running final checks",
    status: validationBlocked ? "warning" : "completed",
    detail: validationBlocked
      ? `Draft kept for human review. Failed checks: ${finalFailures
          .map((check) => check.id)
          .join(", ")}.`
      : config.engine.stages.deterministicValidation
        ? "No blocking checks. Final length and structure look good."
        : "Deterministic validation is disabled; length and structure were still normalized.",
  });

  // Re-review after any later edit. A failed re-review must clear the old
  // accepting verdict; otherwise automation could approve stale content.
  if (contentChanged && config.engine.stages.review) {
    const finalReview = await runReview(content, "Re-reviewing final draft");
    reviewUnavailable = finalReview.failed;
    review = finalReview.review;
  }

  if (review !== null && review.verdict === "accept" && coverage.missing.length > 0) {
    review = withStyleGate(
      withCoverageGate({
        ...review,
        coverage: coverage.items.map((item) => ({
          deliverable: item.item,
          covered: item.covered,
          evidence: "",
        })),
      }),
      inspect(content)
    );
  }

  if (validationBlocked) {
    const baseReview: ProposalReview = review ?? {
      verdict: "revise",
      dimensions: {
        jobUnderstanding: 1,
        specificity: 1,
        technicalJudgment: 1,
        evidence: 1,
        voiceMatch: 1,
        naturalness: 1,
        conciseness: 1,
        grounding: 1,
        policy: 1,
        relevance: 1,
        coverage: 1,
        safety: 1,
      },
      issues: [],
      coverage: [],
      criticalDefects: [],
      revisionInstructions: [],
      mustKeep: ["the generated draft"],
    };
    const validationIssues: ProposalReview["issues"] = finalFailures.map((check) => ({
      severity: "major",
      category: "validation",
      quote: "",
      problem: check.label,
      fix: `Review and fix this check before approval: ${check.label} (${check.detail}).`,
    }));
    review = {
      ...baseReview,
      verdict: baseReview.verdict === "reject" ? "reject" : "revise",
      issues: [
        ...baseReview.issues,
        ...validationIssues.filter(
          (issue) => !baseReview.issues.some((existing) => existing.problem === issue.problem)
        ),
      ],
      revisionInstructions: [
        ...new Set([
          ...baseReview.revisionInstructions,
          ...finalFailures.map(
            (check) => `Review ${check.id}: ${check.label} (${check.detail}).`
          ),
        ]),
      ].slice(0, 10),
    };
  }

  const reviewStatus: ReviewStatus =
    validationBlocked
      ? "needs_revision"
      : !config.engine.stages.review
        ? "disabled"
        : reviewUnavailable || review === null
          ? "unavailable"
          : review.verdict === "accept"
            ? "accepted"
            : review.verdict === "reject"
              ? "rejected"
              : "needs_revision";

  // Fail closed for automation: if review was requested but could not run,
  // or the final content is not accepted, a human must approve the draft. When
  // review is disabled entirely, keep the existing single-writer behavior.
  const approvable = reviewStatus === "accepted" || reviewStatus === "disabled";

  content = ensureReadableParagraphs(content);

  emitTrace(onTrace, {
    phase: "final",
    title: "Final draft ready",
    status: "completed",
    detail: `${words(content)} words in ${paragraphCount(content)} paragraph${
      paragraphCount(content) === 1 ? "" : "s"
    }. Review: ${reviewStatus}.`,
    data: { wordCount: words(content), reviewStatus },
  });

  log.info(
    `Proposal pipeline finished for "${data.jobTitle}" (${words(content)} words, ${
      candidates.length
    } candidate(s), review ${reviewStatus})`,
    { userId }
  );

  return {
    content,
    competitorNote: competitorNoteFor(data),
    review,
    reviewStatus,
    jobBrief: brief,
    playbook,
    samples,
    evidence,
    coverage,
    candidates,
    winnerIndex,
    approvable,
    quality,
  };
}
