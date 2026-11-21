import { createHash } from "node:crypto";

import { z } from "zod";

import { createLogger } from "../../lib/logger.js";
import { DEFAULT_SAMPLE_ID_PREFIX } from "../../lib/proposal-defaults.js";
import {
  buildStructuredResponseFormat,
  callOpenRouterStructured,
} from "../ai/ai.service.js";
import type { SampleView } from "./proposal-config.service.js";
import type { ProposalTraceEmitter } from "./proposal-trace.service.js";

const log = createLogger("proposal");

/**
 * A distilled description of the owner's writing voice. This is deliberately
 * not a template, outline, or set of sample sentences: the writer receives only
 * these traits, never the original sample proposals.
 */
export const voiceProfileSchema = z.object({
  summary: z.string().min(1).max(800),
  rhythm: z.string().min(1).max(800),
  openings: z.array(z.string().min(1).max(400)).max(6).default([]),
  structure: z.string().min(1).max(800),
  closings: z.array(z.string().min(1).max(400)).max(6).default([]),
  habits: z.array(z.string().min(1).max(400)).max(10).default([]),
  avoid: z.array(z.string().min(1).max(400)).max(10).default([]),
});

export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

const voiceResponseFormat = buildStructuredResponseFormat(
  "proposal_voice",
  z.toJSONSchema(voiceProfileSchema) as Record<string, unknown>
);

const EMPTY_PROFILE: VoiceProfile = {
  summary: "No usable voice samples yet. Write in a direct, natural developer voice.",
  rhythm: "Use short, readable paragraphs and vary sentence length.",
  openings: ["Start with the client's actual problem, risk, or recommendation."],
  structure: "Keep paragraphs short and focused. Do not use headings or a fixed section order.",
  closings: ["End naturally. A formal sign-off is optional."],
  habits: ["Use first person naturally and keep only details that help the client decide."],
  avoid: ["Do not imitate a generic consultant or a reusable template."],
};

/**
 * Hand-written guide for the shipped starter examples. It replaces the
 * distillation model call, so a default run stays at two calls: analyse, then
 * write. As soon as the owner adds a real sample, the normal analysis runs.
 */
const STARTER_VOICE_PROFILE: VoiceProfile = {
  summary:
    "A direct, first-person developer voice: specific about the real risk, calm about the fix, and free of sales language.",
  rhythm:
    "Short, readable paragraphs of two to four sentences with varied sentence length. No headings, bullets, or bold text.",
  openings: [
    "Often opens with a brief greeting, then names the risk or outcome the client actually cares about.",
    "Sometimes opens with the recommendation or decision, then explains why.",
  ],
  structure:
    "A greeting, then two or three short body paragraphs that move from the specific risk to the approach and what will be verified, then a simple sign-off.",
  closings: [
    "Ends with a brief, conventional sign-off.",
    "Asks at most one direct question that changes the plan.",
  ],
  habits: [
    "Uses first person and contractions naturally.",
    "Names concrete failure modes such as downtime, partial writes, or regressions.",
    "Keeps proof to one relevant sentence instead of a credentials list.",
    "Prefers prose over bullets, headings, and bold text.",
  ],
  avoid: [
    "Avoids generic openings, self-praise, and long technology lists.",
    "Does not promise results that cannot be verified from the job details.",
    "Never reuses wording, client details, or facts from past proposals.",
  ],
};

const CACHE_LIMIT = 64;
const cache = new Map<string, VoiceProfile>();

function hashSamples(samples: SampleView[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        samples.map((sample) => ({
          id: sample.id,
          content: sample.content,
          rating: sample.rating,
          preferred: sample.preferred,
          outcome: sample.outcome,
          jobType: sample.jobType,
          updatedAt: sample.updatedAt,
        }))
      )
    )
    .digest("hex");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function sampleNgrams(samples: SampleView[], size: number): Set<string> {
  const grams = new Set<string>();
  for (const sample of samples) {
    const tokens = tokenize(sample.content);
    for (let index = 0; index <= tokens.length - size; index += 1) {
      grams.add(tokens.slice(index, index + size).join(" "));
    }
  }
  return grams;
}

