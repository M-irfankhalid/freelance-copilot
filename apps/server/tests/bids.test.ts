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
/** A second job, seeded with no bid rows — exercises the update path for a bid
 *  this app never placed. */
const UNBID_PROJECT_ID = 400002;

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

/** The bid id Freelancer.com reports back, and what a stubbed update targets. */
const FREELANCER_BID_ID = 999999;

/** Our own bidder id, as the stubbed /self response reports it. */
const BIDDER_ID = 77124963;

/** One bid on a project, in the shape the project-bids endpoint returns. */
const projectBid = {
  id: 4242,
  bidder: { id: BIDDER_ID, username: "owner_user" },
  amount: 1300,
  description: "A bid placed outside the app.",
};

/** Every upstream call the stub saw, so a test can prove what did not happen. */
interface StubCalls {
  placed: number;
  updated: Array<{ url: string; method: string; body: unknown }>;
  projectBids: number;
}

/**
 * Stub the Freelancer.com endpoints used by the bids flow.
 *
 * Call counts are returned because several tests assert that something was NOT
 * called — when a request is expected to fail, a throw at that point would look
 * the same as a call that never happened, so the count is the only honest check.
 */
function stubFetch(options: {
  projectBids?: unknown[];
  updateStatus?: number;
} = {}): StubCalls {
  const calls: StubCalls = { placed: 0, updated: [], projectBids: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);

      // /self endpoint
      if (url.includes("freelancer.com/api/users/0.1/self")) {
        return new Response(JSON.stringify(selfResponse), { status: 200 });
      }

      // PUT /bids/{id}/ — update an existing bid. Matched before the POST
      // branch below, whose `includes` would also match this URL.
      if (/freelancer\.com\/api\/projects\/0\.1\/bids\/\d+\//.test(url)) {
        calls.updated.push({
          url,
          method: init?.method ?? "GET",
          body: JSON.parse(String(init?.body ?? "null")) as unknown,
        });
        const status = options.updateStatus ?? 200;
        if (status !== 200) {
          return new Response(
            JSON.stringify({ status: "error", error: { message: "Bid not found" } }),
            { status }
          );
        }
        return new Response(JSON.stringify({ status: "success", result: {} }), {
          status: 200,
        });
      }

      // GET /projects/{id}/bids/ — the user-clicked Find lookup.
      if (
        /freelancer\.com\/api\/projects\/0\.1\/projects\/\d+\/bids\//.test(url) &&
        (init?.method ?? "GET") === "GET"
      ) {
        calls.projectBids++;
        return new Response(
          JSON.stringify({ status: "success", result: { bids: options.projectBids ?? [] } }),
          { status: 200 }
        );
      }

      // POST /bids
      if (url.includes("freelancer.com/api/projects/0.1/bids") && init?.method === "POST") {
        calls.placed++;
        return new Response(JSON.stringify(bidPostResponse), { status: 200 });
      }

      // GET /projects/{id} — the job detail view re-reads the project from
      // Freelancer rather than trusting the stored copy.
      const projectMatch = /freelancer\.com\/api\/projects\/0\.1\/projects\/(\d+)(?:\?|$)/.exec(url);
      if (projectMatch !== null) {
        return new Response(
          JSON.stringify({
            status: "success",
            result: { ...projectDetail, id: Number(projectMatch[1]) },
          }),
          { status: 200 }
        );
      }

      // Fallback for anything unexpected.
      return new Response("not found", { status: 404 });
    })
  );
  return calls;
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

  // A second job with no bids against it. Nothing in this suite places a bid on
  // it, so updating here covers a bid the app never placed.
  getDb()
    .insert(jobs)
    .values({
      id: `job-${UNBID_PROJECT_ID}`,
      projectId: UNBID_PROJECT_ID,
      title: "Migrate a legacy PHP site to Node",
      client: "Client in Ireland",
      clientCountry: "Ireland",
      budgetLabel: "$1000 – $3000",
      skills: "[]",
      postedLabel: "3h ago",
      bidCount: 0,
      avgBidLabel: "—",
      matchScore: 85,
      severity: "fair",
      status: "analyzed",
      analysis: null,
      rawData: JSON.stringify({ ...projectDetail, id: UNBID_PROJECT_ID, bidperiod: 10 }),
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

describe("update bid", () => {
  it("requires authentication", async () => {
    const update = await realFetch(`${baseUrl}/api/bids/project/${PROJECT_ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        freelancerBidId: FREELANCER_BID_ID,
        description: "x",
        amount: 100,
        milestonePercentage: 50,
      }),
    });
    expect(update.status).toBe(401);

    const find = await realFetch(`${baseUrl}/api/bids/project/${PROJECT_ID}/find`);
    expect(find.status).toBe(401);
  });

  it("captures Freelancer's bid id when a bid is placed", async () => {
    const calls = stubFetch();
    try {
      // A third proposal on the shared project, so this test owns its bid.
      const genRes = await realFetch(`${baseUrl}/api/proposals`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-capture`,
          projectId: PROJECT_ID,
          jobTitle: "Bid id capture test",
          client: "Client Capture",
          content: "I can deliver this project.",
          bidAmount: 1100,
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
          amount: 1100,
          period: 7,
          milestonePercentage: 50,
        }),
      });
      expect(bidRes.status).toBe(201);
      expect(calls.placed).toBe(1);

      // The id comes back from the response, not from anything we made up.
      const { bid } = (await bidRes.json()) as { bid: { freelancerBidId: number | null } };
      expect(bid.freelancerBidId).toBe(FREELANCER_BID_ID);

      const listRes = await realFetch(`${baseUrl}/api/bids`, { headers: authed() });
      const { bids } = (await listRes.json()) as {
        bids: Array<{ freelancerBidId: number | null }>;
      };
      expect(bids.map((b) => b.freelancerBidId)).toContain(FREELANCER_BID_ID);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("updates the bid on Freelancer.com and keeps the local record in step", async () => {
    const calls = stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/bids/project/${PROJECT_ID}`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          freelancerBidId: FREELANCER_BID_ID,
          description: "Revised: I can start on Monday.",
          amount: 1750,
          milestonePercentage: 40,
        }),
      });
      expect(res.status).toBe(200);

      // The request went to Freelancer's own bid, by id, as a PUT.
      expect(calls.updated).toHaveLength(1);
      const call = calls.updated[0]!;
      expect(call.method).toBe("PUT");
      expect(call.url).toContain(`/projects/0.1/bids/${FREELANCER_BID_ID}/`);

      // The endpoint takes snake_case; our API takes camelCase. Translating
      // between them is the easiest thing to get wrong here.
      const body = call.body as Record<string, unknown>;
      expect(body["milestone_percentage"]).toBe(40);
      expect(body["milestonePercentage"]).toBeUndefined();
      expect(body["description"]).toBe("Revised: I can start on Monday.");
      expect(body["amount"]).toBe(1750);
      // The endpoint does not accept a period; sending one would be invented data.
      expect(body["period"]).toBeUndefined();

      const { bid } = (await res.json()) as {
        bid: {
          amount: number;
          milestonePercentage: number;
          description: string;
          freelancerBidId: number;
        };
      };
      expect(bid.amount).toBe(1750);
      expect(bid.milestonePercentage).toBe(40);
      expect(bid.description).toBe("Revised: I can start on Monday.");
      expect(bid.freelancerBidId).toBe(FREELANCER_BID_ID);

      // No lookup was made on the user's behalf: the id was already known.
      expect(calls.projectBids).toBe(0);

      // The job page prefills from the stored bid, so it must reflect the edit.
      const jobRes = await realFetch(`${baseUrl}/api/jobs/${PROJECT_ID}`, { headers: authed() });
      const { job } = (await jobRes.json()) as {
        job: { myBid: { freelancerBidId: number | null; amount: number } | null };
      };
      expect(job.myBid?.freelancerBidId).toBe(FREELANCER_BID_ID);
      expect(job.myBid?.amount).toBe(1750);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("records a bid the app never placed", async () => {
    const calls = stubFetch();
    try {
      // Nothing in this suite bid on UNBID_PROJECT_ID, so there is no row yet.
      const res = await realFetch(`${baseUrl}/api/bids/project/${UNBID_PROJECT_ID}`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          freelancerBidId: 555001,
          description: "Bid placed by hand on Freelancer.com.",
          amount: 2400,
          milestonePercentage: 30,
        }),
      });
      expect(res.status).toBe(200);
      expect(calls.updated).toHaveLength(1);

      // It is remembered, with the id, so the next update needs no typing.
      const jobRes = await realFetch(`${baseUrl}/api/jobs/${UNBID_PROJECT_ID}`, {
        headers: authed(),
      });
      const { job } = (await jobRes.json()) as {
        job: {
          myBid: { freelancerBidId: number | null; amount: number; description: string } | null;
        };
      };
      expect(job.myBid?.freelancerBidId).toBe(555001);
      expect(job.myBid?.amount).toBe(2400);
      expect(job.myBid?.description).toBe("Bid placed by hand on Freelancer.com.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails loudly on a bid id Freelancer.com does not know, saving nothing", async () => {
    const calls = stubFetch({ updateStatus: 404 });
    try {
      const before = await realFetch(`${baseUrl}/api/jobs/${UNBID_PROJECT_ID}`, {
        headers: authed(),
      });
      const beforeBody = (await before.json()) as { job: { myBid: { amount: number } | null } };
      // The read has to have actually landed, or both sides below would be
      // undefined and the comparison would pass for the wrong reason.
      expect(typeof beforeBody.job.myBid?.amount).toBe("number");

      const res = await realFetch(`${baseUrl}/api/bids/project/${UNBID_PROJECT_ID}`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          freelancerBidId: 987654,
          description: "This should never be stored.",
          amount: 9999,
          milestonePercentage: 50,
        }),
      });
      expect(res.status).toBe(404);
      const errBody = (await res.json()) as { error: { code: string; message: string } };
      expect(errBody.error.code).toBe("NOT_FOUND");
      // The upstream message is surfaced, not swallowed into a bare status.
      expect(errBody.error.message).toMatch(/no bid with id 987654/);

      // The attempt reached Freelancer — a throw before the call would look the
      // same from the response alone.
      expect(calls.updated).toHaveLength(1);

      const after = await realFetch(`${baseUrl}/api/jobs/${UNBID_PROJECT_ID}`, {
        headers: authed(),
      });
      const afterBody = (await after.json()) as { job: { myBid: { amount: number } | null } };
      expect(afterBody.job.myBid?.amount).toBe(beforeBody.job.myBid?.amount);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects an out-of-range milestone before calling Freelancer", async () => {
    const calls = stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/bids/project/${UNBID_PROJECT_ID}`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          freelancerBidId: 555001,
          description: "Milestone out of range.",
          amount: 2400,
          milestonePercentage: 10,
        }),
      });
      expect(res.status).toBe(400);
      const errBody = (await res.json()) as { error: { code: string } };
      expect(errBody.error.code).toBe("VALIDATION_ERROR");
      expect(calls.updated).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("finds the user's own bid only when the user asks", async () => {
    const calls = stubFetch({ projectBids: [projectBid] });
    try {
      const res = await realFetch(`${baseUrl}/api/bids/project/${PROJECT_ID}/find`, {
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const { bid } = (await res.json()) as {
        bid: { id: number; amount: number | null; description: string | null } | null;
      };
      expect(bid?.id).toBe(4242);
      expect(bid?.amount).toBe(1300);
      expect(bid?.description).toBe("A bid placed outside the app.");
      // Exactly one lookup, and only because Find was pressed.
      expect(calls.projectBids).toBe(1);
      // Finding is not the same as updating.
      expect(calls.updated).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports plainly when no bid of the user's is on the project", async () => {
    // A project whose bids all belong to somebody else.
    const calls = stubFetch({
      projectBids: [{ id: 4243, bidder: { id: 1 }, amount: 900 }],
    });
    try {
      const res = await realFetch(`${baseUrl}/api/bids/project/${PROJECT_ID}/find`, {
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const { bid } = (await res.json()) as { bid: unknown };
      expect(bid).toBeNull();
      expect(calls.projectBids).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});