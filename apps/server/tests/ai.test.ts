import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";

/**
 * AI service: pure relevancy filter and analyzeJob integration.
 * OpenRouter is stubbed at fetch level so a test fails loudly if it gets
 * called when the relevancy filter is supposed to short-circuit.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const { applyRelevancyFilter, isCountryIgnored } = await import("../src/modules/ai/relevancy.js");
const { createApp } = await import("../src/app.js");
const { closeDb } = await import("../src/db/index.js");
const {
  validateRelevancyOutput,
  validateAnalysisOutput,
  buildRelevancyResponseFormat,
  readDeliveryDays,
  readBidAmount,
} = await import("../src/modules/ai/ai.service.js");

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

  // We start each test with a fresh fetch stub so the global fake
  // doesn't leak between cases. The default is a 404 (so the AI route
  // will fail loudly if the relevancy filter is bypassed).
  const stubFetch = (responses: Record<string, () => Response>) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(baseUrl)) return realFetch(input, init);
        for (const [needle, responder] of Object.entries(responses)) {
          if (url.includes(needle)) return responder();
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      })
    );
  };

  // Register, save both credentials, save a profile.
  const register = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Owner",
      email: "owner-ai@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  stubFetch({
    "freelancer.com/api/users/0.1/self": () =>
      new Response(
        JSON.stringify({ status: "success", result: { id: 1, username: "owner" } }),
        { status: 200 }
      ),
    "openrouter.ai/api/v1/key": () =>
      new Response(JSON.stringify({ data: { label: "Key", usage: 1, limit: 10 } }), { status: 200 }),
    "freelancer.com/api/projects/0.1/projects/active/": () =>
      new Response(
        JSON.stringify({
          status: "success",
          result: {
            projects: [
              {
                id: 200001,
                title: "Build a React dashboard with charts",
                description: "We need a React dashboard with charts.",
                preview_description: "React dashboard with charts.",
                currency: { code: "USD", name: "US Dollar", sign: "$", exchange_rate: 1.0 },
                budget: { minimum: 100, maximum: 500, project_type: "fixed" },
                bid_stats: { bid_count: 3, bid_avg: 300, min_amount: 100, max_amount: 400 },
                time_submitted: Math.floor(Date.now() / 1000) - 60,
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
            ],
          },
        }),
        { status: 200 }
      ),
    "freelancer.com/api/projects/0.1/projects/200001": () =>
      new Response(
        JSON.stringify({
          status: "success",
          result: {
            id: 200001,
            title: "Build a React dashboard with charts",
            description: "We need a React dashboard with charts.",
            preview_description: "React dashboard with charts.",
            currency: { code: "USD", name: "US Dollar", sign: "$", exchange_rate: 1.0 },
            budget: { minimum: 100, maximum: 500, project_type: "fixed" },
            bid_stats: { bid_count: 3, bid_avg: 300, min_amount: 100, max_amount: 400 },
            time_submitted: Math.floor(Date.now() / 1000) - 60,
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
              reputation: { overall: 0.85, positive: 0.9, role: "employer", earnings_score: 0.7 },
              status: { payment_verified: true, email_verified: true, profile_complete: false },
              registration_date: 1700000000,
            },
          },
        }),
        { status: 200 }
      ),
    "freelancer.com/api/projects/0.1/projects/200001/bids/": () =>
      new Response(
        JSON.stringify({
          status: "success",
          result: {
            bids: [
              { id: 1, bidder: { id: 901, name: "ReactDev", username: "reactdev" }, amount: 150, currency: { code: "USD" }, is_cheapest: true, time_submitted: Math.floor(Date.now() / 1000) - 300, description: "React expert" },
              { id: 2, bidder: { id: 902, name: "FullStack", username: "fullstack" }, amount: 300, currency: { code: "USD" }, is_cheapest: false, time_submitted: Math.floor(Date.now() / 1000) - 200, description: "Full stack dev" },
              { id: 3, bidder: { id: 903, name: "SeniorDev", username: "seniordev" }, amount: 450, currency: { code: "USD" }, is_cheapest: false, time_submitted: Math.floor(Date.now() / 1000) - 100, description: "Senior engineer" },
            ],
          },
        }),
        { status: 200 }
      ),
  });

  const credFrl = await fetch(`${baseUrl}/api/credentials/freelancer`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "frl_ai_test_token" }),
  });
  if (credFrl.status !== 200) {
    throw new Error(`Failed to save freelancer credential: ${credFrl.status} ${await credFrl.text()}`);
  }
  const credOr = await fetch(`${baseUrl}/api/credentials/openrouter`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value: "sk-or-v1-ai-test" }),
  });
  if (credOr.status !== 200) {
    throw new Error(`Failed to save openrouter credential: ${credOr.status} ${await credOr.text()}`);
  }

  // Profile with a not-wants filter so the analyze tests can prove
  // OpenRouter is not called.
  const profileRes = await fetch(`${baseUrl}/api/profile`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      freelancerUsername: "owner",
      name: "Owner",
      title: "Full-stack developer",
      hourlyRate: "$35/hr",
      about: "React + Node dashboards.",
      skills: ["React.js", "Node.js"],
      skillIds: [759, 500],
      preferredProjectTypes: ["Fixed price"],
      wants: ["React"],
      notWants: ["crypto"],
      ignoredCountries: [],
      customInstructions: null,
      userSummary: "STALE-SUMMARY-MUST-NOT-BE-USED",
    }),
  });
  if (profileRes.status !== 200) {
    throw new Error(`Failed to save profile: ${profileRes.status} ${await profileRes.text()}`);
  }
});

afterAll(() => {
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

describe("relevancy filter (pure)", () => {
  it("passes when not-wants are clear and skills overlap", () => {
    const decision = applyRelevancyFilter({
      jobTitle: "React dashboard",
      jobDescription: ["Build a dashboard"],
      jobSkills: ["React.js", "Node.js"],
      wants: ["React"],
      notWants: ["crypto"],
      profileSkills: ["React.js", "Node.js"],
    });
    expect(decision.relevant).toBe(true);
  });

  it("fails when a not-wants term appears in the description", () => {
    const decision = applyRelevancyFilter({
      jobTitle: "Anything",
      jobDescription: ["We pay in crypto tokens."],
      jobSkills: ["React.js"],
      wants: [],
      notWants: ["crypto"],
      profileSkills: ["React.js"],
    });
    expect(decision.relevant).toBe(false);
    if (!decision.relevant) {
      expect(decision.reasons[0]).toMatch(/not-wants/i);
    }
  });

  it("fails when none of the wants appear and wants is non-empty", () => {
    const decision = applyRelevancyFilter({
      jobTitle: "Generic work",
      jobDescription: ["Need some help."],
      jobSkills: ["Excel"],
      wants: ["React"],
      notWants: [],
      profileSkills: ["React.js"],
    });
    expect(decision.relevant).toBe(false);
  });

  it("fails when no profile skill matches the job's skills or title", () => {
    const decision = applyRelevancyFilter({
      jobTitle: "Excel spreadsheet wizard",
      jobDescription: ["Macros and VLOOKUP."],
      jobSkills: ["Excel", "VBA"],
      wants: [],
      notWants: [],
      profileSkills: ["React.js", "Node.js"],
    });
    expect(decision.relevant).toBe(false);
  });

  it("passes when profile skills are empty (no keyword constraint)", () => {
    const decision = applyRelevancyFilter({
      jobTitle: "Anything",
      jobDescription: ["Whatever."],
      jobSkills: ["Excel"],
      wants: [],
      notWants: [],
      profileSkills: [],
    });
    expect(decision.relevant).toBe(true);
  });

  it("matches case-insensitively", () => {
    const decision = applyRelevancyFilter({
      jobTitle: "REACT dashboard",
      jobDescription: ["CRYPTO accepted."],
      jobSkills: [],
      wants: ["react"],
      notWants: ["CRYPTO"],
      profileSkills: [],
    });
    // notWants crypto matches in description → fail
    expect(decision.relevant).toBe(false);
  });
});

describe("isCountryIgnored (pure)", () => {
  it("matches the country name", () => {
    expect(isCountryIgnored({ name: "Germany", code: "de" }, ["Germany"])).toBe(true);
  });

  it("matches the ISO code", () => {
    expect(isCountryIgnored({ name: "Germany", code: "de" }, ["DE"])).toBe(true);
    expect(isCountryIgnored({ name: "Germany", code: "de" }, ["de"])).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isCountryIgnored({ name: "  GERMANY  ", code: "de" }, ["germany"])).toBe(true);
  });

  it("matches via partial containment", () => {
    expect(
      isCountryIgnored({ name: "Pakistan, Islamic Republic of", code: "pk" }, ["Pakistan"])
    ).toBe(true);
    expect(
      isCountryIgnored({ name: "Pakistan", code: "pk" }, ["Pakistan, Islamic Republic of"])
    ).toBe(true);
  });

  it("returns false for an empty ignore list", () => {
    expect(isCountryIgnored({ name: "Germany", code: "de" }, [])).toBe(false);
  });

  it("returns false when the country is missing", () => {
    expect(isCountryIgnored(undefined, ["Germany"])).toBe(false);
    expect(isCountryIgnored({}, ["Germany"])).toBe(false);
  });

  it("does not match unrelated countries", () => {
    expect(isCountryIgnored({ name: "Germany", code: "de" }, ["India"])).toBe(false);
    expect(isCountryIgnored({ name: "Germany", code: "de" }, ["France", "Canada"])).toBe(false);
  });
});

describe("analyzeJob integration", () => {
  it("returns score 0 and skips OpenRouter when not-wants matches the job", async () => {
    // The active list above has a React dashboard job. We need a job
    // whose title or description mentions "crypto" to trigger the
    // not-wants filter. Create one by directly calling /by-url with
    // a project id whose detail mentions crypto. Easiest: re-stub the
    // detail endpoint for this test.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(baseUrl)) return realFetch(input, init);
        if (url.includes("freelancer.com/api/projects/0.1/projects/200001")) {
          return new Response(
            JSON.stringify({
              status: "success",
              result: {
                id: 200001,
                title: "React dashboard — paid in crypto",
                description: "We will pay in crypto tokens.",
                preview_description: "Crypto payments only.",
                currency: { code: "USD" },
                budget: { minimum: 100, maximum: 500 },
                bid_stats: { bid_count: 3, bid_avg: 300, min_amount: 100, max_amount: 400 },
                time_submitted: Math.floor(Date.now() / 1000) - 60,
                jobs: [{ id: 759, name: "React.js" }],
                location: { country: { name: "Germany" } },
              },
            }),
            { status: 200 }
          );
        }
        // If OpenRouter is called here, the test must fail.
        if (url.includes("openrouter.ai")) {
          throw new Error("OpenRouter was called despite the relevancy filter");
        }
        return new Response("not found", { status: 404 });
      })
    );

    const r = await realFetch(`${baseUrl}/api/jobs/200001/analyze`, {
      method: "POST",
      headers: authed(),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      analysis: { relevancyScore: number; concerns: string[]; analysis: string };
    };
    expect(body.analysis.relevancyScore).toBe(0);
    expect(body.analysis.concerns.length).toBeGreaterThan(0);
    expect(body.analysis.analysis).toMatch(/filtered/i);
  });

  it("calls OpenRouter and returns the AI verdict when the filter passes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(baseUrl)) return realFetch(input, init);
        if (url.includes("freelancer.com/api/projects/0.1/projects/200001")) {
          return new Response(
            JSON.stringify({
              status: "success",
              result: {
                id: 200001,
                title: "React dashboard with charts",
                description: "We need a React dashboard with charts.",
                preview_description: "React dashboard with charts.",
                currency: { code: "USD" },
                budget: { minimum: 100, maximum: 500 },
                bid_stats: { bid_count: 3, bid_avg: 300, min_amount: 100, max_amount: 400 },
                time_submitted: Math.floor(Date.now() / 1000) - 60,
                jobs: [
                  { id: 759, name: "React.js" },
                  { id: 500, name: "Node.js" },
                ],
                location: { country: { name: "Germany" } },
              },
            }),
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
                      score: 72,
                      reason: "Matches your React and Node.js dashboard skills.",
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

    const r = await realFetch(`${baseUrl}/api/jobs/200001/analyze`, {
      method: "POST",
      headers: authed(),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      analysis: { relevancyScore: number; recommendedBid: string };
    };
    expect(body.analysis.relevancyScore).toBe(72);
    expect(body.analysis.recommendedBid).toMatch(/^\$[\d,]+$/);
  });

  it("enforces a strict relevance JSON schema and caps gate output tokens", async () => {
    // Capture the OpenRouter request body. The relevance-gate call bounds its
    // output (max_tokens) AND sends a provider-enforced `response_format` JSON
    // schema so the gate decision comes back conformant on the user's model
    // (which supports structured outputs), rather than relying on the prompt.
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(baseUrl)) return realFetch(input, init);
        if (url.includes("freelancer.com/api/projects/0.1/projects/200001")) {
          return new Response(
            JSON.stringify({
              status: "success",
              result: {
                id: 200001,
                title: "React dashboard with charts",
                description: "We need a React dashboard with charts.",
                preview_description: "React dashboard with charts.",
                currency: { code: "USD" },
                budget: { minimum: 100, maximum: 500 },
                bid_stats: { bid_count: 3, bid_avg: 300, min_amount: 100, max_amount: 400 },
                time_submitted: Math.floor(Date.now() / 1000) - 60,
                jobs: [
                  { id: 759, name: "React.js" },
                  { id: 500, name: "Node.js" },
                ],
                location: { country: { name: "Germany" } },
              },
            }),
            { status: 200 }
          );
        }
        if (url.includes("openrouter.ai/api/v1/chat/completions")) {
          requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      score: 72,
                      reason: "Matches your React and Node.js dashboard skills.",
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

    const r = await realFetch(`${baseUrl}/api/jobs/200001/analyze`, {
      method: "POST",
      headers: authed(),
    });
    expect(r.status).toBe(200);
    expect(requestBody).not.toBeNull();
    const requestText = JSON.stringify(requestBody);
    expect(requestText).toContain("PROFILE BRIEF");
    expect(requestText).toContain("React.js");
    expect(requestText).not.toContain("STALE-SUMMARY-MUST-NOT-BE-USED");
    // The gate request carries a strict JSON-schema response_format so the
    // model's reply is provider-enforced to the {score, reason} shape.
    const rf = requestBody?.["response_format"] as
      | { type: string; json_schema?: { name?: string; strict?: boolean } }
      | undefined;
    expect(rf?.type).toBe("json_schema");
    expect(rf?.json_schema?.name).toBe("relevancy_check");
    expect(rf?.json_schema?.strict).toBe(true);
    const maxTokens = Number(requestBody?.["max_tokens"]);
    expect(Number.isFinite(maxTokens)).toBe(true);
    expect(maxTokens).toBeLessThanOrEqual(500);
  });

  it("marks a country-ignored job as ignored and never calls OpenRouter", async () => {
    // Put Germany on the ignore list — the job below is from Germany.
    const putRes = await realFetch(`${baseUrl}/api/profile`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        freelancerUsername: "owner",
        name: "Owner",
        title: "Full-stack developer",
        hourlyRate: "$35/hr",
        about: "React + Node dashboards.",
        skills: ["React.js", "Node.js"],
        skillIds: [759, 500],
        preferredProjectTypes: ["Fixed price"],
        wants: ["React"],
        notWants: ["crypto"],
        ignoredCountries: ["Germany"],
        customInstructions: null,
      }),
    });
    expect(putRes.status).toBe(200);

    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          if (url.startsWith(baseUrl)) return realFetch(input, init);
          if (url.includes("freelancer.com/api/projects/0.1/projects/200001")) {
            return new Response(
              JSON.stringify({
                status: "success",
                result: {
                  id: 200001,
                  title: "React dashboard with charts",
                  description: "We need a React dashboard with charts.",
                  preview_description: "React dashboard with charts.",
                  currency: { code: "USD" },
                  budget: { minimum: 100, maximum: 500 },
                  bid_stats: { bid_count: 3, bid_avg: 300, min_amount: 100, max_amount: 400 },
                  time_submitted: Math.floor(Date.now() / 1000) - 60,
                  jobs: [{ id: 759, name: "React.js" }],
                  location: { country: { name: "Germany", code: "de" } },
                },
              }),
              { status: 200 }
            );
          }
          // The AI must never be called for an ignored country.
          if (url.includes("openrouter.ai")) {
            throw new Error("OpenRouter was called despite the ignored country filter");
          }
          return new Response("not found", { status: 404 });
        })
      );

      const r = await realFetch(`${baseUrl}/api/jobs/200001/analyze`, {
        method: "POST",
        headers: authed(),
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as {
        analysis: { relevancyScore: number; concerns: string[]; analysis: string };
      };
      expect(body.analysis.relevancyScore).toBe(0);
      expect(body.analysis.concerns).toContain("Ignored country: Germany");
      expect(body.analysis.analysis).toMatch(/ignore list/i);

      // The job must be stored with status "ignored".
      const { getDb } = await import("../src/db/index.js");
      const { jobs } = await import("../src/db/schema.js");
      const row = getDb()
        .select()
        .from(jobs)
        .where(eq(jobs.projectId, 200001))
        .get();
      expect(row?.status).toBe("ignored");
      expect(row?.ignoredAt).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
      // Restore the empty ignore list so later tests see the original profile.
      await realFetch(`${baseUrl}/api/profile`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          freelancerUsername: "owner",
          name: "Owner",
          title: "Full-stack developer",
          hourlyRate: "$35/hr",
          about: "React + Node dashboards.",
          skills: ["React.js", "Node.js"],
          skillIds: [759, 500],
          preferredProjectTypes: ["Fixed price"],
          wants: ["React"],
          notWants: ["crypto"],
          ignoredCountries: [],
          customInstructions: null,
        }),
      });
    }
  });
});

describe("AI JSON output validation (no JSON mode support)", () => {
  it("parses bare JSON", () => {
    expect(
      validateRelevancyOutput('{"score": 75, "reason": "Skills overlap with profile"}')
    ).toEqual({ score: 75, reason: "Skills overlap with profile" });
  });

  it("parses JSON wrapped in a fenced code block with a language tag", () => {
    const raw = '```json\n{"score": 60, "reason": "Decent overlap on React."}\n```';
    expect(validateRelevancyOutput(raw)).toEqual({
      score: 60,
      reason: "Decent overlap on React.",
    });
  });

  it("parses JSON wrapped in prose and backticks", () => {
    const raw =
      'Here is my assessment:\n\n```\n{"score": 82, "reason": "Strong match on Node skills."}\n```\n\nLet me know if you need more.';
    expect(validateRelevancyOutput(raw)).toEqual({
      score: 82,
      reason: "Strong match on Node skills.",
    });
  });

  it("parses JSON when prose surrounds the object without fences", () => {
    const raw =
      'Sure! Based on the job the score is {"score": 55, "reason": "Partial skill overlap."} as I see it.';
    expect(validateRelevancyOutput(raw)).toEqual({
      score: 55,
      reason: "Partial skill overlap.",
    });
  });

  it("tolerates a trailing comma before the closing brace", () => {
    const raw = '{"score": 70, "reason": "Good overlap.",}';
    expect(validateRelevancyOutput(raw)).toEqual({
      score: 70,
      reason: "Good overlap.",
    });
  });

  it("validates the full analysis object shape", () => {
    const raw = JSON.stringify({
      verdict: "good",
      score: 88,
      summary: "A strong project that fits your React and Node profile well.",
      reasons: ["React.js dashboard experience applies"],
      concerns: [],
      recommendedBidLabel: "$1200 – $1800",
      competitorNote: "4 bids already.",
    });
    const out = validateAnalysisOutput(raw);
    expect(out.verdict).toBe("good");
    expect(out.score).toBe(88);
    expect(out.reasons).toHaveLength(1);
  });

  it("throws a diagnosable error when the model returns nothing usable", () => {
    expect(() => validateRelevancyOutput("I am sorry, I cannot help with that.")).toThrow(
      /could not be parsed as JSON/
    );
  });
});

describe("relevance gate delivery timeline", () => {
  const OPTIONS = [1, 3, 5, 7, 10];
  const answer = (deliveryDays: unknown): string =>
    JSON.stringify({ score: 80, reason: "Good fit.", deliveryDays });

  it("leaves the output shape untouched when no timeline was requested", () => {
    // Every existing caller gets the same object it always got — this is what
    // keeps the pre-feature behavior byte-identical.
    expect(validateRelevancyOutput(answer(3))).toEqual({ score: 80, reason: "Good fit." });
    expect(validateRelevancyOutput(answer(3), null)).toEqual({
      score: 80,
      reason: "Good fit.",
    });
  });

  it("returns the chosen days when they are one of the offered values", () => {
    expect(validateRelevancyOutput(answer(1), OPTIONS)).toEqual({
      score: 80,
      reason: "Good fit.",
      deliveryDays: 1,
    });
  });

  it("nulls a value that was never on offer", () => {
    expect(validateRelevancyOutput(answer(2), OPTIONS).deliveryDays).toBeNull();
  });

  it("nulls a missing, malformed, or fractional value", () => {
    for (const value of [undefined, null, "", "soon", 1.5, {}, []]) {
      expect(validateRelevancyOutput(answer(value), OPTIONS).deliveryDays).toBeNull();
    }
  });

  it("still scores when the timeline is unusable", () => {
    // A bad pick must never cost us the screening: the job is scored and bids
    // fall back to the user's preferred days.
    const parsed = validateRelevancyOutput(answer("nonsense"), OPTIONS);
    expect(parsed.score).toBe(80);
  });

  it("reads a numeric string, but only if the value is on offer", () => {
    expect(readDeliveryDays("10", OPTIONS)).toBe(10);
    expect(readDeliveryDays(" 3 ", OPTIONS)).toBe(3);
    expect(readDeliveryDays("2", OPTIONS)).toBeNull();
    expect(readDeliveryDays("10 days", OPTIONS)).toBeNull();
    expect(readDeliveryDays(true, OPTIONS)).toBeNull();
  });

  it("omits the delivery property from the schema unless it is asked for", () => {
    // `additionalProperties: false` makes an unused property a rejection, so it
    // has to be absent — not merely unrequested.
    expect(JSON.stringify(buildRelevancyResponseFormat(null))).not.toContain("deliveryDays");
    expect(JSON.stringify(buildRelevancyResponseFormat([]))).not.toContain("deliveryDays");

    const schema = buildRelevancyResponseFormat(OPTIONS).json_schema.schema as {
      properties: Record<string, { enum?: number[] }>;
      required: string[];
    };
    expect(schema.properties["deliveryDays"]?.enum).toEqual(OPTIONS);
    expect(schema.required).toContain("deliveryDays");
    expect(schema.required).toContain("score");
  });
});

describe("relevance gate bid amount", () => {
  const OPTIONS = [250, 375, 500, 750];
  const answer = (bidAmount: unknown): string =>
    JSON.stringify({ score: 80, reason: "Good fit.", bidAmount });

  it("leaves the output shape untouched when no bid amount was requested", () => {
    expect(validateRelevancyOutput(answer(500))).toEqual({ score: 80, reason: "Good fit." });
    expect(validateRelevancyOutput(answer(500), null, null)).toEqual({
      score: 80,
      reason: "Good fit.",
    });
  });

  it("returns the chosen bid amount when it is one of the offered values", () => {
    expect(validateRelevancyOutput(answer(375), null, OPTIONS)).toEqual({
      score: 80,
      reason: "Good fit.",
      bidAmount: 375,
    });
  });

  it("nulls a value that was never on offer", () => {
    expect(validateRelevancyOutput(answer(200), null, OPTIONS).bidAmount).toBeNull();
  });

  it("nulls a missing, malformed, or fractional value", () => {
    for (const value of [undefined, null, "", "expensive", 250.5, {}, []]) {
      expect(validateRelevancyOutput(answer(value), null, OPTIONS).bidAmount).toBeNull();
    }
  });

  it("still scores when the bid amount is unusable", () => {
    const parsed = validateRelevancyOutput(answer("nonsense"), null, OPTIONS);
    expect(parsed.score).toBe(80);
    expect(parsed.bidAmount).toBeNull();
  });

  it("reads a numeric string, but only if the value is on offer", () => {
    expect(readBidAmount("750", OPTIONS)).toBe(750);
    expect(readBidAmount(" 500 ", OPTIONS)).toBe(500);
    expect(readBidAmount("200", OPTIONS)).toBeNull();
    expect(readBidAmount("$500", OPTIONS)).toBeNull();
    expect(readBidAmount(true, OPTIONS)).toBeNull();
  });

  it("omits the bidAmount property from the schema unless it is asked for", () => {
    expect(JSON.stringify(buildRelevancyResponseFormat(null, null))).not.toContain("bidAmount");
    expect(JSON.stringify(buildRelevancyResponseFormat(null, []))).not.toContain("bidAmount");

    const schema = buildRelevancyResponseFormat(null, OPTIONS).json_schema.schema as {
      properties: Record<string, { enum?: number[] }>;
      required: string[];
    };
    expect(schema.properties["bidAmount"]?.enum).toEqual(OPTIONS);
    expect(schema.required).toContain("bidAmount");
    expect(schema.required).toContain("score");
  });

  it("supports both delivery timeline and bid amount together in schema and output", () => {
    const deliveryOptions = [1, 3, 5];
    const schema = buildRelevancyResponseFormat(deliveryOptions, OPTIONS).json_schema.schema as {
      properties: Record<string, { enum?: number[] }>;
      required: string[];
    };
    expect(schema.properties["deliveryDays"]?.enum).toEqual(deliveryOptions);
    expect(schema.properties["bidAmount"]?.enum).toEqual(OPTIONS);
    expect(schema.required).toContain("deliveryDays");
    expect(schema.required).toContain("bidAmount");

    const fullAnswer = JSON.stringify({
      score: 85,
      reason: "Great match.",
      deliveryDays: 3,
      bidAmount: 500,
    });
    expect(validateRelevancyOutput(fullAnswer, deliveryOptions, OPTIONS)).toEqual({
      score: 85,
      reason: "Great match.",
      deliveryDays: 3,
      bidAmount: 500,
    });
  });
});

