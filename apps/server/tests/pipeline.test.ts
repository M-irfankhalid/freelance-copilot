import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";

/**
 * Pipeline orchestration: POST /api/automation/run-pipeline exercises the full
 * poll → analyze → draft flow against stubbed Freelancer.com and OpenRouter APIs.
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

const PROJECT_ID = 600001;
const BIDDER_ID = 77124963;

/** When set, the bid POST for this project returns an upstream rejection. */
let failBidProjectId: number | null = null;

/** Body of the last bid POSTed to Freelancer.com, for delivery-time assertions. */
let lastBidBody: Record<string, unknown> | null = null;

/** Project returned by Freelancer.com search and getJobById. */
const projectDetail = {
  id: PROJECT_ID,
  title: "React dashboard for SaaS analytics",
  description: "I need a modern admin dashboard built with React and Node.js. The dashboard should display real-time analytics for a SaaS product.",
  preview_description: "Modern React dashboard for SaaS analytics with real-time data.",
  currency: { code: "USD", name: "US Dollar", sign: "$", exchange_rate: 1.0 },
  budget: { minimum: 500, maximum: 2000, project_type: "fixed" },
  bid_stats: { bid_count: 3, bid_avg: 1200, min_amount: 500, max_amount: 2000 },
  time_submitted: Math.floor(Date.now() / 1000) - 7200,
  type: "fixed",
  bidperiod: 7,
  upgrades: { featured: false, urgent: false, sealed: false },
  language: "en",
  jobs: [
    { id: 759, name: "React.js", category: { id: 1, name: "Websites, IT & Software" } },
    { id: 500, name: "Node.js", category: { id: 1, name: "Websites, IT & Software" } },
  ],
  location: { country: { name: "United Kingdom", code: "gb" } },
  owner_info: {
    city: "London",
    country: { name: "United Kingdom", code: "gb" },
    reputation: { entire_history: { overall: 0.8, positive: 0.85 }, role: "employer" },
    status: { payment_verified: true, email_verified: true, profile_complete: true },
    registration_date: 1700000000,
  },
};

const selfResponse = {
  status: "success",
  result: { id: BIDDER_ID, username: "pipeline_user", name: "Pipeline Tester" },
};

const searchResponse: {
  status: string;
  result: { projects: Array<(typeof projectDetail) & { id: number }> };
} = {
  status: "success",
  result: {
    projects: [projectDetail],
  },
};

/** Second project used by the auto-bid-in-run test; added to searchResponse there. */
const projectDetail2 = {
  ...projectDetail,
  id: PROJECT_ID + 1,
  title: "React component library build",
  description: "Build a reusable React component library with TypeScript and tests.",
  preview_description: "Reusable React component library with TypeScript.",
  budget: { minimum: 400, maximum: 1800, project_type: "fixed" },
  time_submitted: Math.floor(Date.now() / 1000) - 3600,
};

const bidsResponse = {
  status: "success",
  result: { bids: [] },
};

/**
 * The gate's answer. `deliveryDays` and `bidAmount` are always present here so
 * the same stub serves both settings: they are read only when the user has AI
 * selection on, and ignored otherwise.
 */
const openRouterRelevancyResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          score: 92,
          reason: "Excellent match for your React and Node.js skills with a well-scoped SaaS analytics dashboard.",
          deliveryDays: 1,
          bidAmount: 600,
        }),
      },
    },
  ],
};

function proposalResponse(userPrompt: string) {
  const amount = userPrompt.match(/Bid amount to quote: \$([\d,]+)(\/hour| fixed price)/);
  const delivery = userPrompt.match(/Delivery to quote: (\d+) days?/);
  let commercial = "";
  if (amount && delivery) {
    commercial = ` I can deliver the first working dashboard in ${delivery[1]} days for $${amount[1]}${amount[2]}.`;
  } else if (amount) {
    commercial = ` I can deliver the first working dashboard for $${amount[1]}${amount[2]}.`;
  } else if (delivery) {
    commercial = ` I can deliver the first working dashboard in ${delivery[1]} days.`;
  }

  return {
    choices: [
      {
        message: {
          content:
            "Your analytics dashboard needs a dependable data path from ingestion through the charts your team uses. I would start by mapping the event sources and the PostgreSQL schema, then build a queue-based ingestion layer so bursts do not overload the database. Next I would implement the React dashboard shell, connect live updates, and add loading, empty, and error states before polishing the views. I have built React and PostgreSQL dashboards with live chart updates, including the data pipeline and per-account filtering described in my portfolio. I would verify the dashboard against a realistic event volume, document the ingestion checks, and leave a short runbook so your team can operate it confidently." +
            commercial +
            " Can we start with a short call to confirm the event sources and the first chart you need live?",
        },
      },
    ],
  };
}

