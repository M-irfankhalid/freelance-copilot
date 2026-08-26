import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";

/**
 * End-to-end auth flows against a real server on an ephemeral port with
 * in-memory SQLite. Cookies are passed manually between requests. Tests in
 * one file run in order and share state deliberately: registration happens
 * once at the top and later blocks consume its results.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";

const { createApp } = await import("../src/app.js");
const { closeDb } = await import("../src/db/index.js");

let app: Express;
let baseUrl: string;
let server: ReturnType<Express["listen"]>;
let cookie: string | null = null;
/** Captured at registration — the only time they exist. */
let backupCodes: string[] = [];

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

function captureCookie(response: Response): void {
  const raw = response.headers.get("set-cookie");
  if (raw !== null) {
    cookie = raw.split(";")[0] ?? null;
  }
}

async function me(): Promise<{ authenticated: boolean; needsSetup: boolean }> {
  const response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return (await response.json()) as { authenticated: boolean; needsSetup: boolean };
}

const account = {
  name: "Test Owner",
  email: "owner@example.com",
  password: "correct-horse-battery",
};

describe("registration", () => {
  it("creates the owner, returns backup codes once, and signs in", async () => {
    expect((await me()).needsSetup).toBe(true);

    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(account),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { backupCodes: string[] };
    expect(body.backupCodes).toHaveLength(8);
    for (const code of body.backupCodes) {
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    }
    backupCodes = body.backupCodes;
    captureCookie(response);
    expect((await me()).authenticated).toBe(true);
  });

  it("refuses any further registration", async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Second",
        email: "other@example.com",
        password: "long-enough-pass",
      }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("rejects weak passwords with a validation envelope", async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...account, password: "short" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("login and logout lifecycle", () => {
  it("rejects a wrong password without revealing which part failed", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: account.email, password: "wrong-password-1" }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toMatch(/invalid email or password/i);
  });

  it("logs in with correct credentials and sets a session cookie", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(account),
    });
    expect(response.status).toBe(200);
    captureCookie(response);
    expect(cookie).toContain("fa_session=");
    expect((await me()).authenticated).toBe(true);
  });

  it("logs out and invalidates the session", async () => {
    await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie ?? "" },
    });
    cookie = null;
    expect((await me()).authenticated).toBe(false);
  });
});

describe("backup code recovery", () => {
  it("rejects an unknown or malformed code", async () => {
    const bad = await fetch(`${baseUrl}/api/auth/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "XXXX-XXXX-XXXX", password: "another-good-passw" }),
    });
    expect(bad.status).toBe(400);
  });

  it("consumes a valid code, resets the password, kills old sessions", async () => {
    // Sign back in so we can prove recovery invalidated this session.
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(account),
    });
    captureCookie(login);
    expect((await me()).authenticated).toBe(true);

    const good = await fetch(`${baseUrl}/api/auth/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: backupCodes[0], password: "brand-new-password" }),
    });
    expect(good.status).toBe(200);

    // Old sessions were invalidated by the recovery.
    expect((await me()).authenticated).toBe(false);

    // Old password no longer works.
    const oldPassword = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...account }),
    });
    expect(oldPassword.status).toBe(401);

    // New password works.
    const newPassword = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...account, password: "brand-new-password" }),
    });
    expect(newPassword.status).toBe(200);
  });

  it("refuses reusing the same code twice", async () => {
    const again = await fetch(`${baseUrl}/api/auth/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: backupCodes[0], password: "third-password-x" }),
    });
    expect(again.status).toBe(400);
  });
});
