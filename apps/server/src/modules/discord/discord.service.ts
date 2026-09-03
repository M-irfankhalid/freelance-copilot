import { eq } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { discordSettings as discordSettingsTable } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { decrypt, encrypt, mask } from "../../lib/crypto.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("system");

/**
 * Discord notifications. The webhook URL is a credential: encrypted at rest
 * (AES-256-GCM), never returned to the frontend in plaintext, never logged.
 * Sending is best-effort — a dead webhook must never break the pipeline.
 */

export const DISCORD_EVENTS = [
  "match",
  "bid_placed",
  "bid_failed",
  "api_error",
] as const;
export type DiscordEvent = (typeof DISCORD_EVENTS)[number];

export function isDiscordEvent(value: string): value is DiscordEvent {
  return (DISCORD_EVENTS as readonly string[]).includes(value);
}

const WEBHOOK_URL_PATTERN =
  /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\//;

export interface DiscordSettings {
  configured: boolean;
  /** Masked webhook preview, never the real URL. */
  webhookPreview: string | null;
  /** Events this user has enabled. */
  events: DiscordEvent[];
}

function parseEvents(raw: string): DiscordEvent[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (e): e is DiscordEvent => typeof e === "string" && isDiscordEvent(e)
      );
    }
  } catch {
    // fall through with an empty list
  }
  return [];
}

function webhookValue(row: {
  webhookCipherText: string | null;
  webhookIv: string | null;
  webhookAuthTag: string | null;
}): { cipherText: string; iv: string; authTag: string } | null {
  if (
    row.webhookCipherText === null ||
    row.webhookIv === null ||
    row.webhookAuthTag === null
  ) {
    return null;
  }
  return {
    cipherText: row.webhookCipherText,
    iv: row.webhookIv,
    authTag: row.webhookAuthTag,
  };
}

/** Read the user's Discord configuration. Never returns the plaintext URL. */
export function getDiscordSettings(userId: string): DiscordSettings {
  const row = getDb()
    .select()
    .from(discordSettingsTable)
    .where(eq(discordSettingsTable.userId, userId))
    .get();
  // Event toggles live independently of the webhook — a removed webhook must
  // not hide them (they come back when the webhook is re-added).
  if (row === undefined) {
    return { configured: false, webhookPreview: null, events: [] };
  }
  const events = parseEvents(row.events);
  const encrypted = webhookValue(row);
  if (encrypted === null) {
    return { configured: false, webhookPreview: null, events };
  }
  let preview: string | null = null;
  try {
    preview = mask(decrypt(encrypted));
  } catch {
    // Undecryptable (key changed or tampered) — leave it hidden rather than leak.
  }
  return {
    configured: preview !== null,
    webhookPreview: preview,
    events,
  };
}

export function saveDiscordSettings(
  userId: string,
  input: { webhook?: string; events?: DiscordEvent[] }
): DiscordSettings {
  const existing = getDb()
    .select()
    .from(discordSettingsTable)
    .where(eq(discordSettingsTable.userId, userId))
    .get();
  const now = new Date().toISOString();

  const next: {
    webhookCipherText?: string;
    webhookIv?: string;
    webhookAuthTag?: string;
    events?: string;
  } = {};

  if (input.webhook !== undefined) {
    const trimmed = input.webhook.trim();
    if (!WEBHOOK_URL_PATTERN.test(trimmed)) {
      throw new AppError(
        400,
        "BAD_REQUEST",
        "That doesn't look like a Discord webhook URL. Paste the webhook URL from your Discord channel's Integrations settings."
      );
    }
    const encrypted = encrypt(trimmed);
    next.webhookCipherText = encrypted.cipherText;
    next.webhookIv = encrypted.iv;
    next.webhookAuthTag = encrypted.authTag;
  }

  if (input.events !== undefined) {
    const valid = input.events.filter(isDiscordEvent);
    next.events = JSON.stringify([...new Set(valid)]);
  }

  if (Object.keys(next).length === 0) {
    return getDiscordSettings(userId);
  }

  const values = { ...next, updatedAt: now };
  if (existing === undefined) {
    getDb().insert(discordSettingsTable).values({ userId, ...values }).run();
  } else {
    getDb()
      .update(discordSettingsTable)
      .set(values)
      .where(eq(discordSettingsTable.userId, userId))
      .run();
  }
  return getDiscordSettings(userId);
}

/** Remove the saved webhook (keeps the event toggles). */
export function deleteDiscordWebhook(userId: string): void {
  getDb()
    .update(discordSettingsTable)
    .set({
      webhookCipherText: null,
      webhookIv: null,
      webhookAuthTag: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(discordSettingsTable.userId, userId))
    .run();
}

function decryptWebhook(userId: string): string | null {
  const row = getDb()
    .select()
    .from(discordSettingsTable)
    .where(eq(discordSettingsTable.userId, userId))
    .get();
  const encrypted = row === undefined ? null : webhookValue(row);
  if (encrypted === null) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

async function postToWebhook(webhookUrl: string, content: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook returned status ${res.status}`);
  }
}

/**
 * Fire the given event if the webhook is configured and that event is enabled.
 * Best-effort: every failure is swallowed so a dead webhook can never break
 * the pipeline. The webhook URL itself is never logged.
 */
export async function sendDiscordEvent(
  userId: string,
  event: DiscordEvent,
  content: string
): Promise<void> {
  try {
    const settings = getDiscordSettings(userId);
    if (!settings.configured || !settings.events.includes(event)) return;
    const webhookUrl = decryptWebhook(userId);
    if (webhookUrl === null) return;
    await postToWebhook(webhookUrl, content);
    log.debug(`Sent Discord ${event} notification`);
  } catch (error) {
    log.warn(`Discord ${event} notification failed`, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/** Send a test message — used by the settings UI to verify a webhook. */
export async function sendTestMessage(userId: string): Promise<void> {
  const settings = getDiscordSettings(userId);
  if (!settings.configured) {
    throw new AppError(400, "BAD_REQUEST", "Save a Discord webhook URL first.");
  }
  const webhookUrl = decryptWebhook(userId);
  if (webhookUrl === null) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "The saved webhook could not be decrypted. Save it again."
    );
  }
  try {
    await postToWebhook(
      webhookUrl,
      "✅ Freelancer Agent — Discord notifications connected."
    );
  } catch (error) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Could not reach the webhook: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
