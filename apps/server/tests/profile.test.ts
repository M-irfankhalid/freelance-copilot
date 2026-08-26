import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

/**
 * Profile storage and Freelancer import mapping. External calls stubbed at
 * fetch level; storage and validation fully real.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars!!";

const { createApp } = await import("../src/app.js");
const { closeDb } = await import("../src/db/index.js");

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

  // External service stub for setup: local requests pass through untouched.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      if (url.includes("freelancer.com/api/users")) {
        return new Response(
          JSON.stringify({ status: "success", result: { username: "stub" } }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    })
  );

  // Register the owner and save a freelancer token so import has one to use.
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Owner",
      email: "owner@example.com",
      password: "correct-horse-battery",
    }),
  });
  const raw = registerResponse.headers.get("set-cookie");
  cookie = raw?.split(";")[0] ?? null;

  await fetch(`${baseUrl}/api/credentials/freelancer`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "frl_profile_import_test_token" }),
  });
});

afterAll(() => {
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

const validProfile = {
  freelancerUsername: "test_user",
  name: "Test Owner",
  title: "Full-stack developer",
  hourlyRate: "$35/hr",
  about: "I build things.",
  skills: ["React", "Node.js"],
  experience: [
    { role: "Dev", company: "Self", periodLabel: "2021 – now", summary: null },
  ],
  portfolio: [],
  certifications: [],
  preferredProjectTypes: ["Fixed price"],
  wants: ["React"],
  notWants: ["crypto"],
  customInstructions: "Keep it short.",
};

describe("profile", () => {
  it("requires a session", async () => {
    const response = await realFetch(`${baseUrl}/api/profile`);
    expect(response.status).toBe(401);
  });

  it("returns null profile before first save", async () => {
    const response = await realFetch(`${baseUrl}/api/profile`, {
      headers: authed(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { profile: unknown };
    expect(body.profile).toBeNull();
  });

  it("saves and reads back a full profile", async () => {
    const put = await realFetch(`${baseUrl}/api/profile`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify(validProfile),
    });
    expect(put.status).toBe(200);

    const get = await realFetch(`${baseUrl}/api/profile`, { headers: authed() });
    const body = (await get.json()) as { profile: typeof validProfile | null };
    expect(body.profile?.skills).toEqual(["React", "Node.js"]);
    expect(body.profile?.experience[0]?.role).toBe("Dev");
  });

  it("rejects invalid profiles with field details", async () => {
    const response = await realFetch(`${baseUrl}/api/profile`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...validProfile, skills: [123] }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; details?: { fieldErrors?: Record<string, unknown> } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(body.error.details)).toContain("skills");
  });

  it("imports from Freelancer.com and maps fields onto our shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith(baseUrl)) return realFetch(input);
        if (url.includes("freelancer.com/api/users")) {
          // Freelancer.com self endpoint returns only these public fields:
          // username, display_name, hourly_rate, location, public_name, etc.
          // tagline, profile_description, and skills do NOT exist in the API.
          return new Response(
            JSON.stringify({
              status: "success",
              result: {
                username: "irfan_dev",
                display_name: "Irfan Developer",
                public_name: "React and Node specialist",
                hourly_rate: 35,
                location: { country: { name: "Pakistan" }, city: "Mardan" },
              },
            }),
            { status: 200 }
          );
        }
        return new Response("not found", { status: 404 });
      })
    );
    try {
      const response = await realFetch(`${baseUrl}/api/profile/import`, {
        method: "POST",
        headers: authed(),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        profile: {
          freelancerUsername: string | null;
          name: string | null;
          title: string | null;
          hourlyRate: string | null;
          skills: string[];
          wants: string[];
        };
      };
      expect(body.profile.freelancerUsername).toBe("irfan_dev");
      expect(body.profile.name).toBe("Irfan Developer");
      expect(body.profile.title).toBe("React and Node specialist");
      expect(body.profile.hourlyRate).toBe("$35/hr");
      // API does not return skills; those remain empty and must be added manually.
      expect(body.profile.skills).toEqual([]);
      expect(body.profile.wants).toEqual([]);
      // Nothing was stored by the import itself.
      const get = await realFetch(`${baseUrl}/api/profile`, { headers: authed() });
      const after = (await get.json()) as { profile: { title: string | null } | null };
      expect(after.profile?.title).toBe("Full-stack developer");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails cleanly when no token is saved for import", async () => {
    // Delete the credential, then expect a clean 400.
    await realFetch(`${baseUrl}/api/credentials/freelancer`, {
      method: "DELETE",
      headers: authed(),
    });
    const restoreFetch = globalThis.fetch;
    globalThis.fetch = realFetch;
    try {
      const response = await realFetch(`${baseUrl}/api/profile/import`, {
        method: "POST",
        headers: authed(),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toMatch(/token first/i);
    } finally {
      globalThis.fetch = restoreFetch;
    }
  });
});
