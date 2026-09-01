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

const openRouterRelevancyResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          relevant: true,
          score: 92,
          reasons: ["React.js is one of your strong skills", "Node.js matches your backend expertise", "Project budget aligns with your rate"],
          summary: "Excellent match for your React and Node.js skills with a well-scoped SaaS analytics dashboard.",
        }),
      },
    },
  ],
};

const openRouterProposalResponse = {
  choices: [
    {
      message: {
        content: "Hello,\n\nI'm a full-stack developer with extensive experience building React dashboards for SaaS products. I've read your project description carefully and I'm confident I can deliver the analytics dashboard you need.\n\nMy key strengths for this project:\n- React.js: I've built 3+ admin dashboards with React, including real-time data visualization\n- Node.js: My backend expertise will ensure the API layer is scalable and performant\n- I work with a 7-day delivery timeline and offer a 100% satisfaction guarantee\n\nI can start immediately and would love to discuss the details.\n\nBest regards,\nPipeline Tester",
      },
    },
  ],
};

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
          if (userPrompt.includes("Write a proposal cover message")) {
            return new Response(JSON.stringify(openRouterProposalResponse), { status: 200 });
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
});
