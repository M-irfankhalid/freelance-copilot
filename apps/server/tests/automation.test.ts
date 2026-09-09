import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

/**
 * Automation flow: save/retrieve settings, run the auto-bid engine against a
 * stubbed analyzed job, enforce daily cap, and verify pause/resume prevents
 * auto-bidding.
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
let realFetch: typeof fetch;

const PROJECT_ID = 500001;

const selfResponse = {
  status: "success",
  result: { id: 77124963, username: "auto_user", name: "Auto Tester" },
};

const bidPostResponse = {
  status: "success",
  result: { bid_id: 888888 },
};

/**
 * Stubs the Freelancer API at fetch level. The stub tracks how many times the
 * bid POST endpoint was called so tests can assert on it.
 */
let bidPostCallCount: number;

function stubFetch() {
  bidPostCallCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);

      // /self endpoint
      if (url.includes("freelancer.com/api/users/0.1/self")) {
        return new Response(JSON.stringify(selfResponse), { status: 200 });
      }

      // POST /bids — track calls for auto-bid assertions
      if (url.includes("freelancer.com/api/projects/0.1/bids") && init?.method === "POST") {
        bidPostCallCount++;
        return new Response(JSON.stringify(bidPostResponse), { status: 200 });
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

  stubFetch();

  // Register the owner user.
  const register = await realFetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Owner",
      email: "owner-auto@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  // Save credentials.
  await realFetch(`${baseUrl}/api/credentials/freelancer`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "frl_auto_test_token" }),
  });
  await realFetch(`${baseUrl}/api/credentials/openrouter`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "sk-or-v1-auto-test" }),
  });

  // Save a profile.
  await realFetch(`${baseUrl}/api/profile`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      freelancerUsername: "auto_user",
      name: "Auto Tester",
      title: "Full-stack developer",
      hourlyRate: "$40/hr",
      about: "I build React and Node applications.",
      skills: ["React.js", "Node.js"],
      skillIds: [759, 500],
      experience: [],
      portfolio: [],
      certifications: [],
      preferredProjectTypes: ["Fixed price"],
      wants: ["React"],
      notWants: ["crypto"],
      ignoredCountries: [],
      customInstructions: null,
    }),
  });

  // Seed an analyzed job directly in the DB so auto-bid has a candidate.
  const { getDb } = await import("../src/db/index.js");
  const now = new Date().toISOString();
  getDb()
    .insert((await import("../src/db/schema.js")).jobs)
    .values({
      id: `job-${PROJECT_ID}`,
      projectId: PROJECT_ID,
      title: "Auto-bid candidate project",
      client: "Client in UK",
      clientCountry: "United Kingdom",
      budgetLabel: "$500 – $2000",
      skills: "[]",
      postedLabel: "2h ago",
      bidCount: 3,
      avgBidLabel: "$1200",
      matchScore: 90,
      severity: "fair",
      status: "analyzed",
      analysis: JSON.stringify({
        verdict: "good",
        score: 90,
        summary: "Good match for your React skills.",
        reasons: ["React.js is one of your strong skills"],
        concerns: [],
        recommendedBidLabel: "$1000 – $1500",
        competitorNote: "3 bids so far.",
      }),
      rawData: JSON.stringify({
        id: PROJECT_ID,
        title: "Auto-bid candidate project",
        budget: { minimum: 500, maximum: 2000, project_type: "fixed" },
        type: "fixed",
        // A real project blob carries owner_info; payment-verified client so
        // the trust gate admits this candidate for auto-bid.
        owner_info: { status: { payment_verified: true } },
      }),
      lastAnalyzedAt: now,
      ignoredAt: null,
      importedAt: now,
      updatedAt: now,
    })
    .run();

  // Seed an approved proposal linked to that job, so auto-bid can submit it.
  const { proposals } = await import("../src/db/schema.js");
  const proposalId = `prop-auto-${Date.now()}`;
  getDb()
    .insert(proposals)
    .values({
      id: proposalId,
      userId: (await getSessionUserId()),
      jobId: `job-${PROJECT_ID}`,
      projectId: PROJECT_ID,
      jobTitle: "Auto-bid candidate project",
      client: "Client in UK",
      bidAmount: 1200,
      status: "approved",
      content: "Hello, I'm an experienced React developer who can build this project for you.",
      competitorNote: "3 bids so far.",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  vi.unstubAllGlobals();
});

