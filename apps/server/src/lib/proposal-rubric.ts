/**
 * Shared, deterministic helpers for the proposal quality rubric.
 *
 * These functions do not try to judge prose. They catch cheap, observable
 * failures (generic openings, missing brief items, unsafe compression) and give
 * the model-based judge/reviewer the same vocabulary for the subjective parts.
 */

export const PROPOSAL_WRITING_RUBRIC = `Write like an experienced developer speaking directly to the client in a real conversation.
- A short greeting such as "Hi there," is welcome. Follow it immediately with a direct answer, a specific recommendation, or what you can do for this client. A simple job may open without a greeting.
- Explain the approach through the client's outcome: what you would review, decide, build, test, and hand over. Say why a step matters instead of listing technologies.
- Mention relevant experience in one conversational sentence ("I've built...", "I've been working with..."). Do not use "My experience includes" or a résumé-style skill list.
- Make quality and reliability concrete: realistic test inputs, output validation, fallbacks, error handling, rate limits, and cost control. Avoid abstract claims such as "careful alignment" with no method.
- Recommendation first: choose the simplest approach that fits, then mention a more advanced option only when it genuinely helps.
- Use only verified profile facts and relevant selected evidence. Never invent clients, outcomes, metrics, credentials, links, prices, or delivery times.
- Keep the proposal as short as the job allows while covering every material requirement. Do not pad to reach a word count.
- A short greeting line, 3-4 short body paragraphs, an optional question, and a simple sign-off such as "Best regards, Irfan Khalid" is the default shape. Never return one dense block.
- Vary the shape. A bug fix is not a SaaS implementation plan.
- Avoid generic claims, forced credentials paragraphs, repeated requirements, exhaustive technology lists, and project-management language.`;

const GENERIC_OPENING_PATTERNS: RegExp[] = [
  /\b(i'?d|i would) be (happy|glad|excited) to\b/i,
  /\bi (understand|have read|read) (your|the) (brief|requirements|description|project)\b/i,
  /\bi am confident\b/i,
  /\bperfect fit\b/i,
  /\bthank you for (the|this) opportunity\b/i,
  /\byour (vision|project) (is|sounds)\b/i,
];

const GENERIC_CLAIM_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "seamless", pattern: /\bseamless(ly)?\b/i },
  { id: "robust", pattern: /\brobust\b/i },
  { id: "comprehensive", pattern: /\bcomprehensive(ly)?\b/i },
  { id: "tailored", pattern: /\btailor(?:ed|ing)\b/i },
  { id: "holistic", pattern: /\bholistic\b/i },
  { id: "high-quality", pattern: /\bhigh[- ]quality\b/i },
  { id: "cutting-edge", pattern: /\bcutting[- ]edge\b/i },
  { id: "end-to-end", pattern: /\bend[- ]to[- ]end\b/i },
  { id: "proven-track-record", pattern: /\bproven track record\b/i },
  { id: "years-of-experience", pattern: /\b\d+\+?\s+years? of experience\b/i },
  { id: "helped-clients", pattern: /\b(i'?ve|i have) helped (many )?clients\b/i },
  { id: "meets-your-needs", pattern: /\b(meets?|exceeds?) your (needs|expectations)\b/i },
  { id: "peace-of-mind", pattern: /\bpeace of mind\b/i },
];

const CONSULTANT_FRAMING_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "translation-framing",
    pattern:
      /\b(?:translating|turning|converting)\b[^.!?]{0,80}\b(?:requirements|needs|complexity|ideas?|vision|goals?)\b[^.!?]{0,40}\binto\b/i,
  },
  {
    id: "task-requires",
    pattern: /\b(?:this|the) (?:task|project|work|role) (?:requires|needs|demands)\b/i,
  },
  {
    id: "intersection",
    pattern: /\b(?:sits?|lies?) at the intersection of\b/i,
  },
  {
    id: "key-challenge",
    pattern: /\bthe (?:key|real|main) (?:challenge|goal|objective|priority) (?:is|here)\b/i,
  },
  {
    id: "when-it-comes",
    pattern: /\b(?:when it comes to|in terms of)\b/i,
  },
  {
    id: "ensure-alignment",
    pattern: /\b(?:ensur(?:e|ing)|facilitat(?:e|ing))\b[^.!?]{0,40}\b(?:alignment|alignment with|outcomes?|success)\b/i,
  },
];