function containsSampleEcho(line: string, ngrams: Set<string>, size: number): boolean {
  const tokens = tokenize(line);
  for (let index = 0; index <= tokens.length - size; index += 1) {
    if (ngrams.has(tokens.slice(index, index + size).join(" "))) return true;
  }
  return false;
}

function cleanLine(
  value: string,
  samples: SampleView[],
  ngrams: Set<string>
): string | null {
  let line = value.trim().replace(/^[-*•]\s*/, "");
  line = line.replace(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "").trim();
  if (line.length < 8 || line.length > 400) return null;
  if (/[{}[\]]/.test(line)) return null;

  const lower = line.toLowerCase();
  for (const sample of samples) {
    const title = sample.title.trim().toLowerCase();
    if (title.length >= 8 && lower.includes(title)) return null;
  }
  if (containsSampleEcho(line, ngrams, 8)) return null;
  return line;
}

function cleanList(
  values: string[],
  samples: SampleView[],
  ngrams: Set<string>,
  fallback: string[],
  limit: number
): string[] {
  const cleaned = values
    .map((value) => cleanLine(value, samples, ngrams))
    .filter((value): value is string => value !== null)
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, limit);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Remove anything that could turn the guide back into a template: URLs,
 * project titles, quoted sentences, and long verbatim fragments from samples.
 */
export function sanitizeVoiceProfile(
  profile: VoiceProfile,
  samples: SampleView[]
): VoiceProfile {
  const fallback = buildFallbackVoiceProfile(samples);
  const ngrams = sampleNgrams(samples, 8);
  const scalar = (value: string, replacement: string): string =>
    cleanLine(value, samples, ngrams) ?? replacement;

  return {
    summary: scalar(profile.summary, fallback.summary),
    rhythm: scalar(profile.rhythm, fallback.rhythm),
    openings: cleanList(profile.openings, samples, ngrams, fallback.openings, 6),
    structure: scalar(profile.structure, fallback.structure),
    closings: cleanList(profile.closings, samples, ngrams, fallback.closings, 6),
    habits: cleanList(profile.habits, samples, ngrams, fallback.habits, 10),
    avoid: cleanList(
      [...profile.avoid, "Never reuse sample wording, client details, links, deliverables, or job facts."],
      samples,
      ngrams,
      fallback.avoid,
      10
    ),
  };
}

/**
 * Keep the AI's qualitative observations, but ground voice and rhythm in
 * measurable sample data. This also removes claims the samples do not support,
 * such as "uses lists" when no sample contains a list.
 */
function finalizeVoiceProfile(profile: VoiceProfile, samples: SampleView[]): VoiceProfile {
  const fallback = buildFallbackVoiceProfile(samples);
  const metrics = measureVoice(samples);
  const supported = (habit: string): boolean => {
    const lower = habit.toLowerCase();
    if (/\b(bullet|bullets|list|lists)\b/.test(lower) && metrics.bulletShare < 25) return false;
    if (/\b(question|questions)\b/.test(lower) && metrics.questionShare < 25) return false;
    if (/\b(contraction|contractions|conversational)\b/.test(lower) && metrics.contractionShare < 25) {
      return false;
    }
    if (/\b(sign-?off|regards|thanks|gratitude)\b/.test(lower) && metrics.signoffShare < 25) {
      return false;
    }
    if (/\b(dash|dashes|em dash)\b/.test(lower) && metrics.emDashShare < 25) return false;
    return true;
  };

  const habitCategory = (habit: string): string => {
    if (/\b(contraction|conversational)\b/i.test(habit)) return "contractions";
    if (/\b(question|questions)\b/i.test(habit)) return "questions";
    if (/\b(bullet|bullets|list|lists|prose)\b/i.test(habit)) return "lists";
    if (/\b(paragraph|paragraphs)\b/i.test(habit)) return "paragraphs";
    if (/\b(dash|dashes|punctuation)\b/i.test(habit)) return "punctuation";
    return "";
  };

  const habits = profile.habits.filter(supported);
  const covered = new Set(habits.map(habitCategory).filter(Boolean));
  const mergedHabits = [
    ...habits,
    ...fallback.habits.filter((habit) => {
      const category = habitCategory(habit);
      return category === "" || !covered.has(category);
    }),
  ].filter((habit, index, list) => list.indexOf(habit) === index);

  return {
    ...profile,
    summary: fallback.summary,
    rhythm: fallback.rhythm,
    structure: fallback.structure,
    habits: mergedHabits.length > 0 ? mergedHabits : fallback.habits,
    avoid: [...profile.avoid, ...fallback.avoid]
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(0, 8),
  };
}