afterAll(() => {
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

// Helper to get the current owner's user id from the DB.
async function getSessionUserId(): Promise<string> {
  const { getDb } = await import("../src/db/index.js");
  const { users } = await import("../src/db/schema.js");
  const row = getDb().select({ id: users.id }).from(users).limit(1).get();
  return row!.id;
}

describe("automation settings", () => {
  it("creates default settings on first retrieval", async () => {
    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation`, { headers: authed() });
      expect(res.status).toBe(200);
      const { settings } = (await res.json()) as { settings: Record<string, unknown> };
      // Defaults from the service
      expect(settings.autobidEnabled).toBe(false);
      expect(settings.minMatchScore).toBe(80);
      expect(settings.dailyCap).toBe(5);
      expect(settings.paused).toBe(false);
      expect(settings.bidsToday).toBe(0);
      // Pre-analysis screening rules all start ON.
      expect(settings.rejectStaleJobs).toBe(true);
      expect(settings.rejectIgnoredCountries).toBe(true);
      expect(settings.rejectBadReputation).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("updates settings via PUT", async () => {
    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          autobidEnabled: true,
          minMatchScore: 70,
          dailyCap: 3,
          rejectStaleJobs: false,
          rejectIgnoredCountries: false,
          rejectBadReputation: false,
        }),
      });
      expect(res.status).toBe(200);
      const { settings } = (await res.json()) as {
        settings: {
          autobidEnabled: boolean;
          minMatchScore: number;
          rejectStaleJobs: boolean;
          rejectIgnoredCountries: boolean;
          rejectBadReputation: boolean;
        };
      };
      expect(settings.autobidEnabled).toBe(true);
      expect(settings.minMatchScore).toBe(70);
      expect(settings.rejectStaleJobs).toBe(false);
      expect(settings.rejectIgnoredCountries).toBe(false);
      expect(settings.rejectBadReputation).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("auto-bid engine", () => {
  it("places an auto-bid when settings are enabled and a candidate job exists", async () => {
    stubFetch();
    try {
      // Settings are already enabled from the previous test.
      const checkRes = await realFetch(`${baseUrl}/api/automation/auto-bid-check`, {
        method: "POST",
        headers: authed(),
      });
      expect(checkRes.status).toBe(200);

      // The bid POST should have been called exactly once.
      expect(bidPostCallCount).toBe(1);

      // A user_bid should have been recorded in the DB with via: "auto".
      const listRes = await realFetch(`${baseUrl}/api/bids`, { headers: authed() });
      const { bids } = (await listRes.json()) as { bids: Array<{ via: string; amount: number }> };
      expect(bids.length).toBe(1);
      expect(bids[0]!.via).toBe("auto");
      // Amount comes from the project's minimum budget ($500, not below minBid).
      expect(bids[0]!.amount).toBe(500);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("pauses the worker and prevents auto-bid", async () => {
    stubFetch();
    try {
      // Pause.
      const pauseRes = await realFetch(`${baseUrl}/api/automation/pause`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ paused: true }),
      });
      expect(pauseRes.status).toBe(200);

      const before = bidPostCallCount;

      // Run auto-bid check — should skip.
      const checkRes = await realFetch(`${baseUrl}/api/automation/auto-bid-check`, {
        method: "POST",
        headers: authed(),
      });
      expect(checkRes.status).toBe(200);

      // No new bid should have been placed.
      expect(bidPostCallCount).toBe(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resumes the worker after un-pausing", async () => {
    stubFetch();
    try {
      // Unpause.
      const resumeRes = await realFetch(`${baseUrl}/api/automation/pause`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ paused: false }),
      });
      expect(resumeRes.status).toBe(200);

      const before = bidPostCallCount;

      // The previous job already has a user_bid, so it won't bid again.
      // Create another candidate job to verify bidding resumes.
      const { getDb } = await import("../src/db/index.js");
      const { jobs } = await import("../src/db/schema.js");
      const now = new Date().toISOString();
      getDb()
        .insert(jobs)
        .values({
          id: `job-${PROJECT_ID + 1}`,
          projectId: PROJECT_ID + 1,
          title: "Second auto-bid candidate",
          client: "Client in US",
          clientCountry: "United States",
          budgetLabel: "$300 – $1500",
          skills: "[]",
          postedLabel: "1h ago",
          bidCount: 2,
          avgBidLabel: "$800",
          matchScore: 85,
          severity: "fair",
          status: "analyzed",
          analysis: JSON.stringify({
            verdict: "good",
            score: 85,
            summary: "Good match.",
            reasons: ["React.js match"],
            concerns: [],
            recommendedBidLabel: "$800 – $1200",
            competitorNote: "2 bids so far.",
          }),
          rawData: JSON.stringify({
            id: PROJECT_ID + 1,
            title: "Second auto-bid candidate",
            budget: { minimum: 300, maximum: 1500, project_type: "fixed" },
            type: "fixed",
            owner_info: { status: { payment_verified: true } },
          }),
          lastAnalyzedAt: now,
          ignoredAt: null,
          importedAt: now,
          updatedAt: now,
        })
        .run();

      const userId = await getSessionUserId();
      const { proposals } = await import("../src/db/schema.js");
      getDb()
        .insert(proposals)
        .values({
          id: `prop-auto-2-${Date.now()}`,
          userId,
          jobId: `job-${PROJECT_ID + 1}`,
          projectId: PROJECT_ID + 1,
          jobTitle: "Second auto-bid candidate",
          client: "Client in US",
          bidAmount: 1000,
          status: "approved",
          content: "Hello, I'm an experienced React developer who can build this project for you.",
          competitorNote: "2 bids so far.",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // Run auto-bid check — should place a bid on the new job.
      const checkRes = await realFetch(`${baseUrl}/api/automation/auto-bid-check`, {
        method: "POST",
        headers: authed(),
      });
      expect(checkRes.status).toBe(200);

      expect(bidPostCallCount).toBe(before + 1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops bidding at the daily cap without pausing the worker", async () => {
    stubFetch();
    try {
      // Set dailyCap to 2 (we already placed 2 bids above).
      await realFetch(`${baseUrl}/api/automation`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ dailyCap: 2 }),
      });

      const before = bidPostCallCount;

      const checkRes = await realFetch(`${baseUrl}/api/automation/auto-bid-check`, {
        method: "POST",
        headers: authed(),
      });
      expect(checkRes.status).toBe(200);

      // Should not have placed any more bids (cap of 2 was reached, already placed 2).
      expect(bidPostCallCount).toBe(before);

      // The cap gates bidding ONLY — the worker must NOT be paused, so
      // scanning/analyzing/drafting keep running.
      const settingsRes = await realFetch(`${baseUrl}/api/automation`, { headers: authed() });
      const { settings } = (await settingsRes.json()) as { settings: { paused: boolean } };
      expect(settings.paused).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lists automation run history", async () => {
    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation/runs`, { headers: authed() });
      expect(res.status).toBe(200);
      const { runs } = (await res.json()) as { runs: Array<{ action: string; detail: string; result: string }> };
      expect(runs.length).toBeGreaterThan(0);
      // Should have logged auto-bid attempts and skips.
      const actions = runs.map((r) => r.action);
      expect(actions).toContain("Auto-bid placed");
      expect(actions).toContain("Auto-bid check");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});