const SELF_DISQUALIFICATION_PATTERNS = [
  /\b(?:slightly|a bit|somewhat) (?:below|short of|under)\b/i,
  /\b(?:although|though|while)\b[^.!?]{0,80}\b(?:below|less than|not (?:a|an) )/i,
  /\b(?:below|short of) (?:your|the) (?:required|requested|stated)\b/i,
];

const VAGUE_EXAMPLE_PATTERNS = [
  /\bfor example,? i (?:have|'ve) (?:produced|built|created|worked on|delivered)\b/i,
  /\bi (?:have|'ve) (?:produced|built|created|delivered) (?:similar|several|various|multiple) (?:systems|projects|solutions)\b/i,
];

export interface NaturalnessFinding {
  id: "consultant-framing" | "self-disqualification" | "vague-example";
  detail: string;
}

/**
 * Catch language that makes a proposal sound like an AI consultant rather than
 * a specific developer. These are deterministic prompts for a targeted rewrite,
 * not a substitute for the model reviewer.
 */
export function naturalnessFindings(text: string): NaturalnessFinding[] {
  const findings: NaturalnessFinding[] = [];
  const consultant = CONSULTANT_FRAMING_PATTERNS.filter(({ pattern }) =>
    pattern.test(text)
  ).map(({ id }) => id);
  if (consultant.length > 0) {
    findings.push({
      id: "consultant-framing",
      detail: `consultant framing (${consultant.join(", ")})`,
    });
  }
  if (SELF_DISQUALIFICATION_PATTERNS.some((pattern) => pattern.test(text))) {
    findings.push({
      id: "self-disqualification",
      detail: "volunteers a weakness or admits being below a stated requirement",
    });
  }
  if (VAGUE_EXAMPLE_PATTERNS.some((pattern) => pattern.test(text))) {
    findings.push({
      id: "vague-example",
      detail: "uses a vague example claim without a concrete verified artifact",
    });
  }
  return findings;
}

export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^.*?[.!?](?=\s|$)/);
  return (match?.[0] ?? trimmed).trim();
}

export function hasGenericOpening(text: string): boolean {
  const opening = firstSentence(text);
  return GENERIC_OPENING_PATTERNS.some((pattern) => pattern.test(opening));
}

/**
 * Guarantee readable paragraph breaks when a model returns one dense block.
 * The words are never changed: only blank lines are inserted at sentence
 * boundaries. Existing paragraphs and very short notes are left alone.
 */
export function ensureReadableParagraphs(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0 || /\n\s*\n/.test(trimmed)) return trimmed;

  const flattened = trimmed.replace(/\s*\n\s*/g, " ");
  const sentences: string[] = [];
  for (const part of flattened.split(/(?<=[.!?])\s+/)) {
    const sentence = part.trim();
    if (sentence.length === 0) continue;
    const previous = sentences[sentences.length - 1];
    if (
      previous !== undefined &&
      /(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|inc|ltd|co|no)\.$/i.test(previous)
    ) {
      sentences[sentences.length - 1] = `${previous} ${sentence}`;
    } else {
      sentences.push(sentence);
    }
  }
  const wordCount = flattened.split(/\s+/).filter(Boolean).length;
  if (sentences.length < 2 || wordCount < 30) return trimmed;

  const target = wordCount >= 110 ? 3 : 2;
  if (sentences.length <= target) return sentences.join("\n\n");

  const paragraphs: string[] = [];
  let index = 0;
  for (let paragraph = 0; paragraph < target; paragraph++) {
    const remainingSentences = sentences.length - index;
    const remainingParagraphs = target - paragraph;
    const take = Math.ceil(remainingSentences / remainingParagraphs);
    paragraphs.push(sentences.slice(index, index + take).join(" "));
    index += take;
  }
  return paragraphs.join("\n\n");
}

export function genericClaims(text: string): string[] {
  return GENERIC_CLAIM_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ id }) => id
  );
}

/** Exact repeated sentences and near-duplicate long fragments. */
export function repeatedSentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().replace(/\s+/g, " ").toLowerCase())
    .filter((sentence) => sentence.split(" ").length >= 6);
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const sentence of sentences) {
    if (seen.has(sentence)) repeated.add(sentence);
    seen.add(sentence);
  }
  return [...repeated];
}

export function questionCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

const COVERAGE_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "into", "is", "it", "its", "of", "on", "or", "our", "that", "the",
  "their", "them", "this", "to", "use", "using", "with", "your", "you", "we",
  "will", "should", "must", "need", "needs", "including", "include", "also",
  "plus", "new", "existing", "site", "project", "work", "help", "able", "can",
]);

