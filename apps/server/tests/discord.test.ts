import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";

/**
 * Discord notifications: webhook stored encrypted, never returned in
 * plaintext, event toggles respected, and webhook failures never propagate.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const { createApp } = await import("../src/app.js");
const { closeDb, getDb } = await import("../src/db/index.js");
const { users } = await import("../src/db/schema.js");
const { sendDiscordEvent } = await import("../src/modules/discord/discord.service.js");

let app: Express;
let baseUrl: string;
let server: ReturnType<Express["listen"]>;
let cookie: string | null = null;
let realFetch: typeof fetch;
let userId: string;

/** The webhook URL the tests save — fake but well-formed. */
const WEBHOOK = "https://discord.com/api/webhooks/123456789/abcdef";

/** Every Discord webhook POST the stub captured, in order. */
const webhookPosts: Array<{ url: string; content: string }> = [];

/** Stub: let server-local calls through, capture Discord webhook posts. */
function stubFetch(options: { failWebhook?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      if (url.startsWith("https://discord.com/api/webhooks/") && init?.method === "POST") {
        if (options.failWebhook) {
          return new Response("fail", { status: 500 });
        }
        webhookPosts.push({
          url,
          content: (JSON.parse(init?.body as string ?? "{}") as { content?: string }).content ?? "",
        });
        return new Response(null, { status: 204 });
      }
      return new Response("not found", { status: 404 });
    })
  );
}

beforeAll(async () => {
  realFetch = globalThis.fetch;
  app = createApp();
  server = app.listen(0);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  baseUrl = `http://localhost:${address.port}`;

  const register = await realFetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Discord Owner",
      email: "owner-discord@example.com",
      password: "correct-horse-battery",
    }),
  });
  expect(register.status).toBe(201);
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  const user = getDb()
    .select()
    .from(users)
    .where(eq(users.email, "owner-discord@example.com"))
    .get();
  expect(user).toBeDefined();
  userId = user!.id;
});

afterAll(() => {
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

describe("discord settings API", () => {
  it("starts unconfigured with no events", async () => {
    const res = await realFetch(`${baseUrl}/api/discord`, { headers: authed() });
    expect(res.status).toBe(200);
    const { settings } = (await res.json()) as {
      settings: { configured: boolean; webhookPreview: string | null; events: string[] };
    };
    expect(settings.configured).toBe(false);
    expect(settings.webhookPreview).toBeNull();
    expect(settings.events).toEqual([]);
  });

  it("rejects a URL that is not a Discord webhook", async () => {
    const res = await realFetch(`${baseUrl}/api/discord`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ webhook: "https://example.com/not-a-webhook" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unknown event names", async () => {
    const res = await realFetch(`${baseUrl}/api/discord`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ events: ["match", "not_an_event"] }),
    });
    expect(res.status).toBe(400);
  });

  it("saves a webhook but only ever returns a masked preview", async () => {
    const res = await realFetch(`${baseUrl}/api/discord`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ webhook: WEBHOOK }),
    });
    expect(res.status).toBe(200);
    const { settings } = (await res.json()) as {
      settings: { configured: boolean; webhookPreview: string | null };
    };
    expect(settings.configured).toBe(true);
    expect(settings.webhookPreview).not.toBeNull();
    // The real URL is never exposed: neither the id nor the host appear.
    expect(settings.webhookPreview).not.toContain("123456789");
    expect(settings.webhookPreview).not.toContain("discord.com");
  });

  it("persists the event toggles", async () => {
    const res = await realFetch(`${baseUrl}/api/discord`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ events: ["match", "bid_failed"] }),
    });
    expect(res.status).toBe(200);
    const { settings } = (await res.json()) as { settings: { events: string[] } };
    expect([...settings.events].sort()).toEqual(["bid_failed", "match"]);
  });

  it("sends only for enabled events, and never for a disabled one", async () => {
    stubFetch();
    try {
      webhookPosts.length = 0;
      // "match" and "bid_failed" are enabled; "api_error" and "bid_placed" are not.
      await sendDiscordEvent(userId, "match", "🎯 New match!");
      await sendDiscordEvent(userId, "bid_failed", "⚠️ Bid failed.");
      await sendDiscordEvent(userId, "api_error", "🚨 API issue.");
      await sendDiscordEvent(userId, "bid_placed", "✅ Bid placed.");
      expect(webhookPosts.length).toBe(2);
      expect(webhookPosts[0]?.content).toBe("🎯 New match!");
      expect(webhookPosts[1]?.content).toBe("⚠️ Bid failed.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("swallows webhook failures instead of throwing", async () => {
    stubFetch({ failWebhook: true });
    try {
      webhookPosts.length = 0;
      // sendDiscordEvent is best-effort — a dead webhook must not break the caller.
      await expect(sendDiscordEvent(userId, "match", "should be swallowed")).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends a test message through the API", async () => {
    stubFetch();
    try {
      webhookPosts.length = 0;
      const res = await realFetch(`${baseUrl}/api/discord/test`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);
      expect(webhookPosts.length).toBe(1);
      expect(webhookPosts[0]?.content).toContain("connected");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("removes the webhook but keeps the event toggles", async () => {
    const del = await realFetch(`${baseUrl}/api/discord`, {
      method: "DELETE",
      headers: authed(),
    });
    expect(del.status).toBe(200);

    const res = await realFetch(`${baseUrl}/api/discord`, { headers: authed() });
    const { settings } = (await res.json()) as {
      settings: { configured: boolean; webhookPreview: string | null; events: string[] };
    };
    expect(settings.configured).toBe(false);
    expect(settings.webhookPreview).toBeNull();
    // Event toggles survive a webhook removal.
    expect([...settings.events].sort()).toEqual(["bid_failed", "match"]);
  });
});
