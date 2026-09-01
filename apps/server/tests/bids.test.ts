import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

/**
 * Bids flow: submit a bid from an approved proposal to the real Freelancer.com
 * API (stubbed at fetch level), record it in user_bids, list bids, update
 * outcome, and verify auth is required.
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

const PROJECT_ID = 400001;

const projectDetail = {
  id: PROJECT_ID,
  title: "Build a landing page in React",
  description: "I need a modern landing page built with React and Tailwind CSS.",
  preview_description: "Modern React landing page with Tailwind CSS.",
  currency: { code: "USD", name: "US Dollar", sign: "$", exchange_rate: 1.0 },
  budget: { minimum: 500, maximum: 2000, project_type: "fixed" },
  bid_stats: { bid_count: 3, bid_avg: 1200, min_amount: 500, max_amount: 2000 },
  time_submitted: Math.floor(Date.now() / 1000) - 120,
  type: "fixed",
  bidperiod: 7,
  upgrades: { featured: false, urgent: false, sealed: false },
  language: "en",
  jobs: [
    { id: 759, name: "React.js", category: { id: 1, name: "Websites, IT & Software" } },
  ],
  location: { country: { name: "United Kingdom", code: "gb" } },
  owner_info: {
    city: "London",
    country: { name: "United Kingdom", code: "gb" },
    reputation: {
      entire_history: { overall: 0.8, positive: 0.85 },
      role: "employer",
      earnings_score: 0.7,
    },
    status: { payment_verified: true, email_verified: true, profile_complete: true },
    registration_date: 1700000000,
  },
};

const selfResponse = {
  status: "success",
  result: { id: 77124963, username: "owner_user", name: "Test Owner" },
};

const bidPostResponse = {
  status: "success",
  result: { bid_id: 999999 },
};

/** Set up stubs that return a fixed bid response from the Freelancer.com bids endpoint. */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);

      // /self endpoint
      if (url.includes("freelancer.com/api/users/0.1/self")) {
        return new Response(JSON.stringify(selfResponse), { status: 200 });
      }

      // POST /bids
      if (url.includes("freelancer.com/api/projects/0.1/bids") && init?.method === "POST") {
        return new Response(JSON.stringify(bidPostResponse), { status: 200 });
      }

      // Fallback for anything unexpected.
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

  // Stub OpenRouter credential test + Freelancer /self during registration.
  stubFetch();

  // Register the owner user (base url requests go through realFetch).
  const register = await realFetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Owner",
      email: "owner-bids@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  // Save credentials.
  await realFetch(`${baseUrl}/api/credentials/freelancer`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "frl_bids_test_token" }),
  });
  await realFetch(`${baseUrl}/api/credentials/openrouter`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "sk-or-v1-bids-test" }),
  });

  // Save a profile so AI generation is grounded.
  await realFetch(`${baseUrl}/api/profile`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      freelancerUsername: "owner_user",
      name: "Bids Tester",
      title: "Full-stack developer",
      hourlyRate: "$35/hr",
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

  // Seed a job so the bids service can find it by projectId.
  const { getDb } = await import("../src/db/index.js");
  const { jobs } = await import("../src/db/schema.js");
  const jobNow = new Date().toISOString();
  getDb()
    .insert(jobs)
    .values({
      id: `job-${PROJECT_ID}`,
      projectId: PROJECT_ID,
      title: "Build a landing page in React",
      client: "Client in United Kingdom",
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
        summary: "Good match.",
        reasons: ["React.js match"],
        concerns: [],
        recommendedBidLabel: "$1000 – $1500",
        competitorNote: "3 bids so far.",
      }),
      rawData: JSON.stringify({ ...projectDetail, description: projectDetail.description }),
      lastAnalyzedAt: jobNow,
      ignoredAt: null,
      importedAt: jobNow,
      updatedAt: jobNow,
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

describe("bids", () => {
  it("requires authentication", async () => {
    const r = await realFetch(`${baseUrl}/api/bids`);
    expect(r.status).toBe(401);
  });

  it("places a bid from an approved proposal and lists it", async () => {
    stubFetch();
    try {
      // Create a draft proposal via the proposals API.
      const genRes = await realFetch(`${baseUrl}/api/proposals`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}`,
          projectId: PROJECT_ID,
          jobTitle: "Build a landing page in React",
          client: "Client in United Kingdom",
          content: "I'm a full-stack developer with React experience. I can build this landing page with Tailwind CSS in 5 days.",
          bidAmount: 1500,
        }),
      });
      expect(genRes.status).toBe(201);
      const { proposal } = (await genRes.json()) as { proposal: { id: string } };

      // Approve the proposal.
      const approveRes = await realFetch(`${baseUrl}/api/proposals/${proposal.id}/status`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "approved" }),
      });
      expect(approveRes.status).toBe(200);

      // Place the bid.
      const bidRes = await realFetch(`${baseUrl}/api/bids`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          proposalId: proposal.id,
          amount: 1500,
          period: 7,
          milestonePercentage: 50,
        }),
      });
      expect(bidRes.status).toBe(201);
      const { bid } = (await bidRes.json()) as { bid: { id: string; amount: number; status: string } };
      expect(bid.id).toMatch(/^bid-/);
      expect(bid.amount).toBe(1500);
      expect(bid.status).toBe("submitted");

      // List bids and verify.
      const listRes = await realFetch(`${baseUrl}/api/bids`, { headers: authed() });
      expect(listRes.status).toBe(200);
      const { bids } = (await listRes.json()) as { bids: Array<{ id: string; jobTitle: string }> };
      expect(bids.length).toBe(1);
      expect(bids[0]!.jobTitle).toBe("Build a landing page in React");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("allows manual bid on any approved proposal", async () => {
    stubFetch();
    try {
      // Create and approve a second proposal.
      const genRes = await realFetch(`${baseUrl}/api/proposals`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-b`,
          projectId: PROJECT_ID,
          jobTitle: "Build a landing page in React (b)",
          client: "Another Client",
          content: "Experienced React developer ready to build your landing page.",
          bidAmount: 1200,
        }),
      });
      const { proposal } = (await genRes.json()) as { proposal: { id: string } };

      await realFetch(`${baseUrl}/api/proposals/${proposal.id}/status`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "approved" }),
      });

      const bidRes = await realFetch(`${baseUrl}/api/bids`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          proposalId: proposal.id,
          amount: 1200,
          period: 14,
          milestonePercentage: 50,
        }),
      });
      expect(bidRes.status).toBe(201);

      // Now there should be 2 bids.
      const listRes = await realFetch(`${baseUrl}/api/bids`, { headers: authed() });
      const { bids } = (await listRes.json()) as { bids: unknown[] };
      expect(bids.length).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a bid from a non-approved proposal", async () => {
    stubFetch();
    try {
      const genRes = await realFetch(`${baseUrl}/api/proposals`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-c`,
          projectId: PROJECT_ID,
          jobTitle: "Draft proposal for rejection test",
          client: "Client C",
          content: "I can do this project for you.",
          bidAmount: 800,
        }),
      });
      const { proposal } = (await genRes.json()) as { proposal: { id: string } };

      // Do NOT approve — proposal stays in draft.
      const bidRes = await realFetch(`${baseUrl}/api/bids`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          proposalId: proposal.id,
          amount: 800,
          period: 7,
          milestonePercentage: 50,
        }),
      });
      expect(bidRes.status).toBe(400);
      const errBody = (await bidRes.json()) as { error: { code: string } };
      expect(errBody.error.code).toBe("BID_ERROR");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a bid without a valid milestone percentage", async () => {
    stubFetch();
    try {
      // Create and approve a proposal first.
      const genRes = await realFetch(`${baseUrl}/api/proposals`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-milestone`,
          projectId: PROJECT_ID,
          jobTitle: "Milestone validation test",
          client: "Client M",
          content: "I can build this milestone test project.",
          bidAmount: 900,
        }),
      });
      const { proposal } = (await genRes.json()) as { proposal: { id: string } };
      await realFetch(`${baseUrl}/api/proposals/${proposal.id}/status`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "approved" }),
      });

      // Milestone omitted → 400 VALIDATION_ERROR (must be 20–100).
      const missingRes = await realFetch(`${baseUrl}/api/bids`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          proposalId: proposal.id,
          amount: 900,
          period: 7,
        }),
      });
      expect(missingRes.status).toBe(400);
      const missingBody = (await missingRes.json()) as { error: { code: string } };
      expect(missingBody.error.code).toBe("VALIDATION_ERROR");

      // Milestone below the 20 minimum → 400.
      const lowRes = await realFetch(`${baseUrl}/api/bids`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          proposalId: proposal.id,
          amount: 900,
          period: 7,
          milestonePercentage: 10,
        }),
      });
      expect(lowRes.status).toBe(400);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("updates a bid outcome", async () => {
    stubFetch();
    try {
      // Use the first bid from the previous test (still in memory).
      const listRes = await realFetch(`${baseUrl}/api/bids`, { headers: authed() });
      const { bids } = (await listRes.json()) as { bids: Array<{ id: string }> };
      const bidId = bids[bids.length - 1]!.id;

      const outcomeRes = await realFetch(`${baseUrl}/api/bids/${bidId}/outcome`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ outcome: "won" }),
      });
      expect(outcomeRes.status).toBe(200);

      // Verify via list with outcome filter.
      const wonRes = await realFetch(`${baseUrl}/api/bids?outcome=won`, { headers: authed() });
      const { bids: wonBids } = (await wonRes.json()) as { bids: Array<{ id: string; outcome: string }> };
      expect(wonBids.length).toBe(1);
      expect(wonBids[0]!.outcome).toBe("won");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});