/**
 * Stub everything except server-local requests. Distinguishes between analysis
 * and proposal calls by checking the user prompt for "Analyze the job" vs
 * "Write a proposal".
 */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      // Let server-local calls pass through.
      if (url.startsWith(baseUrl)) return realFetch(input, init);

      // Freelancer.com /self
      if (url.includes("freelancer.com/api/users/0.1/self")) {
        return new Response(JSON.stringify(selfResponse), { status: 200 });
      }

      // OpenRouter key verification endpoint (called by saveCredential → testOpenRouterKey)
      if (url.includes("openrouter.ai/api/v1/key")) {
        return new Response(JSON.stringify({ data: { label: "test-key", usage: 0, limit: 100 } }), { status: 200 });
      }

      // Freelancer.com search
      if (url.includes("freelancer.com/api/projects/0.1/projects/active")) {
        return new Response(JSON.stringify(searchResponse), { status: 200 });
      }

      // Freelancer.com getJobById — return the matching project from search results
      if (
        url.includes("freelancer.com/api/projects/0.1/projects/") &&
        !url.includes("/bids") &&
        !url.includes("/active")
      ) {
        // Take the id from the last "projects/" segment (a naive
        // /projects\/(\d+)/ match would catch the "0" in "0.1/projects/").
        const id = Number(url.split("projects/").pop()?.match(/^\d+/)?.[0]);
        const project = searchResponse.result.projects.find((p) => p.id === id);
        if (project) {
          return new Response(JSON.stringify({ status: "success", result: project }), { status: 200 });
        }
      }

      // Freelancer.com getBidsForProject
      if (url.includes("freelancer.com/api/projects/0.1/projects/") && url.includes("/bids")) {
        return new Response(JSON.stringify(bidsResponse), { status: 200 });
      }

      // Freelancer.com POST /bids
      if (url.includes("freelancer.com/api/projects/0.1/bids") && init?.method === "POST") {
        let projectId: number | null = null;
        try {
          const body = JSON.parse(init?.body as string ?? "{}") as { project_id?: number };
          projectId = body.project_id ?? null;
          lastBidBody = body as Record<string, unknown>;
        } catch {
          // fall through with no project id
        }
        if (projectId !== null && projectId === failBidProjectId) {
          return new Response(
            JSON.stringify({
              status: "error",
              message: "You must sign an NDA before bidding on this project.",
            }),
            { status: 400 }
          );
        }
        return new Response(JSON.stringify({ status: "success", result: { bid_id: 999999 } }), { status: 200 });
      }

      // OpenRouter chat completions — distinguish relevance vs proposal by prompt.
      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        try {
          const body = JSON.parse(init?.body as string ?? "{}") as {
            messages: Array<{ role: string; content: string }>;
          };
          const userPrompt = body.messages?.find((m) => m.role === "user")?.content ?? "";
          if (userPrompt.includes("relevance screener")) {
            return new Response(JSON.stringify(openRouterRelevancyResponse), { status: 200 });
          }
          if (userPrompt.includes("=== VERIFIED PROFILE FACTS ===")) {
            return new Response(JSON.stringify(proposalResponse(userPrompt)), { status: 200 });
          }
        } catch {
          // fall through
        }
        // Default: return relevancy response
        return new Response(JSON.stringify(openRouterRelevancyResponse), { status: 200 });
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
      email: "owner-pipeline@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  // Save credentials.
  await realFetch(`${baseUrl}/api/credentials/freelancer`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "frl_pipeline_test_token" }),
  });
  await realFetch(`${baseUrl}/api/credentials/openrouter`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "sk-or-v1-pipeline-test" }),
  });

  // Save a profile.
  await realFetch(`${baseUrl}/api/profile`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      freelancerUsername: "pipeline_user",
      name: "Pipeline Tester",
      title: "Full-stack developer",
      hourlyRate: "$40/hr",
      about: "I build React and Node applications.",
      skills: ["React.js", "Node.js"],
      skillIds: [759, 500],
      preferredProjectTypes: ["Fixed price"],
      wants: ["React"],
      notWants: ["crypto"],
      ignoredCountries: [],
      customInstructions: null,
    }),
  });

  vi.unstubAllGlobals();
});

