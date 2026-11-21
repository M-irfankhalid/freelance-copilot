import { z } from "zod";

import { PROPOSAL_WRITING_RUBRIC } from "./proposal-rubric.js";

/**
 * Editable seed data for the proposal engine. These values are written to the
 * database the first time a user opens the proposal system. Runtime code only
 * reads the database — changing these constants does not change saved setups.
 * Existing installations can explicitly upgrade untouched defaults through the
 * proposal-system API; customized values are preserved.
 */

export const promptTemplateSchema = z.object({
  system: z
    .string()
    .min(1)
    .max(40_000)
    .describe(
      "System instruction for this stage. Defines the model's role, hard rules, and required output format."
    ),
  user: z
    .string()
    .min(1)
    .max(80_000)
    .describe(
      "User message template for this stage. Preserve supported {{placeholders}}; change only the guidance you intend to change."
    ),
});

export type PromptTemplate = z.infer<typeof promptTemplateSchema>;

const DEFAULT_WRITER_CONTRACT = [
  "WRITING CONTRACT (highest priority; it overrides any earlier style advice that conflicts with it):",
  "- Write as Irfan speaking directly to this client in first person. Use plain, natural English and contractions where they fit.",
  "- Sound like an experienced developer in a real conversation: calm, direct, warm, specific. Not formal, not corporate, not salesy, not arrogant.",
  "- Open with a brief natural greeting when it fits, such as 'Hi there,'. Then immediately answer the client or say what you can do. Never open with a general definition, market lesson, or 'X requires Y' observation.",
  "- Talk about the client's outcome and the decisions you would make: 'I'd first review...', 'I'd start by...', 'I'd focus on...'. Explain why an approach fits instead of listing technologies.",
  "- Mention relevant experience in one conversational sentence: 'I've built...', 'I've been working with...'. Do not write 'My experience includes', a skill inventory, or a résumé paragraph.",
  "- Make quality and reliability concrete: structured output, realistic test inputs, response validation, fallbacks, error handling, rate limits, and cost control. Avoid abstract claims such as 'careful alignment' with no method.",
  "- Choose the simplest approach that fits. If a relevant enhancement such as RAG would genuinely help, mention it conditionally instead of forcing every technology into the reply.",
  "- A short greeting line, 3-4 short body paragraphs, one optional question, and a simple sign-off such as 'Best regards, Irfan Khalid' is the default shape. Separate paragraphs with blank lines; never return one dense block.",
  "- Every sentence must earn its place. No filler, generic claims, templated transitions, or phrases like 'in today's world' or 'I understand that'.",
  "- Avoid consultant adjectives and verbs: comprehensive, tailored, robust, seamless, holistic, end-to-end, cutting-edge, leverage, ensure alignment, streamline, empower, unlock, navigate, foster, elevate.",
  "- Never invent experience, metrics, certifications, location, availability, or client names. If the profile does not verify it, do not write it.",
  "- Do not volunteer irrelevant weaknesses or self-disqualify. Never say you are below, short of, or missing a stated requirement. Lead with the strongest relevant verified capability instead.",
  "- Use the most relevant verified portfolio link only when examples are requested or it materially improves credibility. Describe related projects accurately.",
  "- If the job asks for an example, document, diagram, or similar proof, name a concrete verified artifact. If no verified artifact matches, omit the example rather than inventing one.",
  "- Ask at most one question, and only if the answer changes what you would do next. Never ask something the job already answers.",
  "- If the brief includes ongoing support, say plainly that ongoing support is included and name the first two concrete things you will do after launch.",
  "- Do not use headings, bullet lists, bold labels, or a consultant-style risks/assumptions section.",
  "- {{relationshipGuidance}}",
  "- Target {{wordTarget}}.",
  "- Before returning, check the brief deliverables, applicationRequirements, and explicit questions one by one and make sure each is addressed naturally. If one is missing, add it in the most natural place instead of padding.",
].join("\n");

const DEFAULT_REVIEW_CONTRACT = [
  "STYLE REVIEW (highest priority; it overrides any earlier review advice that conflicts with it):",
  "- Reward a confident first-person proposal that sounds like a specific developer talking to this client.",
  "- A short greeting and a simple sign-off are natural parts of this voice. Do not penalize them or demand their removal.",
  "- Penalize consultant-report framing, generic market or risk analysis, restating the brief, filler, headings, bullet lists, and multiple questions.",
  "- Penalize any invented experience, metric, location, certification, or client name.",
  "- Treat a sentence that names the support and the next actions as coverage, even if it is not labeled as a deliverable.",
  "- Treat every item in applicationRequirements as mandatory coverage, including required openings, subject lines, examples, links, rates, and availability.",
  "- {{relationshipGuidance}}",
  "- Only request a revision when something important is missing, false, unclear, or off-voice. Do not request a revision for stylistic preference alone.",
].join("\n");

const DEFAULT_REVISION_CONTRACT = [
  "REVISION CONTRACT (highest priority):",
  "- Keep every existing deliverable, application requirement, evidence reference, and the strongest proof.",
  "- Address each instruction in one or two short sentences. Do not remove a covered deliverable or application requirement to make room.",
  "- Do not add consultant framing, headings, bullets, or generic claims.",
  "- Remove consultant adjectives and framing, self-disqualification, vague example claims, and questions the job already answers.",
  "- Keep the text in 3-5 short paragraphs separated by blank lines; split a dense block without changing the words.",
  "- Keep the same first-person voice and preserve a natural greeting, the strongest opening, any useful question, and a simple sign-off.",
].join("\n");

export const proposalContractsSchema = z.object({
  /** Appended to the writer prompt. Supports {{wordTarget}} and {{relationshipGuidance}}. */
  writer: z
    .string()
    .max(40_000)
    .default(DEFAULT_WRITER_CONTRACT)
    .describe(
      "Hard writing rules appended to every writer call. Controls voice, paragraph shape, banned habits, and evidence limits. Change this for persistent writing-style problems, not one-off drafts."
    ),
  /** Appended to the reviewer and judge prompts. Supports {{relationshipGuidance}}. */
  reviewer: z
    .string()
    .max(40_000)
    .default(DEFAULT_REVIEW_CONTRACT)
    .describe(
      "Review rules appended to reviewer and judge calls. Controls what counts as a defect, coverage, and style penalties. Change this when reviews reward or reject the wrong things."
    ),
  /** Appended to the reviser prompt. */
  reviser: z
    .string()
    .max(40_000)
    .default(DEFAULT_REVISION_CONTRACT)
    .describe(
      "Revision rules appended to reviser calls. Controls what a revision must preserve and what it must fix."
    ),
});

export const candidateLaneSchema = z.object({
  /** Used as the candidate shape and as the key in saved legacy shape guidance. */
  id: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .describe(
      "Stable lane id used in traces and judging. Use an existing lane id when editing; add a lane only when a distinct writing strategy is genuinely needed."
    ),
  label: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe("Human-readable lane name shown in the proposal system UI."),
  /** Extra writer guidance for this candidate only. */
  guidance: z
    .string()
    .max(4_000)
    .default("")
    .describe(
      "Extra writer instructions for this lane only. Use it to make one candidate differ in angle, not to repeat the global writer contract."
    ),
  /** Null inherits the writer-stage model. */
  model: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .default(null)
    .describe("Model id for this lane. Null inherits the writer-stage model."),
  /** Null inherits the writer-stage temperature. */
  temperature: z
    .number()
    .min(0)
    .max(2)
    .nullable()
    .default(null)
    .describe("Sampling temperature for this lane. Null inherits the writer-stage temperature."),
  /** Null inherits the writer-stage timeout. */
  timeoutSeconds: z
    .number()
    .int()
    .min(10)
    .max(600)
    .nullable()
    .default(null)
    .describe("Per-call timeout in seconds for this lane. Null inherits the writer-stage timeout."),
  enabled: z
    .boolean()
    .default(true)
    .describe("Set false to keep this lane configured but exclude it from generation."),
});

