import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

/**
 * Credential storage flows with the external services stubbed at fetch
 * level: no network in tests, everything else real (encryption, DB, auth).
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const { createApp } = await import("../src/app.js");
const { closeDb } = await import("../src/db/index.js");

let app: Express;
let baseUrl: string;
let server: ReturnType<Express["listen"]>;
let cookie: string | null = null;

/** Fetch stub: routes by URL, records last Authorization header. */
const lastAuthHeader: { value: string | null } = { value: null };
let realFetch: typeof fetch;

beforeAll(() => {
  realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      // Requests aimed at our own test server use the real fetch.
      if (url.startsWith(baseUrl)) {
        return realFetch(input, init);
      }
      const headers = new Headers(init?.headers);
      lastAuthHeader.value = headers.get("authorization");
      if (url.includes("freelancer.com/api/users")) {
        return new Response(
          JSON.stringify({
            status: "success",
            result: { username: "test_user" },
          }),
          {
            status: 200,
            headers: {
              "x-ratelimit-remaining": "380",
              "x-ratelimit-limit": "500",
            },
          }
        );
      }
      if (url.includes("openrouter.ai/api/v1/key")) {
        return new Response(
          JSON.stringify({ data: { label: "Test key", usage: 1.5, limit: 10 } }),
          { status: 200 }
        );
      }
      if (url.includes("openrouter.ai/api/v1/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "zeta/model", name: "Zeta", context_length: 64000, pricing: { prompt: "0" } },
              { id: "alpha/model", name: "Alpha", context_length: 200000, pricing: { prompt: "0" } },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    })
  );

  app = createApp();
  server = app.listen(0);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  baseUrl = `http://localhost:${address.port}`;
});

afterAll(() => {
  vi.unstubAllGlobals();
  server.close();
  closeDb();
});

async function register(): Promise<void> {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Owner",
      email: "owner@example.com",
      password: "correct-horse-battery",
    }),
  });
  const raw = response.headers.get("set-cookie");
  cookie = raw?.split(";")[0] ?? null;
}

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

/** The OpenRouter credential row as the API reports it. */
async function openRouterSummary(): Promise<
  | {
      analysisModelId: string | null;
      proposalModelId: string | null;
      analysisEngine: string;
      jevModelId: string | null;
    }
  | undefined
> {
  const res = await fetch(`${baseUrl}/api/credentials`, { headers: authed() });
  const body = (await res.json()) as {
    credentials: Array<{
      id: string;
      analysisModelId: string | null;
      proposalModelId: string | null;
      analysisEngine: string;
      jevModelId: string | null;
    }>;
  };
  return body.credentials.find((c) => c.id === "openrouter");
}

