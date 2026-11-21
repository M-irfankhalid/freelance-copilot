import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const { createApp } = await import("../src/app.js");
const { closeDb } = await import("../src/db/index.js");
const { startProposalGenerationRun } = await import(
  "../src/modules/proposals/proposal-trace.service.js"
);

let app: Express;
let baseUrl: string;
let server: ReturnType<Express["listen"]>;
let cookie: string | null = null;
let runId = "";
let realFetch: typeof fetch;

beforeAll(async () => {
  realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));

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
      name: "Trace Routes User",
      email: "trace-routes@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  const { getDb } = await import("../src/db/index.js");
  const { users } = await import("../src/db/schema.js");
  const user = getDb().select({ id: users.id }).from(users).limit(1).get();
  if (!user) throw new Error("Test user was not created");

  const trace = startProposalGenerationRun({
    userId: user.id,
    jobId: "job-trace-route",
    trigger: "generate",
  });
  runId = trace.id;
  trace.emit({ phase: "setup", title: "Preparing", status: "started" });
  trace.finish("completed");

  vi.unstubAllGlobals();
});

afterAll(() => {
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

describe("proposal trace endpoints", () => {
  it("requires authentication", async () => {
    const list = await realFetch(`${baseUrl}/api/proposal-traces`);
    expect(list.status).toBe(401);

    const detail = await realFetch(`${baseUrl}/api/proposal-traces/${runId}`);
    expect(detail.status).toBe(401);
  });

  it("lists recent runs for the owner", async () => {
    const response = await realFetch(`${baseUrl}/api/proposal-traces?limit=10`, {
      headers: authed(),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      runs: Array<{ id: string; eventCount: number; jobTitle: string | null }>;
    };
    expect(body.runs[0]?.id).toBe(runId);
    expect(body.runs[0]?.eventCount).toBe(1);
    expect(body.runs[0]?.jobTitle).toBeNull();
  });

  it("returns the ordered trace detail", async () => {
    const response = await realFetch(`${baseUrl}/api/proposal-traces/${runId}`, {
      headers: authed(),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      run: { id: string; status: string; events: Array<{ phase: string }> };
    };
    expect(body.run.id).toBe(runId);
    expect(body.run.status).toBe("completed");
    expect(body.run.events.map((event) => event.phase)).toEqual(["setup"]);
  });

  it("returns 404 for an unknown run", async () => {
    const response = await realFetch(`${baseUrl}/api/proposal-traces/missing-run`, {
      headers: authed(),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
