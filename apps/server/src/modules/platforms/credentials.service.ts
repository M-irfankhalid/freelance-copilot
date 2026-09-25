import { eq } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { platformCredentials } from "../../db/schema.js";
import { AppError, notFound } from "../../lib/errors.js";
import { decrypt, encrypt, mask } from "../../lib/crypto.js";
import {
  listOpenRouterModels,
  testFreelancerToken,
  testJevAccess,
  testOpenRouterKey,
  type ModelOption,
  type TestResult,
} from "./testers.js";
import { readJevModel } from "../ai/jev.service.js";

/**
 * Credential storage. Values are encrypted at rest and never leave the
 * server: the frontend only ever sees masked previews, statuses, and
 * metadata such as the selected model.
 */

export const PLATFORM_IDS = ["freelancer", "openrouter"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export function isPlatformId(value: string): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

/** Which engine runs the relevance gate: the chat model or the Jev decision model. */
export type AnalysisEngine = "llm" | "jev";

interface CredentialMeta {
  /** Legacy single model selection — still honored as a fallback. */
  modelId?: string;
  /** Model used for relevance screening / analysis (Model A). */
  analysisModelId?: string;
  /** Model used for proposal writing (Model B). */
  proposalModelId?: string;
  /**
   * Engine behind the relevance gate. Absent means "llm", so installs saved
   * before Jev existed keep behaving exactly as they did.
   */
  analysisEngine?: AnalysisEngine;
  /** Jev model id (decision model), when the relevance gate runs on Jev. */
  jevModelId?: string;
  /** Summary from the last successful test. */
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

export interface CredentialSummary {
  id: PlatformId;
  connected: boolean;
  status: "untested" | "ok" | "failed";
  keyPreview: string | null;
  lastTestedAt: string | null;
  lastTestMessage: string | null;
  /** Legacy single model id (mirrors proposalModelId when set). */
  modelId: string | null;
  /** Model used for relevance screening / analysis. */
  analysisModelId: string | null;
  /** Model used for proposal writing. */
  proposalModelId: string | null;
  /** Engine behind the relevance gate ("llm" unless the user picked Jev). */
  analysisEngine: AnalysisEngine;
  /** Jev model id, when the relevance gate runs on Jev. */
  jevModelId: string | null;
  usage: CredentialMeta["usage"];
}

export function listCredentials(): CredentialSummary[] {
  const rows = getDb().select().from(platformCredentials).all();
  return PLATFORM_IDS.map((id) => {
    const row = rows.find((r) => r.id === id);
    if (row === undefined) {
      return {
        id,
        connected: false,
        status: "untested" as const,
        keyPreview: null,
        lastTestedAt: null,
        lastTestMessage: null,
        modelId: null,
        analysisModelId: null,
        proposalModelId: null,
        analysisEngine: "llm" as const,
        jevModelId: null,
        usage: undefined,
      };
    }
    const meta = parseMeta(row.meta);
    let preview: string | null;
    try {
      preview = mask(decrypt(row));
    } catch {
      // Undecryptable (wrong key or tampered row) — hide it rather than leak.
      preview = null;
    }
    const modelId = meta.modelId ?? null;
    return {
      id,
      connected: true,
      status: row.status as CredentialSummary["status"],
      keyPreview: preview,
      lastTestedAt: row.lastTestedAt,
      lastTestMessage: meta.lastTestMessage ?? null,
      modelId,
      analysisModelId: meta.analysisModelId ?? modelId,
      proposalModelId: meta.proposalModelId ?? modelId,
      analysisEngine: meta.analysisEngine ?? "llm",
      jevModelId: meta.jevModelId ?? null,
      usage: meta.usage,
    };
  });
}

async function runTest(id: PlatformId, value: string): Promise<TestResult> {
  if (id === "freelancer") {
    return testFreelancerToken(value);
  }
  return testOpenRouterKey(value);
}

/** Test a credential value without saving it (onboarding flow). */
export async function testUnsaved(
  id: PlatformId,
  value: string
): Promise<TestResult> {
  return runTest(id, value);
}

/** Test the stored credential for a platform. */
export async function testStored(id: PlatformId): Promise<TestResult> {
  const row = getDb()
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.id, id))
    .get();
  if (row === undefined) {
    throw notFound(`No ${id} credential saved yet`);
  }
  const plaintext = decrypt(row);
  const result = await runTest(id, plaintext);

  const meta = parseMeta(row.meta);
  getDb()
    .update(platformCredentials)
    .set({
      status: result.ok ? "ok" : "failed",
      lastTestedAt: new Date().toISOString(),
      meta: JSON.stringify({
        ...meta,
        lastTestMessage: result.message,
        ...(result.usage !== undefined ? { usage: result.usage } : {}),
      }),
    })
    .where(eq(platformCredentials.id, id))
    .run();

  return result;
}

