import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

/**
 * Proposals pipeline: generate, list, edit, regenerate, approve, status update.
 * Freelancer.com and OpenRouter are stubbed at fetch level; storage and route
 * wiring are exercised end-to-end through the real API surface.
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

const PROJECT_ID = 300001;

const projectDetail = {
  id: PROJECT_ID,
  title: "Build a real-time analytics dashboard",
  description: "We need a real-time analytics dashboard using React. The dashboard should connect to PostgreSQL and show charts.\n\nProject must be completed in 2 weeks.",
  preview_description: "Real-time analytics dashboard with React and PostgreSQL.",
  currency: { code: "USD", name: "US Dollar", sign: "$", exchange_rate: 1.0 },
  budget: { minimum: 1000, maximum: 5000, project_type: "fixed" },
  bid_stats: { bid_count: 5, bid_avg: 2500, min_amount: 1200, max_amount: 4000 },
  time_submitted: Math.floor(Date.now() / 1000) - 3600,
  type: "fixed",
  bidperiod: 14,
  upgrades: { featured: true, urgent: false, sealed: true },
  language: "en",
  jobs: [
    { id: 759, name: "React.js", category: { id: 1, name: "Websites, IT & Software" } },
    { id: 500, name: "Node.js", category: { id: 1, name: "Websites, IT & Software" } },
    { id: 17, name: "PostgreSQL", category: { id: 1, name: "Websites, IT & Software" } },
  ],
  location: { country: { name: "Germany", code: "de" } },
  owner_info: {
    city: "Berlin",
    country: { name: "Germany", code: "de" },
    reputation: {
      entire_history: { overall: 0.91, positive: 0.95 },
      role: "employer",
      earnings_score: 0.8,
    },
    status: { payment_verified: true, email_verified: true, profile_complete: true },
    registration_date: 1700000000,
  },
};

const bidsResponse = {
  status: "success",
  result: {
    bids: [
      { id: 1, bidder: { id: 901, name: "ReactDev", username: "reactdev" }, amount: 1500, currency: { code: "USD" }, is_cheapest: true, time_submitted: Math.floor(Date.now() / 1000) - 1800, description: "Expert in React" },
      { id: 2, bidder: { id: 902, name: "FullStack", username: "fullstack" }, amount: 2500, currency: { code: "USD" }, is_cheapest: false, time_submitted: Math.floor(Date.now() / 1000) - 1200, description: "Full stack developer" },
      { id: 3, bidder: { id: 903, name: "SeniorDev", username: "seniordev" }, amount: 4000, currency: { code: "USD" }, is_cheapest: false, time_submitted: Math.floor(Date.now() / 1000) - 600, description: "Senior engineer" },
    ],
  },
};

/** Stub fetch for a given set of responses. Local requests delegate to realFetch. */
function setStub(responses: Record<string, (url: string, init?: RequestInit) => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      for (const [needle, responder] of Object.entries(responses)) {
        if (url.includes(needle)) return responder(url, init);
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
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

  // Stub OpenRouter credential test endpoint before saving credentials.
  setStub({
    "openrouter.ai/api/v1/key": () =>
      new Response(JSON.stringify({ data: { label: "Key", usage: 1, limit: 10 } }), { status: 200 }),
    "freelancer.com": () =>
      new Response(JSON.stringify({ status: "success", result: { id: 1, username: "owner" } }), { status: 200 }),
  });

  // Register the owner user (delegates to realFetch for baseUrl).
  const register = await realFetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Owner",
      email: "owner-proposals@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  // Save credentials (now the stub handles the OpenRouter key test call).
  await realFetch(`${baseUrl}/api/credentials/freelancer`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "frl_proposals_test_token" }),
  });
  await realFetch(`${baseUrl}/api/credentials/openrouter`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "sk-or-v1-proposals-test" }),
  });

  // Save a profile with real skills so proposal generation is grounded.
  const profileRes = await realFetch(`${baseUrl}/api/profile`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      freelancerUsername: "proposals_user",
      name: "Proposal Tester",
      title: "Full-stack developer",
      hourlyRate: "$40/hr",
      about: "I build React dashboards and Node backends.",
      skills: ["React.js", "Node.js", "PostgreSQL"],
      skillIds: [759, 500, 17],
      preferredProjectTypes: ["Fixed price"],
      wants: ["React"],
      notWants: ["crypto"],
      ignoredCountries: [],
      customInstructions: "Keep it professional but concise.",
      userSummary: "Experienced in React and Node.js.",
      portfolioSummary: "### Sales Dashboard\nReact + PostgreSQL sales dashboard, https://example.com/sales",
    }),
  });
  if (profileRes.status !== 200) {
    throw new Error(`Failed to save profile: ${profileRes.status} ${await profileRes.text()}`);
  }
  vi.unstubAllGlobals();
}, 30000);

