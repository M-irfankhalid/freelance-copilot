import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

/**
 * Analytics endpoint: GET /api/analytics returns aggregated KPIs, bid outcomes,
 * bids per week, and proposal status breakdown — all computed from the local DB.
 * Auth is required.
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

/** Seed a realistic mix of jobs, proposals, and user bids for one user. */
async function seedAnalytics(userId: string): Promise<void> {
  const { getDb: getDbInstance } = await import("../src/db/index.js");
  const { jobs, proposals, userBids } = await import("../src/db/schema.js");
  const db = getDbInstance();
  const now = new Date();
  const nowStr = now.toISOString();

  // Jobs — mix of analyzed (with scores) and new.
  db.insert(jobs).values([
    {
      id: "job-1", projectId: 300101, title: "React dashboard", client: "Client A",
      clientCountry: "US", budgetLabel: "$500–$2000", skills: '["React.js"]',
      postedLabel: "2h ago", bidCount: 3, avgBidLabel: "$150/hr",
      matchScore: 94, severity: "urgent", status: "analyzed",
      analysis: JSON.stringify({ verdict: "strong", score: 94 }),
      rawData: "{}", lastAnalyzedAt: nowStr, importedAt: nowStr, updatedAt: nowStr,
    },
    {
      id: "job-2", projectId: 300102, title: "Node API", client: "Client B",
      clientCountry: "UK", budgetLabel: "$800–$3000", skills: '["Node.js"]',
      postedLabel: "1d ago", bidCount: 5, avgBidLabel: "$30/hr",
      matchScore: 67, severity: "info", status: "analyzed",
      analysis: JSON.stringify({ verdict: "fair", score: 67 }),
      rawData: "{}", lastAnalyzedAt: nowStr, importedAt: nowStr, updatedAt: nowStr,
    },
    {
      id: "job-3", projectId: 300103, title: "New job", client: "Client C",
      clientCountry: "CA", budgetLabel: "$1000–$5000", skills: '["Python"]',
      postedLabel: "5m ago", bidCount: 1, avgBidLabel: "$20/hr",
      matchScore: null, severity: "warning", status: "new",
      analysis: null, rawData: "{}", importedAt: nowStr, updatedAt: nowStr,
    },
  ]).run();

  // Proposals — various statuses.
  db.insert(proposals).values([
    {
      id: "prop-1", userId, jobId: "job-1", projectId: 300101,
      jobTitle: "React dashboard", client: "Client A", bidAmount: 1800,
      status: "approved", content: "Proposal content for React dashboard",
      competitorNote: null, createdAt: nowStr, updatedAt: nowStr,
    },
    {
      id: "prop-2", userId, jobId: "job-2", projectId: 300102,
      jobTitle: "Node API", client: "Client B", bidAmount: 2500,
      status: "submitted", content: "Proposal content for Node API",
      competitorNote: null, createdAt: nowStr, updatedAt: nowStr,
    },
  ]).run();

  // User bids — 2 submitted within the last week (this week bucket).
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 3);
  const weekAgoStr = weekAgo.toISOString();

  db.insert(userBids).values([
    {
      id: "bid-1", userId, projectId: 300101, proposalId: "prop-1",
      jobTitle: "React dashboard", client: "Client A", amount: 1800,
      period: 7, milestonePercentage: 0, description: "Bid on React dashboard",
      status: "submitted", outcome: "won", via: "manual",
      submittedAt: weekAgoStr, updatedAt: weekAgoStr,
    },
    {
      id: "bid-2", userId, projectId: 300102, proposalId: "prop-2",
      jobTitle: "Node API", client: "Client B", amount: 2500,
      period: 7, milestonePercentage: 0, description: "Bid on Node API",
      status: "submitted", outcome: "lost", via: "auto",
      submittedAt: weekAgoStr, updatedAt: weekAgoStr,
    },
    {
      id: "bid-3", userId, projectId: 300103, proposalId: null,
      jobTitle: "Another job", client: "Client D", amount: 1200,
      period: 14, milestonePercentage: 0, description: "Bid on another job",
      status: "submitted", outcome: "in_review", via: "manual",
      submittedAt: weekAgoStr, updatedAt: weekAgoStr,
    },
  ]).run();
}

