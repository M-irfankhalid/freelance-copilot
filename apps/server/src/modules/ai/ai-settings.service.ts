import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../../db/index.js";
import { aiSettings } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { listCredentials, setModel } from "../platforms/credentials.service.js";
import { JEV_DEFAULT_MODEL } from "./jev.service.js";

/** Model used when the user has not picked one for a role. */
export const DEFAULT_AI_MODEL = "openai/gpt-4o-mini";

export const AI_SETTINGS_DEFAULTS = {
  relevanceTemperature: 0.2,
  relevanceMaxTokens: 500,
  relevanceTimeoutSeconds: 120,
  analysisTemperature: 0.2,
  analysisMaxTokens: 1000,
  analysisTimeoutSeconds: 120,
  proposalTemperature: 0.5,
  proposalTimeoutSeconds: 180,
  proposalCorrectionAttempts: 1,
  relevanceIgnoreFloor: 50,
  goodScoreFloor: 75,
  strongScoreFloor: 90,
} as const;

export interface AiTuningSettings {
  relevanceTemperature: number;
  relevanceMaxTokens: number;
  relevanceTimeoutSeconds: number;
  analysisTemperature: number;
  analysisMaxTokens: number;
  analysisTimeoutSeconds: number;
  proposalTemperature: number;
  proposalTimeoutSeconds: number;
  proposalCorrectionAttempts: number;
  relevanceIgnoreFloor: number;
  goodScoreFloor: number;
  strongScoreFloor: number;
}

export type MatchBand = "strong" | "good" | "fair";

export interface AiSettings extends AiTuningSettings {
  analysisModelId: string;
  proposalModelId: string;
  agentModelId: string;
  analysisEngine: "llm" | "jev";
  jevModelId: string;
  updatedAt: string | null;
}

const tuningSchema = z.object({
  relevanceTemperature: z.number().min(0).max(2),
  relevanceMaxTokens: z.number().int().min(100).max(8000),
  relevanceTimeoutSeconds: z.number().int().min(10).max(600),
  analysisTemperature: z.number().min(0).max(2),
  analysisMaxTokens: z.number().int().min(100).max(16000),
  analysisTimeoutSeconds: z.number().int().min(10).max(600),
  proposalTemperature: z.number().min(0).max(2),
  proposalTimeoutSeconds: z.number().int().min(10).max(600),
  proposalCorrectionAttempts: z.number().int().min(0).max(2),
  relevanceIgnoreFloor: z.number().int().min(0).max(100),
  goodScoreFloor: z.number().int().min(0).max(100),
  strongScoreFloor: z.number().int().min(1).max(100),
});

const modelSchema = z.object({
  analysisModelId: z.string().trim().min(1).max(200),
  proposalModelId: z.string().trim().min(1).max(200),
  agentModelId: z.string().trim().min(1).max(200),
  analysisEngine: z.enum(["llm", "jev"]),
  jevModelId: z.string().trim().min(1).max(200),
});

export const aiSettingsPatchSchema = tuningSchema
  .partial()
  .merge(modelSchema.partial())
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one AI setting",
  });

export type AiSettingsPatch = z.infer<typeof aiSettingsPatchSchema>;

const FIELD_ORDER: string[] = [
  ...Object.keys(AI_SETTINGS_DEFAULTS),
  "analysisModelId",
  "proposalModelId",
  "agentModelId",
  "analysisEngine",
  "jevModelId",
];

/** Effective relevance band for a score under the saved thresholds. */
export function matchBandForScore(
  score: number,
  settings: Pick<AiTuningSettings, "goodScoreFloor" | "strongScoreFloor">
): MatchBand {
  return score >= settings.strongScoreFloor
    ? "strong"
    : score >= settings.goodScoreFloor
      ? "good"
      : "fair";
}