const SYNONYMS: Record<string, string[]> = {
  design: ["design", "concept", "wireframe", "mockup", "visual", "layout"],
  concept: ["concept", "design", "wireframe", "mockup", "direction"],
  responsive: ["responsive", "mobile", "desktop", "breakpoint", "screen"],
  mobile: ["mobile", "responsive", "desktop", "screen"],
  migration: ["migration", "migrate", "move", "cutover", "transfer"],
  migrate: ["migration", "migrate", "move", "cutover", "transfer"],
  dns: ["dns", "domain", "nameserver", "record"],
  email: ["email", "mail", "mx", "mailbox"],
  seo: ["seo", "search", "visibility", "ranking"],
  speed: ["speed", "performance", "fast", "latency", "load"],
  performance: ["performance", "speed", "slow", "latency", "profil", "cache"],
  payment: ["payment", "stripe", "checkout", "gateway", "cart"],
  checkout: ["checkout", "payment", "cart", "stripe"],
  catalog: ["catalog", "catalogue", "product", "inventory"],
  catalogue: ["catalog", "catalogue", "product", "inventory"],
  cart: ["cart", "checkout", "payment", "basket"],
  authentication: ["auth", "authentication", "login", "session", "signin"],
  roles: ["role", "roles", "permission", "permissions", "rbac", "access"],
  permissions: ["permission", "permissions", "role", "roles", "rbac", "access"],
  tenant: ["tenant", "tenants", "multi-tenant", "organization", "isolation"],
  isolation: ["isolation", "isolate", "tenant", "organization", "separate"],
  testing: ["test", "testing", "verify", "validation", "regression"],
  test: ["test", "testing", "verify", "validation", "regression"],
  documentation: ["documentation", "document", "handoff", "hand-off", "walkthrough", "walk-through", "guide"],
  handoff: ["handoff", "hand-off", "documentation", "walkthrough", "walk-through", "guide"],
  navigation: ["navigation", "menu", "navigate"],
  search: ["search", "filter", "filtering", "find"],
  filtering: ["filter", "filtering", "search", "find"],
  api: ["api", "endpoint", "request", "response", "integration"],
  bug: ["bug", "error", "issue", "broken", "fix", "reproduce"],
  fix: ["fix", "bug", "error", "repair", "resolve"],
  cache: ["cache", "caching", "redis", "invalidation"],
  webhook: ["webhook", "callback", "event", "signature"],
};