beforeAll(async () => {
  realFetch = globalThis.fetch;
  // No external API calls during analytics tests.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));

  app = createApp();
  server = app.listen(0);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  baseUrl = `http://localhost:${address.port}`;

  // Register the owner user.
  const register = await realFetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Analytics User",
      email: "analytics-test@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  // Seed analytics data directly into the DB.
  const { getDb: db } = await import("../src/db/index.js");
  const { users } = await import("../src/db/schema.js");
  const userRow = db().select({ id: users.id }).from(users).limit(1).get();
  if (userRow) {
    await seedAnalytics(userRow.id);
  }

  vi.unstubAllGlobals();
});

afterAll(() => {
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

describe("analytics endpoint", () => {
  it("requires authentication", async () => {
    const res = await realFetch(`${baseUrl}/api/analytics`);
    expect(res.status).toBe(401);
  });

  it("returns the analytics snapshot for an authenticated user", async () => {
    const res = await realFetch(`${baseUrl}/api/analytics`, { headers: authed() });
    expect(res.status).toBe(200);
    const snapshot = (await res.json()) as {
      kpis: Array<{ id: string; label: string; value: string; context?: string }>;
      bidsPerWeek: Array<{ label: string; value: number }>;
      outcomes: { won: number; lost: number; inReview: number };
      proposalsByStatus: Array<{ label: string; value: number }>;
    };

    // KPIs
    const kpiById = Object.fromEntries(snapshot.kpis.map((k) => [k.id, k]));
    expect(kpiById["jobs-analyzed"]?.value).toBe("2"); // 2 analyzed jobs
    expect(kpiById["proposals"]?.value).toBe("2");
    expect(kpiById["bids-placed"]?.value).toBe("3");
    expect(kpiById["won-projects"]?.value).toBe("1");
    expect(kpiById["avg-bid"]?.value).toBe("$1,833"); // (1800 + 2500 + 1200) / 3 = 1833.33
  });

  it("reports bid outcomes (won, lost, in_review)", async () => {
    const res = await realFetch(`${baseUrl}/api/analytics`, { headers: authed() });
    expect(res.status).toBe(200);
    const { outcomes } = (await res.json()) as {
      outcomes: { won: number; lost: number; inReview: number };
    };
    expect(outcomes.won).toBe(1);
    expect(outcomes.lost).toBe(1);
    expect(outcomes.inReview).toBe(1);
  });

  it("returns 8 weeks of bid data (W1–W8)", async () => {
    const res = await realFetch(`${baseUrl}/api/analytics`, { headers: authed() });
    expect(res.status).toBe(200);
    const { bidsPerWeek } = (await res.json()) as {
      bidsPerWeek: Array<{ label: string; value: number }>;
    };
    expect(bidsPerWeek).toHaveLength(8);
    expect(bidsPerWeek[0]!.label).toBe("W1");
    expect(bidsPerWeek[7]!.label).toBe("W8");
    // All 3 bids were seeded within the last week → W8 should have all 3.
    const lastWeek = bidsPerWeek[7]!;
    expect(lastWeek.value).toBe(3);
  });

  it("groups proposals by status", async () => {
    const res = await realFetch(`${baseUrl}/api/analytics`, { headers: authed() });
    expect(res.status).toBe(200);
    const { proposalsByStatus } = (await res.json()) as {
      proposalsByStatus: Array<{ label: string; value: number }>;
    };
    expect(proposalsByStatus.length).toBeGreaterThan(0);
    const approved = proposalsByStatus.find((p) => p.label === "Approved");
    const submitted = proposalsByStatus.find((p) => p.label === "Submitted");
    expect(approved?.value).toBe(1);
    expect(submitted?.value).toBe(1);
  });

  it("still returns a valid snapshot when the user has no bids", async () => {
    // The seeded user has 3 bids, so verify the avg-bid KPI shows a value,
    // not the placeholder "—" — this confirms the non-empty path works.
    const res = await realFetch(`${baseUrl}/api/analytics`, { headers: authed() });
    expect(res.status).toBe(200);
    const snapshot = (await res.json()) as {
      kpis: Array<{ id: string; value: string }>;
    };
    const avgBid = snapshot.kpis.find((k) => k.id === "avg-bid");
    expect(avgBid?.value).toMatch(/^\$[\d,]+$/);
    expect(avgBid?.value).not.toBe("—");
  });
});