/**
 * Verify the Jev engine with the stored key and the selected Jev model. Unlike
 * `testStored`, this does NOT write test metadata back to the credential row —
 * the relevance gate may legitimately run on the LLM while Jev settings are
 * being tried out, and a Jev-specific failure should not mark the credential
 * itself as failed.
 */
export async function testJevEngine(): Promise<TestResult> {
  const row = getDb()
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "openrouter"))
    .get();
  if (row === undefined) {
    throw notFound("No OpenRouter key saved yet");
  }
  return testJevAccess(decrypt(row), readJevModel());
}

export async function saveCredential(
  id: PlatformId,
  value: string
): Promise<void> {
  // Never persist an untested-failing secret without saying so.
  const result = await runTest(id, value);
  if (!result.ok) {
    throw new AppError(400, "BAD_REQUEST", result.message);
  }

  const existing = getDb()
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.id, id))
    .get();

  // Replacing a key keeps every setting the user chose — models, the analysis
  // engine — and resets only the test metadata, which belonged to the old key.
  const prevMeta = existing === undefined ? {} : parseMeta(existing.meta);
  const {
    usage: _staleUsage,
    lastTestMessage: _staleTestMessage,
    ...settings
  } = prevMeta;
  const nextMeta = JSON.stringify({
    ...settings,
    lastTestMessage: result.message,
  });

  const encrypted = encrypt(value.trim());
  const now = new Date().toISOString();

  if (existing !== undefined) {
    getDb()
      .update(platformCredentials)
      .set({
        ...encrypted,
        status: "ok",
        lastTestedAt: now,
        updatedAt: now,
        meta: nextMeta,
      })
      .where(eq(platformCredentials.id, id))
      .run();
  } else {
    getDb()
      .insert(platformCredentials)
      .values({
        id,
        ...encrypted,
        status: "ok",
        lastTestedAt: now,
        updatedAt: now,
        meta: nextMeta,
      })
      .run();
  }
}

export function deleteCredential(id: PlatformId): void {
  getDb()
    .delete(platformCredentials)
    .where(eq(platformCredentials.id, id))
    .run();
}

export function setModel(input: {
  modelId?: string;
  analysisModelId?: string;
  proposalModelId?: string;
  analysisEngine?: AnalysisEngine;
  jevModelId?: string;
}): void {
  const row = getDb()
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "openrouter"))
    .get();
  if (row === undefined) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Save an OpenRouter key before choosing a model"
    );
  }
  const meta = { ...parseMeta(row.meta) };
  if (input.modelId !== undefined) {
    // Legacy single-model selection applies to both roles.
    meta.modelId = input.modelId;
    meta.analysisModelId = input.modelId;
    meta.proposalModelId = input.modelId;
  }
  if (input.analysisModelId !== undefined) {
    meta.analysisModelId = input.analysisModelId;
  }
  if (input.proposalModelId !== undefined) {
    meta.proposalModelId = input.proposalModelId;
    // Keep the legacy pointer on the "main" model for any old readers.
    meta.modelId = input.proposalModelId;
  }
  if (input.analysisEngine !== undefined) {
    meta.analysisEngine = input.analysisEngine;
  }
  if (input.jevModelId !== undefined) {
    meta.jevModelId = input.jevModelId;
  }
  getDb()
    .update(platformCredentials)
    .set({ meta: JSON.stringify(meta), updatedAt: new Date().toISOString() })
    .where(eq(platformCredentials.id, "openrouter"))
    .run();
}

export async function getModels(): Promise<ModelOption[]> {
  const row = getDb()
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "openrouter"))
    .get();
  if (row === undefined) {
    throw notFound("No OpenRouter key saved");
  }
  return listOpenRouterModels(decrypt(row));
}
