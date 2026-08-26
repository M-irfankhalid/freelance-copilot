import { eq } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { platformCredentials } from "../../db/schema.js";
import { AppError, notFound } from "../../lib/errors.js";
import { decrypt, encrypt, mask } from "../../lib/crypto.js";
import {
  listOpenRouterModels,
  testFreelancerToken,
  testOpenRouterKey,
  type ModelOption,
  type TestResult,
} from "./testers.js";

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

interface CredentialMeta {
  /** Selected OpenRouter model id. */
  modelId?: string;
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
  modelId: string | null;
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
    return {
      id,
      connected: true,
      status: row.status as CredentialSummary["status"],
      keyPreview: preview,
      lastTestedAt: row.lastTestedAt,
      lastTestMessage: meta.lastTestMessage ?? null,
      modelId: meta.modelId ?? null,
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

  // Replacing a key keeps the chosen model but resets test metadata.
  const prevMeta = existing === undefined ? {} : parseMeta(existing.meta);
  const nextMeta = JSON.stringify({
    ...(prevMeta.modelId !== undefined ? { modelId: prevMeta.modelId } : {}),
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

export function setModel(modelId: string): void {
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
  const meta = { ...parseMeta(row.meta), modelId };
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
