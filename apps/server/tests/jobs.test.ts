import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

/**
 * Jobs flow against the real backend, with both Freelancer.com and
 * OpenRouter stubbed at fetch level. Storage, auth, and route wiring are
 * exercised end-to-end.
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

beforeAll(async () => {
  realFetch = globalThis.fetch;
  app = createApp();
  server = app.listen(0);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  baseUrl = `http://localhost:${address.port}`;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      if (url.includes("freelancer.com/api/users/0.1/self")) {
        return new Response(
          JSON.stringify({
            status: "success",
            result: { id: 77124963, username: "irfan_dev" },
          }),
          { status: 200 }
        );
      }
      if (url.includes("freelancer.com/api/projects/0.1/projects/active/")) {
        return new Response(
          JSON.stringify({
            status: "success",
            result: {
              projects: [
                {
                  id: 100001,
                  title: "Build a React dashboard",
                  description: "We need a dashboard.\n\nWith charts.",
                  preview_description: "We need a dashboard.",
                  currency: { code: "USD", name: "US Dollar", sign: "$", exchange_rate: 1.0 },
                  budget: { minimum: 100, maximum: 500, project_type: "fixed" },
                  bid_stats: { bid_count: 4, bid_avg: 250, min_amount: 100, max_amount: 400 },
                  time_submitted: Math.floor(Date.now() / 1000) - 30,
                  type: "fixed",
                  bidperiod: 7,
                  upgrades: { featured: false, urgent: false, sealed: false },
                  language: "en",
                  jobs: [
                    { id: 759, name: "React.js", category: { id: 1, name: "Websites, IT & Software" } },
                    { id: 500, name: "Node.js", category: { id: 1, name: "Websites, IT & Software" } },
                  ],
                  location: { country: { name: "Germany", code: "de" } },
                  owner_info: {
                    city: "Berlin",
                    country: { name: "Germany", code: "de" },
                    reputation: {
                      entire_history: { overall: 0.85, positive: 0.9 },
                      role: "employer",
                      earnings_score: 0.7,
                    },
                    status: { payment_verified: true, email_verified: true, profile_complete: false },
                    registration_date: 1700000000,
                  },
                },
                {
                  id: 100002,
                  title: "Laravel API integration",
                  description: "Connect to a third-party API.",
                  preview_description: "Connect to a third-party API.",
                  currency: { code: "USD", name: "US Dollar", sign: "$", exchange_rate: 1.0 },
                  budget: { minimum: 200, maximum: 800, project_type: "fixed" },
                  bid_stats: { bid_count: 0, bid_avg: null, min_amount: null, max_amount: null },
                  time_submitted: Math.floor(Date.now() / 1000) - 60 * 60 * 3,
                  type: "fixed",
                  bidperiod: 7,
                  upgrades: { featured: false, urgent: false, sealed: false },
                  language: "en",
                  jobs: [{ id: 32, name: "Laravel", category: { id: 1, name: "Websites, IT & Software" } }],
                  location: { country: { name: "United States", code: "us" } },
                  owner_info: {
                    country: { name: "United States", code: "us" },
                    reputation: {
                      entire_history: { overall: 0.72, positive: 0.8 },
                      role: "employer",
                      earnings_score: 0.6,
                    },
                    status: { payment_verified: false, email_verified: true, profile_complete: false },
                    registration_date: 1690000000,
                  },
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      // Check the bids endpoint BEFORE the project detail, since the detail
      // pattern is a substring of the bids URL.
      if (url.includes("freelancer.com/api/projects/0.1/projects/100001/bids/")) {
        return new Response(
          JSON.stringify({
            status: "success",
            result: {
              bids: [
                { id: 1, bidder: { id: 501, name: "DevA", username: "deva" }, amount: 200, currency: { code: "USD" }, is_cheapest: true, time_submitted: Math.floor(Date.now() / 1000) - 3600, description: "Experienced React dev" },
                { id: 2, bidder: { id: 502, name: "DevB", username: "devb" }, amount: 300, currency: { code: "USD" }, is_cheapest: false, time_submitted: Math.floor(Date.now() / 1000) - 3500, description: "Full stack with dashboard experience" },
                { id: 3, bidder: { id: 503, name: "DevC", username: "devc" }, amount: 400, currency: { code: "USD" }, is_cheapest: false, time_submitted: Math.floor(Date.now() / 1000) - 3400, description: "Senior frontend engineer" },
                { id: 4, bidder: { id: 504, name: "DevD", username: "devd" }, amount: 450, currency: { code: "USD" }, is_cheapest: false, time_submitted: Math.floor(Date.now() / 1000) - 3300, description: "Can build dashboards fast" },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("freelancer.com/api/projects/0.1/projects/999999")) {
        return new Response(JSON.stringify({ status: "error" }), { status: 404 });
      }
      if (url.includes("freelancer.com/api/projects/0.1/projects/100001")) {
        return new Response(
          JSON.stringify({
            status: "success",
            result: {
              id: 100001,
              title: "Build a React dashboard",
              description: "We need a React dashboard.\n\nWith charts and a dark mode.",
              preview_description: "We need a React dashboard.",
              currency: { code: "USD", name: "US Dollar", sign: "$", exchange_rate: 1.0 },
              budget: { minimum: 100, maximum: 500, project_type: "fixed" },
              bid_stats: { bid_count: 4, bid_avg: 250, min_amount: 100, max_amount: 400 },
              time_submitted: Math.floor(Date.now() / 1000) - 30,
              type: "fixed",
              bidperiod: 7,
              upgrades: { featured: false, urgent: false, sealed: false },
              language: "en",
              jobs: [
                { id: 759, name: "React.js", category: { id: 1, name: "Websites, IT & Software" } },
                { id: 500, name: "Node.js", category: { id: 1, name: "Websites, IT & Software" } },
              ],
              location: { country: { name: "Germany", code: "de" } },
              owner_info: {
                city: "Berlin",
                country: { name: "Germany", code: "de" },
                reputation: {
                  entire_history: { overall: 0.85, positive: 0.9 },
                  role: "employer",
                  earnings_score: 0.7,
                },
                status: { payment_verified: true, email_verified: true, profile_complete: false },
                registration_date: 1700000000,
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("openrouter.ai/api/v1/key")) {
        return new Response(
          JSON.stringify({ data: { label: "Test key", usage: 1.5, limit: 10 } }),
          { status: 200 }
        );
      }
      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 78,
                    reason: "Matches your React/Node.js skills and your want to build dashboards.",
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    })
  );

  // Register the owner and save freelancer + openrouter tokens.
  const register = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Owner",
      email: "owner-jobs@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  await fetch(`${baseUrl}/api/credentials/freelancer`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "frl_jobs_test_token" }),
  });
  await fetch(`${baseUrl}/api/credentials/openrouter`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "sk-or-v1-jobs-test" }),
  });

  // Seed a profile so the analyzer has facts to ground its output in.
  await fetch(`${baseUrl}/api/profile`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      freelancerUsername: "irfan_dev",
      name: "Irfan Developer",
      title: "Full-stack developer",
      hourlyRate: "$35/hr",
      about: "I build React + Node dashboards.",
      skills: ["React.js", "Node.js", "Tailwind CSS"],
      skillIds: [759, 500, 1263],
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
});

afterAll(() => {
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

describe("jobs", () => {
  it("requires a session for the list", async () => {
    const r = await realFetch(`${baseUrl}/api/jobs`);
    expect(r.status).toBe(401);
  });

  it("searches and persists jobs using the real /projects/active/ endpoint", async () => {
    const search = await realFetch(`${baseUrl}/api/jobs/search`, {
      headers: authed(),
    });
    expect(search.status).toBe(200);
    const body = (await search.json()) as {
      jobs: Array<{
        projectId: number;
        title: string;
        client: string;
        clientCountry: string;
        budgetLabel: string;
        skills: string[];
        postedLabel: string;
        bidCount: number;
        avgBidLabel: string;
        status: string;
      }>;
    };
    expect(body.jobs).toHaveLength(2);

    const first = body.jobs[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.projectId).toBe(100001);
    expect(first.title).toBe("Build a React dashboard");
    expect(first.client).toBe("Client in Germany");
    expect(first.clientCountry).toBe("Germany");
    expect(first.budgetLabel).toBe("$100 – $500");
    expect(first.skills).toEqual(["React.js", "Node.js"]);
    expect(first.bidCount).toBe(4);
    expect(first.avgBidLabel).toBe("$250");
    expect(first.status).toBe("new");
    expect(first.postedLabel).toMatch(/ago/);

    // The second job was submitted 3h ago, so the label must reflect that.
    const second = body.jobs[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    expect(second.postedLabel).toBe("3h ago");
    expect(second.clientCountry).toBe("United States");
  });

  it("returns the locally cached list from GET /api/jobs", async () => {
    const r = await realFetch(`${baseUrl}/api/jobs`, { headers: authed() });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { jobs: Array<{ projectId: number }> };
    expect(body.jobs.map((j) => j.projectId)).toEqual([100001, 100002]);
  });

  it("returns 404 for an unknown project id", async () => {
    const r = await realFetch(`${baseUrl}/api/jobs/999999`, { headers: authed() });
    expect(r.status).toBe(404);
  });

  it("fetches the detail shape and splits the description into paragraphs", async () => {
    const r = await realFetch(`${baseUrl}/api/jobs/100001`, { headers: authed() });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      job: {
        projectId: number;
        description: string[];
        clientInfo: { country: string; memberSinceLabel: string; hireRateLabel: string; reputationScore?: number | null };
        insights: { bidCount: number; avgBidLabel: string; highBidLabel: string; lowBidLabel: string };
        suggestion: { verdict: string; score: number; summary: string };
        projectType?: string | null;
        bidPeriod?: number | null;
        upgrades?: { featured: boolean; urgent: boolean; sealed: boolean };
        competition?: { bidCount: number; minBid: number | null; maxBid: number | null; medianBid: number | null; isCheapest: boolean } | null;
        status: string;
        matchScore?: number;
      };
    };
    expect(body.job.projectId).toBe(100001);
    expect(body.job.description).toEqual([
      "We need a React dashboard.",
      "With charts and a dark mode.",
    ]);
    // Owner info now comes from the API response.
    expect(body.job.clientInfo.country).toBe("Germany");
    expect(body.job.clientInfo.memberSinceLabel).toMatch(/2023/);
    expect(body.job.clientInfo.hireRateLabel).toBe("85%");
    expect(body.job.clientInfo.reputationScore).toBe(0.85);
    // Expanded project context fields.
    expect(body.job.projectType).toBe("fixed");
    expect(body.job.bidPeriod).toBe(7);
    expect(body.job.upgrades).toEqual({ featured: false, urgent: false, sealed: false });
    // Competition data from fetched bids.
    expect(body.job.competition).toBeDefined();
    if (body.job.competition) {
      expect(body.job.competition.bidCount).toBe(4);
      expect(body.job.competition.minBid).toBe(200);
      expect(body.job.competition.maxBid).toBe(450);
      expect(body.job.competition.isCheapest).toBe(true);
    }
    expect(body.job.insights.bidCount).toBe(4);
    expect(body.job.insights.avgBidLabel).toBe("$250");
    expect(body.job.insights.highBidLabel).toBe("$400");
    expect(body.job.insights.lowBidLabel).toBe("$100");
    // Not analyzed yet — suggestion block is a clear placeholder.
    expect(body.job.suggestion.score).toBe(0);
    expect(body.job.suggestion.verdict).toBe("fair");
    expect(body.job.status).toBe("new");
  });

  it("runs the AI analyzer and persists the result", async () => {
    const r = await realFetch(`${baseUrl}/api/jobs/100001/analyze`, {
      method: "POST",
      headers: authed(),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      analysis: { relevancyScore: number; recommendedBid: string; matchedSkills: string[] };
    };
    expect(body.analysis.relevancyScore).toBe(78);
    expect(body.analysis.recommendedBid).toBe("—");
    expect(body.analysis.matchedSkills).toEqual(["React.js", "Node.js"]);

    // Re-fetching the detail must now surface the stored analysis.
    const detail = await realFetch(`${baseUrl}/api/jobs/100001`, { headers: authed() });
    const detailBody = (await detail.json()) as {
      job: { status: string; matchScore?: number; suggestion: { score: number; verdict: string; summary: string } };
    };
    expect(detailBody.job.status).toBe("analyzed");
    expect(detailBody.job.matchScore).toBe(78);
    expect(detailBody.job.suggestion.score).toBe(78);
    expect(detailBody.job.suggestion.verdict).toBe("good");
    expect(detailBody.job.suggestion.summary).toMatch(/React\/Node\.js/);
  });

  it("ignores a job and returns 404 when the project doesn't exist", async () => {
    const ok = await realFetch(`${baseUrl}/api/jobs/100001/ignore`, {
      method: "POST",
      headers: authed(),
    });
    expect(ok.status).toBe(200);

    const missing = await realFetch(`${baseUrl}/api/jobs/100003/ignore`, {
      method: "POST",
      headers: authed(),
    });
    expect(missing.status).toBe(404);
  });

  it("fetches a job by URL or bare numeric id via /by-url", async () => {
    const r = await realFetch(`${baseUrl}/api/jobs/by-url`, {
      method: "POST",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ url: "https://www.freelancer.com/projects/100001" }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { job: { projectId: number } };
    expect(body.job.projectId).toBe(100001);
  });

  it("marks jobs from ignored countries as ignored during search", async () => {
    // The ignore list comes from the saved profile. Job 100001 is from
    // Germany (both location.country and owner_info.country); job 100002
    // is from the United States. Regression: the ingest-time check used to
    // pass `owner_info.country.name` (a bare string) into isCountryIgnored,
    // which expects a { name, code } object — so it always returned false.
    const profileSave = await realFetch(`${baseUrl}/api/profile`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        freelancerUsername: "irfan_dev",
        name: "Irfan Developer",
        title: "Full-stack developer",
        hourlyRate: "$35/hr",
        about: "I build React + Node dashboards.",
        skills: ["React.js", "Node.js"],
        skillIds: [759, 500],
        experience: [],
        portfolio: [],
        certifications: [],
        preferredProjectTypes: ["Fixed price"],
        wants: ["React"],
        notWants: ["crypto"],
        ignoredCountries: ["Germany"],
        customInstructions: null,
      }),
    });
    expect(profileSave.status).toBe(200);

    const search = await realFetch(`${baseUrl}/api/jobs/search`, {
      headers: authed(),
    });
    expect(search.status).toBe(200);
    const body = (await search.json()) as {
      jobs: Array<{ projectId: number; status: string }>;
    };
    const germany = body.jobs.find((j) => j.projectId === 100001);
    const us = body.jobs.find((j) => j.projectId === 100002);
    expect(germany?.status).toBe("ignored");
    expect(us?.status).toBe("new");

    // The ignored job must be stored as a minimal marker — no rawData — while
    // the non-ignored job keeps its full payload.
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("../src/db/index.js");
    const { jobs } = await import("../src/db/schema.js");
    const germanyRow = getDb()
      .select()
      .from(jobs)
      .where(eq(jobs.projectId, 100001))
      .get();
    expect(germanyRow?.status).toBe("ignored");
    expect(germanyRow?.rawData).toBeNull();
    const usRow = getDb()
      .select()
      .from(jobs)
      .where(eq(jobs.projectId, 100002))
      .get();
    expect(usRow?.rawData).toBeTruthy();
  });

  it("labels stored jobs with their ignore reason and bid state on the list", async () => {
    // Force a deterministic ignore reason, then attach a placed auto-bid to a
    // separate job so the cached list can label both.
    const ignore = await realFetch(`${baseUrl}/api/jobs/100001/ignore`, {
      method: "POST",
      headers: authed(),
    });
    expect(ignore.status).toBe(200);

    const { getDb } = await import("../src/db/index.js");
    const { users, userBids } = await import("../src/db/schema.js");
    const user = getDb()
      .select({ id: users.id })
      .from(users)
      .limit(1)
      .get();
    if (user === undefined) throw new Error("No user row to attach a placed bid to");

    const now = new Date().toISOString();
    getDb()
      .insert(userBids)
      .values({
        id: `bid-100002-${Date.now()}`,
        userId: user.id,
        projectId: 100002,
        jobTitle: "Build a React dashboard",
        client: "Acme Client",
        amount: 250,
        period: 7,
        description: "Submitted proposal text",
        status: "submitted",
        outcome: "won",
        via: "auto",
        submittedAt: now,
        updatedAt: now,
      })
      .run();

    const r = await realFetch(`${baseUrl}/api/jobs?limit=100`, { headers: authed() });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      jobs: Array<{
        projectId: number;
        status: string;
        rejectionReason: string | null;
        bidded: boolean;
        bidVia: string | null;
        bidOutcome: string | null;
      }>;
    };

    const ignored = body.jobs.find((job) => job.projectId === 100001);
    expect(ignored?.status).toBe("ignored");
    expect(ignored?.rejectionReason).toBe("Marked ignored by you.");
    expect(ignored?.bidded).toBe(false);

    const bidded = body.jobs.find((job) => job.projectId === 100002);
    expect(bidded?.bidded).toBe(true);
    expect(bidded?.bidVia).toBe("auto");
    expect(bidded?.bidOutcome).toBe("won");
  });
});