afterAll(() => {
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

describe("pipeline run", () => {
  it("polls and analyzes a new job, but drafts nothing while auto-bid is off", async () => {
    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation/run-pipeline`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);

      const result = (await res.json()) as {
        status: string;
        jobsFound: number;
        analyzed: number;
        drafted: number;
        bidsPlaced: number;
      };
      expect(result.status).toBe("ok");
      expect(result.jobsFound).toBe(1);
      expect(result.analyzed).toBe(1);
      // Auto-bid is off, so no proposals are auto-written — the user writes
      // proposals and places bids manually.
      expect(result.drafted).toBe(0);
      expect(result.bidsPlaced).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stores the polled job in the DB with raw data", async () => {
    const { getDb: db } = await import("../src/db/index.js");
    const { jobs } = await import("../src/db/schema.js");
    const row = db()
      .select()
      .from(jobs)
      .where(eq(jobs.projectId, PROJECT_ID))
      .get();
    expect(row).toBeDefined();
    expect(row!.title).toContain("React dashboard");
    expect(row!.rawData).toBeTruthy();
  });

  it("analyzes the job — status updated, match score set, analysis stored", async () => {
    const { getDb: db } = await import("../src/db/index.js");
    const { jobs } = await import("../src/db/schema.js");
    const row = db()
      .select()
      .from(jobs)
      .where(eq(jobs.projectId, PROJECT_ID))
      .get();
    expect(row!.status).toBe("analyzed");
    expect(row!.matchScore).toBe(92);
    const analysis = JSON.parse(row!.analysis ?? "{}");
    expect(analysis.verdict).toBe("strong");
    expect(analysis.score).toBe(92);
  });

  it("drafts and auto-bids the analyzed job once auto-bid is enabled", async () => {
    // Enable auto-bid below the job's 92 score so it qualifies.
    const settingsRes = await realFetch(`${baseUrl}/api/automation`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ autobidEnabled: true, minMatchScore: 70, dailyCap: 5 }),
    });
    expect(settingsRes.status).toBe(200);

    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation/run-pipeline`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);

      const result = (await res.json()) as {
        status: string;
        jobsFound: number;
        analyzed: number;
        drafted: number;
        bidsPlaced: number;
      };
      expect(result.status).toBe("ok");
      // The job was already analyzed; now it gets a proposal and a bid.
      expect(result.jobsFound).toBe(1);
      expect(result.analyzed).toBe(0);
      expect(result.drafted).toBe(1);
      expect(result.bidsPlaced).toBe(1);

      // The proposal was auto-approved so the auto-bid engine could place it,
      // and it carries grounded content about the actual project.
      const { getDb: db } = await import("../src/db/index.js");
      const { proposals } = await import("../src/db/schema.js");
      const row = db()
        .select()
        .from(proposals)
        .where(eq(proposals.projectId, PROJECT_ID))
        .get();
      expect(row).toBeDefined();
      expect(row!.status).toBe("approved");
      expect(row!.content).toContain("React");
      expect(row!.content.length).toBeGreaterThan(50);

      // AI timeline selection is off, so the bid quotes the preferred 4 days —
      // the same number auto-bid used before the setting existed.
      expect(lastBidBody?.["period"]).toBe(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips the pipeline when paused", async () => {
    // Pause the worker.
    await realFetch(`${baseUrl}/api/automation/pause`, {
      method: "POST",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ paused: true }),
    });

    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation/run-pipeline`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const result = (await res.json()) as { status: string };
      expect(result.status).toBe("skipped");
    } finally {
      vi.unstubAllGlobals();
    }

    // Unpause for subsequent tests.
    await realFetch(`${baseUrl}/api/automation/pause`, {
      method: "POST",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ paused: false }),
    });
  });

  it("does not re-draft a job that already has a proposal", async () => {
    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation/run-pipeline`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const result = (await res.json()) as {
        status: string;
        drafted: number;
        bidsPlaced: number;
      };
      expect(result.status).toBe("ok");
      // The job already has a proposal and a bid, so nothing is drafted or bid.
      expect(result.drafted).toBe(0);
      expect(result.bidsPlaced).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("auto-bids on a fresh job in the same run when auto-bid is enabled", async () => {
    // Enable auto-bid below the relevancy score so the new job qualifies.
    const settingsRes = await realFetch(`${baseUrl}/api/automation`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ autobidEnabled: true, minMatchScore: 70, dailyCap: 5 }),
    });
    expect(settingsRes.status).toBe(200);

    // The new project is returned by the next search.
    searchResponse.result.projects.push(projectDetail2);

    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation/run-pipeline`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);

      const result = (await res.json()) as {
        status: string;
        jobsFound: number;
        analyzed: number;
        drafted: number;
        bidsPlaced: number;
      };
      expect(result.status).toBe("ok");
      expect(result.jobsFound).toBe(2);
      // Only the second project is new — analyzed, drafted, and bid on.
      expect(result.analyzed).toBe(1);
      expect(result.drafted).toBe(1);
      expect(result.bidsPlaced).toBe(1);

      // The proposal was auto-approved so the auto-bid engine could place it.
      const { eq } = await import("drizzle-orm");
      const { getDb } = await import("../src/db/index.js");
      const { proposals, userBids } = await import("../src/db/schema.js");
      const proposal = getDb()
        .select()
        .from(proposals)
        .where(eq(proposals.projectId, PROJECT_ID + 1))
        .get();
      expect(proposal?.status).toBe("approved");

      const bid = getDb()
        .select()
        .from(userBids)
        .where(eq(userBids.projectId, PROJECT_ID + 1))
        .get();
      expect(bid?.via).toBe("auto");
      // Amount comes from the project's minimum budget ($400, clamped to minBid $500).
      expect(bid?.amount).toBe(500);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks a failed auto-bid so it is never retried, and surfaces it in matches", async () => {
    // Enable auto-bid below the job's relevancy score so the fresh project qualifies.
    const settingsRes = await realFetch(`${baseUrl}/api/automation`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ autobidEnabled: true, minMatchScore: 70, dailyCap: 5 }),
    });
    expect(settingsRes.status).toBe(200);

    // A fresh project whose bid the upstream rejects — the common case where a
    // freelancer must sign an NDA (or similar) before bidding.
    const failProject = {
      ...projectDetail,
      id: PROJECT_ID + 2,
      title: "React dashboard with NDA required",
      description: "I need a React dashboard built. You must sign an NDA before bidding.",
      preview_description: "React dashboard, NDA required before bidding.",
      budget: { minimum: 600, maximum: 3000, project_type: "fixed" },
      time_submitted: Math.floor(Date.now() / 1000) - 1800,
    };
    searchResponse.result.projects.push(failProject);
    failBidProjectId = failProject.id;

    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation/run-pipeline`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const result = (await res.json()) as {
        status: string;
        jobsFound: number;
        analyzed: number;
        drafted: number;
        bidsPlaced: number;
      };
      expect(result.status).toBe("ok");
      expect(result.jobsFound).toBe(3);
      // The fresh project is analyzed and drafted, but the bid is rejected.
      expect(result.analyzed).toBe(1);
      expect(result.drafted).toBe(1);
      expect(result.bidsPlaced).toBe(0);

      // The job is marked so the auto engine never retries it, with the reason kept.
      const { getDb: db } = await import("../src/db/index.js");
      const { jobs } = await import("../src/db/schema.js");
      const row = db()
        .select()
        .from(jobs)
        .where(eq(jobs.projectId, failProject.id))
        .get();
      expect(row?.autoBidFailedAt).toBeTruthy();
      expect(row?.autoBidError).toContain("NDA");

      // The failure is visible in the matches list so the user handles it manually.
      const matchesRes = await realFetch(`${baseUrl}/api/jobs/matches`, {
        method: "GET",
        headers: authed(),
      });
      expect(matchesRes.status).toBe(200);
      const { matches } = (await matchesRes.json()) as {
        matches: Array<{ jobId: string; bidFailed: boolean; bidError: string | null }>;
      };
      const failedMatch = matches.find((m) => m.jobId === String(failProject.id));
      expect(failedMatch?.bidFailed).toBe(true);
      expect(failedMatch?.bidError).toContain("NDA");

      // A second run does NOT retry the failed bid — no draft, no bid attempt.
      const again = await realFetch(`${baseUrl}/api/automation/run-pipeline`, {
        method: "POST",
        headers: authed(),
      });
      expect(again.status).toBe(200);
      const result2 = (await again.json()) as {
        analyzed: number;
        drafted: number;
        bidsPlaced: number;
      };
      expect(result2.analyzed).toBe(0);
      expect(result2.drafted).toBe(0);
      expect(result2.bidsPlaced).toBe(0);
    } finally {
      failBidProjectId = null;
      vi.unstubAllGlobals();
    }
  });

  it("bids the delivery time the gate picked when AI timeline selection is on", async () => {
    const settingsRes = await realFetch(`${baseUrl}/api/automation`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        autobidEnabled: true,
        minMatchScore: 70,
        // Generous: earlier tests in this file have already spent bids today.
        dailyCap: 10,
        aiDeliveryTimeline: true,
        preferredDeliveryDays: 21,
        deliveryTimelineOptions: [1, 3, 5, 7, 10],
      }),
    });
    expect(settingsRes.status).toBe(200);

    const timelineProject = {
      ...projectDetail,
      id: PROJECT_ID + 4,
      title: "React bug fix on an existing dashboard",
      description: "Small React fix: a broken chart tooltip on our dashboard.",
      preview_description: "Small React fix on our dashboard.",
      budget: { minimum: 500, maximum: 900, project_type: "fixed" },
      time_submitted: Math.floor(Date.now() / 1000) - 1200,
    };
    searchResponse.result.projects.push(timelineProject);

    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation/run-pipeline`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const result = (await res.json()) as { status: string; bidsPlaced: number };
      expect(result.status).toBe("ok");
      expect(result.bidsPlaced).toBe(1);

      // The gate's pick (1 day) reaches Freelancer.com as `period`, not the
      // preferred 21 — that is the whole point of the switch.
      expect(lastBidBody?.["period"]).toBe(1);

      const { eq } = await import("drizzle-orm");
      const { getDb } = await import("../src/db/index.js");
      const { jobs, userBids } = await import("../src/db/schema.js");
      const jobRow = getDb()
        .select()
        .from(jobs)
        .where(eq(jobs.projectId, timelineProject.id))
        .get();
      expect(jobRow?.deliveryDays).toBe(1);

      const bidRow = getDb()
        .select()
        .from(userBids)
        .where(eq(userBids.projectId, timelineProject.id))
        .get();
      expect(bidRow?.period).toBe(1);
    } finally {
      // Leave the shared search fixture as the later tests expect it.
      searchResponse.result.projects.pop();
      await realFetch(`${baseUrl}/api/automation`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ aiDeliveryTimeline: false, preferredDeliveryDays: 4 }),
      });
      vi.unstubAllGlobals();
    }
  });

  it("bids the amount the gate picked when AI bid amount selection is on", async () => {
    const settingsRes = await realFetch(`${baseUrl}/api/automation`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        autobidEnabled: true,
        minMatchScore: 70,
        dailyCap: 15,
        aiBidAmount: true,
        bidAmountFractions: ["1/3", "2/3", "full"],
        bidAmountInstructions: "Quote the optimal fraction.",
      }),
    });
    expect(settingsRes.status).toBe(200);

    const bidAmountProject = {
      ...projectDetail,
      id: PROJECT_ID + 5,
      title: "React full-stack SaaS platform",
      description: "Build a complete SaaS platform with React and Node.js.",
      preview_description: "SaaS platform with React and Node.js.",
      budget: { minimum: 400, maximum: 900, project_type: "fixed" },
      time_submitted: Math.floor(Date.now() / 1000) - 1500,
    };
    searchResponse.result.projects.push(bidAmountProject);

    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation/run-pipeline`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const result = (await res.json()) as { status: string; bidsPlaced: number };
      expect(result.status).toBe("ok");
      expect(result.bidsPlaced).toBe(1);

      // The gate's pick ($600) reaches Freelancer.com as `amount`, not the minimum budget ($400, clamped $500).
      expect(lastBidBody?.["amount"]).toBe(600);

      const { getDb } = await import("../src/db/index.js");
      const { eq } = await import("drizzle-orm");
      const { jobs, userBids } = await import("../src/db/schema.js");
      const jobRow = getDb()
        .select()
        .from(jobs)
        .where(eq(jobs.projectId, bidAmountProject.id))
        .get();
      expect(jobRow?.bidAmount).toBe(600);

      const bidRow = getDb()
        .select()
        .from(userBids)
        .where(eq(userBids.projectId, bidAmountProject.id))
        .get();
      expect(bidRow?.amount).toBe(600);
    } finally {
      searchResponse.result.projects.pop();
      await realFetch(`${baseUrl}/api/automation`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ aiBidAmount: false }),
      });
      vi.unstubAllGlobals();
    }
  });

  it("rounds the AI-picked bid amount to the nearest step for fixed-price projects", async () => {
    const settingsRes = await realFetch(`${baseUrl}/api/automation`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        autobidEnabled: true,
        minMatchScore: 70,
        dailyCap: 15,
        aiBidAmount: true,
        bidAmountFractions: ["1/3", "2/3", "full"],
        bidAmountInstructions: "Quote the optimal fraction.",
        roundBidUpTo: 10,
      }),
    });
    expect(settingsRes.status).toBe(200);

    // Use a max budget of 905 so the fractions produce non-round options:
    //   1/3 of 905 = 302, 2/3 of 905 = 603, full = 905
    // The gate picks 603 (not a multiple of 10) → rounds to 600.
    const roundProject = {
      ...projectDetail,
      id: PROJECT_ID + 5,
      title: "React full-stack SaaS platform",
      description: "Build a complete SaaS platform with React and Node.js.",
      preview_description: "SaaS platform with React and Node.js.",
      budget: { minimum: 300, maximum: 905, project_type: "fixed" },
      time_submitted: Math.floor(Date.now() / 1000) - 1500,
    };
    searchResponse.result.projects.push(roundProject);

    const relevancyChoice = openRouterRelevancyResponse.choices[0];
    if (relevancyChoice === undefined) throw new Error("Test fixture has no choices");
    const originalContent = relevancyChoice.message.content;
    relevancyChoice.message.content = JSON.stringify({
      score: 92,
      reason: "Excellent match.",
      deliveryDays: 7,
      bidAmount: 603,
    });

    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation/run-pipeline`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);

      // 603 → Math.max(300, 603) = 603 → round to nearest 10 → 600
      expect(lastBidBody?.["amount"]).toBe(600);
    } finally {
      relevancyChoice.message.content = originalContent;
      searchResponse.result.projects.pop();
      await realFetch(`${baseUrl}/api/automation`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ aiBidAmount: false, roundBidUpTo: 0 }),
      });
      vi.unstubAllGlobals();
    }
  });

  it("records why a job was rejected by the profile filters, and shows it on the job detail", async () => {
    // The profile's notWants includes "crypto"; a project about cryptocurrency
    // trips the deterministic keyword filter before any AI call is made.
    const cryptoProject = {
      ...projectDetail,
      id: PROJECT_ID + 3,
      title: "Cryptocurrency trading bot",
      description: "Build a cryptocurrency trading bot with React and Node.js.",
      preview_description: "Cryptocurrency trading bot.",
      budget: { minimum: 800, maximum: 4000, project_type: "fixed" },
      time_submitted: Math.floor(Date.now() / 1000) - 900,
    };
    searchResponse.result.projects.push(cryptoProject);

    stubFetch();
    try {
      const res = await realFetch(`${baseUrl}/api/automation/run-pipeline`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const result = (await res.json()) as { status: string; analyzed: number };
      expect(result.status).toBe("ok");
      // The one new job is processed and ends up rejected (no successful analysis).
      expect(result.analyzed).toBe(1);

      // The stored row carries the human-readable reason.
      const { getDb: db } = await import("../src/db/index.js");
      const { jobs } = await import("../src/db/schema.js");
      const row = db()
        .select()
        .from(jobs)
        .where(eq(jobs.projectId, cryptoProject.id))
        .get();
      expect(row?.status).toBe("ignored");
      expect(row?.rejectionReason).toContain("Filtered out by your profile filters");

      // The reason is visible on the job detail endpoint too.
      const detailRes = await realFetch(`${baseUrl}/api/jobs/${cryptoProject.id}`, {
        method: "GET",
        headers: authed(),
      });
      expect(detailRes.status).toBe(200);
      const { job } = (await detailRes.json()) as {
        job: { status: string; rejectionReason: string | null };
      };
      expect(job.status).toBe("ignored");
      expect(job.rejectionReason).toContain("Filtered out by your profile filters");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