describe("credentials", () => {
  it("require an authenticated session", async () => {
    const response = await fetch(`${baseUrl}/api/credentials`);
    expect(response.status).toBe(401);
  });

  it("save a freelancer token after testing it against the real API shape", async () => {
    await register();
    const response = await fetch(`${baseUrl}/api/credentials/freelancer`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ value: "frl_test_token_1234567890" }),
    });
    expect(response.status).toBe(200);
    expect(lastAuthHeader.value).toBe("Bearer frl_test_token_1234567890");
  });

  it("refuse to store a failing token", async () => {
    // External calls get a rejection; local requests keep flowing.
    const currentFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("openrouter.ai")) {
        return new Response(JSON.stringify({}), { status: 401 });
      }
      return currentFetch(input, init);
    }) as typeof fetch;
    try {
      const response = await fetch(`${baseUrl}/api/credentials/openrouter`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ value: "sk-or-bad-key-123456" }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toMatch(/rejected/i);
    } finally {
      globalThis.fetch = currentFetch;
    }
  });

  it("list masked previews without ever returning plaintext", async () => {
    const response = await fetch(`${baseUrl}/api/credentials`, {
      headers: authed(),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("frl_test_token_1234567890");
    const body = JSON.parse(text) as {
      credentials: Array<{
        id: string;
        connected: boolean;
        keyPreview: string | null;
        status: string;
      }>;
    };
    const freelancer = body.credentials.find((c) => c.id === "freelancer");
    expect(freelancer?.connected).toBe(true);
    expect(freelancer?.status).toBe("ok");
    expect(freelancer?.keyPreview).toMatch(/^frl_/);
    expect(freelancer?.keyPreview).toContain("••••");
  });

  it("test a stored credential and surface quota info", async () => {
    const response = await fetch(`${baseUrl}/api/credentials/freelancer/test`, {
      method: "POST",
      headers: authed(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { ok: boolean; message: string; usage?: { used: number; limit: number } };
    };
    expect(body.result.ok).toBe(true);
    expect(body.result.message).toContain("@test_user");
    expect(body.result.usage?.used).toBe(120); // 500 limit - 380 remaining
  });

  it("select and persist an OpenRouter model after saving a key", async () => {
    // Save a working OpenRouter key first.
    const save = await fetch(`${baseUrl}/api/credentials/openrouter`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ value: "sk-or-test-key-1234567890" }),
    });
    expect(save.status).toBe(200);

    const model = await fetch(`${baseUrl}/api/credentials/openrouter/model`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ modelId: "alpha/model" }),
    });
    expect(model.status).toBe(200);

    const list = await fetch(`${baseUrl}/api/credentials/openrouter/models`, {
      headers: authed(),
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      models: Array<{ id: string; label: string; provider: string }>;
    };
    expect(body.models.map((m) => m.id)).toEqual(["alpha/model", "zeta/model"]);
  });

  it("select distinct analysis and proposal models, falling back to legacy modelId", async () => {
    // Save a working OpenRouter key first.
    const save = await fetch(`${baseUrl}/api/credentials/openrouter`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ value: "sk-or-test-key-1234567890" }),
    });
    expect(save.status).toBe(200);

    // Set only the analysis model — proposal stays unset.
    const analysis = await fetch(`${baseUrl}/api/credentials/openrouter/model`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ analysisModelId: "alpha/model" }),
    });
    expect(analysis.status).toBe(200);

    // Set only the proposal model — analysis stays on alpha/model.
    const proposal = await fetch(`${baseUrl}/api/credentials/openrouter/model`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ proposalModelId: "zeta/model" }),
    });
    expect(proposal.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/api/credentials`, { headers: authed() });
    const list = (await listRes.json()) as {
      credentials: Array<{
        modelId: string | null;
        analysisModelId: string | null;
        proposalModelId: string | null;
      }>;
    };
    const openrouter = list.credentials.find((c) => (c as { id?: string }).id === "openrouter");
    expect(openrouter).toBeDefined();
    expect(openrouter?.analysisModelId).toBe("alpha/model");
    expect(openrouter?.proposalModelId).toBe("zeta/model");
    // Legacy modelId mirrors the proposal model.
    expect(openrouter?.modelId).toBe("zeta/model");
  });

  it("default to the chat engine and persist the Jev decision engine", async () => {
    // Absent engine means "llm", so installs saved before Jev existed behave
    // exactly as they did.
    const before = await openRouterSummary();
    expect(before?.analysisEngine).toBe("llm");
    expect(before?.jevModelId).toBeNull();

    const set = await fetch(`${baseUrl}/api/credentials/openrouter/model`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        analysisEngine: "jev",
        jevModelId: "typesafe/jev-1.13",
      }),
    });
    expect(set.status).toBe(200);

    const after = await openRouterSummary();
    expect(after?.analysisEngine).toBe("jev");
    expect(after?.jevModelId).toBe("typesafe/jev-1.13");
  });

  it("reject an unknown analysis engine", async () => {
    const res = await fetch(`${baseUrl}/api/credentials/openrouter/model`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ analysisEngine: "gpt" }),
    });
    expect(res.status).toBe(400);
  });

  it("keep every saved setting when the API key is replaced", async () => {
    // Distinct values per role, so a dropped field is visible rather than
    // silently equal to another.
    await fetch(`${baseUrl}/api/credentials/openrouter/model`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ analysisModelId: "alpha/model" }),
    });
    await fetch(`${baseUrl}/api/credentials/openrouter/model`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ proposalModelId: "zeta/model" }),
    });
    await fetch(`${baseUrl}/api/credentials/openrouter/model`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ analysisEngine: "jev", jevModelId: "typesafe/jev-1.13" }),
    });

    const replace = await fetch(`${baseUrl}/api/credentials/openrouter`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ value: "sk-or-rotated-key-0987654321" }),
    });
    expect(replace.status).toBe(200);

    const cred = await openRouterSummary();
    expect(cred?.analysisModelId).toBe("alpha/model");
    expect(cred?.proposalModelId).toBe("zeta/model");
    expect(cred?.analysisEngine).toBe("jev");
    expect(cred?.jevModelId).toBe("typesafe/jev-1.13");
  });

  it("reject unknown platforms and missing values", async () => {
    const badPlatform = await fetch(`${baseUrl}/api/credentials/nope`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ value: "whatever-value" }),
    });
    expect(badPlatform.status).toBe(404);

    const shortValue = await fetch(`${baseUrl}/api/credentials/freelancer`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ value: "short" }),
    });
    expect(shortValue.status).toBe(400);
  });
});