afterAll(() => {
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

/** Set up the standard stub: returns a controlled OpenRouter proposal response. */
function stubFetchWithAI(): { getProposalPrompt: () => string | null } {
  let lastProposalPrompt: string | null = null;
  setStub({
    "freelancer.com/api/projects/0.1/projects/300001": () =>
      new Response(JSON.stringify({ status: "success", result: projectDetail }), { status: 200 }),
    "freelancer.com/api/projects/0.1/projects/300001/bids": () =>
      new Response(JSON.stringify(bidsResponse), { status: 200 }),
    "openrouter.ai/api/v1/chat/completions": (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const isProposal = body.messages?.some((m: { content?: string }) => m.content?.includes("=== VERIFIED PROFILE FACTS ==="));
      if (isProposal) {
        lastProposalPrompt =
          body.messages?.find((m: { content?: string }) => m.content?.includes("=== VERIFIED PROFILE FACTS ==="))
            ?.content ?? null;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Your dashboard needs reliable real-time updates without overloading the database. I would start with a queue-based ingestion layer for the event stream, then build the React dashboard with live chart updates backed by PostgreSQL. I have built several React and PostgreSQL analytics dashboards, including a sales dashboard that processed live data streams and surfaced per-account trends. I would keep the first milestone small: connect the data pipeline, render one live chart, and verify latency under load before expanding the views. Each step would include a short checkpoint so you can see progress before we move on. From there, I would add filtering, loading states, and tests around the ingestion path so the dashboard stays dependable as traffic grows. Could we start with a short call to confirm the event sources and the first dashboard view you want working? — Proposal Tester" } }],
          }),
          { status: 200 }
        );
      }
      // Analysis response (not used in these tests but guard against leaks)
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ verdict: "strong", score: 88, summary: "Good fit", reasons: ["React skills match"], concerns: [], recommendedBidLabel: "$2000 – $3000", competitorNote: "5 bids" }) } }],
        }),
        { status: 200 }
      );
    },
  });
  return { getProposalPrompt: () => lastProposalPrompt };
}