export type CandidateLane = z.infer<typeof candidateLaneSchema>;

export const flowStepTypeSchema = z.enum([
  "brief",
  "write",
  "judge",
  "review",
  "revise",
  "custom",
  "final",
]);

export type FlowStepType = z.infer<typeof flowStepTypeSchema>;

export const flowStepSchema = z.object({
  /** Used as the template variable suffix: {{step_<id>}}. */
  id: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Use letters, numbers, and underscores; start with a letter")
    .describe(
      "Unique step id. Other steps reference this output as {{step_<id>}}; changing an id breaks existing references."
    ),
  label: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe("Human-readable step name shown in traces and the flow canvas."),
  type: flowStepTypeSchema.describe(
    "Step behavior: brief, write, judge, review, revise, custom, or final. The type controls which built-in handling and variables apply."
  ),
  enabled: z
    .boolean()
    .default(true)
    .describe("Set false to skip this step without deleting it."),
  system: z
    .string()
    .max(40_000)
    .default("")
    .describe("System prompt for this step. Empty uses the step type's default behavior."),
  user: z
    .string()
    .max(80_000)
    .default("")
    .describe("User prompt template for this step. Supports {{step_<id>}}, {{file_<id>}}, job, profile, and policy variables."),
  /** Null inherits the proposal model selected on the Platforms page. */
  model: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .default(null)
    .describe("Model id for this step. Null inherits the proposal model selected on the Platforms page."),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .nullable()
    .default(null)
    .describe("Sampling temperature for this step. Null inherits the proposal temperature."),
  timeoutSeconds: z
    .number()
    .int()
    .min(10)
    .max(600)
    .nullable()
    .default(null)
    .describe("Per-call timeout in seconds for this step. Null uses the step-type default."),
  /** Canvas position. Null means the UI should auto-arrange the node. */
  position: z
    .object({
      x: z.number().min(0).max(100_000).describe("Horizontal node position on the flow canvas."),
      y: z.number().min(0).max(100_000).describe("Vertical node position on the flow canvas."),
    })
    .nullable()
    .default(null)
    .describe("UI-only canvas position. Null lets the UI auto-arrange the node; it does not affect generation."),
  /** Files from flow.files made available as {{files}} for this step. */
  fileIds: z
    .array(z.string().trim().min(1).max(60))
    .max(25)
    .default([])
    .describe(
      "Context file ids from flow.files to expose to this step as {{file_<id>}} variables. Use only files relevant to this step."
    ),
});

export type FlowStep = z.infer<typeof flowStepSchema>;

export const flowFileSchema = z.object({
  /** Used as the template variable suffix: {{file_<id>}}. */
  id: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Use letters, numbers, and underscores; start with a letter")
    .describe(
      "Unique file id. Steps reference this content as {{file_<id>}}; changing an id breaks existing references."
    ),
  label: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe("Human-readable name for this context file."),
  content: z
    .string()
    .max(120_000)
    .default("")
    .describe(
      "Reference content available to steps that select this file, such as a checklist, case study, or style guide. It is not sent unless a step references it."
    ),
  enabled: z
    .boolean()
    .default(true)
    .describe("Set false to keep the file but exclude it from every step."),
});

export type FlowFile = z.infer<typeof flowFileSchema>;

export const proposalFlowSchema = z
  .object({
    enabled: z.boolean().default(false),
    steps: z.array(flowStepSchema).max(24).default([]),
    files: z.array(flowFileSchema).max(25).default([]),
  })
  .superRefine((flow, ctx) => {
    const stepIds = new Set<string>();
    for (const [index, step] of flow.steps.entries()) {
      if (stepIds.has(step.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate flow step id: ${step.id}`,
          path: ["steps", index, "id"],
        });
      }
      stepIds.add(step.id);
    }

    const fileIds = new Set<string>();
    let totalFileChars = 0;
    for (const [index, file] of flow.files.entries()) {
      if (fileIds.has(file.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate context file id: ${file.id}`,
          path: ["files", index, "id"],
        });
      }
      fileIds.add(file.id);
      totalFileChars += file.content.length;
    }
    if (totalFileChars > 120_000) {
      ctx.addIssue({
        code: "custom",
        message: "Context files are limited to 120,000 characters in total",
        path: ["files"],
      });
    }

    for (const [index, step] of flow.steps.entries()) {
      for (const fileId of step.fileIds) {
        if (!fileIds.has(fileId)) {
          ctx.addIssue({
            code: "custom",
            message: `Unknown context file: ${fileId}`,
            path: ["steps", index, "fileIds"],
          });
        }
      }
      if (!flow.enabled || !step.enabled || step.type === "final") continue;
      if (step.system.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Add a system prompt for this step",
          path: ["steps", index, "system"],
        });
      }
      if (step.user.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Add a user prompt for this step",
          path: ["steps", index, "user"],
        });
      }
    }

    const enabledSteps = flow.steps.filter((step) => step.enabled);
    if (flow.enabled && enabledSteps.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Enable at least one flow step",
        path: ["steps"],
      });
    }
    if (
      flow.enabled &&
      !enabledSteps.some(
        (step) => step.type === "write" || step.type === "revise" || step.type === "custom"
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Enable at least one text-producing step (write, revise, or custom)",
        path: ["steps"],
      });
    }
  });

export type ProposalFlow = z.infer<typeof proposalFlowSchema>;

const DEFAULT_FLOW_BRIEF_USER = `JOB:
{{jobJson}}

POLICY:
{{policyJson}}

VERIFIED PROFILE FACTS:
{{profileFacts}}

RETRIEVED PLAYBOOK:
{{playbook}}

Return ONLY valid JSON with these keys:
{
  "goal": "the client's real outcome in 1-2 sentences",
  "facts": ["requirements the client stated explicitly"],
  "hypotheses": ["reasonable inferences, clearly unconfirmed"],
  "deliverables": ["concrete things the client asked for"],
  "explicitQuestions": ["questions the client asked, in their words"],
  "applicationRequirements": ["required openings, subject lines, examples, links, rates, or availability the client asked for"],
  "mustAddress": ["constraints or non-negotiables"],
  "acceptanceCriteria": ["how the client will know the work is complete"],
  "dependencies": ["access, assets, or decisions the work depends on"],
  "unresolved": ["genuinely open decisions"],
  "risks": ["things that could go wrong or hidden work"],
  "avoidAssumptions": ["things the proposal must not assume"],
  "bestQuestion": "one question whose answer changes the plan, or empty string",
  "bestQuestionWhy": "why that question matters",
  "angle": {
    "type": "de_risk|speed|quality|cost|communication|technical_depth|simplicity|compliance",
    "statement": "the single message this proposal should lead with",
    "why": "why this angle fits this client"
  },
  "shape": "short_note|diagnostic|plan|technical_brief",
  "omit": ["things the proposal should leave out"],
  "evidenceNeeds": ["kinds of proof that would be relevant"],
  "toneHints": ["observable tone cues from the job"],
  "clarificationNeeded": false
}

Rules: put only job-stated facts in facts and deliverables; put guesses in hypotheses. Capture every distinct responsibility as its own deliverable. Capture explicit questions, application requirements, and acceptance criteria. Do not put greetings or sign-offs in omit unless the client forbids them. Prefer the shortest useful shape. Do not write the proposal.`;