/* ------------------------- Deterministic fallback ------------------------- */

interface VoiceMetrics {
  samples: number;
  words: number;
  sentences: number;
  paragraphs: number;
  avgSentenceWords: number;
  shortSentenceShare: number;
  avgParagraphWords: number;
  greetingShare: number;
  questionShare: number;
  contractionShare: number;
  signoffShare: number;
  bulletShare: number;
  emDashShare: number;
}

function measureVoice(samples: SampleView[]): VoiceMetrics {
  const contents = samples.map((sample) => sample.content.trim()).filter(Boolean);
  const joined = contents.join("\n\n");
  const words = joined.split(/\s+/).filter(Boolean).length;
  const sentences = joined
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  const paragraphs = contents.flatMap((content) =>
    content.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
  );
  const sentenceWordCounts = sentences.map(
    (sentence) => sentence.split(/\s+/).filter(Boolean).length
  );
  const shortSentences = sentenceWordCounts.filter((count) => count <= 12).length;
  const avgSentenceWords =
    sentenceWordCounts.reduce((total, count) => total + count, 0) /
    Math.max(1, sentenceWordCounts.length);
  const avgParagraphWords =
    paragraphs.reduce(
      (total, paragraph) => total + paragraph.split(/\s+/).filter(Boolean).length,
      0
    ) / Math.max(1, paragraphs.length);
  const count = Math.max(1, contents.length);

  return {
    samples: contents.length,
    words,
    sentences: sentenceWordCounts.length,
    paragraphs: paragraphs.length,
    avgSentenceWords: Math.round(avgSentenceWords),
    shortSentenceShare: Math.round((shortSentences / Math.max(1, sentenceWordCounts.length)) * 100),
    avgParagraphWords: Math.round(avgParagraphWords),
    greetingShare: Math.round(
      (contents.filter((content) => /^(hi|hello|hey|dear)\b/i.test(content)).length / count) * 100
    ),
    questionShare: Math.round(
      (contents.filter((content) => content.includes("?")).length / count) * 100
    ),
    contractionShare: Math.round(
      (contents.filter((content) => /\b\w+'(?:s|t|re|ve|ll|d|m)\b/i.test(content)).length / count) *
        100
    ),
    signoffShare: Math.round(
      (contents.filter((content) => /\b(best regards|kind regards|regards|thanks|thank you)\b/i.test(content)).length /
        count) *
        100
    ),
    bulletShare: Math.round(
      (contents.filter((content) => /^\s*[-*•]\s+/m.test(content)).length / count) * 100
    ),
    emDashShare: Math.round(
      (contents.filter((content) => /—|--/.test(content)).length / count) * 100
    ),
  };
}

export function buildFallbackVoiceProfile(samples: SampleView[]): VoiceProfile {
  if (samples.length === 0) return EMPTY_PROFILE;
  const m = measureVoice(samples);
  const sentenceBand =
    m.avgSentenceWords <= 12
      ? "short"
      : m.avgSentenceWords <= 18
        ? "medium-length"
        : "longer";
  const paragraphBand =
    m.avgParagraphWords <= 35
      ? "short"
      : m.avgParagraphWords <= 70
        ? "compact"
        : "longer";

  const opening =
    m.greetingShare >= 50
      ? "Often opens with a brief greeting, then gets to the point."
      : m.questionShare >= 50
        ? "Often opens with a direct question."
        : "Usually opens directly with a recommendation, observation, or problem.";

  const habits: string[] = [];
  if (m.contractionShare >= 50) habits.push("Uses contractions and a conversational register.");
  if (m.questionShare >= 50) habits.push("Sometimes uses one direct question instead of a pitch.");
  if (m.bulletShare < 25) habits.push("Prefers prose over bullets and headings.");
  if (m.emDashShare < 25) habits.push("Uses punctuation sparingly; avoids heavy dash or list formatting.");
  habits.push(
    `Keeps paragraphs to about ${m.avgParagraphWords} words with one main idea each.`
  );

  const closings = [
    m.signoffShare >= 50
      ? "Ends with a brief, conventional sign-off."
      : "Ends without a formal sign-off.",
    "Does not add a long recap or a second call to action.",
  ];

  return {
    summary: `Writes in a ${m.greetingShare >= 50 ? "polite but direct" : "direct"} first-person voice with ${sentenceBand} sentences and ${paragraphBand} paragraphs.`,
    rhythm: `Average sentence is about ${m.avgSentenceWords} words; ${m.shortSentenceShare}% are 12 words or fewer. Paragraphs average about ${m.avgParagraphWords} words.`,
    openings: [opening],
    structure:
      "Keeps paragraphs short and focused, with one main idea each. Does not use headings or a fixed section order.",
    closings,
    habits,
    avoid: [
      "Do not copy phrases, client details, project names, links, or deliverables from past proposals.",
      "Do not turn this description into a template, outline, or fixed paragraph count.",
    ],
  };
}

/* ------------------------------ AI distillation ----------------------------- */

function parseProfile(raw: string): VoiceProfile {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  return voiceProfileSchema.parse(JSON.parse(candidate) as unknown);
}

function samplesForAnalysis(samples: SampleView[]): string {
  return samples
    .map(
      (sample, index) =>
        `--- SAMPLE ${index + 1} (${sample.outcome}, rating ${sample.rating}/5${
          sample.preferred ? ", preferred" : ""
        }) ---\n${sample.content.trim()}`
    )
    .join("\n\n");
}

const VOICE_SYSTEM_PROMPT =
  "You analyze a freelancer's past proposals to describe their stable writing voice. You are not writing a proposal, template, outline, or example. Extract only general style traits. Never quote or paraphrase client-specific content, project names, URLs, job requirements, deliverables, or sentences. Return ONLY valid JSON.";

function voiceUserPrompt(samples: SampleView[]): string {
  return `Analyze these past proposals as voice evidence. Describe HOW the writer writes, not WHAT they wrote.

Focus on:
- rhythm: sentence and paragraph length, variation, and pacing
- openings: how the writer usually begins, described as a trait rather than an example
- structure: how the body is paragraphed and how ideas connect; describe tendencies, not a required section order
- closings: how the writer ends, including sign-offs or questions
- directness, warmth, formality, technical depth, and restraint
- recurring habits: contractions, punctuation, questions, lists, repetition, emphasis
- what this writer avoids

Rules:
- Do not produce a template, outline, skeleton, reusable frame, or example proposal.
- Do not describe a fixed opening-body-close sequence that every future proposal must follow.
- Do not quote or reuse any phrase longer than four words from the samples.
- Do not include client names, project names, URLs, prices, deadlines, deliverables, or job facts.
- Write each trait as a general instruction that applies to any future job.
- Prefer specific, observable traits over generic praise.
- If the samples disagree, describe the range instead of forcing one style.
- Preferred samples carry more weight. Won/lost outcomes are not proof that the prose is good.

Return JSON with:
{
  "summary": "one sentence describing the overall voice",
  "rhythm": "sentence and paragraph rhythm",
  "openings": ["trait", "trait"],
  "structure": "how a proposal usually moves",
  "closings": ["trait", "trait"],
  "habits": ["trait", "trait"],
  "avoid": ["thing this writer avoids"]
}

SAMPLES:
${samplesForAnalysis(samples)}`;
}

function trace(
  onTrace: ProposalTraceEmitter | undefined,
  event: Parameters<ProposalTraceEmitter>[0]
): void {
  try {
    onTrace?.(event);
  } catch (error) {
    log.warn("Voice guide trace callback failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

export interface VoiceGuideOptions {
  userId: string;
  samples: SampleView[];
  model?: string;
  timeoutMs?: number;
  onTrace?: ProposalTraceEmitter;
}

export async function getVoiceGuide({
  userId,
  samples,
  model,
  timeoutMs,
  onTrace,
}: VoiceGuideOptions): Promise<VoiceProfile> {
  if (samples.length === 0) return EMPTY_PROFILE;
  if (samples.every((sample) => sample.id.startsWith(DEFAULT_SAMPLE_ID_PREFIX))) {
    return STARTER_VOICE_PROFILE;
  }

  const key = `${userId}:${model ?? "default"}:${hashSamples(samples)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const startedAt = Date.now();
  const request = {
    model: model ?? null,
    temperature: 0.2,
    timeoutMs: timeoutMs ?? 60_000,
    system: VOICE_SYSTEM_PROMPT,
    user: voiceUserPrompt(samples),
    responseFormat: voiceResponseFormat,
  };

  let profile: VoiceProfile;
  try {
    const raw = await callOpenRouterStructured(
      request.system,
      request.user,
      voiceResponseFormat,
      model,
      request.timeoutMs,
      { temperature: request.temperature }
    );
    trace(onTrace, {
      phase: "setup",
      title: "Voice guide API response",
      status: "completed",
      detail: `${Date.now() - startedAt}ms`,
      data: { kind: "model-call", request, response: raw, durationMs: Date.now() - startedAt },
    });
    profile = finalizeVoiceProfile(sanitizeVoiceProfile(parseProfile(raw), samples), samples);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    trace(onTrace, {
      phase: "setup",
      title: "Voice guide API error",
      status: "failed",
      detail: message,
      data: { kind: "model-call", request, error: message, durationMs: Date.now() - startedAt },
    });
    log.warn("Voice guide stage failed; using deterministic style analysis", {
      error: error instanceof Error ? error.message : "unknown",
    });
    profile = buildFallbackVoiceProfile(samples);
  }

  cache.set(key, profile);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return profile;
}

export function clearVoiceGuideCache(): void {
  cache.clear();
}

export function voiceGuideText(profile: VoiceProfile): string {
  const list = (label: string, values: string[]): string[] =>
    values.length > 0 ? [`${label}:`, ...values.map((value) => `- ${value}`)] : [];

  return [
    "VOICE GUIDE — an analysis of how the owner writes. This is not sample text and must not be reused as wording.",
    "Use it only to match rhythm, directness, structure, and restraint. Do not turn it into a template, outline, or fixed sentence frames. Do not copy client details, projects, links, deliverables, or facts from past proposals.",
    `Overall voice: ${profile.summary}`,
    `Rhythm: ${profile.rhythm}`,
    ...list("Openings", profile.openings),
    `Structure: ${profile.structure}`,
    ...list("Closings", profile.closings),
    ...list("Habits", profile.habits),
    ...list("Avoid", profile.avoid),
    "Use the job brief to decide what matters, then add judgment, decisions, and verification. Do not paraphrase the brief back to the client.",
    "Before finishing, confirm that every material deliverable is covered, including any final testing or verification the client asked for.",
  ].join("\n");
}
