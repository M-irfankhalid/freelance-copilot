import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";

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
let userId = "";
let realFetch: typeof fetch;

interface ChatRequestBody {
  model?: string;
  messages: Array<{
    role: string;
    content: string | null;
    tool_calls?: Array<{ function: { name: string } }>;
  }>;
  tools?: Array<{ function: { name: string } }>;
}

type ChatHandler = (body: ChatRequestBody, call: number) => Response;

function assistant(
  content: string | null,
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
            ...(toolCalls !== undefined
              ? {
                  tool_calls: toolCalls.map((call) => ({
                    id: call.id,
                    type: "function",
                    function: { name: call.name, arguments: call.arguments },
                  })),
                }
              : {}),
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function stubChat(handler: ChatHandler) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        call += 1;
        return handler(JSON.parse((init?.body as string) ?? "{}") as ChatRequestBody, call);
      }
      throw new Error(`Unexpected fetch in agent test: ${url}`);
    })
  );
}

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

async function postChat(body: unknown) {
  return realFetch(`${baseUrl}/api/agent/chat`, {
    method: "POST",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

const profilePayload = {
  freelancerUsername: "agent_tester",
  name: "Agent Tester",
  title: "Full-stack developer",
  hourlyRate: "$40/hr",
  about: "I build React dashboards and Node APIs.",
  skills: ["React.js", "Node.js", "PostgreSQL"],
  skillIds: [759, 500, 17],
  preferredProjectTypes: [],
  wants: [],
  notWants: [],
  ignoredCountries: [],
  customInstructions: null,
  relevancyInstructions: null,
  portfolioSummary: "## Portfolio\n\n### Existing project\nAn existing project.",
  proposalTemplates: null,
};

beforeAll(async () => {
  realFetch = globalThis.fetch;
  app = createApp();
  server = app.listen(0);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  baseUrl = `http://localhost:${address.port}`;

  const register = await realFetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Agent Owner",
      email: "agent-owner@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  const { getDb } = await import("../src/db/index.js");
  const { users, platformCredentials } = await import("../src/db/schema.js");
  const { encrypt } = await import("../src/lib/crypto.js");
  const db = getDb();
  const row = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "agent-owner@example.com"))
    .get();
  if (row === undefined) throw new Error("Test user was not created");
  userId = row.id;

  const encrypted = encrypt("sk-or-v1-agent-test");
  const now = new Date().toISOString();
  db.insert(platformCredentials)
    .values({
      id: "openrouter",
      cipherText: encrypted.cipherText,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      meta: JSON.stringify({
        proposalModelId: "test/proposal-model",
        agentModelId: "test/agent-model",
      }),
      status: "ok",
      lastTestedAt: now,
      updatedAt: now,
    })
    .run();

  const saved = await realFetch(`${baseUrl}/api/profile`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify(profilePayload),
  });
  if (saved.status !== 200) {
    throw new Error(`Failed to save test profile: ${saved.status} ${await saved.text()}`);
  }
}, 30_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  server.close();
  closeDb();
});