const DEFAULT_FLOW_WRITE_USER = `JOB BRIEF:
{{jobBriefJson}}

JOB:
{{jobJson}}

VERIFIED PROFILE FACTS:
{{profileFacts}}

SELECTED EVIDENCE:
{{evidence}}

VOICE GUIDE:
{{samples}}

POLICY:
{{policyJson}}

ANTI-AI TELLS:
{{antiAiTells}}

{{files}}

Write one conversational proposal now. Open with a brief greeting when it fits, then answer the client directly or make a specific recommendation. Present the strongest relevant verified capabilities and evidence in one or two sentences, explain the approach through the client's outcome, and use a purposeful next step when helpful. Make reliability concrete instead of using abstract claims. Include relevant verified portfolio links when examples are requested or the link materially improves trust. Cover material deliverables, application requirements, and explicit questions without overexplaining. Use a short greeting line, 3-4 short body paragraphs, and a simple sign-off. Never return one dense block. Keep risk analysis internal by default; do not volunteer irrelevant weaknesses or front-load warnings. Never invent experience, credentials, clients, results, prices, deadlines, or links. Return only the proposal text.`;

const DEFAULT_FLOW_JUDGE_USER = `JOB BRIEF:
{{jobBriefJson}}

JOB:
{{jobJson}}

POLICY:
{{policyJson}}

CANDIDATES:
{{candidatesJson}}

Rank every candidate. Return ONLY valid JSON:
{
  "winnerIndex": 0,
  "ranking": [
    {
      "index": 0,
      "score": 0,
      "reasons": ["why this candidate wins or loses, citing its text"],
      "risks": ["specific risk if this candidate is sent"]
    }
  ],
  "summary": "one sentence on the deciding difference"
}

Score each candidate for job understanding, specificity, judgment, evidence relevance, voice match, coverage, conciseness, naturalness, and policy compliance. Do not reward length or polished generic writing.`;

const DEFAULT_FLOW_REVIEW_USER = `JOB BRIEF:
{{jobBriefJson}}

JOB:
{{jobJson}}

POLICY:
{{policyJson}}

VOICE GUIDE:
{{samples}}

SELECTED EVIDENCE:
{{evidence}}

DRAFT:
{{draft}}

Review the draft. Return ONLY valid JSON:
{
  "verdict": "accept|revise|reject",
  "dimensions": {
    "jobUnderstanding": 0,
    "specificity": 0,
    "technicalJudgment": 0,
    "evidence": 0,
    "voiceMatch": 0,
    "naturalness": 0,
    "conciseness": 0,
    "grounding": 0,
    "policy": 0
  },
  "issues": [
    {
      "severity": "blocker|major|minor",
      "category": "fabrication|irrelevant|generic|voice_mismatch|policy|length|structure|coverage|commercials|closing|filler|opening",
      "quote": "exact substring from the draft",
      "problem": "what is wrong and why it matters",
      "fix": "the minimum specific change"
    }
  ],
  "coverage": [
    { "deliverable": "exact item from the brief", "covered": true, "evidence": "short quote or missing" }
  ],
  "criticalDefects": ["fabricated claim or hard violation; empty when none"],
  "revisionInstructions": ["at most five targeted instructions"],
  "mustKeep": ["specific strengths the revision must preserve"]
}

Dimensions are 0, 1, or 2. List every deliverable, application requirement, and explicit question in coverage. A brief greeting followed by a specific response is not generic. A simple sign-off is not a defect. Do not request a rewrite for a stylistic preference alone.`;

const DEFAULT_FLOW_REVISE_USER = `JOB BRIEF:
{{jobBriefJson}}

POLICY:
{{policyJson}}

SELECTED EVIDENCE:
{{evidence}}

CURRENT DRAFT:
{{draft}}

REVIEW:
{{reviewJson}}

REVISION INSTRUCTIONS:
{{revisionInstructions}}

MUST KEEP:
{{mustKeep}}

Apply only the review findings. Preserve every covered deliverable, relevant evidence reference, the owner's voice, a natural greeting, the strongest opening, any useful question, and a simple sign-off. Do not add facts, links, prices, deadlines, or new claims. Return only the revised proposal text.`;

const DEFAULT_FLOW_REVISE_STEP: FlowStep = {
  id: "revise",
  label: "Revise",
  type: "revise",
  enabled: true,
  system:
    "You are the owner's editor. Apply only the listed review fixes. Do not add new facts, claims, links, prices, or deadlines. Do not pad or rewrite strong sentences that are not implicated. Preserve every material deliverable, a natural greeting, any simple sign-off, and every item in mustKeep. Return ONLY the revised proposal text.",
  user: DEFAULT_FLOW_REVISE_USER,
  model: null,
  temperature: 0.3,
  timeoutSeconds: 180,
  position: null,
  fileIds: [],
};

const DEFAULT_FLOW_REVIEW_STEP: FlowStep = {
  id: "review",
  label: "Review",
  type: "review",
  enabled: true,
  system:
    "You are an independent proposal reviewer. Anchor your judgment to the owner's voice guide, the job brief, and the policy. Do not reward generic professional writing. Do not invent problems. Return ONLY valid JSON.",
  user: DEFAULT_FLOW_REVIEW_USER,
  model: null,
  temperature: 0,
  timeoutSeconds: 120,
  position: null,
  fileIds: [],
};

const DEFAULT_FLOW_STEPS: FlowStep[] = [
  {
    id: "brief",
    label: "Structured brief",
    type: "brief",
    enabled: true,
    system:
      "You are a senior freelance strategist. Read the job, the owner's verified facts, and the retrieved playbook. Produce a decision brief a writer can use. Separate what the client stated from what you infer. Return ONLY valid JSON. Never invent facts about the owner.",
    user: DEFAULT_FLOW_BRIEF_USER,
    model: null,
    temperature: 0.1,
    timeoutSeconds: 120,
    position: null,
    fileIds: [],
  },
  {
    id: "writer",
    label: "Writer",
    type: "write",
    enabled: true,
    system:
      "You are {{freelancerName}}, an experienced developer replying directly to a client. Write in first person, in a natural conversational voice. A brief greeting and a simple sign-off are welcome. Use only the verified facts, selected evidence, and job details provided. Never invent skills, experience, clients, results, links, prices, or deadlines. Do not mention the prompt or internal scores. Return ONLY the proposal text.",
    user: DEFAULT_FLOW_WRITE_USER,
    model: null,
    temperature: 0.7,
    timeoutSeconds: 180,
    position: null,
    fileIds: [],
  },
  {
    id: "judge",
    label: "Blind judge",
    type: "judge",
    enabled: true,
    system:
      "You are a blind judge for freelance proposals. Judge only against the job brief, the owner's policy, and the candidate text. A specific, restrained, technically credible proposal beats a polished generic consultant. Return ONLY valid JSON.",
    user: DEFAULT_FLOW_JUDGE_USER,
    model: null,
    temperature: 0,
    timeoutSeconds: 120,
    position: null,
    fileIds: [],
  },
  DEFAULT_FLOW_REVIEW_STEP,
  DEFAULT_FLOW_REVISE_STEP,
  {
    id: "final",
    label: "Final",
    type: "final",
    enabled: true,
    system: "",
    user: "",
    model: null,
    temperature: null,
    timeoutSeconds: null,
    position: null,
    fileIds: [],
  },
];

