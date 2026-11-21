import { createHash } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../../db/index.js";
import {
  profileAuditSettings,
  profileAudits,
  proposalEngineSettings,
  proposalPlaybooks,
  proposalSamples,
  userBids,
} from "../../db/schema.js";
import { AppError, notFound } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import {
  DEFAULT_PLAYBOOKS,
  DEFAULT_PROPOSAL_ENGINE,
  DEFAULT_SAMPLE_ID_PREFIX,
  DEFAULT_SAMPLES,
  flowFileSchema,
  flowStepSchema,
  promptTemplateSchema,
  proposalContractsSchema,
  proposalEngineConfigSchema,
  type CandidateLane,
  type ProposalEngineConfig,
} from "../../lib/proposal-defaults.js";
import {
  DEFAULT_PROFILE_AUDIT_SETTINGS,
  profileAuditSettingsSchema,
  type ProfileAuditSettings,
} from "../../lib/profile-audit-defaults.js";

const log = createLogger("proposal");

/**
 * Fingerprints of the shipped v1 defaults. The upgrade path replaces only
 * values that still match these fingerprints, so user edits are preserved.
 */
const LEGACY_DEFAULT_HASHES = {
  engine: "ed028747ea4d86437f91677019db2059b015ea2ae4e4d883adda88d2d7bb0657",
  /** v5 shipped engine block, before the default pipeline was simplified. */
  engineV5: "7a6158613edfcd41af1904fa4e667d0fc2b9245a16da0de2b7b1fd057e028afc",
  policy: "363077e76ab441ab09d68cbc96a4a25fc0f468ddb46a52fa755c8e3edc37fad1",
  checks: "760ea57e58f65da4f266d970fd189183c6b15011c99afc4951ab3169046d6c50",
  prompts: {
    brief: {
      system: "b613fea015e2e0f3dcb58732a6c046d9e2e1580657835ee7fa4884715f93ce5c",
      user: "3b5dea7aaf5dc41b0b4481d66290a1eaeb543bf8f54fa107df3c0821c52d752b",
    },
    writer: {
      system: "a9ee61beb085464cb520d1f038ac6d4f8ed33456c134d4c0e30524086b65ea3c",
      user: "5c9a8c03816eeefe61c490b5e8e4a1d696431a69fc1a79df4647048c3f4a340a",
    },
    judge: {
      system: "cbac45d4f60fa1ec84a333df9456152c01411336bd2147302477593ad32124cb",
      user: "b21a489e0d633e8e7ef7a34ee92c1fbe9a2647cbf2c443cedbfed785d1ef92e1",
    },
    reviewer: {
      system: "726dcbd5330ca69a99730694428db1ea2075eafcaaf453953b96874e3826a279",
      user: "d3577e01e1d94fd61fb0d1c30f8348a814cdb0360ac936f70e3a2455f98945a1",
    },
    reviser: {
      system: "b4e41c53ff7c76e6fcb5dd22cddb77ac47546f66d7417207850783e0450b2db9",
      user: "438f877595590a9b4880451898a00f7df675640df9ee1c9b5d21ad3b32e048ab",
    },
    deleter: {
      system: "7d9029d2fa90f00b9c0b34e6d81326b9619094eddb6a6a414857b7d3924ffedf",
      user: "4b7a63dded949e772f9fc524f7f20f021219f12abac98757b6c55fdece255dca",
    },
  },
} as const;

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function labelForLane(id: string): string {
  return (
    id
      .split(/[_-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ") || "Candidate"
  );
}

/**
 * Older saved configs only have shapes + candidateCount. Turn those into
 * first-class lanes once, in memory, so the pipeline and UI share one model.
 */
export function normalizeCandidateLanes(
  engine: ProposalEngineConfig["engine"]
): ProposalEngineConfig["engine"] {
  if (engine.candidateLanes !== undefined && engine.candidateLanes.length > 0) {
    return engine;
  }

  const shapes = engine.shapes.length > 0 ? engine.shapes : ["short_note"];
  const count = Math.max(1, Math.min(engine.candidateCount, 8));
  const lanes: CandidateLane[] = Array.from({ length: count }, (_value, index) => {
    const shape = shapes[index % shapes.length] ?? "short_note";
    const repeat = Math.floor(index / shapes.length);
    const id = repeat === 0 ? shape : `${shape}-${repeat + 1}`;
    return {
      id,
      label: labelForLane(shape),
      guidance: engine.shapeGuidance[shape] ?? "",
      model: null,
      temperature: null,
      timeoutSeconds: null,
      enabled: true,
    };
  });

  return { ...engine, candidateLanes: lanes };
}

function normalizeFlow(
  engine: ProposalEngineConfig["engine"]
): ProposalEngineConfig["engine"] {
  return {
    ...engine,
    flow: {
      ...engine.flow,
      steps: engine.flow.steps.map((step) => ({
        ...step,
        id: step.id.trim(),
        fileIds: step.fileIds.map((id) => id.trim()),
      })),
      files: engine.flow.files.map((file) => ({ ...file, id: file.id.trim() })),
    },
  };
}

/** Replace {{name}} placeholders. Unknown placeholders become an empty string. */
export function renderTemplate(
  template: string,
  values: Record<string, string | number | null | undefined>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

function parseJson<T>(raw: string, schema: z.ZodType<T>, fallback: T, label: string): T {
  try {
    const parsed = schema.safeParse(JSON.parse(raw) as unknown);
    if (parsed.success) return parsed.data;
    log.warn(`Invalid ${label} config; using defaults`, { issues: parsed.error.issues });
  } catch {
    log.warn(`Unreadable ${label} config; using defaults`);
  }
  return fallback;
}

function seedEngine(userId: string): ProposalEngineConfig {
  const now = new Date().toISOString();
  getDb()
    .insert(proposalEngineSettings)
    .values({
      userId,
      engineJson: JSON.stringify(DEFAULT_PROPOSAL_ENGINE.engine),
      promptsJson: JSON.stringify(DEFAULT_PROPOSAL_ENGINE.prompts),
      policyJson: JSON.stringify(DEFAULT_PROPOSAL_ENGINE.policy),
      checksJson: JSON.stringify(DEFAULT_PROPOSAL_ENGINE.checks),
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
  seedDefaultSamples(userId);
  return DEFAULT_PROPOSAL_ENGINE;
}

export function getProposalEngineConfig(userId: string): ProposalEngineConfig {
  const row = getDb()
    .select()
    .from(proposalEngineSettings)
    .where(eq(proposalEngineSettings.userId, userId))
    .get();
  if (row === undefined) return seedEngine(userId);

  const fallback = DEFAULT_PROPOSAL_ENGINE;
  const engine = parseJson(
    row.engineJson,
    proposalEngineConfigSchema.shape.engine,
    fallback.engine,
    "engine"
  );
  return {
    engine: normalizeFlow(normalizeCandidateLanes(engine)),
    prompts: parseJson(
      row.promptsJson,
      proposalEngineConfigSchema.shape.prompts,
      fallback.prompts,
      "prompts"
    ),
    policy: parseJson(row.policyJson, proposalEngineConfigSchema.shape.policy, fallback.policy, "policy"),
    checks: parseJson(row.checksJson, proposalEngineConfigSchema.shape.checks, fallback.checks, "checks"),
  };
}

const flowPatchSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe(
        "Enable the custom pipeline. When true, flow steps replace the built-in brief/write/judge/review/revise stages and their prompts."
      ),
    steps: z
      .array(flowStepSchema)
      .max(24)
      .optional()
      .describe(
        "Ordered custom steps. They run in array order; reference earlier output as {{step_<id>}}. Send the full steps array when adding, removing, or reordering steps."
      ),
    files: z
      .array(flowFileSchema)
      .max(25)
      .optional()
      .describe(
        "Context files available to steps as {{file_<id>}}. Send the full files array when adding, removing, or editing files."
      ),
  })
  .strict()
  .describe(
    "Optional custom pipeline. Keep disabled unless the user explicitly wants to replace the built-in proposal pipeline."
  );

const engineNestedPatch = {
  models: proposalEngineConfigSchema.shape.engine.shape.models.partial().optional(),
  temperatures: proposalEngineConfigSchema.shape.engine.shape.temperatures.partial().optional(),
  timeoutsSeconds: proposalEngineConfigSchema.shape.engine.shape.timeoutsSeconds.partial().optional(),
  stages: proposalEngineConfigSchema.shape.engine.shape.stages.partial().optional(),
  contracts: proposalContractsSchema.partial().optional(),
  flow: flowPatchSchema.optional(),
};

const enginePatchSchema = proposalEngineConfigSchema.shape.engine
  .partial()
  .extend(engineNestedPatch);

const editableEnginePatchSchema = proposalEngineConfigSchema.shape.engine
  .omit({ version: true, defaultsVersion: true })
  .partial()
  .extend(engineNestedPatch);

const promptsPatchSchema = z
  .object({
    brief: promptTemplateSchema.partial().optional(),
    writer: promptTemplateSchema.partial().optional(),
    judge: promptTemplateSchema.partial().optional(),
    reviewer: promptTemplateSchema.partial().optional(),
    reviser: promptTemplateSchema.partial().optional(),
    deleter: promptTemplateSchema.partial().optional(),
  })
  .partial();

const policyPatchSchema = proposalEngineConfigSchema.shape.policy
  .omit({ version: true })
  .partial();
const checksPatchSchema = proposalEngineConfigSchema.shape.checks.partial();

const hasKeys = (value: object) => Object.keys(value).length > 0;

export const proposalEngineSettingsPatchSchema = editableEnginePatchSchema.refine(hasKeys, {
  message: "Provide at least one engine setting",
});

export const proposalPromptsPatchSchema = promptsPatchSchema.refine(hasKeys, {
  message: "Provide at least one prompt",
});

export const proposalPolicyPatchSchema = policyPatchSchema.refine(hasKeys, {
  message: "Provide at least one policy setting",
});

export const proposalChecksPatchSchema = checksPatchSchema.refine(hasKeys, {
  message: "Provide at least one check",
});

export const proposalEnginePatchSchema = z
  .object({
    engine: enginePatchSchema.optional(),
    prompts: promptsPatchSchema.optional(),
    policy: policyPatchSchema.optional(),
    checks: checksPatchSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one proposal setting",
  });

export type ProposalEnginePatch = z.infer<typeof proposalEnginePatchSchema>;

function mergePrompts(
  current: ProposalEngineConfig["prompts"],
  patch: ProposalEnginePatch["prompts"]
): ProposalEngineConfig["prompts"] {
  if (patch === undefined) return current;
  return {
    brief: { ...current.brief, ...patch.brief },
    writer: { ...current.writer, ...patch.writer },
    judge: { ...current.judge, ...patch.judge },
    reviewer: { ...current.reviewer, ...patch.reviewer },
    reviser: { ...current.reviser, ...patch.reviser },
    deleter: { ...current.deleter, ...patch.deleter },
  };
}

function writeProposalEngineConfig(
  userId: string,
  config: ProposalEngineConfig
): void {
  const now = new Date().toISOString();
  getDb()
    .insert(proposalEngineSettings)
    .values({
      userId,
      engineJson: JSON.stringify(config.engine),
      promptsJson: JSON.stringify(config.prompts),
      policyJson: JSON.stringify(config.policy),
      checksJson: JSON.stringify(config.checks),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: proposalEngineSettings.userId,
      set: {
        engineJson: JSON.stringify(config.engine),
        promptsJson: JSON.stringify(config.prompts),
        policyJson: JSON.stringify(config.policy),
        checksJson: JSON.stringify(config.checks),
        updatedAt: now,
      },
    })
    .run();
}

export function saveProposalEngineConfig(
  userId: string,
  patch: ProposalEnginePatch
): ProposalEngineConfig {
  const current = getProposalEngineConfig(userId);
  const merged: ProposalEngineConfig = {
    engine: {
      ...current.engine,
      ...patch.engine,
      models: { ...current.engine.models, ...patch.engine?.models },
      temperatures: { ...current.engine.temperatures, ...patch.engine?.temperatures },
      timeoutsSeconds: {
        ...current.engine.timeoutsSeconds,
        ...patch.engine?.timeoutsSeconds,
      },
      stages: { ...current.engine.stages, ...patch.engine?.stages },
      contracts: { ...current.engine.contracts, ...patch.engine?.contracts },
      flow: {
        ...current.engine.flow,
        ...patch.engine?.flow,
        steps: patch.engine?.flow?.steps ?? current.engine.flow.steps,
        files: patch.engine?.flow?.files ?? current.engine.flow.files,
      },
    },
    prompts: mergePrompts(current.prompts, patch.prompts),
    policy: { ...current.policy, ...patch.policy },
    checks: { ...current.checks, ...patch.checks },
  };

  const lanes = merged.engine.candidateLanes;
  if (lanes !== undefined && lanes.length > 0) {
    for (const lane of lanes) lane.id = lane.id.trim();
    if (new Set(lanes.map((lane) => lane.id)).size !== lanes.length) {
      throw new AppError(400, "VALIDATION_ERROR", "Candidate lane IDs must be unique");
    }
    merged.engine.candidateCount = Math.min(lanes.length, 8);
    merged.engine.shapes = lanes.map((lane) => lane.id);
    merged.engine.shapeGuidance = Object.fromEntries(
      lanes.map((lane) => [lane.id, lane.guidance])
    );
  }

  merged.engine = normalizeFlow(merged.engine);
  merged.engine.flow.steps = merged.engine.flow.steps.map((step) => ({
    ...step,
    fileIds: [...new Set(step.fileIds)],
  }));

  const parsed = proposalEngineConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Proposal settings failed validation", parsed.error.flatten());
  }
  if (parsed.data.policy.words.min >= parsed.data.policy.words.max) {
    throw new AppError(400, "VALIDATION_ERROR", "The minimum word count must be below the maximum");
  }

  writeProposalEngineConfig(userId, parsed.data);
  return parsed.data;
}

export function resetProposalEngineConfig(userId: string): ProposalEngineConfig {
  getDb().delete(proposalEngineSettings).where(eq(proposalEngineSettings.userId, userId)).run();
  return getProposalEngineConfig(userId);
}

export interface ProposalUpgradeResult {
  config: ProposalEngineConfig;
  upgraded: string[];
  preserved: string[];
  fromVersion: number;
  toVersion: number;
}

/**
 * Upgrade saved defaults without overwriting customization. Each prompt,
 * policy, check list, and engine block is replaced only when it still matches
 * the exact v1 shipped value; otherwise it is kept and reported as preserved.
 */
export function upgradeProposalEngineConfig(userId: string): ProposalUpgradeResult {
  const current = getProposalEngineConfig(userId);
  const fromVersion = current.engine.defaultsVersion;
  const toVersion = DEFAULT_PROPOSAL_ENGINE.engine.defaultsVersion;
  if (fromVersion >= toVersion) {
    return { config: current, upgraded: [], preserved: [], fromVersion, toVersion };
  }

  const upgraded: string[] = [];
  const preserved: string[] = [];
  const next: ProposalEngineConfig = {
    engine: { ...current.engine, defaultsVersion: toVersion },
    prompts: { ...current.prompts },
    policy: { ...current.policy },
    checks: { ...current.checks },
  };

  const currentEngineCore: Record<string, unknown> = { ...current.engine };
  delete currentEngineCore.defaultsVersion;
  // Contracts and candidate lanes are newer than the v1 fingerprint. Ignore
  // them for the legacy comparison, but never overwrite customized blocks.
  delete currentEngineCore.contracts;
  delete currentEngineCore.candidateLanes;
  delete currentEngineCore.flow;
  const contractsAreDefault =
    hashJson(current.engine.contracts) === hashJson(DEFAULT_PROPOSAL_ENGINE.engine.contracts);
  const lanesAreDefault =
    hashJson(current.engine.candidateLanes) ===
    hashJson(DEFAULT_PROPOSAL_ENGINE.engine.candidateLanes);
  const flowIsDefault =
    hashJson(current.engine.flow) === hashJson(DEFAULT_PROPOSAL_ENGINE.engine.flow);
  const engineCoreHash = hashJson(currentEngineCore);
  if (
    contractsAreDefault &&
    lanesAreDefault &&
    flowIsDefault &&
    (engineCoreHash === LEGACY_DEFAULT_HASHES.engine ||
      engineCoreHash === LEGACY_DEFAULT_HASHES.engineV5)
  ) {
    next.engine = { ...DEFAULT_PROPOSAL_ENGINE.engine };
    upgraded.push("engine");
  } else {
    preserved.push("engine");
  }

  const stages = Object.keys(current.prompts) as Array<keyof ProposalEngineConfig["prompts"]>;
  for (const stage of stages) {
    for (const field of ["system", "user"] as const) {
      if (hashText(current.prompts[stage][field]) === LEGACY_DEFAULT_HASHES.prompts[stage][field]) {
        next.prompts[stage] = {
          ...next.prompts[stage],
          [field]: DEFAULT_PROPOSAL_ENGINE.prompts[stage][field],
        };
        upgraded.push(`prompts.${stage}.${field}`);
      } else {
        preserved.push(`prompts.${stage}.${field}`);
      }
    }
  }

  if (hashJson(current.policy) === LEGACY_DEFAULT_HASHES.policy) {
    next.policy = { ...DEFAULT_PROPOSAL_ENGINE.policy };
    upgraded.push("policy");
  } else {
    preserved.push("policy");
  }

  if (hashJson(current.checks) === LEGACY_DEFAULT_HASHES.checks) {
    next.checks = { ...DEFAULT_PROPOSAL_ENGINE.checks };
    upgraded.push("checks");
  } else {
    next.checks = {
      ...current.checks,
      advisory: [
        ...current.checks.advisory,
        ...DEFAULT_PROPOSAL_ENGINE.checks.advisory.filter(
          (check) => !current.checks.advisory.includes(check)
        ),
      ],
    };
    preserved.push("checks");
  }

  const parsed = proposalEngineConfigSchema.parse(next);
  writeProposalEngineConfig(userId, parsed);
  seedDefaultSamples(userId);
  log.info("Proposal defaults upgraded", { userId, upgraded, preserved });
  return { config: parsed, upgraded, preserved, fromVersion, toVersion };
}

/* ------------------------------- Playbooks ------------------------------- */

export const playbookInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("Human-readable playbook name."),
  jobType: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("Job category this playbook covers, such as web, api, or migration."),
  matchKeywords: z
    .array(z.string().trim().min(1).max(100))
    .max(50)
    .describe("Keywords that make this playbook match a job. Matching is case-insensitive."),
  strategy: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe(
      "Core strategy for this job type: the angle, proof, and plan the writer should favor. This is strategy, not a voice sample."
    ),
  openingGuidance: z
    .string()
    .max(10_000)
    .default("")
    .describe("Optional guidance for the opening line or first paragraph."),
  questionGuidance: z
    .string()
    .max(10_000)
    .default("")
    .describe("Optional guidance for the closing question, if policy allows one."),
  omitGuidance: z
    .string()
    .max(10_000)
    .default("")
    .describe("Optional things this job type should avoid or not emphasize."),
  active: z
    .boolean()
    .default(true)
    .describe("Set false to keep the playbook but stop it from matching jobs."),
  sortOrder: z
    .number()
    .int()
    .min(0)
    .max(10_000)
    .default(0)
    .describe("Ordering hint when multiple playbooks match; lower numbers come first."),
});

