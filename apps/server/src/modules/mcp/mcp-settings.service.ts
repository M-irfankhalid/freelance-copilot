import { eq } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { mcpSettings as mcpSettingsTable } from "../../db/schema.js";
import { decrypt, encrypt, mask } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";

/**
 * Secure MCP Tunnel settings. The runtime API key is a credential: encrypted
 * with AES-256-GCM, never returned to the frontend, and never logged.
 */

export const TUNNEL_ID_PATTERN = /^tunnel_[a-z0-9]{32}$/;

export interface McpSettings {
  configured: boolean;
  tunnelId: string | null;
  /** Masked runtime key preview, never the real key. */
  apiKeyPreview: string | null;
  allowWrites: boolean;
  /** Whether the tunnel should be running (and resume on server boot). */
  enabled: boolean;
  updatedAt: string | null;
}

export interface McpConfiguration {
  userId: string;
  tunnelId: string;
  apiKey: string;
  allowWrites: boolean;
}

type McpSettingsRow = typeof mcpSettingsTable.$inferSelect;

function apiKeyValue(
  row: McpSettingsRow
): { cipherText: string; iv: string; authTag: string } | null {
  if (
    row.apiKeyCipherText === null ||
    row.apiKeyIv === null ||
    row.apiKeyAuthTag === null
  ) {
    return null;
  }
  return {
    cipherText: row.apiKeyCipherText,
    iv: row.apiKeyIv,
    authTag: row.apiKeyAuthTag,
  };
}

function getRow(userId: string): McpSettingsRow | undefined {
  return getDb()
    .select()
    .from(mcpSettingsTable)
    .where(eq(mcpSettingsTable.userId, userId))
    .get();
}

/** Read the user's MCP configuration without exposing the runtime key. */
export function getMcpSettings(userId: string): McpSettings {
  const row = getRow(userId);
  if (row === undefined) {
    return {
      configured: false,
      tunnelId: null,
      apiKeyPreview: null,
      allowWrites: true,
      enabled: false,
      updatedAt: null,
    };
  }

  const encrypted = apiKeyValue(row);
  let preview: string | null = null;
  if (encrypted !== null) {
    try {
      preview = mask(decrypt(encrypted));
    } catch {
      // Undecryptable (key changed or tampered) — leave it hidden rather than leak.
    }
  }

  return {
    configured: row.tunnelId !== null && preview !== null,
    tunnelId: row.tunnelId,
    apiKeyPreview: preview,
    allowWrites: row.allowWrites === 1,
    enabled: row.enabled === 1,
    updatedAt: row.updatedAt,
  };
}

/** Decrypted configuration used only inside the server tunnel manager. */
export function getMcpConfiguration(userId: string): McpConfiguration | null {
  const row = getRow(userId);
  if (row === undefined || row.tunnelId === null) return null;
  const encrypted = apiKeyValue(row);
  if (encrypted === null) return null;
  let apiKey: string;
  try {
    apiKey = decrypt(encrypted);
  } catch {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "The saved runtime API key could not be decrypted. Enter it again on the Platforms page."
    );
  }
  return {
    userId,
    tunnelId: row.tunnelId,
    apiKey,
    allowWrites: row.allowWrites === 1,
  };
}

/** Save settings. An omitted API key keeps the existing encrypted value. */
export function saveMcpSettings(
  userId: string,
  input: { tunnelId?: string; apiKey?: string; allowWrites?: boolean }
): McpSettings {
  const existing = getRow(userId);
  const now = new Date().toISOString();

  const next: {
    tunnelId?: string;
    apiKeyCipherText?: string;
    apiKeyIv?: string;
    apiKeyAuthTag?: string;
    allowWrites?: number;
    updatedAt: string;
  } = { updatedAt: now };

  if (input.tunnelId !== undefined) {
    const tunnelId = input.tunnelId.trim().toLowerCase();
    if (!TUNNEL_ID_PATTERN.test(tunnelId)) {
      throw new AppError(
        400,
        "BAD_REQUEST",
        "That doesn't look like a tunnel ID. It starts with tunnel_ followed by 32 lowercase letters or digits."
      );
    }
    next.tunnelId = tunnelId;
  }

  if (input.apiKey !== undefined) {
    const apiKey = input.apiKey.trim();
    if (apiKey.length < 8) {
      throw new AppError(400, "BAD_REQUEST", "That runtime API key looks too short.");
    }
    const encrypted = encrypt(apiKey);
    next.apiKeyCipherText = encrypted.cipherText;
    next.apiKeyIv = encrypted.iv;
    next.apiKeyAuthTag = encrypted.authTag;
  }

  if (input.allowWrites !== undefined) {
    next.allowWrites = input.allowWrites ? 1 : 0;
  }

  if (existing === undefined) {
    if (next.tunnelId === undefined || next.apiKeyCipherText === undefined) {
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Enter the tunnel ID and runtime API key before connecting."
      );
    }
    getDb()
      .insert(mcpSettingsTable)
      .values({ userId, ...next })
      .run();
  } else {
    getDb()
      .update(mcpSettingsTable)
      .set(next)
      .where(eq(mcpSettingsTable.userId, userId))
      .run();
  }

  return getMcpSettings(userId);
}

export function setMcpEnabled(userId: string, enabled: boolean): void {
  getDb()
    .update(mcpSettingsTable)
    .set({ enabled: enabled ? 1 : 0, updatedAt: new Date().toISOString() })
    .where(eq(mcpSettingsTable.userId, userId))
    .run();
}

export function deleteMcpSettings(userId: string): void {
  getDb()
    .delete(mcpSettingsTable)
    .where(eq(mcpSettingsTable.userId, userId))
    .run();
}