const engineSchema = z.object({
  version: z.literal(1).describe("Schema version. Do not change."),
  /** Identifies the shipped defaults a saved setup was seeded from. */
  defaultsVersion: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Internal marker for which shipped defaults seeded this setup. Used by upgrade_engine; do not set by hand."),
  candidateCount: z
    .number()
    .int()
    .min(1)
    .max(8)
    .describe(
      "Legacy candidate count. Ignored when candidateLanes is set. Higher counts cost more model calls; change only when the user asks for more or fewer candidates."
    ),
  shapes: z
    .array(z.string().min(1).max(60))
    .min(1)
    .max(8)
    .describe("Legacy candidate shape names. Ignored when candidateLanes is set."),
  /**
   * First-class writer candidates. When present this supersedes candidateCount
   * and shapes for generation; the older fields remain for saved configs,
   * MCP clients, and the upgrade path.
   */
  candidateLanes: z
    .array(candidateLaneSchema)
    .min(1)
    .max(8)
    .optional()
    .describe(
      "Writer candidates. Each enabled lane is one separate writer call with its own guidance, model, and temperature. This controls how many different drafts are generated before judging."
    ),
  /**
   * Optional user-designed pipeline. When enabled it replaces the built-in
   * stages, candidate lanes, contracts, and prompts for proposal generation.
   */
  flow: proposalFlowSchema
    .default(() => ({
      enabled: false,
      steps: DEFAULT_FLOW_STEPS.map((step) => ({ ...step, fileIds: [...step.fileIds] })),
      files: [],
    }))
    .describe(
      "Optional custom pipeline. When enabled, its steps replace the built-in brief/write/judge/review/revise stages and their prompts. Keep it disabled unless the user explicitly wants a custom flow."
    ),
  /**
   * Model ids per stage. Null/empty means "use the proposal model selected on
   * the Platforms page". This keeps model choice data-driven without forcing
   * the owner to configure six ids.
   */
  models: z
    .object({
      brief: z
        .string()
        .max(200)
        .nullable()
        .describe("Model for the structured brief stage. Null inherits proposalModelId."),
      writer: z
        .string()
        .max(200)
        .nullable()
        .describe("Model for writer candidates. Null inherits proposalModelId."),
      judge: z
        .string()
        .max(200)
        .nullable()
        .describe("Model for blind judging. Null inherits proposalModelId."),
      reviewer: z
        .string()
        .max(200)
        .nullable()
        .describe("Model for review/quality judgment. Null inherits proposalModelId."),
      reviser: z
        .string()
        .max(200)
        .nullable()
        .describe("Model for revisions. Null inherits proposalModelId."),
      deleter: z
        .string()
        .max(200)
        .nullable()
        .describe("Model for the deletion/compression pass. Null inherits proposalModelId."),
    })
    .describe("Per-stage model overrides. Null means use proposalModelId from AI settings."),
  temperatures: z
    .object({
      brief: z.number().min(0).max(2).describe("Brief temperature. Lower is more deterministic."),
      writer: z.number().min(0).max(2).describe("Writer temperature. Higher increases variation."),
      judge: z.number().min(0).max(2).describe("Judge temperature. Keep low for consistency."),
      reviewer: z.number().min(0).max(2).describe("Reviewer temperature. Keep low for consistency."),
      reviser: z.number().min(0).max(2).describe("Reviser temperature. Low keeps edits conservative."),
      deleter: z.number().min(0).max(2).describe("Deletion-pass temperature. Keep low."),
    })
    .describe("Per-stage sampling temperatures."),
  timeoutsSeconds: z
    .object({
      brief: z.number().int().min(10).max(600).describe("Brief-stage timeout in seconds."),
      writer: z.number().int().min(10).max(600).describe("Writer-stage timeout in seconds."),
      judge: z.number().int().min(10).max(600).describe("Judge-stage timeout in seconds."),
      reviewer: z.number().int().min(10).max(600).describe("Reviewer-stage timeout in seconds."),
      reviser: z.number().int().min(10).max(600).describe("Reviser-stage timeout in seconds."),
      deleter: z.number().int().min(10).max(600).describe("Deletion-stage timeout in seconds."),
    })
    .describe("Per-stage timeouts in seconds."),
  stages: z
    .object({
      brief: z.boolean().describe("Run the structured brief stage before writing."),
      candidates: z
        .boolean()
        .describe("Generate multiple writer candidates instead of a single draft."),
      judge: z.boolean().describe("Run blind judging to choose between candidates."),
      review: z.boolean().describe("Run the review stage and compute quality/coverage."),
      revision: z.boolean().describe("Allow revisions after review."),
      deletion: z.boolean().describe("Allow the deletion/compression pass to cut filler."),
      deterministicValidation: z
        .boolean()
        .describe("Run deterministic quality, coverage, policy, and grounding checks."),
    })
    .describe("Stage toggles. Turn off a stage only when the user wants it skipped."),
  maxRevisionAttempts: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe("How many revision passes may run after review. 0 disables revision."),
  maxRepairAttempts: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe("How many repair attempts may run after hard or policy failures. 0 disables repair."),
  maxSampleCount: z
    .number()
    .int()
    .min(0)
    .max(5)
    .describe("Maximum voice samples analyzed for the voice guide. More samples cost more tokens."),
  maxEvidenceItems: z
    .number()
    .int()
    .min(0)
    .max(5)
    .describe("Maximum portfolio evidence items given to the writer."),
  /** Minimum word count before the deletion pass runs. 0 = always run. */
  minWordsForDeletion: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .describe("Minimum draft word count before the deletion pass runs. 0 always runs it."),
  shapeGuidance: z
    .record(z.string(), z.string().max(2000))
    .describe(
      "Legacy per-shape writer guidance keyed by shape/lane id. Candidate lane guidance is preferred when lanes are configured."
    ),
  contracts: proposalContractsSchema
    .default({
      writer: DEFAULT_WRITER_CONTRACT,
      reviewer: DEFAULT_REVIEW_CONTRACT,
      reviser: DEFAULT_REVISION_CONTRACT,
    })
    .describe("Persistent writing, review, and revision rules appended to the matching stages."),
});

const policySchema = z.object({
  version: z.literal(1).describe("Schema version. Do not change."),
  commercials: z
    .enum(["body_when_set", "fields_only", "if_client_asks"])
    .describe(
      "Where price and delivery may appear: body_when_set includes them in the text when terms are saved; fields_only keeps them out of the text; if_client_asks mentions them only when the job asks."
    ),
  words: z
    .object({
      min: z.number().int().min(20).max(1000).describe("Minimum target word count."),
      max: z.number().int().min(40).max(2000).describe("Maximum allowed word count."),
    })
    .describe("Target proposal length. Use this for length complaints instead of editing prompts."),
  format: z
    .enum(["natural", "structured"])
    .describe("natural means conversational paragraphs; structured allows headings and lists."),
  askQuestion: z
    .enum(["never", "if_useful", "always"])
    .describe("Whether the proposal ends with a question."),
  maxEvidence: z
    .number()
    .int()
    .min(0)
    .max(5)
    .describe("Maximum portfolio evidence items allowed in the text."),
  includeLinks: z.boolean().describe("Allow verified portfolio links in the proposal."),
  bannedPhrases: z
    .array(z.string().max(200))
    .max(200)
    .describe("Phrases that must never appear. Use this for specific banned wording."),
});

const checksSchema = z.object({
  /** Failures that block a draft even if every other score is high. */
  hard: z
    .array(z.string().max(100))
    .max(50)
    .describe("Hard failures that block a draft even when other scores are high."),
  /** Preference failures that trigger one revision. */
  policy: z
    .array(z.string().max(100))
    .max(50)
    .describe("Policy failures that trigger one revision."),
  /** Quality warnings. Never block. */
  advisory: z
    .array(z.string().max(100))
    .max(50)
    .describe("Quality warnings that never block a draft."),
  antiAiTells: z
    .array(z.string().max(200))
    .max(200)
    .describe("Phrases that trigger generic-writing warnings. Prefer policy.bannedPhrases for hard bans."),
});

