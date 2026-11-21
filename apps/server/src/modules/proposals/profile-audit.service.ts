import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import {
  buildStructuredResponseFormat,
  callOpenRouterStructured,
} from "../ai/ai.service.js";
import { getAiSettingsView } from "../ai/ai-settings.service.js";
import { getProfile, type ProfileData } from "../profile/profile.service.js";
import type {
  ProfileAuditRule,
  ProfileAuditSettings,
} from "../../lib/profile-audit-defaults.js";
import {
  getProfileAuditSettings,
  getProposalEngineConfig,
  renderTemplate,
  saveProfileAudit,
  type StoredProfileAudit,
} from "./proposal-config.service.js";

const log = createLogger("proposal");

export type AuditSeverity = "blocker" | "warning" | "info";

export interface ProfileFinding {
  ruleId: string;
  severity: AuditSeverity;
  category: string;
  field: string;
  title: string;
  evidence: string;
  why: string;
  recommendation: string;
  suggestedText?: string;
}

export interface ProfileAuditResult {
  score: number;
  status: "good" | "needs_attention" | "poor";
  summary: string;
  findings: ProfileFinding[];
  model: string | null;
  audit: StoredProfileAudit;
}

const aiFindingSchema = z.object({
  ruleId: z.string().default("ai-audit"),
  severity: z.enum(["blocker", "warning", "info"]),
  category: z.string().default("ambiguity"),
  field: z.string().default("profile"),
  title: z.string().min(1),
  evidence: z.string().default(""),
  why: z.string().default(""),
  recommendation: z.string().min(1),
  suggestedText: z.string().default(""),
});

const aiAuditSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string().default(""),
  findings: z.array(aiFindingSchema).default([]),
});

const aiAuditResponseFormat = buildStructuredResponseFormat(
  "profile_audit",
  z.toJSONSchema(aiAuditSchema) as Record<string, unknown>
);

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

function clamp(value: string | null | undefined, max = 8000): string {
  const text = value?.trim() ?? "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated]`;
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ruleFor(
  settings: ProfileAuditSettings,
  id: string
): ProfileAuditRule | null {
  return settings.rules.find((rule) => rule.id === id) ?? null;
}

function makeFinding(
  settings: ProfileAuditSettings,
  id: string,
  finding: Omit<ProfileFinding, "ruleId" | "severity">
): ProfileFinding | null {
  const rule = ruleFor(settings, id);
  if (rule === null || !rule.enabled) return null;
  return { ...finding, ruleId: id, severity: rule.severity };
}

function overlaps(wants: string[], notWants: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const want of wants) {
    const a = normalized(want);
    if (a.length < 3) continue;
    for (const notWant of notWants) {
      const b = normalized(notWant);
      if (b.length < 3) continue;
      if (a === b || a.includes(b) || b.includes(a)) {
        pairs.push([want, notWant]);
      }
    }
  }
  return pairs;
}

function duplicateValues(values: string[]): string[] {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    const key = normalized(value).replace(/[.\s-]+/g, " ");
    if (key.length === 0) continue;
    if (seen.has(key)) duplicates.add(value);
    else seen.set(key, value);
  }
  return [...duplicates];
}

