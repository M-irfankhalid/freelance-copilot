import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";

/**
 * Dashboard snapshot surfaces Discord as a connection row in `platforms`,
 * flipping to connected once a webhook is saved. (Discord config UI lives on
 * the Platforms/Settings pages; this guards the dashboard representation.)
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const { createApp } = await import("../src/app.js");
const { closeDb, getDb } = await import("../src/db/index.js");
const { users } = await import("../src/db/schema.js");

let app: Express;
let baseUrl: string;
let server: ReturnType<Express["listen"]>;
let cookie: string | null = null;
let realFetch: typeof fetch;

/** The webhook URL the tests save — fake but well-formed. */
const WEBHOOK = "https://discord.com/api/webhooks/123456789/abcdef";

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
      name: "Dashboard Owner",
      email: "owner-dashboard@example.com",
      password: "correct-horse-battery",
    }),
  });
  expect(register.status).toBe(201);
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  const user = getDb()
    .select()
    .from(users)
    .where(eq(users.email, "owner-dashboard@example.com"))
    .get();
  expect(user).toBeDefined();
});

afterAll(() => {
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

async function dashboardPlatforms(): Promise<
  Array<{ id: string; name: string; status: string; note?: string | null }>
> {
  const res = await realFetch(`${baseUrl}/api/dashboard`, { headers: authed() });
  expect(res.status).toBe(200);
  const { snapshot } = (await res.json()) as {
    snapshot: { platforms: Array<{ id: string; name: string; status: string; note?: string | null }> };
  };
  return snapshot.platforms;
}

describe("dashboard platform connections", () => {
  it("lists Discord alongside the freelance platforms", async () => {
    const platforms = await dashboardPlatforms();
    const ids = platforms.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(["freelancer", "openrouter", "discord"])
    );
    const discord = platforms.find((p) => p.id === "discord");
    expect(discord?.status).toBe("not_connected");
    expect(discord?.note).toContain("Connect Discord");
  });

  it("flips Discord to connected once a webhook is saved", async () => {
    const save = await realFetch(`${baseUrl}/api/discord`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ webhook: WEBHOOK }),
    });
    expect(save.status).toBe(200);

    const platforms = await dashboardPlatforms();
    const discord = platforms.find((p) => p.id === "discord");
    expect(discord?.status).toBe("connected");
    expect(discord?.note).toContain("Webhook");
    // The real webhook identity never leaks into the dashboard either.
    expect(discord?.note ?? "").not.toContain("123456789");
    expect(discord?.note ?? "").not.toContain("discord.com");
  });
});