function coverageTokens(value: string): string[] {
  return value
    .toLowerCase()
    .match(/[a-z][a-z0-9+.#-]{1,}/g)
    ?.filter((word) => !COVERAGE_STOPWORDS.has(word)) ?? [];
}

function expandTerms(term: string): string[] {
  return [term, ...(SYNONYMS[term] ?? [])];
}

/**
 * Some deliverables are too easy to fake with adjacent words. A marketing
 * deliverable is not covered by "launch" alone, and ongoing support is not
 * covered by "after launch". These families need one of their own terms.
 */
const REQUIRED_TERM_FAMILIES: Array<{
  trigger: RegExp;
  terms: string[];
  minMatches: number;
}> = [
  {
    trigger: /\bmarketing\b/i,
    terms: ["marketing", "ad", "ads", "advertising", "content", "campaign", "campaigns", "promotion"],
    minMatches: 1,
  },
  {
    trigger: /\bmarketing\b[^.]*\b(?:ad|ads|advertising|content|campaign|promotion)\b/i,
    terms: ["marketing", "ad", "ads", "advertising", "content", "campaign", "campaigns", "promotion"],
    minMatches: 2,
  },
  {
    trigger: /\bongoing support\b|\bsupport after launch\b/i,
    terms: ["ongoing", "support", "maintenance", "retainer"],
    minMatches: 2,
  },
  {
    trigger: /\bsuppliers?\b/i,
    terms: ["supplier", "suppliers", "vendor", "vendors", "sourcing"],
    minMatches: 1,
  },
  {
    trigger: /\bbranding\b|\bbrand feel\b/i,
    terms: ["brand", "branding", "logo", "identity"],
    minMatches: 1,
  },
];

function requiredTermsSatisfied(item: string, contentTokens: Set<string>): boolean {
  return REQUIRED_TERM_FAMILIES.every((family) => {
    if (!family.trigger.test(item)) return true;
    const matches = family.terms.filter((term) => contentTokens.has(term)).length;
    return matches >= family.minMatches;
  });
}

function requiredOpening(item: string): string | null {
  const match = item.match(
    /\b(?:start|begin)\s+(?:your\s+|the\s+)?(?:message|proposal|reply|application)\s+(?:with|using)\s+(?:the\s+word\s+|the\s+phrase\s+)?["“'`]?([^"”'`.,;\n]+)/i
  );
  return match?.[1]?.trim() ?? null;
}

function openingMatches(content: string, required: string): boolean {
  const normalize = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const expected = normalize(required);
  const expectedWords = expected.split(" ").filter(Boolean).length;
  const actual = normalize(content.trim()).split(" ").slice(0, Math.max(1, expectedWords)).join(" ");
  return actual === expected;
}

function itemCovered(item: string, content: string, contentTokens: Set<string>): boolean {
  const opening = requiredOpening(item);
  if (opening !== null) return openingMatches(content, opening);
  if (!requiredTermsSatisfied(item, contentTokens)) return false;
  const terms = coverageTokens(item);
  if (terms.length === 0) return true;
  const strong = terms.filter((term) => term.length >= 4);
  const matched = strong.filter((term) =>
    expandTerms(term).some((candidate) => contentTokens.has(candidate))
  );
  if (strong.length === 0) return matched.length > 0;
  return matched.length >= Math.min(2, strong.length);
}

export interface BriefCoverageItem {
  item: string;
  covered: boolean;
  matchedTerms: string[];
}

export interface BriefCoverageResult {
  items: BriefCoverageItem[];
  coveredCount: number;
  total: number;
  missing: string[];
}

export interface CoverageBriefLike {
  deliverables?: string[];
  mustAddress?: string[];
  explicitQuestions?: string[];
  applicationRequirements?: string[];
}

export function evaluateBriefCoverage(
  content: string,
  brief: CoverageBriefLike
): BriefCoverageResult {
  const contentTokens = new Set(coverageTokens(content));
  const items = [
    ...(brief.deliverables ?? []),
    ...(brief.mustAddress ?? []),
    ...(brief.explicitQuestions ?? []),
    ...(brief.applicationRequirements ?? []),
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
  const evaluated = items.map((item) => {
    const terms = coverageTokens(item);
    const matchedTerms = terms.filter((term) =>
      expandTerms(term).some((candidate) => contentTokens.has(candidate))
    );
    return { item, covered: itemCovered(item, content, contentTokens), matchedTerms };
  });
  const missing = evaluated.filter((entry) => !entry.covered).map((entry) => entry.item);
  return {
    items: evaluated,
    coveredCount: evaluated.length - missing.length,
    total: evaluated.length,
    missing,
  };
}

export interface DeletionGuardInput {
  before: string;
  after: string;
  minWords: number;
  maxWords: number;
  brief: CoverageBriefLike;
}

export interface DeletionGuardResult {
  accept: boolean;
  reasons: string[];
  beforeWords: number;
  afterWords: number;
  beforeCoverage: BriefCoverageResult;
  afterCoverage: BriefCoverageResult;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Compression is optional editing, not a quota. Reject a cut that goes below
 * the configured floor, still exceeds the ceiling, expands the draft, or loses
 * a deliverable the previous draft covered.
 */
export function evaluateDeletionCandidate(input: DeletionGuardInput): DeletionGuardResult {
  const beforeWords = wordCount(input.before);
  const afterWords = wordCount(input.after);
  const beforeCoverage = evaluateBriefCoverage(input.before, input.brief);
  const afterCoverage = evaluateBriefCoverage(input.after, input.brief);
  const reasons: string[] = [];

  if (afterWords === 0) reasons.push("empty draft");
  if (afterWords >= beforeWords) reasons.push("did not shorten the draft");
  if (afterWords < input.minWords) {
    reasons.push(`below the ${input.minWords}-word minimum`);
  }
  if (afterWords > input.maxWords) {
    reasons.push(`still above the ${input.maxWords}-word maximum`);
  }
  if (afterCoverage.coveredCount < beforeCoverage.coveredCount) {
    reasons.push(
      `lost coverage (${beforeCoverage.coveredCount}/${beforeCoverage.total} -> ${afterCoverage.coveredCount}/${afterCoverage.total})`
    );
  }
  if (
    afterCoverage.coveredCount === beforeCoverage.coveredCount &&
    afterWords < Math.floor(beforeWords * 0.5)
  ) {
    reasons.push("cut more than half the draft");
  }

  return {
    accept: reasons.length === 0,
    reasons,
    beforeWords,
    afterWords,
    beforeCoverage,
    afterCoverage,
  };
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
