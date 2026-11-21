/**
 * Deterministic proposal quality checks.
 *
 * This is not a replacement for a human read: it catches the failure modes we
 * can verify cheaply (missing job specifics, invented prices, generic filler,
 * wrong delivery time, no next step). The eval script prints these checks next
 * to each generated proposal so prompt changes can be compared.
 */

import {
  genericClaims,
  hasGenericOpening,
  naturalnessFindings,
  repeatedSentences,
  evaluateBriefCoverage,
} from "./proposal-rubric.js";

export const PROPOSAL_TARGET_MIN_WORDS = 35;
export const PROPOSAL_TARGET_MAX_WORDS = 170;

export interface ProposalQualityContext {
  jobTitle: string;
  jobDescription: string[];
  jobSkills: string[];
  profileSkills?: string[];
  /** The exact amount the bid will submit, when known. */
  bidAmount?: number | null;
  /** The exact delivery time the bid will submit, when known. */
  deliveryDays?: number | null;
  /** URLs the proposal is allowed to cite (portfolio/profile links). */
  allowedUrls?: string[];
  /** Policy-owned word range. Defaults to the legacy 120–170 band. */
  targetWords?: { min: number; max: number };
  /** "structured" permits headings/bullets; "natural" requires plain text. */
  format?: "natural" | "structured";
  /** Whether a closing question/next step is required. Defaults to true. */
  requireCta?: boolean;
  /** When true, any price or delivery mention is a policy failure. */
  forbidCommercials?: boolean;
  /** Extra user-level banned phrases. */
  bannedPhrases?: string[];
  /** AI-sounding phrases to report as warnings. */
  aiTells?: string[];
  /** Enforce the owner preference against portfolio project names/URLs. */
  forbidProjectUrls?: boolean;
  forbiddenProjectNames?: string[];
  /** Explicit application questions/instructions extracted by the proposal brief. */
  requiredAnswers?: string[];
}

export interface ProposalQualityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ProposalQualityWarning {
  id: string;
  message: string;
}

export interface ProposalQualityResult {
  /** 0–100, based only on the checks below. */
  score: number;
  wordCount: number;
  checks: ProposalQualityCheck[];
  warnings: ProposalQualityWarning[];
  matchedJobTerms: string[];
}

const STOPWORDS = new Set([
  "about", "after", "again", "also", "and", "any", "are", "because", "been",
  "before", "being", "between", "both", "but", "can", "could", "does", "each",
  "for", "from", "have", "here", "how", "into", "its", "just", "like", "more",
  "most", "need", "needs", "not", "now", "only", "other", "our", "out", "over",
  "should", "some", "such", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "those", "through", "too", "under", "use",
  "used", "using", "very", "want", "wants", "was", "were", "what", "when",
  "where", "which", "while", "who", "will", "with", "would", "you", "your",
  "project", "client", "work", "working", "help", "looking", "someone",
]);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g) ?? [];
}

function significantWords(text: string): string[] {
  return [...new Set(words(text).filter((word) => !STOPWORDS.has(word)))];
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function canonicalUrl(url: string): string {
  return url
    .trim()
    .replace(/[),.;!?]+$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** Extract and normalize HTTP(S) links from profile or proposal text. */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return [...new Set(matches.map(canonicalUrl).filter(Boolean))];
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("en-US");
}

function skillKey(skill: string): string {
  return skill.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function skillMatches(a: string, b: string): boolean {
  const left = skillKey(a);
  const right = skillKey(b);
  if (left.length === 0 || right.length === 0) return false;
  if (left === right) return true;
  return left.length >= 3 && right.length >= 3 && (left.includes(right) || right.includes(left));
}

function sentenceMentionsSkill(sentence: string, skill: string): boolean {
  const tokens = new Set(normalized(sentence).split(" ").filter(Boolean));
  const parts = skill
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length >= 2);
  const aliases: Record<string, string[]> = {
    postgresql: ["postgres", "postgresql"],
    javascript: ["javascript", "js"],
    typescript: ["typescript", "ts"],
    "node.js": ["node", "nodejs"],
  };
  return (
    parts.length > 0 &&
    parts.every((part) => tokens.has(part) || (aliases[part] ?? []).some((alias) => tokens.has(alias)))
  );
}

const COMMERCIAL_SENTENCE =
  /(?:\$|£|€|\b(?:usd|gbp|eur|price|pricing|rate|cost|budget|quote|delivery|deadline|timeline|turnaround|timeframe|asap|as soon as possible|days?|weeks?|hours?)\b|\b\d+\s*[- ]?\s*(?:day|week|hour|month)s?\b)/i;

/**
 * Remove sentences that leak commercial terms when policy says they belong in
 * the bid fields. Models often echo the client's requested deadline even when
 * told not to; this keeps validation deterministic without asking the model to
 * rewrite again.
 */
export function stripCommercialMentions(content: string): string {
  return content
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !COMMERCIAL_SENTENCE.test(sentence))
        .map((sentence) =>
          sentence
            .replace(/\s+/g, " ")
            .replace(/\s+([,.;:!?])/g, "$1")
            .replace(/^[,;:\s]+/, "")
            .trim()
        )
        .filter((sentence) => sentence.length > 0)
        .join(" ")
        .trim()
    )
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n")
    .trim();
}

