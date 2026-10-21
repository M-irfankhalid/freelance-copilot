import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const { Client: ClientClass } = await import(
  "@modelcontextprotocol/sdk/client/index.js"
);
const { InMemoryTransport } = await import(
  "@modelcontextprotocol/sdk/inMemory.js"
);
const { createMcpServer } = await import("../src/mcp/server.js");
const { closeDb, getDb } = await import("../src/db/index.js");
const { jobs, platformCredentials, proposals, userBids } = await import(
  "../src/db/schema.js"
);
const { encrypt } = await import("../src/lib/crypto.js");
const { register } = await import("../src/modules/auth/auth.service.js");
const { getProfile, saveProfile } = await import(
  "../src/modules/profile/profile.service.js"
);

let userId = "";
let draftContent = "";
let submittedContent = "";

interface Connected {
  client: Client;
  server: Server;
}

async function connect(allowWrites: boolean): Promise<Connected> {
  const server = createMcpServer({ userId, allowWrites });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new ClientClass(
    { name: "mcp-test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client, server };
}

function textOf(result: unknown): string {
  if (result === null || typeof result !== "object") return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  for (const item of content) {
    if (
      item !== null &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      return (item as { text: string }).text;
    }
  }
  return "";
}

function jsonOf(result: unknown): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>;
}

beforeAll(async () => {
  const registration = await register({
    name: "MCP Owner",
    email: "mcp-owner@example.com",
    password: "correct-horse-battery",
  });
  userId = registration.userId;

  saveProfile(userId, {
    freelancerUsername: "mcp_tester",
    name: "MCP Tester",
    title: "Full-stack developer",
    hourlyRate: "$50/hr",
    about: "I build React dashboards and Node APIs.",
    skills: ["React.js", "Node.js"],
    skillIds: [759, 500],
    preferredProjectTypes: [],
    wants: [],
    notWants: [],
    ignoredCountries: [],
    customInstructions: null,
    relevancyInstructions: null,
    portfolioSummary: "## Portfolio\n\n### Existing project\nAn existing project.",
    proposalTemplates: null,
  });

  draftContent = "Draft proposal content that is long enough to be realistic for testing.";
  submittedContent =
    "Submitted proposal content that must never be changed by the MCP server.";

  const now = new Date().toISOString();
  const freelancerToken = encrypt("frl-mcp-test-token");
  const openRouterKey = encrypt("sk-or-v1-mcp-test");
  getDb()
    .insert(platformCredentials)
    .values([
      {
        id: "freelancer",
        cipherText: freelancerToken.cipherText,
        iv: freelancerToken.iv,
        authTag: freelancerToken.authTag,
        meta: null,
        status: "ok",
        lastTestedAt: now,
        updatedAt: now,
      },
      {
        id: "openrouter",
        cipherText: openRouterKey.cipherText,
        iv: openRouterKey.iv,
        authTag: openRouterKey.authTag,
        meta: JSON.stringify({ proposalModelId: "test/proposal-model" }),
        status: "ok",
        lastTestedAt: now,
        updatedAt: now,
      },
    ])
    .run();

  getDb()
    .insert(jobs)
    .values({
      id: "job-mcp-tools",
      projectId: 930001,
      title: "Build a React analytics dashboard",
      client: "Client in Germany",
      clientCountry: "Germany",
      budgetLabel: "$1,000 – $5,000",
      skills: JSON.stringify(["React.js", "PostgreSQL"]),
      postedLabel: "1h ago",
      bidCount: 4,
      avgBidLabel: "$2,000",
      matchScore: 88,
      severity: "info",
      status: "analyzed",
      analysis: JSON.stringify({
        verdict: "strong",
        score: 88,
        summary: "Strong React fit.",
        reasons: ["React experience"],
        concerns: ["Dashboard scope is broad."],
        recommendedBidLabel: "$2,000",
        competitorNote: "4 bids",
      }),
      rawData: JSON.stringify({
        id: 930001,
        title: "Build a React analytics dashboard",
        description:
          "We need a React analytics dashboard connected to PostgreSQL with live charts and filters.",
        type: "fixed",
        bidperiod: 7,
        currency: { code: "USD" },
        budget: { minimum: 1000, maximum: 5000 },
      }),
      deliveryDays: 5,
      bidAmount: 1800,
      lastAnalyzedAt: now,
      importedAt: now,
      updatedAt: now,
    })
    .run();

  getDb()
    .insert(jobs)
    .values({
      id: "job-mcp-bid",
      projectId: 950001,
      title: "Build a Node.js billing service",
      client: "Billing Client",
      clientCountry: "Canada",
      budgetLabel: "$2,000 – $4,000",
      skills: JSON.stringify(["Node.js", "PostgreSQL"]),
      postedLabel: "2h ago",
      bidCount: 2,
      avgBidLabel: "$2,800",
      matchScore: null,
      severity: null,
      status: "new",
      analysis: null,
      rawData: JSON.stringify({
        id: 950001,
        title: "Build a Node.js billing service",
        description:
          "We need a Node.js billing service with PostgreSQL and Stripe webhooks.",
        type: "fixed",
        bidperiod: 7,
        currency: { code: "USD" },
        budget: { minimum: 2000, maximum: 4000 },
      }),
      deliveryDays: 6,
      bidAmount: 2600,
      lastAnalyzedAt: null,
      importedAt: now,
      updatedAt: now,
    })
    .run();

  getDb()
    .insert(proposals)
    .values([
      {
        id: "prop-mcp-draft",
        userId,
        jobId: "job-mcp-draft",
        projectId: 920001,
        jobTitle: "Build a dashboard",
        client: "MCP Client",
        bidAmount: 1500,
        status: "draft",
        content: draftContent,
        competitorNote: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "prop-mcp-submitted",
        userId,
        jobId: "job-mcp-submitted",
        projectId: 920002,
        jobTitle: "Build an API",
        client: "MCP Client",
        bidAmount: 2000,
        status: "submitted",
        content: submittedContent,
        competitorNote: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "prop-mcp-bid-draft",
        userId,
        jobId: "job-mcp-bid",
        projectId: 950001,
        jobTitle: "Build a Node.js billing service",
        client: "Billing Client",
        bidAmount: 2600,
        status: "draft",
        content:
          "I can build the Node.js billing service with PostgreSQL and Stripe webhooks, starting with the schema and webhook retries.",
        competitorNote: null,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  closeDb();
});

describe("mcp server", () => {
  it("lists read and write tools with correct annotations", async () => {
    const { client, server } = await connect(true);

    const result = await client.listTools();
    const byName = new Map(result.tools.map((tool) => [tool.name, tool]));

    expect(byName.has("get_profile")).toBe(true);
    expect(byName.has("list_matches")).toBe(true);
    expect(byName.has("search_jobs")).toBe(true);
    expect(byName.has("refresh_job")).toBe(true);
    expect(byName.has("create_proposal_draft")).toBe(true);
    expect(byName.has("update_profile_skills")).toBe(true);
    expect(byName.has("get_dashboard")).toBe(true);
    expect(byName.has("get_ai_settings")).toBe(true);
    expect(byName.has("update_ai_settings")).toBe(true);
    expect(byName.has("test_ai_settings")).toBe(true);
    expect(byName.has("list_bids")).toBe(true);
    expect(byName.has("run_scan")).toBe(true);
    expect(byName.has("approve_proposal")).toBe(true);
    expect(byName.has("place_bid")).toBe(true);
    expect(byName.has("get_recent_logs")).toBe(true);
    expect(byName.get("get_profile")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("list_matches")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("get_dashboard")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("get_ai_settings")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("update_ai_settings")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("test_ai_settings")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("list_bids")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("get_recent_logs")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("search_jobs")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("create_proposal_draft")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("run_scan")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("approve_proposal")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("place_bid")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("update_profile")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("update_proposal")?.annotations?.destructiveHint).toBe(true);

    await client.close();
    await server.close();
  });

  it("reads and updates the profile through MCP tools", async () => {
    const { client, server } = await connect(true);

    const read = await client.callTool({ name: "get_profile", arguments: {} });
    expect(read.isError).toBeFalsy();
    const profile = jsonOf(read).profile as Record<string, unknown>;
    expect(profile.name).toBe("MCP Tester");

    const update = await client.callTool({
      name: "update_profile",
      arguments: { title: "MCP updated title" },
    });
    expect(update.isError).toBeFalsy();
    expect(jsonOf(update).changedFields).toEqual(["title"]);
    expect(getProfile(userId)?.title).toBe("MCP updated title");

    await client.close();
    await server.close();
  });

  it("reads and updates AI settings through MCP tools", async () => {
    const { client, server } = await connect(true);

    const read = await client.callTool({ name: "get_ai_settings", arguments: {} });
    expect(read.isError).toBeFalsy();
    const settings = jsonOf(read).settings as Record<string, unknown>;
    expect(settings.relevanceIgnoreFloor).toBe(50);
    expect(settings.goodScoreFloor).toBe(75);
    expect(settings.strongScoreFloor).toBe(90);

    const update = await client.callTool({
      name: "update_ai_settings",
      arguments: {
        relevanceIgnoreFloor: 55,
        goodScoreFloor: 70,
        strongScoreFloor: 88,
        proposalCorrectionAttempts: 2,
      },
    });
    expect(update.isError).toBeFalsy();
    expect(jsonOf(update).changedFields).toEqual([
      "proposalCorrectionAttempts",
      "relevanceIgnoreFloor",
      "goodScoreFloor",
      "strongScoreFloor",
    ]);
    const updated = jsonOf(update).settings as Record<string, unknown>;
    expect(updated.strongScoreFloor).toBe(88);

    const invalid = await client.callTool({
      name: "update_ai_settings",
      arguments: { goodScoreFloor: 90, strongScoreFloor: 88 },
    });
    expect(invalid.isError).toBe(true);

    await client.callTool({
      name: "update_ai_settings",
      arguments: {
        relevanceIgnoreFloor: 50,
        goodScoreFloor: 75,
        strongScoreFloor: 90,
        proposalCorrectionAttempts: 1,
      },
    });

    await client.close();
    await server.close();
  });

  it("hides and refuses write tools in read-only mode", async () => {
    const { client, server } = await connect(false);

    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name);
    expect(names).toContain("list_matches");
    expect(names).toContain("get_dashboard");
    expect(names).toContain("get_ai_settings");
    expect(names).toContain("list_bids");
    expect(names).toContain("get_recent_logs");
    expect(names).not.toContain("update_ai_settings");
    expect(names).not.toContain("test_ai_settings");
    expect(names).not.toContain("search_jobs");
    expect(names).not.toContain("refresh_job");
    expect(names).not.toContain("create_proposal_draft");
    expect(names).not.toContain("run_scan");
    expect(names).not.toContain("analyze_job");
    expect(names).not.toContain("regenerate_proposal_draft");
    expect(names).not.toContain("update_proposal_terms");
    expect(names).not.toContain("approve_proposal");
    expect(names).not.toContain("place_bid");
    expect(names).not.toContain("update_profile");
    expect(names).not.toContain("update_profile_skills");
    expect(names).not.toContain("update_proposal");

    const blocked = await client.callTool({
      name: "update_profile",
      arguments: { title: "Unapproved MCP change" },
    });
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toContain("Unknown or disabled tool");
    expect(getProfile(userId)?.title).toBe("MCP updated title");

    await client.close();
    await server.close();
  });

  it("updates a draft but refuses a submitted proposal", async () => {
    const { client, server } = await connect(true);

    const updated = await client.callTool({
      name: "update_proposal",
      arguments: {
        proposalId: "prop-mcp-draft",
        content:
          "This replacement draft is grounded in the saved profile and the job details.",
      },
    });
    expect(updated.isError).toBeFalsy();
    expect(jsonOf(updated).ok).toBe(true);

    const blocked = await client.callTool({
      name: "update_proposal",
      arguments: {
        proposalId: "prop-mcp-submitted",
        content:
          "This replacement text must be rejected because the proposal was already submitted.",
      },
    });
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toContain("Only draft proposals can be edited");

    const rows = getDb().select().from(proposals).all();
    expect(rows.find((row) => row.id === "prop-mcp-draft")?.content).toContain(
      "replacement draft"
    );
    expect(rows.find((row) => row.id === "prop-mcp-submitted")?.content).toBe(
      submittedContent
    );

    await client.close();
    await server.close();
  });

  it("lists matched jobs and edits skills by add/remove", async () => {
    const { client, server } = await connect(true);

    const matches = await client.callTool({
      name: "list_matches",
      arguments: { limit: 5 },
    });
    expect(matches.isError).toBeFalsy();
    const matchData = jsonOf(matches);
    expect(matchData.count).toBe(1);
    expect((matchData.matches as Array<{ score: number }>)[0]?.score).toBe(88);

    const skills = await client.callTool({
      name: "update_profile_skills",
      arguments: { add: ["TypeScript", "React.js"], remove: ["Node.js"] },
    });
    expect(skills.isError).toBeFalsy();
    const skillData = jsonOf(skills);
    expect(skillData.changedFields).toEqual(["skills", "skillIds"]);
    const profile = getProfile(userId);
    expect(profile?.skills).toEqual(["React.js", "TypeScript"]);
    expect(profile?.skills).not.toContain("Node.js");

    await client.close();
    await server.close();
  });

  it("searches Freelancer and caches the jobs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("freelancer.com/api/projects/0.1/projects/active/")) {
          return new Response(
            JSON.stringify({
              status: "success",
              result: {
                projects: [
                  {
                    id: 940001,
                    title: "Build a TypeScript API",
                    description: "We need a TypeScript API with PostgreSQL.",
                    preview_description: "We need a TypeScript API.",
                    currency: { code: "USD" },
                    budget: { minimum: 500, maximum: 1500, project_type: "fixed" },
                    bid_stats: { bid_count: 2, bid_avg: 900 },
                    time_submitted: Math.floor(Date.now() / 1000) - 60,
                    type: "fixed",
                    bidperiod: 7,
                    jobs: [{ id: 759, name: "React.js" }],
                    location: { country: { name: "Germany", code: "de" } },
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        throw new Error(`Unexpected fetch in MCP search test: ${url}`);
      })
    );

    const { client, server } = await connect(true);
    const result = await client.callTool({
      name: "search_jobs",
      arguments: { keywords: ["typescript"], limit: 5 },
    });
    expect(result.isError).toBeFalsy();
    const data = jsonOf(result);
    expect(data.count).toBe(1);
    expect((data.jobs as Array<{ projectId: number }>)[0]?.projectId).toBe(940001);

    const stored = getDb()
      .select()
      .from(jobs)
      .all()
      .find((job) => job.projectId === 940001);
    expect(stored?.title).toBe("Build a TypeScript API");

    await client.close();
    await server.close();
  });

  it("runs a scan without drafting or bidding", async () => {
    let postedBid = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("freelancer.com/api/projects/0.1/bids") && init?.method === "POST") {
          postedBid = true;
          throw new Error("run_scan must never place a bid");
        }
        if (url.includes("freelancer.com/api/projects/0.1/projects/active/")) {
          return new Response(
            JSON.stringify({ status: "success", result: { projects: [] } }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        throw new Error(`Unexpected fetch in MCP scan test: ${url}`);
      })
    );

    const { client, server } = await connect(true);
    const result = await client.callTool({
      name: "run_scan",
      arguments: { limit: 2 },
    });
    expect(result.isError).toBeFalsy();
    const data = jsonOf(result);
    expect(data.found).toBe(0);
    expect(data.analyzed).toBe(0);
    expect(postedBid).toBe(false);

    await client.close();
    await server.close();
  });

  it("creates a proposal draft and never places a bid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("openrouter.ai/api/v1/chat/completions")) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      "Your React analytics dashboard needs a reliable path from PostgreSQL to the live charts your team will use. I would start by mapping the event sources and schema, then build a queue-based ingestion layer so traffic spikes do not overload the database. Next I would implement the React dashboard shell, connect live updates, and add filtering, loading, empty, and error states before polishing the views. I have built React and PostgreSQL dashboards with live chart updates and per-account filters similar to the work in my portfolio. I would test the dashboard against realistic event volume, document the ingestion checks, and leave a short, practical runbook for handoff so your team can operate it. I can deliver the first working dashboard in 5 days for $1,800. Can we start with a short call to confirm the event sources and the first chart you need live?",
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        throw new Error(`Unexpected fetch in MCP proposal test: ${url}`);
      })
    );

    const { client, server } = await connect(true);
    const result = await client.callTool({
      name: "create_proposal_draft",
      arguments: { projectId: 930001 },
    });
    expect(result.isError).toBeFalsy();
    const data = jsonOf(result);
    const proposal = data.proposal as { id: string; status: string; content: string };
    expect(proposal.status).toBe("draft");
    expect(proposal.content).toContain("React analytics dashboard");

    const rows = getDb().select().from(proposals).all();
    const stored = rows.find((row) => row.id === proposal.id);
    expect(stored?.status).toBe("draft");
    expect(stored?.bidAmount).toBe(1800);
    expect(getDb().select().from(jobs).all().find((job) => job.projectId === 930001)?.status).toBe(
      "analyzed"
    );

    const duplicate = await client.callTool({
      name: "create_proposal_draft",
      arguments: { projectId: 930001 },
    });
    expect(duplicate.isError).toBe(true);
    expect(textOf(duplicate)).toContain("already exists");

    await client.close();
    await server.close();
  });

  it("refreshes one job without analyzing or bidding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("freelancer.com/api/projects/0.1/projects/930001/bids/")) {
          return new Response(
            JSON.stringify({
              status: "success",
              result: {
                bids: [
                  {
                    id: 11,
                    bidder: { id: 501, name: "DevA", username: "deva" },
                    amount: 2100,
                    currency: { code: "USD" },
                    is_cheapest: true,
                    time_submitted: Math.floor(Date.now() / 1000) - 600,
                    description: "React dashboard experience",
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("freelancer.com/api/projects/0.1/projects/930001")) {
          return new Response(
            JSON.stringify({
              status: "success",
              result: {
                id: 930001,
                title: "Build a React analytics dashboard (live)",
                description:
                  "Live description: React dashboard connected to PostgreSQL with filters.",
                currency: { code: "USD" },
                budget: { minimum: 1000, maximum: 5000, project_type: "fixed" },
                bid_stats: { bid_count: 5, bid_avg: 2100 },
                time_submitted: Math.floor(Date.now() / 1000) - 900,
                type: "fixed",
                bidperiod: 7,
                jobs: [{ id: 759, name: "React.js" }],
                location: { country: { name: "Germany", code: "de" } },
                owner_info: {
                  country: { name: "Germany", code: "de" },
                  reputation: { entire_history: { overall: 0.8, positive: 0.9 } },
                  status: { payment_verified: true },
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        throw new Error(`Unexpected fetch in MCP refresh test: ${url}`);
      })
    );

    const { client, server } = await connect(true);
    const result = await client.callTool({
      name: "refresh_job",
      arguments: { projectId: 930001 },
    });
    expect(result.isError).toBeFalsy();
    const job = jsonOf(result).job as {
      title: string;
      bidCount: number;
      description: string[];
    };
    expect(job.title).toContain("(live)");
    expect(job.bidCount).toBe(5);
    expect(job.description.join(" ")).toContain("Live description");

    const stored = getDb()
      .select()
      .from(jobs)
      .all()
      .find((row) => row.projectId === 930001);
    expect(stored?.title).toContain("(live)");
    expect(stored?.status).toBe("analyzed");

    await client.close();
    await server.close();
  });

  it("reads the dashboard, proposal by job, and recent logs", async () => {
    const { client, server } = await connect(true);

    const dashboard = await client.callTool({
      name: "get_dashboard",
      arguments: {},
    });
    expect(dashboard.isError).toBeFalsy();
    expect(jsonOf(dashboard).dashboard).toBeTypeOf("object");

    const forJob = await client.callTool({
      name: "get_proposal_for_job",
      arguments: { projectId: 930001 },
    });
    expect(forJob.isError).toBeFalsy();
    const proposal = jsonOf(forJob).proposal as { id: string; status: string };
    expect(proposal.status).toBe("draft");

    const logs = await client.callTool({
      name: "get_recent_logs",
      arguments: { limit: 5 },
    });
    expect(logs.isError).toBeFalsy();
    expect(Array.isArray(jsonOf(logs).logs)).toBe(true);

    await client.close();
    await server.close();
  });

  it("requires confirmation before approving or bidding", async () => {
    const { client, server } = await connect(true);

    const terms = await client.callTool({
      name: "update_proposal_terms",
      arguments: {
        proposalId: "prop-mcp-bid-draft",
        bidAmount: 2600,
        deliveryDays: 5,
      },
    });
    expect(terms.isError).toBeFalsy();
    expect(jsonOf(terms).deliveryDays).toBe(5);

    const unconfirmedApproval = await client.callTool({
      name: "approve_proposal",
      arguments: { proposalId: "prop-mcp-bid-draft", confirm: false },
    });
    expect(unconfirmedApproval.isError).toBe(true);
    expect(
      getDb().select().from(proposals).all().find((row) => row.id === "prop-mcp-bid-draft")
        ?.status
    ).toBe("draft");

    const approval = await client.callTool({
      name: "approve_proposal",
      arguments: { proposalId: "prop-mcp-bid-draft", confirm: true },
    });
    expect(approval.isError).toBeFalsy();
    expect(
      getDb().select().from(proposals).all().find((row) => row.id === "prop-mcp-bid-draft")
        ?.status
    ).toBe("approved");

    const unconfirmedBid = await client.callTool({
      name: "place_bid",
      arguments: {
        proposalId: "prop-mcp-bid-draft",
        amount: 2600,
        period: 5,
        confirm: false,
      },
    });
    expect(unconfirmedBid.isError).toBe(true);
    expect(textOf(unconfirmedBid)).toContain("confirm=true");
    expect(getDb().select().from(userBids).all()).toHaveLength(0);

    await client.close();
    await server.close();
  });

  it("places an approved bid once and records it", async () => {
    let placedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("freelancer.com/api/users/0.1/self")) {
          return new Response(
            JSON.stringify({
              status: "success",
              result: { id: 77124963, username: "mcp_tester" },
            }),
            { status: 200 }
          );
        }
        if (url.includes("freelancer.com/api/projects/0.1/bids") && init?.method === "POST") {
          placedBody = JSON.parse(String(init.body ?? "null")) as Record<string, unknown>;
          return new Response(
            JSON.stringify({ status: "success", result: { bid_id: 888001 } }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected fetch in MCP bid test: ${url}`);
      })
    );

    const { client, server } = await connect(true);
    const result = await client.callTool({
      name: "place_bid",
      arguments: {
        proposalId: "prop-mcp-bid-draft",
        amount: 2600,
        period: 5,
        milestonePercentage: 50,
        confirm: true,
      },
    });
    expect(result.isError).toBeFalsy();
    const bid = jsonOf(result).bid as {
      id: string;
      amount: number;
      period: number;
      freelancerBidId: number | null;
    };
    expect(bid.amount).toBe(2600);
    expect(bid.period).toBe(5);
    expect(bid.freelancerBidId).toBe(888001);
    expect(placedBody?.["project_id"]).toBe(950001);
    expect(placedBody?.["amount"]).toBe(2600);
    expect(placedBody?.["period"]).toBe(5);

    const stored = getDb()
      .select()
      .from(userBids)
      .all()
      .find((row) => row.id === bid.id);
    expect(stored?.status).toBe("submitted");
    expect(stored?.via).toBe("manual");

    const readBack = await client.callTool({
      name: "get_bid",
      arguments: { bidId: bid.id },
    });
    expect(readBack.isError).toBeFalsy();
    expect((jsonOf(readBack).bid as { amount: number }).amount).toBe(2600);

    const listed = await client.callTool({
      name: "list_bids",
      arguments: {},
    });
    expect(listed.isError).toBeFalsy();
    expect(jsonOf(listed).count).toBe(1);

    const duplicate = await client.callTool({
      name: "place_bid",
      arguments: {
        proposalId: "prop-mcp-bid-draft",
        amount: 2600,
        period: 5,
        confirm: true,
      },
    });
    expect(duplicate.isError).toBe(true);
    expect(textOf(duplicate)).toContain("already exists");

    await client.close();
    await server.close();
  });
});