/** Tuning values only. AI calls use this; it never decrypts credentials. */
export function getAiTuningSettings(userId?: string | null): AiTuningSettings {
  if (!userId) return { ...AI_SETTINGS_DEFAULTS };
  const row = getDb()
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.userId, userId))
    .get();
  if (row === undefined) return { ...AI_SETTINGS_DEFAULTS };
  return {
    relevanceTemperature: row.relevanceTemperature,
    relevanceMaxTokens: row.relevanceMaxTokens,
    relevanceTimeoutSeconds: row.relevanceTimeoutSeconds,
    analysisTemperature: row.analysisTemperature,
    analysisMaxTokens: row.analysisMaxTokens,
    analysisTimeoutSeconds: row.analysisTimeoutSeconds,
    proposalTemperature: row.proposalTemperature,
    proposalTimeoutSeconds: row.proposalTimeoutSeconds,
    proposalCorrectionAttempts: row.proposalCorrectionAttempts,
    relevanceIgnoreFloor: row.relevanceIgnoreFloor,
    goodScoreFloor: row.goodScoreFloor,
    strongScoreFloor: row.strongScoreFloor,
  };
}

/** The full settings view: tuning plus the effective model/engine choices. */
export function getAiSettingsView(userId: string): AiSettings {
  const tuning = getAiTuningSettings(userId);
  const row = getDb()
    .select({ updatedAt: aiSettings.updatedAt })
    .from(aiSettings)
    .where(eq(aiSettings.userId, userId))
    .get();
  const openRouter = listCredentials().find((item) => item.id === "openrouter");
  return {
    ...tuning,
    analysisModelId: openRouter?.analysisModelId ?? DEFAULT_AI_MODEL,
    proposalModelId: openRouter?.proposalModelId ?? DEFAULT_AI_MODEL,
    agentModelId: openRouter?.agentModelId ?? DEFAULT_AI_MODEL,
    analysisEngine: openRouter?.analysisEngine ?? "llm",
    jevModelId: openRouter?.jevModelId ?? JEV_DEFAULT_MODEL,
    updatedAt: row?.updatedAt ?? null,
  };
}

function validateBands(settings: AiTuningSettings): void {
  if (settings.relevanceIgnoreFloor > settings.goodScoreFloor) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "The ignore floor cannot be higher than the good-score floor"
    );
  }
  if (settings.goodScoreFloor >= settings.strongScoreFloor) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "The strong-score floor must be higher than the good-score floor"
    );
  }
}

export function saveAiSettings(
  userId: string,
  patch: AiSettingsPatch
): { settings: AiSettings; changedFields: string[] } {
  const before = getAiSettingsView(userId);
  const merged = tuningSchema.parse({
    ...getAiTuningSettings(userId),
    ...Object.fromEntries(
      Object.entries(patch).filter(([key]) => key in AI_SETTINGS_DEFAULTS)
    ),
  });
  validateBands(merged);

  const modelPatch = {
    ...(patch.analysisModelId !== undefined
      ? { analysisModelId: patch.analysisModelId }
      : {}),
    ...(patch.proposalModelId !== undefined
      ? { proposalModelId: patch.proposalModelId }
      : {}),
    ...(patch.agentModelId !== undefined ? { agentModelId: patch.agentModelId } : {}),
    ...(patch.analysisEngine !== undefined
      ? { analysisEngine: patch.analysisEngine }
      : {}),
    ...(patch.jevModelId !== undefined ? { jevModelId: patch.jevModelId } : {}),
  };
  if (Object.keys(modelPatch).length > 0) {
    setModel(modelPatch);
  }

  const now = new Date().toISOString();
  getDb()
    .insert(aiSettings)
    .values({
      userId,
      ...merged,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: aiSettings.userId,
      set: { ...merged, updatedAt: now },
    })
    .run();

  const after = getAiSettingsView(userId);
  const beforeRecord = before as unknown as Record<string, unknown>;
  const afterRecord = after as unknown as Record<string, unknown>;
  const changedFields = FIELD_ORDER.filter(
    (field) =>
      field in patch &&
      JSON.stringify(beforeRecord[field]) !== JSON.stringify(afterRecord[field])
  );
  return { settings: after, changedFields };
}

/** Restore tuning defaults. Model and engine selections are left untouched. */
export function resetAiSettings(userId: string): AiSettings {
  getDb().delete(aiSettings).where(eq(aiSettings.userId, userId)).run();
  return getAiSettingsView(userId);
}