function dollarAmounts(content: string): number[] {
  return [...content.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)]
    .map((match) => Number(match[1]?.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
}

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

function dayForms(value: number): string[] {
  const form = NUMBER_WORDS[value];
  return form === undefined ? [String(value)] : [String(value), form];
}

function mentionsDays(content: string, days: number): boolean {
  const dayMatch = dayForms(days).some((form) =>
    new RegExp(`\\b${form}[\\s-]*(?:business\\s+)?days?\\b`, "i").test(content)
  );
  if (dayMatch) return true;

  if (days % 7 === 0) {
    const weeks = days / 7;
    const weekForms = dayForms(weeks);
    if (weeks === 1) weekForms.push("a", "one");
    return weekForms.some((form) =>
      new RegExp(`\\b${form}[\\s-]*weeks?\\b`, "i").test(content)
    );
  }

  return false;
}

/** Any day/week duration, so an omitted timeline is allowed but a wrong one is not. */
function hasAnyDeliveryMention(content: string): boolean {
  if (/\b(?:timeframe|turnaround|deadline|timeline|asap)\b/i.test(content)) return true;
  const forms = [...NUMBER_WORDS, "a", "an"].join("|");
  return new RegExp(
    `\\b(?:\\d{1,3}|${forms})[\\s-]*(?:business\\s+)?(?:days?|weeks?)\\b`,
    "i"
  ).test(content);
}

export function evaluateProposalQuality(
  content: string,
  context: ProposalQualityContext
): ProposalQualityResult {
  const trimmed = content.trim();
  const wordCount = words(trimmed).length;
  const jobTerms = significantWords(
    [context.jobTitle, ...context.jobDescription, ...context.jobSkills].join(" ")
  );
  const contentNormalized = normalized(trimmed);
  const contentTokens = new Set(contentNormalized.split(" ").filter(Boolean));
  const matchesTerm = (term: string) =>
    term
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length > 0)
      .every((part) => contentTokens.has(part));
  const matchedJobTerms = jobTerms.filter(matchesTerm);

  const checks: ProposalQualityCheck[] = [];
  const add = (id: string, label: string, passed: boolean, detail: string) => {
    checks.push({ id, label, passed, detail });
  };

  const targetMin = context.targetWords?.min ?? PROPOSAL_TARGET_MIN_WORDS;
  const targetMax = context.targetWords?.max ?? PROPOSAL_TARGET_MAX_WORDS;
  add(
    "length",
    `Length is ${targetMin}–${targetMax} words`,
    wordCount >= targetMin && wordCount <= targetMax,
    `${wordCount} words`
  );

  const requiredTerms = Math.min(3, jobTerms.length);
  add(
    "specific",
    `Mentions at least ${requiredTerms} job-specific terms`,
    matchedJobTerms.length >= requiredTerms,
    matchedJobTerms.length > 0 ? matchedJobTerms.slice(0, 8).join(", ") : "none found"
  );

  const genericOpening = hasGenericOpening(trimmed);
  add(
    "opening",
    "Opens with a job-specific observation or decision",
    !genericOpening,
    genericOpening ? "generic opening" : "ok"
  );

  const hasMarkdown =
    /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|```)/m.test(trimmed) ||
    /\*\*[^*]+\*\*/.test(trimmed);
  const structured = context.format === "structured";
  add(
    "plain",
    structured ? "Formatting is allowed by policy" : "Plain text (no headings, bullets, or markdown)",
    structured || !hasMarkdown,
    structured ? "structured format" : hasMarkdown ? "formatting found" : "ok"
  );

  const amounts = dollarAmounts(trimmed);
  const expectedAmount = context.bidAmount ?? null;
  const priceOk =
    context.forbidCommercials === true
      ? amounts.length === 0
      : expectedAmount === null
        ? amounts.length === 0
        : amounts.length === 0 ||
          (amounts.includes(expectedAmount) &&
            amounts.every((amount) => amount === expectedAmount));
  add(
    "price",
    context.forbidCommercials === true
      ? "Does not mention price (policy: fields only)"
      : expectedAmount === null
        ? "Does not invent a price"
        : `If a price is mentioned, quotes only $${formatAmount(expectedAmount)}`,
    priceOk,
    amounts.length === 0 ? "no price mentioned" : `$${amounts.join(", $")}`
  );

  const expectedDays = context.deliveryDays ?? null;
  const mentionsDelivery = hasAnyDeliveryMention(trimmed);
  const deliveryOk =
    context.forbidCommercials === true
      ? !mentionsDelivery
      : expectedDays === null || !mentionsDelivery || mentionsDays(trimmed, expectedDays);
  add(
    "delivery",
    context.forbidCommercials === true
      ? "Does not mention delivery time (policy: fields only)"
      : expectedDays === null
        ? "No delivery requirement"
        : `Delivery time matches when mentioned (${expectedDays} day(s))`,
    deliveryOk,
    context.forbidCommercials === true
      ? mentionsDelivery
        ? "delivery mentioned"
        : "not mentioned"
      : expectedDays === null
        ? "not applicable"
        : !mentionsDelivery
          ? "not mentioned"
          : deliveryOk
            ? "matches"
            : "different"
  );

  const closing = trimmed.slice(-400);
  const hasCta =
    /\?/.test(closing) ||
    /\b(let's|let me know|happy to|would you|shall we|next step|send me|share the|jump on|can start|available to start|ready to start|look forward|feel free|reach out|get started|kick off|schedule|book a|jump on a call|hop on a call)\b/i.test(
      closing
    );
  const requireCta = context.requireCta === true;
  add(
    "cta",
    requireCta ? "Ends with a question or next step" : "Closing style is policy-owned",
    requireCta ? hasCta : true,
    requireCta ? (hasCta ? "ok" : "no call to action") : "not required"
  );

  const mentionsCompetition =
    /\b(other freelancers?|competitors?|bid count|bids so far|median bid|lowest bid|highest bid)\b/i.test(
      trimmed
    );
  add(
    "competition",
    "Does not mention competitors or bid stats",
    !mentionsCompetition,
    mentionsCompetition ? "competition leak" : "ok"
  );

  const hasPlaceholder = /\[[^\]]+\]|lorem ipsum|your name|insert /i.test(trimmed);
  add("placeholder", "No placeholders", !hasPlaceholder, hasPlaceholder ? "placeholder found" : "ok");

  const citedUrls = extractUrls(trimmed);
  const allowedUrls = new Set((context.allowedUrls ?? []).map(canonicalUrl));
  const unsupportedUrls = citedUrls.filter((url) => !allowedUrls.has(url));
  add(
    "links",
    "Only cites links from the verified profile",
    unsupportedUrls.length === 0,
    unsupportedUrls.length > 0 ? unsupportedUrls.join(", ") : "ok"
  );
  const projectSpecificUrls = context.forbidProjectUrls
    ? citedUrls.filter((url) => {
        try {
          const parsed = new URL(url);
          return /(^|\.)irfankhalid\.com$/i.test(parsed.hostname) && parsed.pathname.replace(/\/+$/, "") !== "";
        } catch {
          return false;
        }
      })
    : [];
  const escapedProjectNames = (context.forbiddenProjectNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length >= 3)
    .filter((name) => normalized(trimmed).includes(normalized(name)));
  const projectReferenceProblems = [...projectSpecificUrls, ...escapedProjectNames];
  add(
    "project_names",
    "Does not mention portfolio project names or project-specific URLs",
    projectReferenceProblems.length === 0,
    projectReferenceProblems.length > 0 ? projectReferenceProblems.join(", ") : "ok"
  );
  const requiredAnswers = (context.requiredAnswers ?? []).map((answer) => answer.trim()).filter(Boolean);
  const answerCoverage = requiredAnswers.length > 0
    ? evaluateBriefCoverage(trimmed, { deliverables: requiredAnswers, mustAddress: [], explicitQuestions: [] })
    : null;
  add(
    "mandatory_questions",
    "Answers all explicit application questions/instructions",
    answerCoverage === null || answerCoverage.missing.length === 0,
    answerCoverage === null
      ? "no explicit application questions supplied"
      : answerCoverage.missing.length === 0
        ? "all explicit questions/instructions covered"
        : answerCoverage.missing.join("; ")
  );

  const profileSkills = context.profileSkills ?? [];
  const relevantProfileSkills = profileSkills.filter((profileSkill) =>
    context.jobSkills.some((jobSkill) => skillMatches(profileSkill, jobSkill))
  );
  const proofOk =
    relevantProfileSkills.length === 0 ||
    relevantProfileSkills.some((skill) => {
      const skillWords = skill
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3);
      return skillWords.length > 0 && skillWords.every((word) => contentTokens.has(word));
    });
  add(
    "proof",
    relevantProfileSkills.length === 0
      ? "No irrelevant profile-skill mention required"
      : "References a relevant profile skill",
    proofOk,
    relevantProfileSkills.length === 0
      ? "no directly relevant profile skill in job tags"
      : proofOk
        ? "relevant skill mentioned"
        : "relevant profile skill not mentioned"
  );

  const naturalness = naturalnessFindings(trimmed);
  const claims = genericClaims(trimmed);
  const naturalDetails = [
    genericOpening ? "generic opening" : null,
    claims.length > 0 ? `generic claims (${claims.join(", ")})` : null,
    ...naturalness.map((finding) => finding.detail),
  ].filter((detail): detail is string => detail !== null);
  add(
    "natural",
    "Sounds like a specific developer, not an AI consultant",
    naturalDetails.length === 0,
    naturalDetails.length === 0 ? "ok" : naturalDetails.join("; ")
  );

  const warnings: ProposalQualityWarning[] = [];
  const banned = [
    ...new Set(
      [
        "i understand",
        "i am confident",
        "i have read",
        "look no further",
        "perfect fit",
        "dear hiring manager",
        ...(context.bannedPhrases ?? []),
        ...(context.aiTells ?? []),
      ]
        .map((phrase) => phrase.trim().toLowerCase())
        .filter((phrase) => phrase.length > 0)
    ),
  ].filter((phrase) => trimmed.toLowerCase().includes(phrase));
  if (banned.length > 0) {
    warnings.push({ id: "generic", message: `Generic phrase(s): ${banned.join(", ")}` });
  }
  if (genericOpening) {
    warnings.push({
      id: "generic-opening",
      message: "Opens with a generic greeting, understanding, or willingness claim",
    });
  }
  if (claims.length > 0) {
    warnings.push({
      id: "generic-claims",
      message: `Generic claim(s): ${claims.join(", ")}`,
    });
  }
  for (const finding of naturalness) {
    warnings.push({ id: finding.id, message: finding.detail });
  }
  const repeated = repeatedSentences(trimmed);
  if (repeated.length > 0) {
    warnings.push({
      id: "repetition",
      message: `Repeated sentence(s): ${repeated.slice(0, 2).join(" / ")}`,
    });
  }
  if (
    /\b(i've|i have) delivered\b|\bproven track record\b|\bsimilar (performance|results|gains)\b/i.test(
      trimmed
    )
  ) {
    warnings.push({
      id: "unverified-result",
      message: "Specific delivery/result claim — verify it is supported by the profile",
    });
  }

  const experienceSentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) =>
      /\b(i have|i've|i am|i'm|my experience|we have|we've)\b/i.test(sentence)
    );
  const unsupportedSkillClaims = context.jobSkills.filter(
    (skill) =>
      !profileSkills.some((profileSkill) => skillMatches(profileSkill, skill)) &&
      experienceSentences.some((sentence) => sentenceMentionsSkill(sentence, skill))
  );
  if (unsupportedSkillClaims.length > 0) {
    warnings.push({
      id: "unsupported-skill",
      message: `Claimed experience with job skill(s) not in the profile: ${unsupportedSkillClaims.join(", ")}`,
    });
  }
  add(
    "unsupported_claims",
    "Does not claim experience with unverified job skills",
    unsupportedSkillClaims.length === 0,
    unsupportedSkillClaims.length > 0 ? unsupportedSkillClaims.join(", ") : "ok"
  );

  const passed = checks.filter((check) => check.passed).length;
  const warningPenalty = Math.min(30, warnings.length * 5);
  return {
    score: Math.max(0, Math.round((passed / checks.length) * 100) - warningPenalty),
    wordCount,
    checks,
    warnings,
    matchedJobTerms,
  };
}