export const proposalEngineConfigSchema = z.object({
  engine: engineSchema,
  prompts: z.object({
    brief: promptTemplateSchema,
    writer: promptTemplateSchema,
    judge: promptTemplateSchema,
    reviewer: promptTemplateSchema,
    reviser: promptTemplateSchema,
    deleter: promptTemplateSchema,
  }),
  policy: policySchema,
  checks: checksSchema,
});

export type ProposalEngineConfig = z.infer<typeof proposalEngineConfigSchema>;
export type ProposalPolicy = ProposalEngineConfig["policy"];
export type ProposalChecks = ProposalEngineConfig["checks"];
export type ProposalPromptSet = ProposalEngineConfig["prompts"];

const ANTI_AI_TELLS = [
  "I've read your brief",
  "I have read your brief",
  "I understand",
  "Here's the plan I'd follow",
  "Here is the plan I would follow",
  "Let me know",
  "In today's",
  "not just",
  "seamless",
  "robust",
  "leverage",
  "delve",
  "elevate",
  "unlock",
  "tailored",
  "comprehensive",
  "I am confident",
  "perfect fit",
  "look no further",
  "proven track record",
  "game-changer",
  "cutting-edge",
  "end-to-end",
  "holistic",
  "synergy",
  "empower",
  "foster",
  "navigate",
  "landscape",
  "realm",
  "testament",
  "meticulous",
  "passionate",
  "I look forward",
  "reach out",
  "discuss next steps",
  "let's connect",
  "ensure alignment",
  "ensuring alignment",
  "bridge the gap",
  "smooth communication",
  "practical approach",
  "when it comes to",
  "in terms of",
  "slightly below",
  "short of your",
  "fully available",
];

const DEFAULT_SHAPE_GUIDANCE: Record<string, string> = {
  short_note:
    "A conversational client-winning note. Open with a brief greeting if it fits, then a direct answer or a specific recommendation. Use short body paragraphs, one relevant proof point, a natural question when useful, and a simple sign-off. Keep it client-first and free of generic self-introduction.",
  diagnostic:
    "Lead with one or two sharp diagnostic questions that prove you understand the risk. Then one compact paragraph of credibility and one compact paragraph of approach. No headings and no exhaustive checklists.",
  plan:
    "Use only when the client explicitly asked for a plan or the work is genuinely multi-phase. Keep it to at most four plain-language steps. No bold headings. Do not turn the proposal into a project plan.",
  technical_brief:
    "For a technical buyer. Lead with the core technical risk and the approach that addresses it. Stay concise. Do not list every technology you know.",
};

export const DEFAULT_CANDIDATE_LANES: CandidateLane[] = [
  {
    id: "short_note",
    label: "Short note",
    guidance: DEFAULT_SHAPE_GUIDANCE.short_note ?? "",
      model: null,
      temperature: null,
      timeoutSeconds: null,
      enabled: true,
  },
  {
    id: "diagnostic",
    label: "Diagnostic",
    guidance: DEFAULT_SHAPE_GUIDANCE.diagnostic ?? "",
      model: null,
      temperature: null,
      timeoutSeconds: null,
      enabled: true,
  },
  {
    id: "plan",
    label: "Plan",
    guidance: DEFAULT_SHAPE_GUIDANCE.plan ?? "",
      model: null,
      temperature: null,
      timeoutSeconds: null,
      enabled: true,
  },
];

