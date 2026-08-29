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
  skillIds: [759, 500],
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
        if (url.includes("freelancer.com/api/users/0.1/self")) {
          // Freelancer.com self endpoint with profile_description=true and
          // jobs=true returns: username, display_name, hourly_rate,
          // public_name, profile_description (About text string),
          // location, jobs (array of {id, name, category:{id,name}, seo_url, local}).
          // Jobs array elements are the user's skill categories on Freelancer.
          return new Response(
            JSON.stringify({
              status: "success",
              result: {
                id: 77124963,
                username: "irfan_dev",
                display_name: "Irfan Developer",
                public_name: "React Developer",
                hourly_rate: 35,
                profile_description: "Full-stack developer with 5 years experience.",
                location: { country: { name: "Pakistan" }, city: "Mardan" },
                jobs: [
                  { id: 9, name: "JavaScript", category: { id: 1, name: "Web Dev" }, seo_url: "javascript", local: false },
                  { id: 759, name: "React.js", category: { id: 1, name: "Web Dev" }, seo_url: "react_js", local: false },
                  { id: 500, name: "Node.js", category: { id: 1, name: "Web Dev" }, seo_url: "nodejs", local: false },
                ],
              },
            }),
            { status: 200 }
          );
        }
        if (url.includes("freelancer.com/api/users/0.1/portfolios")) {
          // Portfolios endpoint returns projects the user has added to their
          // Freelancer portfolio, with title, description, and files.
          return new Response(
            JSON.stringify({
              status: "success",
              result: {
                portfolios: {
                  "77124963": [
                    {
                      id: 12062244,
                      title: "AroundU.Social - Location-Based App",
                      description: "Location-based social web app built with MERN stack.",
                      files: [
                        {
                          cdn_url: "//cdn2.f-cdn.com/files/download/123456/screenshot.png",
                          thumbnails: [{ cdn_url: "//cdn6.f-cdn.com/files/download/123456/thumb.jpg" }],
                        },
                      ],
                    },
                    {
                      id: 12418902,
                      title: "Figma to Next.js Landing Page",
                      description: "Pixel-perfect landing page from Figma design.",
                      files: [
                        {
                          cdn_url: "//cdn3.f-cdn.com/files/download/789012/landing.png",
                        },
                      ],
                    },
                  ],
                },
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
          about: string | null;
          skills: string[];
          skillIds: number[];
          portfolio: { title: string; url: string | null; description: string | null }[];
        };
      };
      expect(body.profile.freelancerUsername).toBe("irfan_dev");
      expect(body.profile.name).toBe("Irfan Developer");
      expect(body.profile.title).toBe("React Developer");
      expect(body.profile.hourlyRate).toBe("$35/hr");
      // profile_description=true maps to about; jobs=true maps skill names to skills.
      expect(body.profile.about).toBe("Full-stack developer with 5 years experience.");
      expect(body.profile.skills).toEqual(["JavaScript", "React.js", "Node.js"]);
      expect(body.profile.skillIds).toEqual([9, 759, 500]);
      // Portfolios fetched from a separate /portfolios/ API call, mapped to title/url/description.
      expect(body.profile.portfolio).toHaveLength(2);
      expect(body.profile.portfolio[0]?.title).toBe("AroundU.Social - Location-Based App");
      expect(body.profile.portfolio[0]?.description).toBe("Location-based social web app built with MERN stack.");
      expect(body.profile.portfolio[0]?.url).toBe("https://cdn2.f-cdn.com/files/download/123456/screenshot.png");
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