describe("proposals", () => {
  it("generates a proposal using real profile and AI", async () => {
    stubFetchWithAI();
    try {
      const response = await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}`,
          projectId: PROJECT_ID,
          jobTitle: "Build a real-time analytics dashboard",
          clientName: "Client in Germany",
          description: projectDetail.description.split(/\n{2,}/),
          jobSkills: ["React.js", "Node.js", "PostgreSQL"],
          bidStats: { bidCount: 5, avgBid: "$2,500" },
          projectType: "fixed",
          bidPeriod: 14,
          upgrades: { featured: true, urgent: false, sealed: true },
          competition: {
            bidCount: 3,
            minBid: 1500,
            maxBid: 4000,
            medianBid: 2500,
            isCheapest: false,
          },
        }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        proposal: { id: string; content: string; competitorNote: string; status: string };
      };
      expect(body.proposal.id).toMatch(/^prop-/);
      expect(body.proposal.status).toBe("draft");
      expect(body.proposal.content).toContain("React");
      expect(body.proposal.content.length).toBeGreaterThan(100);
      expect(body.proposal.competitorNote).toContain("3 bids");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lists proposals after generation", async () => {
    stubFetchWithAI();
    try {
      // Generate first so we have data to list.
      await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}`,
          projectId: PROJECT_ID,
          jobTitle: "Build a real-time analytics dashboard",
          clientName: "Client in Germany",
          description: ["We need a dashboard."],
          jobSkills: ["React.js"],
          bidStats: { bidCount: 5, avgBid: "$2,500" },
          projectType: "fixed",
          bidPeriod: 14,
          upgrades: { featured: true, urgent: false, sealed: true },
          competition: { bidCount: 3, minBid: 1500, maxBid: 4000, medianBid: 2500, isCheapest: false },
        }),
      });

      const listResponse = await realFetch(`${baseUrl}/api/proposals`, {
        headers: authed(),
      });
      expect(listResponse.status).toBe(200);
      const listBody = (await listResponse.json()) as {
        proposals: Array<{
          id: string;
          jobTitle: string;
          status: string;
          content: string;
          competitorNote: string | null;
          bidAmount: number | null;
        }>;
      };
      expect(listBody.proposals.length).toBeGreaterThan(0);
      const gen = listBody.proposals.find((p) => p.jobTitle === "Build a real-time analytics dashboard");
      expect(gen).toBeDefined();
      expect(gen?.status).toBe("draft");
      expect(gen?.content).toContain("React");
      expect(gen?.competitorNote).toContain("3 bids");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retries once when the first draft fails validation", async () => {
    let proposalCalls = 0;
    setStub({
      "openrouter.ai/api/v1/chat/completions": (_url, init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const isProposal = body.messages?.some((m: { content?: string }) =>
          m.content?.includes("=== VERIFIED PROFILE FACTS ===")
        );
        if (!isProposal) {
          return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
            status: 200,
          });
        }

        proposalCalls++;
        const content =
          proposalCalls === 1
            ? "I can build this dashboard and have relevant React experience."
            : "Your analytics dashboard needs a dependable path from PostgreSQL to the live charts your team uses. I would map the event sources and schema, then build a queue-based ingestion layer so bursts do not overload the database. Next I would implement the React dashboard shell, connect live updates, and add filtering, loading, empty, and error states before polishing the views. I have built React and PostgreSQL dashboards with live chart updates and per-account filters similar to the work in my portfolio. I would test against realistic event volume, document the ingestion checks, and leave a short, practical runbook for handoff. I can deliver the dashboard in 7 days for $1,800. Can we start with a short call to confirm the event sources and the first chart you need live?";
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200,
        });
      },
    });

    try {
      const response = await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-retry`,
          projectId: PROJECT_ID,
          jobTitle: "Build a React analytics dashboard",
          clientName: "Client",
          description: ["React dashboard with PostgreSQL and live charts."],
          jobSkills: ["React.js", "PostgreSQL"],
          projectType: "fixed",
          bidAmount: 1800,
          deliveryDays: 7,
        }),
      });

      expect(response.status).toBe(200);
      expect(proposalCalls).toBe(2);
      const body = (await response.json()) as { proposal: { content: string } };
      expect(body.proposal.content).toContain("7 days");
      expect(body.proposal.content).toContain("$1,800");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("prevents duplicate proposals for the same job", async () => {
    stubFetchWithAI();
    try {
      const firstBody = JSON.stringify({
        jobId: `job-${PROJECT_ID}-dup`,
        projectId: PROJECT_ID,
        jobTitle: "Duplicate guard test",
        clientName: "Client",
        description: ["Test"],
        jobSkills: ["React.js"],
        bidStats: { bidCount: 1 },
        projectType: null,
        bidPeriod: null,
        upgrades: undefined,
        competition: null,
      });

      const first = await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: firstBody,
      });
      if (first.status !== 200) {
        console.error("First generate failed:", first.status, await first.clone().text());
      }
      expect(first.status).toBe(200);

      const second = await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: firstBody,
      });
      expect(second.status).toBe(409);
      const errBody = (await second.json()) as { error: { code: string } };
      expect(errBody.error.code).toBe("CONFLICT");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("updates proposal status to queued (approval)", async () => {
    stubFetchWithAI();
    try {
      // Generate a proposal first.
      const genRes = await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-approve`,
          projectId: PROJECT_ID,
          jobTitle: "Status update test",
          clientName: "Client",
          description: ["Test"],
          jobSkills: ["React.js"],
          bidStats: { bidCount: 1 },
          projectType: null,
          bidPeriod: null,
          upgrades: undefined,
          competition: null,
        }),
      });
      if (genRes.status !== 200) {
        console.error("Generate failed for status test:", genRes.status, await genRes.clone().text());
      }
      const { proposal } = (await genRes.json()) as { proposal: { id: string } };

      const updateRes = await realFetch(`${baseUrl}/api/proposals/${proposal.id}/status`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "queued" }),
      });
      expect(updateRes.status).toBe(200);

      // Verify via list that status changed.
      const listRes = await realFetch(`${baseUrl}/api/proposals`, { headers: authed() });
      const { proposals: list } = (await listRes.json()) as { proposals: Array<{ id: string; status: string }> };
      const updated = list.find((p) => p.id === proposal.id);
      expect(updated?.status).toBe("queued");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("edits proposal content via PUT", async () => {
    stubFetchWithAI();
    try {
      const genRes = await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-edit`,
          projectId: PROJECT_ID,
          jobTitle: "Edit test",
          clientName: "Client",
          description: ["Test"],
          jobSkills: ["React.js"],
          bidStats: { bidCount: 1 },
          projectType: null,
          bidPeriod: null,
          upgrades: undefined,
          competition: null,
        }),
      });
      const { proposal } = (await genRes.json()) as { proposal: { id: string } };

      const editedContent = "Edited proposal content for testing purposes.";
      const editRes = await realFetch(`${baseUrl}/api/proposals/${proposal.id}`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ content: editedContent }),
      });
      expect(editRes.status).toBe(200);

      // Verify via single-get.
      const getRes = await realFetch(`${baseUrl}/api/proposals/${proposal.id}`, { headers: authed() });
      const { proposal: fetched } = (await getRes.json()) as { proposal: { content: string } };
      expect(fetched.content).toBe(editedContent);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("regenerates a proposal with fresh context", async () => {
    const stub = stubFetchWithAI();
    try {
      const genRes = await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-regen`,
          projectId: PROJECT_ID,
          jobTitle: "Regen test",
          clientName: "Client",
          description: ["Test"],
          jobSkills: ["React.js"],
          bidStats: { bidCount: 1 },
          projectType: "fixed",
          bidPeriod: 14,
          upgrades: { featured: true, urgent: false, sealed: true },
          competition: { bidCount: 3, minBid: 1500, maxBid: 4000, medianBid: 2500, isCheapest: false },
        }),
      });
      const { proposal: genProposal } = (await genRes.json()) as { proposal: { id: string; content: string } };

      const regenRes = await realFetch(`${baseUrl}/api/proposals/${genProposal.id}/regenerate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({}),
      });
      expect(regenRes.status).toBe(200);
      const regenBody = (await regenRes.json()) as { proposal: { content: string } };
      expect(regenBody.proposal.content).toContain("React");
      expect(regenBody.proposal.content.length).toBeGreaterThan(50);
      const regenPrompt = stub.getProposalPrompt();
      expect(regenPrompt).toContain("Keep it professional but concise.");
      expect(regenPrompt).toContain("Sales Dashboard");
      expect(regenPrompt).toContain("React.js, Node.js, PostgreSQL");
      expect(regenPrompt).not.toContain("Experienced in React and Node.js.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fetches the proposal for a job by jobId", async () => {
    stubFetchWithAI();
    try {
      const genRes = await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-byjob`,
          projectId: PROJECT_ID,
          jobTitle: "By-job lookup test",
          clientName: "Client",
          description: ["Test"],
          jobSkills: ["React.js"],
          bidStats: { bidCount: 1 },
          projectType: null,
          bidPeriod: null,
          upgrades: undefined,
          competition: null,
        }),
      });
      expect(genRes.status).toBe(200);
      const { proposal } = (await genRes.json()) as { proposal: { id: string; content: string } };

      // Existing job → returns the proposal.
      const foundRes = await realFetch(`${baseUrl}/api/proposals/job/job-${PROJECT_ID}-byjob`, {
        headers: authed(),
      });
      expect(foundRes.status).toBe(200);
      const found = (await foundRes.json()) as { proposal: { id: string; content: string } };
      expect(found.proposal.id).toBe(proposal.id);
      expect(found.proposal.content.length).toBeGreaterThan(50);

      // Job with no proposal → proposal is null.
      const missingRes = await realFetch(`${baseUrl}/api/proposals/job/job-missing`, {
        headers: authed(),
      });
      expect(missingRes.status).toBe(200);
      const missing = (await missingRes.json()) as { proposal: null };
      expect(missing.proposal).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deletes a draft proposal", async () => {
    stubFetchWithAI();
    try {
      const genRes = await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-delete`,
          projectId: PROJECT_ID,
          jobTitle: "Delete test",
          clientName: "Client",
          description: ["Test"],
          jobSkills: ["React.js"],
          bidStats: { bidCount: 1 },
          projectType: null,
          bidPeriod: null,
          upgrades: undefined,
          competition: null,
        }),
      });
      const { proposal } = (await genRes.json()) as { proposal: { id: string } };

      const delRes = await realFetch(`${baseUrl}/api/proposals/${proposal.id}`, {
        method: "DELETE",
        headers: authed(),
      });
      expect(delRes.status).toBe(200);

      // Gone from the list and from single-get.
      const listRes = await realFetch(`${baseUrl}/api/proposals`, { headers: authed() });
      const { proposals: list } = (await listRes.json()) as { proposals: Array<{ id: string }> };
      expect(list.find((p) => p.id === proposal.id)).toBeUndefined();

      const getRes = await realFetch(`${baseUrl}/api/proposals/${proposal.id}`, { headers: authed() });
      expect(getRes.status).toBe(404);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses to delete a non-draft proposal", async () => {
    stubFetchWithAI();
    try {
      const genRes = await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-delete-approved`,
          projectId: PROJECT_ID,
          jobTitle: "Delete approved test",
          clientName: "Client",
          description: ["Test"],
          jobSkills: ["React.js"],
          bidStats: { bidCount: 1 },
          projectType: null,
          bidPeriod: null,
          upgrades: undefined,
          competition: null,
        }),
      });
      const { proposal } = (await genRes.json()) as { proposal: { id: string } };

      // Approve it first (as the bid flow does), then try to delete.
      await realFetch(`${baseUrl}/api/proposals/${proposal.id}/status`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "approved" }),
      });

      const delRes = await realFetch(`${baseUrl}/api/proposals/${proposal.id}`, {
        method: "DELETE",
        headers: authed(),
      });
      expect(delRes.status).toBe(400);
      const errBody = (await delRes.json()) as { error: { code: string } };
      expect(errBody.error.code).toBe("BAD_REQUEST");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns 404 when deleting an unknown proposal", async () => {
    const delRes = await realFetch(`${baseUrl}/api/proposals/nonexistent-id`, {
      method: "DELETE",
      headers: authed(),
    });
    expect(delRes.status).toBe(404);
  });

  it("declines a draft proposal", async () => {
    stubFetchWithAI();
    try {
      const genRes = await realFetch(`${baseUrl}/api/proposals/generate`, {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jobId: `job-${PROJECT_ID}-decline`,
          projectId: PROJECT_ID,
          jobTitle: "Decline test",
          clientName: "Client",
          description: ["Test"],
          jobSkills: ["React.js"],
          bidStats: { bidCount: 1 },
          projectType: null,
          bidPeriod: null,
          upgrades: undefined,
          competition: null,
        }),
      });
      const { proposal } = (await genRes.json()) as { proposal: { id: string } };

      const declineRes = await realFetch(`${baseUrl}/api/proposals/${proposal.id}/status`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "declined" }),
      });
      expect(declineRes.status).toBe(200);

      const listRes = await realFetch(`${baseUrl}/api/proposals`, { headers: authed() });
      const { proposals: list } = (await listRes.json()) as { proposals: Array<{ id: string; status: string }> };
      const declined = list.find((p) => p.id === proposal.id);
      expect(declined?.status).toBe("declined");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requires authentication", async () => {
    const response = await realFetch(`${baseUrl}/api/proposals`);
    expect(response.status).toBe(401);
  });
});

describe("proposals (regenerate missing proposal)", () => {
  it("returns 404 for a non-existent proposal id", async () => {
    const response = await realFetch(`${baseUrl}/api/proposals/nonexistent-id/regenerate`, {
      method: "POST",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(404);
  });
});
