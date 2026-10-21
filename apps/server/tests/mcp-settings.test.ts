import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";

/**
 * UI-managed Secure MCP Tunnel settings: validation, encrypted storage,
 * masked previews, and disconnect/forget behavior. Runtime tests avoid the
 * network download by exercising the save/read paths only.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const { createApp } = await import("../src/app.js");
const { closeDb, getDb } = await import("../src/db/index.js");
const { mcpSettings } = await import("../src/db/schema.js");

const TUNNEL_ID = "tunnel_0123456789abcdef0123456789abcdef";
const RUNTIME_KEY = "sk-test-runtime-key-that-must-never-leak";

let app: Express;
let baseUrl: string;
let server: ReturnType<Express["listen"]>;
let cookie: string | null = null;
let realFetch: typeof fetch;

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
      name: "MCP Settings Owner",
      email: "owner-mcp-settings@example.com",
      password: "correct-horse-battery",
    }),
  });
  expect(register.status).toBe(201);
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;
});

afterAll(() => {
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

interface StateBody {
  settings: {
    configured: boolean;
    tunnelId: string | null;
    apiKeyPreview: string | null;
    allowWrites: boolean;
    enabled: boolean;
  };
  status: { state: string; running: boolean };
}

describe("MCP settings API", () => {
  it("starts unconfigured with a stopped tunnel", async () => {
    const res = await realFetch(`${baseUrl}/api/mcp`, { headers: authed() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StateBody;
    expect(body.settings.configured).toBe(false);
    expect(body.settings.tunnelId).toBeNull();
    expect(body.settings.apiKeyPreview).toBeNull();
    expect(body.settings.allowWrites).toBe(true);
    expect(body.status.state).toBe("not_configured");
    expect(body.status.running).toBe(false);
  });

  it("refuses to connect without a saved configuration", async () => {
    const res = await realFetch(`${baseUrl}/api/mcp/connect`, {
      method: "POST",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    });
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(400);
  });

  it("rejects a malformed tunnel ID", async () => {
    const res = await realFetch(`${baseUrl}/api/mcp`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        tunnelId: "not-a-tunnel",
        apiKey: RUNTIME_KEY,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("stores the runtime key encrypted and returns only a masked preview", async () => {
    const res = await realFetch(`${baseUrl}/api/mcp`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ tunnelId: TUNNEL_ID, apiKey: RUNTIME_KEY }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StateBody;
    expect(body.settings.configured).toBe(true);
    expect(body.settings.tunnelId).toBe(TUNNEL_ID);
    expect(body.settings.apiKeyPreview).not.toBe(RUNTIME_KEY);
    expect(body.settings.apiKeyPreview).toContain("•");
    expect(body.settings.enabled).toBe(false);
    expect(body.status.state).toBe("disconnected");

    const row = getDb()
      .select()
      .from(mcpSettings)
      .where(eq(mcpSettings.tunnelId, TUNNEL_ID))
      .get();
    expect(row).toBeDefined();
    expect(row!.apiKeyCipherText).not.toBe(RUNTIME_KEY);
    expect(row!.apiKeyCipherText).not.toContain(RUNTIME_KEY);
  });

  it("updates write access without touching the saved key", async () => {
    const res = await realFetch(`${baseUrl}/api/mcp`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ allowWrites: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StateBody;
    expect(body.settings.allowWrites).toBe(false);
    expect(body.settings.configured).toBe(true);
    expect(body.settings.apiKeyPreview).not.toBeNull();
  });

  it("forgets the configuration and stops the tunnel", async () => {
    const res = await realFetch(`${baseUrl}/api/mcp`, {
      method: "DELETE",
      headers: authed(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StateBody;
    expect(body.settings.configured).toBe(false);
    expect(body.settings.tunnelId).toBeNull();
    expect(body.settings.apiKeyPreview).toBeNull();
    expect(body.status.state).toBe("not_configured");
  });

  it("requires authentication", async () => {
    const res = await realFetch(`${baseUrl}/api/mcp`);
    expect(res.status).toBe(401);
  });
});