export type PlaybookInput = z.infer<typeof playbookInputSchema>;

export interface PlaybookView extends PlaybookInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

function parseStringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Starter voice examples ship with a fresh install. They are ordinary samples:
 * editable, deactivatable, and deletable. Seeding is skipped as soon as the
 * owner has any sample, so deleting them never brings them back.
 */
export function seedDefaultSamples(userId: string): void {
  const existing = getDb()
    .select({ id: proposalSamples.id })
    .from(proposalSamples)
    .where(eq(proposalSamples.userId, userId))
    .limit(1)
    .get();
  if (existing !== undefined) return;

  const now = new Date().toISOString();
  for (const sample of DEFAULT_SAMPLES) {
    getDb()
      .insert(proposalSamples)
      .values({
        id: `${DEFAULT_SAMPLE_ID_PREFIX}${userId}-${sample.slug}`,
        userId,
        title: sample.title,
        jobType: sample.jobType,
        content: sample.content,
        tags: JSON.stringify(sample.tags),
        outcome: sample.outcome,
        rating: sample.rating,
        preferred: sample.preferred ? 1 : 0,
        notes: sample.notes,
        active: 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }
}

function seedPlaybooks(userId: string): void {
  const existing = getDb()
    .select({ id: proposalPlaybooks.id })
    .from(proposalPlaybooks)
    .where(eq(proposalPlaybooks.userId, userId))
    .limit(1)
    .get();
  if (existing !== undefined) return;

  const now = new Date().toISOString();
  for (const playbook of DEFAULT_PLAYBOOKS) {
    getDb()
      .insert(proposalPlaybooks)
      .values({
        id: `pb-${crypto.randomUUID()}`,
        userId,
        name: playbook.name,
        jobType: playbook.jobType,
        matchKeywords: JSON.stringify(playbook.matchKeywords),
        strategy: playbook.strategy,
        openingGuidance: playbook.openingGuidance,
        questionGuidance: playbook.questionGuidance,
        omitGuidance: playbook.omitGuidance,
        active: 1,
        sortOrder: playbook.sortOrder,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export function listPlaybooks(userId: string): PlaybookView[] {
  seedPlaybooks(userId);
  return getDb()
    .select()
    .from(proposalPlaybooks)
    .where(eq(proposalPlaybooks.userId, userId))
    .orderBy(proposalPlaybooks.sortOrder, proposalPlaybooks.name)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      jobType: row.jobType,
      matchKeywords: parseStringArray(row.matchKeywords),
      strategy: row.strategy,
      openingGuidance: row.openingGuidance,
      questionGuidance: row.questionGuidance,
      omitGuidance: row.omitGuidance,
      active: row.active === 1,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
}

export function upsertPlaybook(
  userId: string,
  input: PlaybookInput,
  id?: string
): PlaybookView {
  const data = playbookInputSchema.parse(input);
  const now = new Date().toISOString();
  const playbookId = id ?? `pb-${crypto.randomUUID()}`;

  if (id !== undefined) {
    const existing = getDb()
      .select({ id: proposalPlaybooks.id })
      .from(proposalPlaybooks)
      .where(and(eq(proposalPlaybooks.id, id), eq(proposalPlaybooks.userId, userId)))
      .get();
    if (existing === undefined) throw notFound(`Playbook ${id} not found`);
  }

  getDb()
    .insert(proposalPlaybooks)
    .values({
      id: playbookId,
      userId,
      name: data.name,
      jobType: data.jobType,
      matchKeywords: JSON.stringify(data.matchKeywords),
      strategy: data.strategy,
      openingGuidance: data.openingGuidance,
      questionGuidance: data.questionGuidance,
      omitGuidance: data.omitGuidance,
      active: data.active ? 1 : 0,
      sortOrder: data.sortOrder,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: proposalPlaybooks.id,
      set: {
        name: data.name,
        jobType: data.jobType,
        matchKeywords: JSON.stringify(data.matchKeywords),
        strategy: data.strategy,
        openingGuidance: data.openingGuidance,
        questionGuidance: data.questionGuidance,
        omitGuidance: data.omitGuidance,
        active: data.active ? 1 : 0,
        sortOrder: data.sortOrder,
        updatedAt: now,
      },
    })
    .run();

  return listPlaybooks(userId).find((item) => item.id === playbookId) as PlaybookView;
}

export function deletePlaybook(userId: string, id: string): void {
  const result = getDb()
    .delete(proposalPlaybooks)
    .where(and(eq(proposalPlaybooks.id, id), eq(proposalPlaybooks.userId, userId)))
    .run();
  if (result.changes === 0) throw notFound(`Playbook ${id} not found`);
}

export function selectPlaybook(userId: string, jobText: string): PlaybookView | null {
  const text = jobText.toLowerCase();
  const scored = listPlaybooks(userId)
    .filter((playbook) => playbook.active)
    .map((playbook) => {
      const hits = playbook.matchKeywords.filter((keyword) =>
        text.includes(keyword.toLowerCase())
      ).length;
      return { playbook, hits };
    })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.playbook.sortOrder - b.playbook.sortOrder);
  return scored[0]?.playbook ?? null;
}

export function playbookText(playbook: PlaybookView | null): string {
  if (playbook === null) {
    return "No specific playbook matched. Use the job brief and the owner's voice guide; do not force a generic plan.";
  }
  return [
    `Name: ${playbook.name}`,
    `Job type: ${playbook.jobType}`,
    `Strategy: ${playbook.strategy}`,
    playbook.openingGuidance ? `Opening: ${playbook.openingGuidance}` : null,
    playbook.questionGuidance ? `Question: ${playbook.questionGuidance}` : null,
    playbook.omitGuidance ? `Omit: ${playbook.omitGuidance}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/* -------------------------------- Samples -------------------------------- */

export const sampleInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe("Short label for the sample, for example 'React dashboard proposal'."),
  jobType: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .default("general")
    .describe("Job category such as web, mobile, api, or general."),
  content: z
    .string()
    .trim()
    .min(20)
    .max(40_000)
    .describe("The full proposal text, written by the owner. Minimum 20 characters."),
  tags: z
    .array(z.string().trim().min(1).max(100))
    .max(40)
    .default([])
    .describe("Optional search tags."),
  outcome: z
    .enum(["won", "lost", "unknown"])
    .default("unknown")
    .describe("Result of the proposal. Use unknown when it is not recorded."),
  rating: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3)
    .describe("Owner rating from 1 (weak) to 5 (best voice example)."),
  /** The owner explicitly wants this sample used as a voice reference. */
  preferred: z
    .boolean()
    .default(false)
    .describe("True when the owner wants this sample prioritized as a voice reference."),
  notes: z
    .string()
    .max(10_000)
    .default("")
    .describe("Optional notes about why this sample is useful."),
  active: z
    .boolean()
    .default(true)
    .describe("False keeps the sample saved but excludes it from voice analysis."),
});

export type SampleInput = z.infer<typeof sampleInputSchema>;

export interface SampleView extends SampleInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export function listSamples(userId: string): SampleView[] {
  return getDb()
    .select()
    .from(proposalSamples)
    .where(eq(proposalSamples.userId, userId))
    .orderBy(
      desc(proposalSamples.preferred),
      desc(proposalSamples.rating),
      desc(proposalSamples.updatedAt)
    )
    .all()
    .map((row) => ({
      id: row.id,
      title: row.title,
      jobType: row.jobType,
      content: row.content,
      tags: parseStringArray(row.tags),
      outcome: row.outcome as SampleInput["outcome"],
      rating: row.rating,
      preferred: row.preferred === 1,
      notes: row.notes,
      active: row.active === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
}

export function upsertSample(
  userId: string,
  input: z.input<typeof sampleInputSchema>,
  id?: string
): SampleView {
  const data = sampleInputSchema.parse(input);
  const now = new Date().toISOString();
  const sampleId = id ?? `sample-${crypto.randomUUID()}`;

  if (id !== undefined) {
    const existing = getDb()
      .select({ id: proposalSamples.id })
      .from(proposalSamples)
      .where(and(eq(proposalSamples.id, id), eq(proposalSamples.userId, userId)))
      .get();
    if (existing === undefined) throw notFound(`Sample ${id} not found`);
  }

  getDb()
    .insert(proposalSamples)
    .values({
      id: sampleId,
      userId,
      title: data.title,
      jobType: data.jobType,
      content: data.content,
      tags: JSON.stringify(data.tags),
      outcome: data.outcome,
      rating: data.rating,
      preferred: data.preferred ? 1 : 0,
      notes: data.notes,
      active: data.active ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: proposalSamples.id,
      set: {
        title: data.title,
        jobType: data.jobType,
        content: data.content,
        tags: JSON.stringify(data.tags),
        outcome: data.outcome,
        rating: data.rating,
        preferred: data.preferred ? 1 : 0,
        notes: data.notes,
        active: data.active ? 1 : 0,
        updatedAt: now,
      },
    })
    .run();

  return listSamples(userId).find((item) => item.id === sampleId) as SampleView;
}

export function deleteSample(userId: string, id: string): void {
  const result = getDb()
    .delete(proposalSamples)
    .where(and(eq(proposalSamples.id, id), eq(proposalSamples.userId, userId)))
    .run();
  if (result.changes === 0) throw notFound(`Sample ${id} not found`);
}

export function deleteAllSamples(userId: string): number {
  const result = getDb()
    .delete(proposalSamples)
    .where(eq(proposalSamples.userId, userId))
    .run();
  return result.changes;
}

function containsTerm(text: string, term: string): boolean {
  const needle = term.trim();
  if (needle.length === 0) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(text);
}

export interface SampleScore {
  sample: SampleView;
  relevance: number;
  quality: number;
  total: number;
}

function sampleContentPenalty(sample: SampleView): number {
  let penalty = 0;
  const content = sample.content.trim();
  if (content.length < 40) penalty += 3;
  if (/^(hi|hello|dear)\b/i.test(content)) penalty += 1;
  if (/\b(i'?d|i would) be (happy|glad)\b/i.test(content)) penalty += 2;
  if (/\b(i understand|i have read|i can help)\b/i.test(content)) penalty += 2;
  if (/\b(seamless|robust|cutting[- ]edge|perfect fit)\b/i.test(content)) penalty += 1;
  return penalty;
}

/**
 * Combine job relevance with a light, deterministic writing-quality signal.
 * A won bid is a supporting signal, never proof that the prose is good.
 */
export function scoreSample(sample: SampleView, jobText: string): SampleScore {
  const tagHits = sample.tags.filter((tag) => containsTerm(jobText, tag)).length;
  const typeHit =
    sample.jobType !== "general" && containsTerm(jobText, sample.jobType) ? 3 : 0;
  const relevance = tagHits * 2 + typeHit;
  let quality = sample.rating - 3;
  if (sample.preferred) quality += 4;
  if (sample.outcome === "won") quality += 1;
  if (sample.outcome === "lost") quality -= 2;
  quality -= sampleContentPenalty(sample);
  return { sample, relevance, quality, total: relevance * 10 + quality };
}

/**
 * Choose a small, varied set of samples for voice analysis. Voice is not
 * job-specific, so this deliberately does not rank by the current job. Taking
 * the best sample from different job types avoids overfitting the writer to one
 * old proposal while still preferring the owner's strongest examples.
 */
export function selectVoiceSamples(userId: string, maxCount: number): SampleView[] {
  if (maxCount <= 0) return [];

  const seen = new Set<string>();
  const eligible = listSamples(userId).filter((sample) => {
    if (!sample.active || sample.rating < 3) return false;
    const key = sample.content.trim().replace(/\s+/g, " ").toLowerCase();
    if (key.length < 20 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const scored = eligible
    .map((sample) => ({
      sample,
      quality:
        sample.rating +
        (sample.preferred ? 4 : 0) +
        (sample.outcome === "won" ? 1 : 0) -
        sampleContentPenalty(sample),
    }))
    .sort((a, b) => b.quality - a.quality);

  const byType = new Map<string, (typeof scored)[number]>();
  for (const entry of scored) {
    if (!byType.has(entry.sample.jobType)) byType.set(entry.sample.jobType, entry);
  }

  const selected = [...byType.values()].slice(0, maxCount);
  if (selected.length < maxCount) {
    const selectedIds = new Set(selected.map((entry) => entry.sample.id));
    for (const entry of scored) {
      if (selected.length >= maxCount) break;
      if (!selectedIds.has(entry.sample.id)) {
        selected.push(entry);
        selectedIds.add(entry.sample.id);
      }
    }
  }

  return selected.map((entry) => entry.sample);
}

export function selectSamples(
  userId: string,
  jobText: string,
  maxCount: number
): SampleView[] {
  if (maxCount <= 0) return [];

  const seen = new Set<string>();
  const eligible = listSamples(userId).filter((sample) => {
    if (!sample.active || sample.rating < 3) return false;
    const key = sample.content.trim().replace(/\s+/g, " ").toLowerCase();
    if (key.length < 20 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const scored = eligible.map((sample) => scoreSample(sample, jobText));
  const relevant = scored
    .filter((entry) => entry.relevance > 0)
    .sort((a, b) => b.total - a.total || b.relevance - a.relevance);
  const topScore = relevant[0]?.total ?? 0;
  const cutoff = Math.max(1, Math.ceil(topScore / 2));
  const strong = relevant.filter((entry) => entry.total >= cutoff);
  const general = scored
    .filter(
      (entry) =>
        entry.relevance === 0 &&
        entry.sample.jobType === "general" &&
        (entry.sample.preferred || entry.sample.rating >= 4)
    )
    .sort((a, b) => b.quality - a.quality);

  if (strong.length > 0) {
    const selected = strong.slice(0, maxCount);
    if (selected.length < maxCount && general[0] !== undefined) {
      selected.push(general[0]);
    }
    return selected.map((entry) => entry.sample);
  }

  const preferred = scored
    .filter((entry) => entry.sample.preferred)
    .sort((a, b) => b.quality - a.quality);
  const fallback = preferred.length > 0 ? preferred : general;
  return fallback.slice(0, Math.min(maxCount, 2)).map((entry) => entry.sample);
}

/**
 * Import selected, already-submitted bids as voice samples. Importing every
 * bid by default is deliberately not supported.
 */
export function importSamplesFromBids(
  userId: string,
  bidIds: string[]
): { imported: number; skipped: number; notFound: number } {
  if (bidIds.length === 0) {
    return { imported: 0, skipped: 0, notFound: 0 };
  }
  const rows = getDb()
    .select()
    .from(userBids)
    .where(and(eq(userBids.userId, userId), inArray(userBids.id, bidIds)))
    .all();
  const found = new Set(rows.map((row) => row.id));
  const notFound = bidIds.filter((id) => !found.has(id)).length;
  const existing = new Set(listSamples(userId).map((sample) => sample.content.trim()));
  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const content = row.description.trim();
    if (content.length < 20 || existing.has(content)) {
      skipped++;
      continue;
    }
    upsertSample(userId, {
      title: row.jobTitle,
      jobType: "general",
      content,
      tags: row.jobTitle
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3)
        .slice(0, 12),
      outcome: row.outcome === "won" ? "won" : row.outcome === "lost" ? "lost" : "unknown",
      rating: 2,
      preferred: false,
      notes: `Imported from a submitted bid (${row.via}). Review the writing and activate it only if it is a good voice example.`,
      active: false,
    });
    existing.add(content);
    imported++;
  }
  return { imported, skipped, notFound };
}

/* ----------------------------- Profile audit ----------------------------- */

function seedAuditSettings(userId: string): ProfileAuditSettings {
  const now = new Date().toISOString();
  getDb()
    .insert(profileAuditSettings)
    .values({
      userId,
      rulesJson: JSON.stringify(DEFAULT_PROFILE_AUDIT_SETTINGS.rules),
      prompt: JSON.stringify(DEFAULT_PROFILE_AUDIT_SETTINGS.prompt),
      model: DEFAULT_PROFILE_AUDIT_SETTINGS.model,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
  return DEFAULT_PROFILE_AUDIT_SETTINGS;
}

export function getProfileAuditSettings(userId: string): ProfileAuditSettings {
  const row = getDb()
    .select()
    .from(profileAuditSettings)
    .where(eq(profileAuditSettings.userId, userId))
    .get();
  if (row === undefined) return seedAuditSettings(userId);
  return {
    version: 1,
    runOnSave: row.runOnSave,
    rules: parseJson(
      row.rulesJson,
      z.array(profileAuditSettingsSchema.shape.rules.element),
      DEFAULT_PROFILE_AUDIT_SETTINGS.rules,
      "audit rules"
    ),
    prompt: parseJson(
      row.prompt,
      profileAuditSettingsSchema.shape.prompt,
      DEFAULT_PROFILE_AUDIT_SETTINGS.prompt,
      "audit prompt"
    ),
    model: row.model,
  };
}

export const profileAuditSettingsPatchSchema = z
  .object({
    runOnSave: z.boolean().optional(),
    rules: z.array(profileAuditSettingsSchema.shape.rules.element).max(100).optional(),
    prompt: profileAuditSettingsSchema.shape.prompt.partial().optional(),
    model: z.string().max(200).nullable().optional(),
  })
  .strict();

export function saveProfileAuditSettings(
  userId: string,
  patch: z.infer<typeof profileAuditSettingsPatchSchema>
): ProfileAuditSettings {
  const current = getProfileAuditSettings(userId);
  const merged: ProfileAuditSettings = {
    version: 1,
    runOnSave: patch.runOnSave ?? current.runOnSave,
    rules: patch.rules ?? current.rules,
    prompt: { ...current.prompt, ...patch.prompt },
    model: patch.model === undefined ? current.model : patch.model,
  };
  const parsed = profileAuditSettingsSchema.parse(merged);
  const now = new Date().toISOString();
  getDb()
    .insert(profileAuditSettings)
    .values({
      userId,
      rulesJson: JSON.stringify(parsed.rules),
      prompt: JSON.stringify(parsed.prompt),
      model: parsed.model,
      runOnSave: parsed.runOnSave,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: profileAuditSettings.userId,
      set: {
        rulesJson: JSON.stringify(parsed.rules),
        prompt: JSON.stringify(parsed.prompt),
        model: parsed.model,
        runOnSave: parsed.runOnSave,
        updatedAt: now,
      },
    })
    .run();
  return parsed;
}

export interface StoredProfileAudit {
  id: string;
  score: number;
  status: string;
  summary: string;
  findings: unknown[];
  model: string | null;
  createdAt: string;
}

export function saveProfileAudit(
  userId: string,
  audit: {
    score: number;
    status: string;
    summary: string;
    findings: unknown[];
    model: string | null;
  }
): StoredProfileAudit {
  const row: StoredProfileAudit = {
    id: `audit-${crypto.randomUUID()}`,
    score: audit.score,
    status: audit.status,
    summary: audit.summary,
    findings: audit.findings,
    model: audit.model,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .insert(profileAudits)
    .values({
      id: row.id,
      userId,
      score: row.score,
      status: row.status,
      summary: row.summary,
      findingsJson: JSON.stringify(row.findings),
      model: row.model,
      createdAt: row.createdAt,
    })
    .run();
  return row;
}

export function getLatestProfileAudit(userId: string): StoredProfileAudit | null {
  const row = getDb()
    .select()
    .from(profileAudits)
    .where(eq(profileAudits.userId, userId))
    .orderBy(desc(profileAudits.createdAt))
    .limit(1)
    .get();
  if (row === undefined) return null;
  return {
    id: row.id,
    score: row.score,
    status: row.status,
    summary: row.summary,
    findings: parseJson(row.findingsJson, z.array(z.unknown()), [], "audit findings"),
    model: row.model,
    createdAt: row.createdAt,
  };
}