export const DEFAULT_PROPOSAL_ENGINE: ProposalEngineConfig = {
  engine: {
    version: 1,
    defaultsVersion: 6,
    candidateCount: 3,
    shapes: ["short_note", "diagnostic", "plan"],
    candidateLanes: DEFAULT_CANDIDATE_LANES.map((lane) => ({ ...lane })),
    flow: {
      enabled: false,
      steps: DEFAULT_FLOW_STEPS.map((step) => ({ ...step, fileIds: [...step.fileIds] })),
      files: [],
    },
    models: {
      brief: null,
      writer: null,
      judge: null,
      reviewer: null,
      reviser: null,
      deleter: null,
    },
    temperatures: {
      brief: 0.1,
      writer: 0.7,
      judge: 0,
      reviewer: 0,
      reviser: 0.3,
      deleter: 0.4,
    },
    timeoutsSeconds: {
      brief: 120,
      writer: 180,
      judge: 120,
      reviewer: 120,
      reviser: 180,
      deleter: 120,
    },
    stages: {
      brief: true,
      // One writer call by default: the brief picks the lane, then the writer
      // writes. Judging, review, revision, and deletion are opt-in extras so a
      // default run costs exactly two model calls (analyse, then write).
      candidates: false,
      judge: false,
      review: false,
      revision: false,
      deletion: false,
      deterministicValidation: true,
    },
    maxRevisionAttempts: 0,
    maxRepairAttempts: 0,
    maxSampleCount: 3,
    maxEvidenceItems: 2,
    /** Optional cleanup only runs when a draft is over the policy max or clearly filler-heavy. */
    minWordsForDeletion: 0,
    shapeGuidance: DEFAULT_SHAPE_GUIDANCE,
    contracts: {
      writer: DEFAULT_WRITER_CONTRACT,
      reviewer: DEFAULT_REVIEW_CONTRACT,
      reviser: DEFAULT_REVISION_CONTRACT,
    },
  },
  prompts: {
    brief: {
      system:
        "You are a senior freelance strategist. Read the job, the owner's verified facts, and the retrieved playbook. Produce a decision brief that a writer can use to draft one specific proposal. Separate what the client stated from what you infer. Return ONLY valid JSON with no markdown, no prose, and no commentary. Never invent facts about the owner.",
      user: `JOB:
{{jobJson}}

POLICY:
{{policyJson}}

VERIFIED PROFILE FACTS:
{{profileFacts}}

RETRIEVED PLAYBOOK:
{{playbook}}

Return JSON with exactly these keys:
{
  "goal": "the client's real outcome in 1–2 sentences",
  "facts": ["requirements or constraints the client stated explicitly"],
  "hypotheses": ["reasonable inferences or possible causes, clearly marked as unconfirmed"],
  "deliverables": ["concrete things the client asked for"],
  "explicitQuestions": ["questions the client asked in their own words"],
  "applicationRequirements": ["required openings, subject lines, examples, links, rates, or availability the client asked for"],
  "mustAddress": ["constraints, acceptance criteria, or non-negotiables"],
  "acceptanceCriteria": ["how the client will know the work is complete"],
  "dependencies": ["access, assets, third parties, hosting, DNS, credentials, or decisions the work depends on"],
  "unresolved": ["genuinely open decisions that could change the approach"],
  "risks": ["things that could go wrong, hidden work, or delivery risks"],
  "avoidAssumptions": ["things the proposal must not assume or promise"],
  "bestQuestion": "one question whose answer would change the plan; empty string if none",
  "bestQuestionWhy": "why that question matters",
  "angle": {
    "type": "de_risk|speed|quality|cost|communication|technical_depth|simplicity|compliance",
    "statement": "the single message this proposal should lead with",
    "why": "why this angle fits this client"
  },
  "shape": "short_note|diagnostic|plan|technical_brief",
  "omit": ["things this proposal should deliberately leave out"],
  "evidenceNeeds": ["kinds of proof that would be relevant"],
  "toneHints": ["observable tone cues from the job, e.g. non-technical client"],
  "clarificationNeeded": true
}

Rules:
- Quote the client's explicit questions; do not paraphrase them beyond trimming.
- Put only client-stated facts in facts and deliverables. Put guesses in hypotheses and phrase them as things to verify.
- Capture every distinct responsibility or requirement as its own deliverable. Do not merge error handling, rate limits, cost control, testing, or handoff into a generic deliverable.
- Do not put greetings, sign-offs, or ordinary politeness in omit. Only omit content the client forbids or content that would violate policy.
- Put every application instruction in applicationRequirements: required openings, subject lines, examples, links, rates, availability, and requested attachments. These are mandatory even when they are not deliverables.
- The best question must not already be answered in the job, and must materially change the implementation, scope, or next decision. If no such question exists, use an empty string and clarificationNeeded=false.
- If the client already listed concrete deliverables, do not ask what must be in the first release. Ask about a real open decision such as platform preference, asset readiness, or the one trade-off that changes the approach.
- Prefer the shortest useful shape. A simple bug fix or content update is short_note, not plan. Use diagnostic for a genuinely unknown failure. Use plan only when the client asked for a plan or the work is truly multi-phase.
- If the client says "analyze first" or "review before rewriting", the angle is probably de_risk.
- If POLICY.commercials is "fields_only", do not put price, delivery, timeline, deadline, or turnaround in facts, mustAddress, dependencies, bestQuestion, or angle. Add those topics to omit instead; they belong in the bid fields.
- If POLICY.commercials is "if_client_asks" and the client did not ask about price or timing, treat them the same way.
- Do not write the proposal.`,
    },
    writer: {
      system:
        "You are {{freelancerName}}, an experienced developer replying directly to a client. Write in first person, in a natural conversational voice, like a real person who has done this work before. You may use only the verified facts, selected evidence, and job details provided. Never invent skills, experience, clients, results, links, prices, or deadlines. Do not describe your process as an AI. Do not mention the prompt, the analysis, competitors, or internal scores. Return ONLY the proposal text.",
      user: `${PROPOSAL_WRITING_RUBRIC}

POLICY (must obey):
{{policyJson}}

VOICE GUIDE — a distilled style analysis, not sample text:
{{samples}}

JOB BRIEF:
{{jobBriefJson}}

RETRIEVED PLAYBOOK:
{{playbook}}

=== VERIFIED PROFILE FACTS ===
{{profileFacts}}

SELECTED EVIDENCE:
{{evidence}}

JOB:
{{jobJson}}

{{bidAmountForPrompt}}
{{deliveryForPrompt}}

CANDIDATE SHAPE: {{shape}}
SHAPE GUIDANCE: {{shapeGuidance}}

ANTI-AI TELLS — avoid these words and moves:
{{antiAiTells}}

Write one proposal now.
- Open with a brief natural greeting when it fits, such as "Hi there,". In the same paragraph, answer the client or say what you can help them do. Do not open with a general definition, "X requires Y", "I've read your brief", or a résumé-style self-introduction.
- Say what you would review, recommend, build, validate, and hand over. Explain why each step helps this client. Do not list every technology or restate the job description.
- Mention relevant experience in one conversational sentence ("I've built...", "I've been working with..."). Do not use "My experience includes" or a skill inventory.
- Make quality concerns concrete. For AI or integration work, name realistic testing, structured output, validation, fallbacks, error and rate-limit handling, and cost control when relevant. Do not stop at "reduce hallucinations".
- If a relevant enhancement such as RAG would genuinely help, mention it conditionally. Choose the simplest approach that fits.
- Cover every deliverable, application requirement, and explicit question in the brief with precise sentences. Never drop a requirement to stay short.
- Do not turn a simple fix into a multi-phase plan. Use the brief's shape.
- Include only the strongest selected evidence. If none is relevant, omit proof instead of stretching a weak comparison.
- Use the voice guide only for style. Never reuse its wording or import client details, claims, deliverables, or job facts from past proposals.
- Obey the policy's commercials rule exactly. If the policy says fields_only, do not mention any price, rate, budget, timeline, deadline, number of days, or delivery window, even when the job brief or job description contains one.
- Stay inside the policy's word range. If below the minimum, add concrete verification or technical detail, not filler.
- Ask at most one question, and only if it changes the plan. A natural project or feature question is welcome when it helps.
- Use a short greeting line, 3-4 short body paragraphs, and a simple sign-off such as "Best regards, Irfan Khalid". Separate paragraphs with blank lines.
- Do not use headings, bullets, bold, emojis, or code blocks unless the policy's format is "structured".
- End naturally. No forced credentials paragraph, no "Let me know", no "I look forward", no "Let's discuss next steps".
Return only the proposal.`,
    },
    judge: {
      system:
        "You are a blind judge for freelance proposals. You do not know which candidate was generated first. Judge only against the job brief, the owner's policy, the owner's distilled voice guide, and the deterministic flags attached to each candidate. A specific, restrained, technically credible proposal beats a polished generic consultant. Return ONLY valid JSON.",
      user: `JOB BRIEF:
{{jobBriefJson}}

POLICY:
{{policyJson}}

VOICE GUIDE — a distilled style analysis, not sample text:
{{samples}}

ANTI-AI TELLS:
{{antiAiTells}}

CANDIDATES:
{{candidatesJson}}

Rank every candidate. Return JSON:
{
  "winnerIndex": 0,
  "ranking": [
    {
      "index": 0,
      "score": 0,
      "reasons": ["why this candidate wins or loses, citing its actual text"],
      "risks": ["specific risk if this candidate is sent"]
    }
  ],
  "summary": "one sentence on the deciding difference"
}

Score each candidate against this rubric:
1. Job understanding: names the real problem or outcome.
2. Specificity: makes job-specific decisions instead of repeating the brief.
3. Technical or delivery judgment: identifies an important implementation choice, risk, dependency, or verification step.
4. Evidence relevance: uses only profile evidence that genuinely supports this job.
5. Voice match: follows the owner's voice guide, not a generic consultant.
6. Coverage: addresses every material deliverable and explicit question.
7. Conciseness: every sentence contributes.
8. Naturalness: no generic opening, filler, repetition, or forced closing.
9. Policy and grounding: obeys commercial rules and avoids unsupported claims.

Rules:
- score is 0–100 for this specific job, not general writing quality.
- A candidate with a non-empty hardFailures list cannot win if any candidate has no hard failures. A candidate outside the word range cannot win over a compliant candidate.
- Penalize meta openings, self-praise, exhaustive plans, generic transitions, technology dumps, and any policy violation.
- Do not reward length, polished wording, the number of technologies, or the mere presence of a question.
- Reward a client-first opening, restraint, a useful question, and a voice match with the owner's voice guide.
- winnerIndex must refer to one of the candidates and must not be chosen by position alone.`,
    },
    reviewer: {
      system:
        "You are an independent proposal reviewer. You are not the writer. Anchor your judgment to the owner's distilled voice guide, the job brief, and the owner's policy. Do not reward generic professional writing. Do not invent problems. Return ONLY valid JSON.",
      user: `JOB BRIEF:
{{jobBriefJson}}

POLICY:
{{policyJson}}

VOICE GUIDE:
{{samples}}

SELECTED EVIDENCE:
{{evidence}}

HARD CHECKS:
{{hardChecks}}

ANTI-AI TELLS:
{{antiAiTells}}

DRAFT:
{{draft}}

Review the draft. Return JSON:
{
  "verdict": "accept|revise|reject",
  "dimensions": {
    "jobUnderstanding": 0,
    "specificity": 0,
    "technicalJudgment": 0,
    "evidence": 0,
    "voiceMatch": 0,
    "naturalness": 0,
    "conciseness": 0,
    "grounding": 0,
    "policy": 0
  },
  "issues": [
    {
      "severity": "blocker|major|minor",
      "category": "fabrication|irrelevant|generic|voice_mismatch|policy|length|structure|coverage|commercials|closing|filler|opening",
      "quote": "exact substring from the draft",
      "problem": "what is wrong and why it matters",
      "fix": "the minimum specific change to make"
    }
  ],
  "coverage": [
    {
      "deliverable": "exact item from JOB BRIEF.deliverables",
      "covered": true,
      "evidence": "short quote from the draft, or 'missing'"
    }
  ],
  "criticalDefects": ["fabricated claim, wrong job, hard policy violation, or missing blocker; empty when none"],
  "revisionInstructions": ["at most five targeted instructions"],
  "mustKeep": ["specific strengths the revision must preserve"]
}

Rules:
- dimensions are 0, 1, or 2. 2 means genuinely strong, not merely acceptable.
- quote must be an exact substring of the draft. For a missing requirement, use quote: "" and name the missing item.
- List every item in JOB BRIEF.deliverables, JOB BRIEF.applicationRequirements, and every explicit client question in coverage. Set covered=false when the draft does not address it, even if the writing is good. If any item is false, the verdict cannot be accept.
- Check that the opening answers this job rather than making a generic willingness claim. A brief greeting followed by a specific direct response is not generic. Check that technical claims are supported by the profile facts and selected evidence. Check that the proposal does not repeat the job description or pad.
- A short greeting and a simple sign-off are part of the owner's voice. Do not flag them or ask for their removal.
- Put fabricated claims, wrong-job content, and hard policy violations in criticalDefects.
- verdict=revise only when a fixable major or blocker exists. Do not request a rewrite for a stylistic preference.
- verdict=reject only for an unfixable hard-rule violation, a fabricated claim, or a draft for the wrong job.
- Prefer deletion over addition, but missing requirements must be added concisely. Do not ask for polish or padding.
- If the draft already follows the owner's voice guide and covers the brief, return accept with no issues and no criticalDefects.`,
    },
    reviser: {
      system:
        "You are the owner's editor. Apply only the listed fixes. Do not add new facts, claims, links, prices, or deadlines. Do not pad or rewrite strong sentences that are not implicated. Preserve the owner's voice, every material deliverable, and every item in mustKeep. Return ONLY the revised proposal text.",
      user: `POLICY:
{{policyJson}}

VOICE GUIDE — a distilled style analysis, not sample text:
{{samples}}

JOB BRIEF:
{{jobBriefJson}}

=== VERIFIED PROFILE FACTS ===
{{profileFacts}}

SELECTED EVIDENCE:
{{evidence}}

CURRENT DRAFT:
{{draft}}

REVIEW:
{{reviewJson}}

REVISION INSTRUCTIONS:
{{revisionInstructions}}

MUST KEEP:
{{mustKeep}}

Make the smallest edit that fixes the review findings. Preserve every deliverable and explicit question. Do not make it longer unless a finding explicitly requires it. Preserve a natural greeting and sign-off. Do not change the shape, opening, or ending when they are not part of a finding. Return only the proposal text.`,
    },
    deleter: {
      system:
        "You are a careful human editor. Remove only filler, repetition, self-praise, and over-explanation. This is optional compression, not a percentage quota. Never remove a material deliverable, explicit question, technical decision, verification step, relevant evidence, or required policy detail. Never go below the policy minimum. Do not add claims or make the draft more formal. If the draft is already tight, return it unchanged. Return ONLY the final proposal text.",
      user: `JOB BRIEF:
{{jobBriefJson}}

POLICY:
{{policyJson}}

VOICE GUIDE — a distilled style analysis, not sample text:
{{samples}}

ANTI-AI TELLS:
{{antiAiTells}}

CURRENT DRAFT:
{{draft}}

Remove filler and repetition only. Keep every deliverable, every explicit question, the strongest job-specific observation, the verification detail, and the ending. The result must stay at or above the policy minimum and must not exceed the policy maximum. If nothing can be removed safely, return the draft unchanged. Return only the final text.`,
    },
  },
  policy: {
    version: 1,
    commercials: "fields_only",
    words: { min: 35, max: 170 },
    format: "natural",
    askQuestion: "if_useful",
    maxEvidence: 2,
    includeLinks: true,
    bannedPhrases: [
      "I've read your brief",
      "I have read your brief",
      "I understand",
      "Here's the plan I'd follow",
      "I am confident",
      "perfect fit",
      "look no further",
      "Dear Hiring Manager",
    ],
  },
  checks: {
    hard: ["price", "delivery", "links", "placeholder", "competition"],
    policy: ["length", "plain"],
    advisory: ["specific", "proof", "cta", "opening", "filler", "repetition"],
    antiAiTells: ANTI_AI_TELLS,
  },
};

