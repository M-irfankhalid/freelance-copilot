import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";

/**
 * Integration tests against the real app factory on an ephemeral port.
 * In-memory SQLite keeps runs hermetic.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";

const { createApp } = await import("../src/app.js");
const { closeDb } = await import("../src/db/index.js");

let app: Express;
let baseUrl: string;
let server: ReturnType<Express["listen"]>;

beforeAll(() => {
  app = createApp();
  server = app.listen(0);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  baseUrl = `http://localhost:${address.port}`;
});

afterAll(() => {
  server.close();
  closeDb();
});

describe("GET /api/health", () => {
  it("returns ok with uptime", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});

describe("unknown routes", () => {
  it("returns a JSON 404 envelope", async () => {
    const response = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error: { code: string };
    };
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("malformed JSON body", () => {
  it("returns a 400 envelope instead of crashing", async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string };
    };
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});