const CONFLICT_TOPICS: Array<{ id: string; positive: RegExp; negative: RegExp }> = [
  {
    id: "price",
    positive: /\b(include|quote|state|mention|add)\b[^.\n]{0,40}\b(price|budget|rate|cost)\b/i,
    negative: /\b(never|don't|do not|avoid|no)\b[^.\n]{0,40}\b(price|budget|rate|cost)\b/i,
  },
  {
    id: "delivery",
    positive: /\b(include|quote|state|mention|add)\b[^.\n]{0,40}\b(delivery|timeline|days|weeks)\b/i,
    negative: /\b(never|don't|do not|avoid|no)\b[^.\n]{0,40}\b(delivery|timeline|days|weeks)\b/i,
  },
  {
    id: "question",
    positive: /\b(end with|ask|include)\b[^.\n]{0,40}\bquestion\b/i,
    negative: /\b(never|don't|do not|avoid|no)\b[^.\n]{0,40}\bquestion\b/i,
  },
  {
    id: "links",
    positive: /\b(include|add|share|attach)\b[^.\n]{0,40}\b(link|portfolio|url)\b/i,
    negative: /\b(never|don't|do not|avoid|no)\b[^.\n]{0,40}\b(link|portfolio|url)\b/i,
  },
  {
    id: "greeting",
    positive: /\b(start with|use|include)\b[^.\n]{0,40}\b(dear|hi|hello|greeting)\b/i,
    negative: /\b(never|don't|do not|avoid|no)\b[^.\n]{0,40}\b(dear|greeting)\b/i,
  },
  {
    id: "headings",
    positive: /\b(use|include|add)\b[^.\n]{0,40}\b(heading|headings|bold|bullets?)\b/i,
    negative: /\b(never|don't|do not|avoid|no)\b[^.\n]{0,40}\b(heading|headings|bold|bullets?)\b/i,
  },
];

function instructionBlocks(profile: ProfileData): Array<{ field: string; text: string }> {
  return [
    { field: "customInstructions", text: profile.customInstructions ?? "" },
    { field: "relevancyInstructions", text: profile.relevancyInstructions ?? "" },
    { field: "proposalWritingInstructions", text: profile.proposalWritingInstructions ?? "" },
    { field: "proposalSystemInstructions", text: profile.proposalSystemInstructions ?? "" },
    { field: "proposalTemplates", text: profile.proposalTemplates ?? "" },
  ].filter((entry) => entry.text.trim().length > 0);
}

const LEGACY_FORMAT_PATTERN =
  /\b(mandatory format|exact format|must follow this structure|always start with|always end with|dear hiring manager)\b/i;

export function aiFindingIsGrounded(
  finding: ProfileFinding,
  profile: ProfileData,
  policy: ReturnType<typeof getProposalEngineConfig>["policy"]
): boolean {
  if (finding.ruleId === "wall-of-rules") {
    return instructionBlocks(profile).some((block) => block.text.length > 4000);
  }
  if (finding.ruleId === "legacy-format-conflict") {
    return (
      policy.format === "natural" &&
      instructionBlocks(profile).some((block) => LEGACY_FORMAT_PATTERN.test(block.text))
    );
  }
  if (finding.ruleId === "ignored-country-conflict") {
    const targetText = normalized(
      [
        ...profile.wants,
        ...profile.preferredProjectTypes,
        profile.customInstructions ?? "",
      ].join(" ")
    );
    return profile.ignoredCountries.some((country) => {
      const key = normalized(country);
      return key.length >= 3 && targetText.includes(key);
    });
  }
  return true;
}

export function deterministicProfileFindings(
  profile: ProfileData,
  settings: ProfileAuditSettings,
  policy: ReturnType<typeof getProposalEngineConfig>["policy"]
): ProfileFinding[] {
  const findings: ProfileFinding[] = [];

  const missing: string[] = [];
  if (!profile.name?.trim()) missing.push("name");
  if (!profile.title?.trim()) missing.push("title");
  if (!profile.about?.trim() || profile.about.trim().length < 120) missing.push("about (120+ characters)");
  if (profile.skills.length === 0) missing.push("skills");
  if (!profile.portfolioSummary?.trim() || profile.portfolioSummary.trim().length < 80) {
    missing.push("portfolio summary");
  }
  if (missing.length > 0) {
    const finding = makeFinding(settings, "missing-core-fields", {
      category: "missing",
      field: missing.join(", "),
      title: "Core profile facts are missing or too thin",
      evidence: `Missing or too short: ${missing.join(", ")}.`,
      why: "The proposal writer can only use saved facts. Missing facts force it to stay generic or risk inventing details.",
      recommendation: "Fill the missing fields with concrete, verifiable facts before generating or auto-bidding.",
    });
    if (finding) findings.push(finding);
  }

  const conflicts = overlaps(profile.wants, profile.notWants);
  if (conflicts.length > 0) {
    const finding = makeFinding(settings, "wants-conflict", {
      category: "conflict",
      field: "wants / notWants",
      title: "Wants and not-wants overlap",
      evidence: conflicts
        .slice(0, 6)
        .map(([want, notWant]) => `"${want}" also appears as "${notWant}"`)
        .join("; "),
      why: "Screening and proposal prompts receive both lists, so the model gets contradictory instructions on the same term.",
      recommendation: "Keep each term in exactly one list, or make the distinction explicit (for example 'WordPress maintenance' vs 'WordPress plugin development').",
    });
    if (finding) findings.push(finding);
  }

  const ignoredHits: string[] = [];
  const targetText = normalized(
    [
      ...profile.wants,
      ...profile.preferredProjectTypes,
      profile.customInstructions ?? "",
    ].join(" ")
  );
  for (const country of profile.ignoredCountries) {
    const key = normalized(country);
    if (key.length >= 3 && targetText.includes(key)) ignoredHits.push(country);
  }
  if (ignoredHits.length > 0) {
    const finding = makeFinding(settings, "ignored-country-conflict", {
      category: "conflict",
      field: "ignoredCountries",
      title: "Ignored countries appear in target preferences",
      evidence: `Also referenced as a target: ${ignoredHits.join(", ")}.`,
      why: "The job can be excluded before analysis while the proposal instructions still treat that market as wanted.",
      recommendation: "Remove the country from one side, or narrow the rule to a specific city/region if the intent is different.",
    });
    if (finding) findings.push(finding);
  }

  const duplicateSkills = duplicateValues(profile.skills);
  if (duplicateSkills.length > 0) {
    const finding = makeFinding(settings, "duplicate-skills", {
      category: "redundancy",
      field: "skills",
      title: "Skills contain duplicates",
      evidence: duplicateSkills.join(", "),
      why: "Duplicates waste prompt space and can make matching scores look stronger than they are.",
      recommendation: "Remove case-insensitive duplicates and merge near-identical skills.",
    });
    if (finding) findings.push(finding);
  }

  const blocks = instructionBlocks(profile);
  const conflictEvidence: string[] = [];
  for (const block of blocks) {
    const sentences = block.text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);
    for (const topic of CONFLICT_TOPICS) {
      // Judge each sentence on its own so "do not include links" is not read as
      // both a positive and a negative rule.
      const positive = sentences.some(
        (sentence) => topic.positive.test(sentence) && !topic.negative.test(sentence)
      );
      const negative = sentences.some((sentence) => topic.negative.test(sentence));
      if (positive && negative) {
        conflictEvidence.push(`${block.field} says both yes and no about ${topic.id}`);
      }
    }
  }
  if (conflictEvidence.length > 0) {
    const finding = makeFinding(settings, "conflicting-instructions", {
      category: "conflict",
      field: "instruction blocks",
      title: "Instructions contradict each other",
      evidence: [...new Set(conflictEvidence)].join("; "),
      why: "The model cannot resolve mutually exclusive rules, so it follows the last one it saw or ignores both.",
      recommendation: "Keep one rule per topic, or split them by condition (for example 'state price only when the client asks').",
    });
    if (finding) findings.push(finding);
  }

  const legacyEvidence: string[] = [];
  if (policy.format === "natural") {
    for (const block of blocks) {
      if (LEGACY_FORMAT_PATTERN.test(block.text)) {
        legacyEvidence.push(`${block.field} still forces a fixed structure`);
      }
    }
    if (legacyEvidence.length > 0) {
      const finding = makeFinding(settings, "legacy-format-conflict", {
        category: "format",
        field: "proposalSystemInstructions / proposalTemplates",
        title: "Legacy format rules conflict with natural format",
        evidence: [...new Set(legacyEvidence)].join("; "),
        why: "The active policy asks for plain, natural text while older instructions still require headings, a greeting, or a fixed order.",
        recommendation: "Turn off or rewrite the old mandatory format text. Keep only rules that still apply to the current policy.",
      });
      if (finding) findings.push(finding);
    }
  }

  const templates = profile.proposalTemplates?.trim() ?? "";
  if (templates.length > 0) {
    const lines = templates.split("\n").map((line) => line.trim()).filter(Boolean);
    const headingLines = lines.filter((line) =>
      /^(#{1,6}\s|[-*]\s|\d+\.\s|[A-Z][A-Za-z ]+:)$/.test(line)
    ).length;
    const placeholderLines = lines.filter((line) => /\[[^\]]+\]|\{\{[^}]+\}\}|<[^>]+>/.test(line)).length;
    const proseLines = lines.filter(
      (line) => line.split(/\s+/).length >= 8 && !/^(#{1,6}\s|[-*]\s|\d+\.\s)/.test(line)
    ).length;
    if (lines.length > 0 && (proseLines < 2 || headingLines + placeholderLines > lines.length * 0.7)) {
      const finding = makeFinding(settings, "template-is-not-voice", {
        category: "retrieval",
        field: "proposalTemplates",
        title: "Proposal templates look like a format, not voice samples",
        evidence: `${lines.length} lines, ${proseLines} prose line(s), ${headingLines + placeholderLines} heading/placeholder line(s).`,
        why: "A template teaches the model shape, not how the owner actually writes. Voice examples must be real prose from past proposals.",
        recommendation: "Move real past proposals into Proposal System > Voice samples. Keep proposalTemplates for reusable content only.",
      });
      if (finding) findings.push(finding);
    }
  }

  const portfolio = profile.portfolioSummary?.trim() ?? "";
  if (portfolio.length >= 80) {
    const hasConcrete = /\b(\d+%?|\$\d|reduced|increased|migrated|fixed|shipped|launched|built|integrated|resolved|saved)\b/i.test(
      portfolio
    );
    if (!hasConcrete) {
      const finding = makeFinding(settings, "vague-portfolio", {
        category: "unsupported-claim",
        field: "portfolioSummary",
        title: "Portfolio has no concrete outcomes",
        evidence: portfolio.slice(0, 240),
        why: "Without a concrete scope, result, or verifiable detail, the writer can only make generic claims.",
        recommendation: "Add one concrete detail to each portfolio item: what was built, the stack, the result, or a measurable outcome. Do not invent numbers.",
      });
      if (finding) findings.push(finding);
    }
  }

  if (profile.hourlyRate?.trim() && !/\d/.test(profile.hourlyRate)) {
    const finding = makeFinding(settings, "rate-format", {
      category: "ambiguity",
      field: "hourlyRate",
      title: "Hourly rate is not a recognizable amount",
      evidence: profile.hourlyRate,
      why: "The model may quote or paraphrase this value incorrectly.",
      recommendation: "Use a clear format such as '$45/hr' or '45 USD per hour'.",
    });
    if (finding) findings.push(finding);
  }

  const bloated = blocks.filter((block) => block.text.length > 4000);
  if (bloated.length > 0) {
    const finding = makeFinding(settings, "wall-of-rules", {
      category: "redundancy",
      field: bloated.map((block) => block.field).join(", "),
      title: "Instruction blocks are bloated",
      evidence: bloated.map((block) => `${block.field}: ${block.text.length} characters`).join("; "),
      why: "Long instruction blocks repeat rules and push the writer toward a template instead of the job.",
      recommendation: "Cut repeated rules and keep the smallest set that changes the output.",
    });
    if (finding) findings.push(finding);
  }

  const genericAbout =
    /\b(passionate|dedicated|hardworking|results[- ]driven|detail[- ]oriented|i am a|i'm a)\b/i.test(
      profile.about ?? ""
    );
  if (genericAbout) {
    const finding = makeFinding(settings, "missing-core-fields", {
      category: "ambiguity",
      field: "about",
      title: "About text uses generic self-description",
      evidence: (profile.about ?? "").slice(0, 240),
      why: "Generic adjectives do not give the writer a concrete fact or point of view to use.",
      recommendation: "Replace adjectives with specifics: what you build, for whom, and one verifiable result.",
    });
    if (finding) findings.push(finding);
  }

  return findings;
}

function dedupe(findings: ProfileFinding[]): ProfileFinding[] {
  const seen = new Set<string>();
  const output: ProfileFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.ruleId}:${normalized(finding.title)}:${normalized(finding.field)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(finding);
  }
  return output;
}

function scoreFor(findings: ProfileFinding[]): number {
  const penalty = findings.reduce((total, finding) => {
    if (finding.severity === "blocker") return total + 30;
    if (finding.severity === "warning") return total + 10;
    return total + 3;
  }, 0);
  const hasBlocker = findings.some((finding) => finding.severity === "blocker");
  const score = Math.max(0, 100 - penalty);
  return hasBlocker ? Math.min(score, 55) : score;
}

function statusFor(score: number): ProfileAuditResult["status"] {
  if (score >= 85) return "good";
  if (score >= 65) return "needs_attention";
  return "poor";
}

export async function runProfileAudit(userId: string): Promise<ProfileAuditResult> {
  const profile = getProfile(userId);
  if (profile === null) {
    throw new AppError(400, "BAD_REQUEST", "Save your profile before running an audit");
  }
  const settings = getProfileAuditSettings(userId);
  const policy = getProposalEngineConfig(userId).policy;
  const deterministic = deterministicProfileFindings(profile, settings, policy);
  const ai = getAiSettingsView(userId);
  const model = settings.model ?? ai.proposalModelId ?? ai.analysisModelId ?? null;

  let aiScore: number | null = null;
  let aiSummary = "";
  let aiFindings: ProfileFinding[] = [];

  try {
    const profileJson = JSON.stringify(
      {
        freelancerUsername: profile.freelancerUsername,
        name: profile.name,
        title: profile.title,
        hourlyRate: profile.hourlyRate,
        about: clamp(profile.about),
        skills: profile.skills,
        preferredProjectTypes: profile.preferredProjectTypes,
        wants: profile.wants,
        notWants: profile.notWants,
        ignoredCountries: profile.ignoredCountries,
        customInstructions: clamp(profile.customInstructions),
        relevancyInstructions: clamp(profile.relevancyInstructions),
        portfolioSummary: clamp(profile.portfolioSummary),
        proposalTemplates: clamp(profile.proposalTemplates),
        proposalSystemInstructions: clamp(profile.proposalSystemInstructions),
        proposalWritingInstructions: clamp(profile.proposalWritingInstructions),
      },
      null,
      2
    );
    const variables = {
      profileJson,
      policyJson: JSON.stringify(policy, null, 2),
      auditRules: settings.rules
        .filter((rule) => rule.enabled)
        .map((rule) => `- ${rule.id} (${rule.severity}): ${rule.label}. ${rule.instruction}`)
        .join("\n"),
      deterministicFindings: JSON.stringify(deterministic, null, 2),
    };
    const raw = await callOpenRouterStructured(
      renderTemplate(settings.prompt.system, variables),
      renderTemplate(settings.prompt.user, variables),
      aiAuditResponseFormat,
      model ?? undefined,
      90_000,
      { temperature: 0.1 }
    );
    const parsed = aiAuditSchema.safeParse(extractJson(raw));
    if (parsed.success) {
      const rawFindings = parsed.data.findings.map((finding) => ({
        ...finding,
        severity: finding.severity,
      }));
      const grounded = rawFindings.filter((finding) =>
        aiFindingIsGrounded(finding, profile, policy)
      );
      if (grounded.length !== rawFindings.length) {
        log.warn("Dropped ungrounded profile-audit findings", {
          dropped: rawFindings.length - grounded.length,
        });
        aiScore = null;
        aiSummary = "";
      } else {
        aiScore = parsed.data.score;
        aiSummary = parsed.data.summary;
      }
      aiFindings = grounded;
    } else {
      log.warn("Profile audit returned invalid JSON; using deterministic findings only");
    }
  } catch (error) {
    log.warn("AI profile audit failed; using deterministic findings only", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  const findings = dedupe([...deterministic, ...aiFindings]);
  const computedScore = scoreFor(findings);
  const score =
    aiScore === null
      ? computedScore
      : Math.round(computedScore * 0.7 + Math.max(0, Math.min(100, aiScore)) * 0.3);
  const status = statusFor(score);
  const summary =
    aiSummary.trim() ||
    (findings.length === 0
      ? "No profile conflicts found. The profile is safe to use as proposal context."
      : `${findings.length} issue(s) found. Fix blockers and warnings before enabling auto-bid.`);

  const audit = saveProfileAudit(userId, {
    score,
    status,
    summary,
    findings,
    model,
  });

  return { score, status, summary, findings, model, audit };
}