export interface DefaultPlaybook {
  name: string;
  jobType: string;
  matchKeywords: string[];
  strategy: string;
  openingGuidance: string;
  questionGuidance: string;
  omitGuidance: string;
  sortOrder: number;
}

export const DEFAULT_PLAYBOOKS: DefaultPlaybook[] = [
  {
    name: "Migration / hosting move",
    jobType: "migration",
    matchKeywords: [
      "migrate",
      "migration",
      "move",
      "hosting",
      "dns",
      "wordpress",
      "server",
      "transfer",
      "ssl",
    ],
    strategy:
      "Lead with the cutover risk the client is actually afraid of: downtime, DNS, email, SSL, or data loss. Recommend testing on the destination before the live switch. Show that you know the order of operations. Do not dump a generic five-step project plan.",
    openingGuidance:
      "Open with a recommendation that de-risks the switch, for example testing the full installation on the new host before changing DNS.",
    questionGuidance:
      "Ask who controls DNS or which records must be preserved. Avoid generic questions about plugins or theme tweaks when the client already described a simple site.",
    omitGuidance:
      "Omit price and delivery unless policy says otherwise. Omit a full step-by-step plan. Omit a portfolio link unless it directly proves a migration.",
    sortOrder: 10,
  },
  {
    name: "Rescue / audit / production readiness",
    jobType: "rescue",
    matchKeywords: [
      "rescue",
      "audit",
      "existing",
      "production",
      "launch",
      "stabilize",
      "review current",
      "technical issues",
      "root cause",
      "pre-launch",
    ],
    strategy:
      "Lead with diagnosis, not a rewrite. Ask the two questions that reveal the biggest launch blockers. Then state a compact credibility pattern and a triage approach: reproduce, isolate, root cause, fix, regression test. Promise a clear issue report and launch-blocking priorities.",
    openingGuidance:
      "Open with one or two sharp diagnostic questions about blockers, reproducible cases, logs, staging access, or the failing workflow.",
    questionGuidance:
      "Ask which issues are actually blocking launch, or whether logs and staging access are available. Do not ask a generic 'tell me more' question.",
    omitGuidance:
      "Omit exhaustive technology lists, a promise to fix everything before seeing the code, and a long credentials section.",
    sortOrder: 20,
  },
  {
    name: "Bug fix / debugging",
    jobType: "bug_fix",
    matchKeywords: [
      "bug",
      "fix",
      "error",
      "broken",
      "issue",
      "debug",
      "not working",
      "crash",
      "regression",
    ],
    strategy:
      "Lead with reproduction and isolation. Explain that you will reproduce the issue, find the root cause, make the smallest safe fix, and add a regression check. Ask for the failing workflow, logs, or environment details that would change the diagnosis.",
    openingGuidance:
      "Open with a specific diagnostic question or a short statement of how you will reproduce the failure.",
    questionGuidance:
      "Ask for the exact failing workflow, a recent error, or access to logs. Avoid asking what the project is about.",
    omitGuidance:
      "Omit broad architecture reviews and a full rewrite plan. Omit claims that you already know the cause.",
    sortOrder: 30,
  },
  {
    name: "API / AI integration",
    jobType: "integration",
    matchKeywords: [
      "api",
      "integration",
      "webhook",
      "openai",
      "llm",
      "third-party",
      "authentication",
      "rate limit",
      "token",
      "external service",
    ],
    strategy:
      "Lead with the reliability risk: auth, retries, rate limits, validation, idempotency, error handling, and observability. Explain one concrete integration pattern you would use. Ask which failure mode matters most or what the current integration already does.",
    openingGuidance:
      "Open with the failure mode that usually breaks this kind of integration, or a question about the current implementation.",
    questionGuidance:
      "Ask which failure mode is unacceptable, or what the current integration already handles. Avoid listing every API you know.",
    omitGuidance:
      "Omit a full stack list. Omit a generic architecture diagram in prose. Omit promises about uptime you cannot verify.",
    sortOrder: 40,
  },
  {
    name: "E-commerce platform and store build",
    jobType: "ecommerce",
    matchKeywords: [
      "ecommerce",
      "e-commerce",
      "online store",
      "shopify",
      "woocommerce",
      "stripe",
      "payment gateway",
      "product catalogue",
      "product catalog",
      "shopping cart",
      "checkout",
      "physical products",
      "classic",
      "timeless",
    ],
    strategy:
      "Treat this as a store build with a platform decision, not a generic MVP. Lead with the design and buying-flow outcome. Say you will start with initial design concepts and refine them with the client before development. If the client has hosting already and wants low maintenance, recommend Shopify first and explain that Shopify includes hosting, so the existing hosting may become unnecessary. If keeping the current hosting matters, offer WooCommerce on WordPress as the alternative. Name the licensing implication. Then group the remaining requirements into one or two short paragraphs: responsive front end, product management, search and filtering, payments, SEO and page speed, and handoff. Do not turn it into a milestone plan or a raw feature checklist.",
    openingGuidance:
      "Open with the design principle and the shopping flow, then state the platform recommendation and the one hosting or licensing trade-off the client should know.",
    questionGuidance:
      "Ask whether they have a preferred platform or would be open to Shopify if it fits their requirements. Do not ask what must be in the first release when the client already listed the requirements.",
    omitGuidance:
      "Omit a first-milestone or prototype plan, a raw stack dump, price, delivery, and links unless the client asked or the policy allows them. Do not recommend a custom Next.js build unless the client rejects the hosted platform or needs custom functionality. Do not repeat the full requirements list.",
    sortOrder: 5,
  },
  {
    name: "Website maintenance and ongoing support",
    jobType: "maintenance",
    matchKeywords: [
      "maintenance",
      "ongoing",
      "support",
      "updates",
      "monthly",
      "small fixes",
      "content updates",
      "keep the site",
      "retainer",
      "plugin updates",
    ],
    strategy:
      "Lead with reliability and a clear way to request work. Say how you would handle updates, backups, security checks, and small fixes without breaking the live site. Offer a simple monthly arrangement only if the client asked for ongoing help. Do not turn it into a large project plan.",
    openingGuidance:
      "Open with the one thing that keeps a maintained site healthy, such as staged updates and a tested backup before any change.",
    questionGuidance:
      "Ask what they need most: routine updates, security and backups, or a queue of small fixes. Avoid asking for a full feature list when they only want ongoing help.",
    omitGuidance:
      "Omit a full rebuild, a technology list, and a fixed monthly price unless policy allows it. Omit claims about response times you cannot commit to.",
    sortOrder: 35,
  },
  {
    name: "Data scraping and automation",
    jobType: "automation",
    matchKeywords: [
      "scrape",
      "scraping",
      "crawler",
      "automation",
      "data extraction",
      "spreadsheet",
      "csv",
      "excel",
      "report",
      "scheduled",
      "sync data",
      "api data",
    ],
    strategy:
      "Lead with the shape and reliability of the output: what the data looks like, where it goes, and what happens when the source changes or a run fails. Explain deduplication, retries, and a clear failure report. Ask about the target format and how often the data must refresh.",
    openingGuidance:
      "Open with the output the client will actually use, such as a clean spreadsheet or a scheduled sync, and the failure handling that keeps it trustworthy.",
    questionGuidance:
      "Ask where the data must end up and how often it must refresh. Avoid asking which library to use.",
    omitGuidance:
      "Omit a stack list and a long architecture description. Omit promises about bypassing access controls or scraping data the client does not have rights to use.",
    sortOrder: 45,
  },
  {
    name: "Greenfield build",
    jobType: "greenfield",
    matchKeywords: [
      "build",
      "develop",
      "new",
      "from scratch",
      "website",
      "app",
      "platform",
      "mvp",
      "implement",
    ],
    strategy:
      "Lead with the first useful deliverable and the smallest path to it. Clarify scope, the first milestone, and what the client will see first. Ask one question that changes scope or sequencing.",
    openingGuidance:
      "Open with the first milestone or the smallest useful version, not a long list of features.",
    questionGuidance:
      "Ask what the first release must prove only when scope is genuinely unclear. If the client already listed concrete deliverables, ask which one matters most or what constraint decides the approach.",
    omitGuidance:
      "Omit every technology in your stack. Omit a full project plan. Omit claims about timelines before scope is clear.",
    sortOrder: 50,
  },
];