describe("agent", () => {
  it("requires authentication", async () => {
    const response = await realFetch(`${baseUrl}/api/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(response.status).toBe(401);
  });

  it("reads profile data through a tool and returns an answer", async () => {
    stubChat((body, call) => {
      expect(body.model).toBe("test/agent-model");
      expect(body.tools?.map((tool) => tool.function.name)).toContain("get_profile");
      expect(body.tools?.map((tool) => tool.function.name)).not.toContain("update_profile");
      if (call === 1) {
        return assistant(null, [
          { id: "call-profile", name: "get_profile", arguments: "{}" },
        ]);
      }
      const toolMessage = body.messages.find((message) => message.role === "tool");
      expect(toolMessage?.content).toContain("Agent Tester");
      return assistant("Your profile is missing a portfolio summary update.");
    });

    const response = await postChat({
      messages: [{ role: "user", content: "What is in my profile?" }],
      allowWrites: false,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      message: string;
      actions: Array<{ tool: string }>;
    };
    expect(body.message).toContain("portfolio summary");
    expect(body.actions).toEqual([]);
  });

  it("refuses writes when Allow changes is off", async () => {
    stubChat((body, call) => {
      if (call === 1) {
        return assistant(null, [
          {
            id: "call-write-blocked",
            name: "update_profile",
            arguments: JSON.stringify({ title: "Unapproved title" }),
          },
        ]);
      }
      const toolMessage = body.messages.find((message) => message.role === "tool");
      expect(toolMessage?.content).toContain("Writes are disabled");
      return assistant("Turn on Allow changes before I edit your profile.");
    });

    const response = await postChat({
      messages: [{ role: "user", content: "Change my title." }],
      allowWrites: false,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { actions: unknown[] };
    expect(body.actions).toEqual([]);

    const { getProfile } = await import("../src/modules/profile/profile.service.js");
    expect(getProfile(userId)?.title).toBe("Full-stack developer");
  });

  it("applies an approved profile update and reports the changed fields", async () => {
    stubChat((body, call) => {
      expect(body.tools?.map((tool) => tool.function.name)).toContain("update_profile");
      if (call === 1) {
        return assistant(null, [
          {
            id: "call-write-allowed",
            name: "update_profile",
            arguments: JSON.stringify({
              title: "Senior React developer",
            }),
          },
        ]);
      }
      const toolMessage = body.messages.find((message) => message.role === "tool");
      expect(toolMessage?.content).toContain("title");
      return assistant("I updated your title.");
    });

    const response = await postChat({
      messages: [{ role: "user", content: "Change my title to senior React developer." }],
      allowWrites: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      message: string;
      actions: Array<{ tool: string; changedFields?: string[] }>;
    };
    expect(body.message).toContain("updated");
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]?.tool).toBe("update_profile");
    expect(body.actions[0]?.changedFields).toContain("title");

    const { getProfile } = await import("../src/modules/profile/profile.service.js");
    expect(getProfile(userId)?.title).toBe("Senior React developer");
  });

  it("reports saved writes when the model fails after a change", async () => {
    stubChat((_body, call) => {
      if (call === 1) {
        return assistant(null, [
          {
            id: "call-partial-write",
            name: "update_profile",
            arguments: JSON.stringify({
              title: "Saved before the upstream failure",
            }),
          },
        ]);
      }
      throw new Error("upstream unavailable");
    });

    const response = await postChat({
      messages: [{ role: "user", content: "Update my title." }],
      allowWrites: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      message: string;
      actions: Array<{ tool: string }>;
    };
    expect(body.message).toContain("saved one change");
    expect(body.message).toContain("upstream unavailable");
    expect(body.actions[0]?.tool).toBe("update_profile");

    const { getProfile } = await import("../src/modules/profile/profile.service.js");
    expect(getProfile(userId)?.title).toBe("Saved before the upstream failure");
  });

  it("updates the portfolio summary with user-supplied project facts", async () => {
    stubChat((_body, call) => {
      if (call === 1) {
        return assistant(null, [
          {
            id: "call-portfolio-summary",
            name: "update_profile",
            arguments: JSON.stringify({
              portfolioSummary:
                "## Portfolio\n\n### Inventory app\nBuilt a stock tracking app for a small retailer.\nhttps://example.com/inventory",
            }),
          },
        ]);
      }
      return assistant("Added Inventory app to your portfolio summary.");
    });

    const response = await postChat({
      messages: [
        {
          role: "user",
          content:
            "Add this project to my portfolio summary: Inventory app. Built a stock tracking app for a small retailer. https://example.com/inventory",
        },
      ],
      allowWrites: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      actions: Array<{ tool: string; changedFields?: string[] }>;
    };
    expect(body.actions[0]?.tool).toBe("update_profile");
    expect(body.actions[0]?.changedFields).toContain("portfolioSummary");

    const { getProfile } = await import("../src/modules/profile/profile.service.js");
    const profile = getProfile(userId);
    expect(profile?.portfolioSummary).toContain("Inventory app");
    expect(profile?.portfolioSummary).toContain("https://example.com/inventory");
  });

  it("runs deterministic quality checks on a saved proposal", async () => {
    const { getDb } = await import("../src/db/index.js");
    const { jobs, proposals } = await import("../src/db/schema.js");
    const now = new Date().toISOString();
    const db = getDb();
    db.insert(jobs)
      .values({
        id: "job-910001",
        projectId: 910001,
        title: "Build a React analytics dashboard",
        client: "Client in Germany",
        clientCountry: "Germany",
        budgetLabel: "$1,000 – $5,000",
        skills: JSON.stringify(["React.js", "PostgreSQL"]),
        postedLabel: "1h ago",
        bidCount: 4,
        avgBidLabel: "$2,000",
        matchScore: 72,
        severity: "info",
        status: "analyzed",
        analysis: JSON.stringify({
          verdict: "good",
          score: 72,
          summary: "Reasonable fit.",
          reasons: ["React"],
          concerns: ["Dashboard scope is broad."],
          recommendedBidLabel: "$2,000",
          competitorNote: "4 bids",
        }),
        rawData: JSON.stringify({
          id: 910001,
          title: "Build a React analytics dashboard",
          description:
            "We need a React analytics dashboard connected to PostgreSQL with live charts and filters.",
        }),
        lastAnalyzedAt: now,
        deliveryDays: 5,
        importedAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(proposals)
      .values({
        id: "prop-agent-quality",
        userId,
        jobId: "job-910001",
        projectId: 910001,
        jobTitle: "Build a React analytics dashboard",
        client: "Client in Germany",
        bidAmount: 2000,
        status: "draft",
        content: "I understand you need a dashboard. I am confident I can help. Let me know.",
        competitorNote: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    stubChat((body, call) => {
      if (call === 1) {
        return assistant(null, [
          {
            id: "call-quality",
            name: "check_proposal_quality",
            arguments: JSON.stringify({ proposalId: "prop-agent-quality" }),
          },
        ]);
      }
      const toolMessage = body.messages.find((message) => message.role === "tool");
      expect(toolMessage?.content).toContain("failedChecks");
      expect(toolMessage?.content).toContain("score");
      return assistant("The proposal is too short and lacks specifics.");
    });

    const response = await postChat({
      messages: [{ role: "user", content: "Why is my latest proposal weak?" }],
      allowWrites: false,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("too short");
  });
});
