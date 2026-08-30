import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

/**
 * Logs endpoint: GET /api/logs with search, level, and category filters,
 * plus pagination. Auth is required — unauthenticated requests get 401.
 */

// Set env BEFORE any dynamic imports so db/index.ts picks up ":memory:".
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const { createApp } = await import("../src/app.js");

let app: Express;
let baseUrl: string;
let server: ReturnType<Express["listen"]>;
let cookie: string | null = null;
let realFetch: typeof fetch;

const SAMPLE_LOGS = [
  { level: "info", category: "sync", message: "Freelancer.com scan completed — 14 new jobs found" },
  { level: "warn", category: "sync", message: "Rate limit header shows 80% quota used" },
  { level: "error", category: "sync", message: "Freelancer.com request returned 429 — backing off" },
  { level: "info", category: "analysis", message: "Analyzed job #39120412 — score 94 (strong)" },
  { level: "debug", category: "analysis", message: "Relevancy filter rejected job #39090122" },
  { level: "info", category: "proposal", message: "Drafted proposal for job #39120412" },
  { level: "warn", category: "proposal", message: "AI proposal generated but too short — retrying" },
  { level: "info", category: "bid", message: "Auto-bid placed $1,900 on #39085900" },
  { level: "error", category: "bid", message: "Auto-bid failed: project not found" },
  { level: "info", category: "auth", message: "Session refreshed for user@example.com" },
  { level: "debug", category: "system", message: "Credential test OK: token valid" },
  { level: "info", category: "system", message: "Profile imported from Freelancer.com" },
];

async function seedLogs(): Promise<void> {
  const { getDb } = await import("../src/db/index.js");
  const { logs } = await import("../src/db/schema.js");
  const now = new Date();
  for (let i = 0; i < SAMPLE_LOGS.length; i++) {
    const entry = SAMPLE_LOGS[SAMPLE_LOGS.length - 1 - i]!; // newest first
    getDb()
      .insert(logs)
      .values({
        id: `log-${i}`,
        time: new Date(now.getTime() - i * 60_000).toISOString(),
        level: entry.level,
        category: entry.category,
        message: entry.message,
        meta: null,
      })
      .run();
  }
}

beforeAll(async () => {
  realFetch = globalThis.fetch;
  // No external API calls during logs tests, but we stub fetch to prevent
  // anything unexpected from leaking out.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));

  app = createApp();
  server = app.listen(0);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  baseUrl = `http://localhost:${address.port}`;

  // Stub fetch during registration so credential tests on /self don't escape.
  const register = await realFetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Logs User",
      email: "logs-test@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  await seedLogs();

  vi.unstubAllGlobals();
});

afterAll(async () => {
  server.close();
  const { closeDb } = await import("../src/db/index.js");
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

describe("logs endpoint", () => {
  it("requires authentication", async () => {
    const res = await realFetch(`${baseUrl}/api/logs`);
    expect(res.status).toBe(401);
  });

  it("returns all logs when no filters are applied", async () => {
    const res = await realFetch(`${baseUrl}/api/logs`, { headers: authed() });
    expect(res.status).toBe(200);
    const { logs: entries, total, hasMore } = (await res.json()) as {
      logs: Array<{ id: string; level: string; category: string; message: string; timeLabel: string }>;
      total: number;
      hasMore: boolean;
    };
    expect(total).toBe(SAMPLE_LOGS.length);
    expect(entries.length).toBe(SAMPLE_LOGS.length);
    expect(hasMore).toBe(false);
    // Should be newest first.
    expect(entries[0]!.message).toContain("Profile imported");
  });

  it("filters by level", async () => {
    const res = await realFetch(`${baseUrl}/api/logs?level=error`, { headers: authed() });
    expect(res.status).toBe(200);
    const { logs: entries, total } = (await res.json()) as {
      logs: Array<{ level: string }>;
      total: number;
    };
    expect(total).toBe(2); // 2 error-level entries in the mock
    expect(entries.every((e) => e.level === "error")).toBe(true);
  });

  it("filters by category", async () => {
    const res = await realFetch(`${baseUrl}/api/logs?category=sync`, { headers: authed() });
    expect(res.status).toBe(200);
    const { logs: entries, total } = (await res.json()) as {
      logs: Array<{ category: string }>;
      total: number;
    };
    expect(total).toBe(3); // sync: info, warn, error
    expect(entries.every((e) => e.category === "sync")).toBe(true);
  });

  it("filters by search query", async () => {
    const res = await realFetch(`${baseUrl}/api/logs?q=proposal`, { headers: authed() });
    expect(res.status).toBe(200);
    const { logs: entries, total } = (await res.json()) as {
      logs: Array<{ message: string }>;
      total: number;
    };
    expect(total).toBe(2); // two proposal entries: info + warn
    expect(entries.every((e) => e.message.toLowerCase().includes("proposal"))).toBe(true);
  });

  it("combines level and category filters", async () => {
    const res = await realFetch(`${baseUrl}/api/logs?level=warn&category=sync`, { headers: authed() });
    expect(res.status).toBe(200);
    const { logs: entries, total } = (await res.json()) as {
      logs: Array<{ level: string; category: string }>;
      total: number;
    };
    expect(total).toBe(1);
    expect(entries[0]!.level).toBe("warn");
    expect(entries[0]!.category).toBe("sync");
  });

  it("supports pagination via limit and offset", async () => {
    const res = await realFetch(`${baseUrl}/api/logs?limit=5&offset=0`, { headers: authed() });
    expect(res.status).toBe(200);
    const { logs: entries, total, hasMore } = (await res.json()) as {
      logs: unknown[];
      total: number;
      hasMore: boolean;
    };
    expect(entries.length).toBe(5);
    expect(total).toBe(SAMPLE_LOGS.length);
    expect(hasMore).toBe(true);
  });

  it("returns 400 for an invalid level parameter", async () => {
    const res = await realFetch(`${baseUrl}/api/logs?level=success`, { headers: authed() });
    expect(res.status).toBe(400);
  });

  it("returns 400 when offset exceeds total", async () => {
    const res = await realFetch(`${baseUrl}/api/logs?limit=5&offset=999`, { headers: authed() });
    expect(res.status).toBe(200);
    const { logs: entries, total, hasMore } = (await res.json()) as {
      logs: unknown[];
      total: number;
      hasMore: boolean;
    };
    expect(entries).toHaveLength(0);
    expect(total).toBe(SAMPLE_LOGS.length);
    expect(hasMore).toBe(false);
  });

  it("returns entries with timeLabel field", async () => {
    const res = await realFetch(`${baseUrl}/api/logs?limit=1`, { headers: authed() });
    expect(res.status).toBe(200);
    const { logs: entries } = (await res.json()) as {
      logs: Array<{ timeLabel: string }>;
    };
    expect(entries[0]!.timeLabel).toBeTruthy();
    expect(typeof entries[0]!.timeLabel).toBe("string");
  });
});