/** Ids of shipped starter voice examples start with this prefix. */
export const DEFAULT_SAMPLE_ID_PREFIX = "sample-default-";

export interface DefaultSample {
  /** Stable slug used to build a per-user id. */
  slug: string;
  title: string;
  jobType: string;
  content: string;
  tags: string[];
  outcome: "won" | "lost" | "unknown";
  rating: number;
  preferred: boolean;
  notes: string;
}

/**
 * Starter voice examples. They are shown in the voice-example list, can be
 * edited or deleted, and can be replaced by real proposals the owner wrote.
 * Their content is deliberately generic so no client or project is implied.
 */
export const DEFAULT_SAMPLES: DefaultSample[] = [
  {
    slug: "migration",
    title: "Starter example: hosting move",
    jobType: "migration",
    content: `Hi there,

The part that usually breaks a move like this is the order of operations, so I would install the full site on the new host first and test it there, including the database, SSL, and any contact forms. Once that copy is confirmed, I would switch DNS and keep the old host live for a few days in case a record needs to be corrected.

I have handled moves where email records had to stay untouched and where the site could not go offline during the switch.

Quick question: who controls the DNS account, and are there email records that must not change?

Best regards,`,
    tags: ["migration", "hosting", "dns", "ssl", "wordpress"],
    outcome: "unknown",
    rating: 4,
    preferred: false,
    notes: "Starter example. Replace it with a proposal you actually wrote.",
  },
  {
    slug: "integration",
    title: "Starter example: API integration",
    jobType: "integration",
    content: `Hi there,

The failure mode I would design around first is a partial write: the external API succeeds, your app times out, and the two systems disagree about what happened. I would use idempotency keys, validate the response before storing it, and add retries with backoff only for errors that are safe to retry.

I have built integrations where rate limits and webhook retries were the main source of support tickets, so I would log each request with enough detail to replay a failed one without guessing.

Which failure matters most here: duplicate records, missed events, or silent data loss?

Best regards,`,
    tags: ["api", "integration", "webhook", "rate limit", "error handling"],
    outcome: "unknown",
    rating: 4,
    preferred: false,
    notes: "Starter example. Replace it with a proposal you actually wrote.",
  },
  {
    slug: "rescue",
    title: "Starter example: launch rescue",
    jobType: "rescue",
    content: `Hi there,

Before changing anything, I would reproduce the failing flow on a copy of the site and check the logs around the failure. That usually separates a configuration problem from a code problem quickly, and it means the first fix is aimed at the actual cause instead of the loudest symptom.

From there I would fix the smallest reliable change, add a regression check for the flow, and give you a short list of anything still risky before launch.

Which issue is blocking the launch right now, and do you have staging access plus recent error logs?

Best regards,`,
    tags: ["rescue", "audit", "launch", "debug", "bug"],
    outcome: "unknown",
    rating: 4,
    preferred: false,
    notes: "Starter example. Replace it with a proposal you actually wrote.",
  },
];
