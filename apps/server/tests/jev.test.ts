import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

/**
 * Jev decision model as the relevance-gate engine.
 *
 * OpenRouter exposes Jev on a separate Decisions endpoint, so most of these
 * tests assert WHICH endpoint was called — a Jev-enabled gate must never fall
 * through to the chat endpoint unless Jev actually failed.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const { createApp } = await import("../src/app.js");
const { closeDb } = await import("../src/db/index.js");
const {
  buildJevState,
  validateJevGateOutput,
  scoreFromLevelIndex,
  JEV_DECIDING_FACTORS,
  JEV_SCORE_LEVELS,
  buildJevGateQuestions,
  buildDeliveryPeriodQuestion,
  buildBidAmountQuestion,
  readAnswerChoice,
} = await import("../src/modules/ai/jev.service.js");

let app: Express;
let baseUrl: string;
let server: ReturnType<Express["listen"]>;
let cookie: string | null = null;
let realFetch: typeof fetch;

/** Minimal Freelancer project the jobs pipeline can analyze. */
const PROJECT = {
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
  location: { country: { name: "Germany", code: "de" } },
};

const PROFILE = {
  freelancerUsername: "owner",
  name: "Owner",
  title: "Full-stack developer",
  hourlyRate: "$35/hr",
  about: "React + Node dashboards.",
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
};

/**
 * A fetch stub routing the three upstreams we care about. `onDecisions` and
 * `onChat` let a test decide what each endpoint returns, or throw to prove an
 * endpoint was never reached. Anything else 404s.
 *
 * The returned counters matter where a test expects an ERROR status: a throw
 * from an unconfigured handler would be masked by the error being expected, so
 * "the chat model was never used" has to be asserted by count instead.
 */
function stubUpstreams(handlers: {
  decisions?: (body: Record<string, unknown>) => Response;
  chat?: () => Response;
}): { chatCalls: number; decisionsCalls: number } {
  const calls = { chatCalls: 0, decisionsCalls: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);

      if (url.includes("openrouter.ai/api/alpha/decisions")) {
        calls.decisionsCalls += 1;
        if (handlers.decisions === undefined) {
          throw new Error("Jev decisions endpoint was called but not expected");
        }
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return handlers.decisions(body);
      }
      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        calls.chatCalls += 1;
        if (handlers.chat === undefined) {
          throw new Error("Chat completions endpoint was called but not expected");
        }
        return handlers.chat();
      }
      if (url.includes("freelancer.com/api/projects/0.1/projects/200001")) {
        return new Response(
          JSON.stringify({ status: "success", result: PROJECT }),
          { status: 200 }
        );
      }
      if (url.includes("freelancer.com/api/users/0.1/self")) {
        return new Response(
          JSON.stringify({ status: "success", result: { id: 1, username: "owner" } }),
          { status: 200 }
        );
      }
      if (url.includes("openrouter.ai/api/v1/key")) {
        return new Response(
          JSON.stringify({ data: { label: "Key", usage: 1, limit: 10 } }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    })
  );
  return calls;
}

/**
 * A Jev answer. A `score` question is answered as the POSITION on the ordered
 * level scale — 0-5 for our six levels, not a 0-100 number — so the default
 * sits at index 4, the lowest level eligible for automatic bidding.
 */
function jevAnswers(levelIndex = 4, factor = "good_fit", confidence = 0.93): Response {
  return new Response(
    JSON.stringify({
      model: "typesafe/jev-1.13",
      provider: "typesafe",
      usage: { cost: 0.00003, inputTokens: 900, outputTokens: 0 },
      answers: {
        score: {
          type: "score",
          score: levelIndex,
          probabilities: [0, 0, 0, 0.1, 0.8, 0.1],
          confidence,
          legend: { "0": "Unusable", "5": "Ideal" },
        },
        deciding_factor: {
          choice: factor,
          confidence,
          probabilities: { [factor]: confidence },
        },
      },
    }),
    { status: 200 }
  );
}

/**
 * The chat-model answer. Used by the chat-engine test, and wired up (but
 * expected to go uncalled) wherever a test asserts the chat model was NOT the
 * engine that screened the job.
 */
function chatAnswers(): Response {
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

async function setEngine(body: Record<string, string>): Promise<number> {
  const res = await realFetch(`${baseUrl}/api/credentials/openrouter/model`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return res.status;
}

async function analyzeProject(): Promise<{
  status: number;
  analysis: { relevancyScore: number; analysis: string; concerns: string[] };
}> {
  const res = await realFetch(`${baseUrl}/api/jobs/200001/analyze`, {
    method: "POST",
    headers: authed(),
  });
  const body = (await res.json()) as {
    analysis: { relevancyScore: number; analysis: string; concerns: string[] };
  };
  return { status: res.status, analysis: body.analysis };
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

  const register = await realFetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Owner",
      email: "owner-jev@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = register.headers.get("set-cookie")?.split(";")[0] ?? null;

  stubUpstreams({
    chat: () => new Response("unused", { status: 200 }),
  });

  for (const [platform, value] of [
    ["freelancer", "frl_jev_test_token"],
    ["openrouter", "sk-or-v1-jev-test"],
  ] as const) {
    const res = await realFetch(`${baseUrl}/api/credentials/${platform}`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ value }),
    });
    if (res.status !== 200) {
      throw new Error(`Failed to save ${platform} credential: ${res.status}`);
    }
  }

  const profileRes = await realFetch(`${baseUrl}/api/profile`, {
    method: "PUT",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify(PROFILE),
  });
  if (profileRes.status !== 200) {
    throw new Error(`Failed to save profile: ${profileRes.status}`);
  }
});

afterAll(() => {
  vi.unstubAllGlobals();
  server.close();
  closeDb();
});

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie ?? "", ...extra };
}

describe("buildJevState (pure)", () => {
  it("pre-computes the numeric comparisons Jev should not have to make", () => {
    const state = buildJevState({
      jobTitle: "React dashboard",
      jobDescription: ["Build a dashboard"],
      client: {
        country: "Germany",
        paymentVerified: true,
        emailVerified: false,
        depositMade: null,
        accountAgeLabel: "account is established (registered ~14 years ago)",
        reputationLabel: "5.0/5 from 10 ratings",
        upgrades: ["NDA", "Recruiter"],
      },
      budgetLabel: "$100 – $500",
      projectType: "fixed",
      bidCount: 22,
    });

    // Raw counts are classified here, not left for the model to compare.
    expect(state["bid_volume"]).toBe("high");
    expect(state["client_payment_verified"]).toBe("Yes");
    expect(state["client_email_verified"]).toBe("No");
    expect(state["client_deposit_made"]).toBe("Unknown");
    // An NDA upgrade is surfaced as a resolved flag, not a flags list alone.
    expect(state["requires_signature"]).toBe("Yes");
  });

  it("bands bid volume without touching the model", () => {
    const band = (bidCount: number | undefined) =>
      buildJevState({ jobTitle: "t", jobDescription: [], bidCount })["bid_volume"];
    expect(band(0)).toBe("none");
    expect(band(3)).toBe("low");
    expect(band(10)).toBe("moderate");
    expect(band(22)).toBe("high");
    expect(band(90)).toBe("very high");
    expect(band(undefined)).toBe("unknown");
  });

  it("reports no signature requirement for an unupgraded project", () => {
    const state = buildJevState({
      jobTitle: "React dashboard",
      jobDescription: [],
      client: {
        paymentVerified: null,
        emailVerified: null,
        depositMade: null,
        upgrades: ["Recruiter"],
      },
    });
    expect(state["requires_signature"]).toBe("No");
    expect(state["client_upgrades"]).toBe("Recruiter");
  });
});

describe("scoreFromLevelIndex (pure)", () => {
  it("maps the six evenly spaced levels onto 0-100", () => {
    const levels = JEV_SCORE_LEVELS.length;
    expect(scoreFromLevelIndex(0, levels)).toBe(0);
    expect(scoreFromLevelIndex(3, levels)).toBe(60);
    // The two boundaries the app's thresholds sit on.
    expect(scoreFromLevelIndex(4, levels)).toBe(80);
    expect(scoreFromLevelIndex(5, levels)).toBe(100);
  });

  it("keeps a fractional position between two levels", () => {
    expect(scoreFromLevelIndex(3.5, JEV_SCORE_LEVELS.length)).toBe(70);
  });

  it("rejects a position outside the scale", () => {
    // A 0-100 answer read as a position is the failure this guards: a perfect
    // job would score about 5/100 and be dropped by the relevance floor.
    expect(() => scoreFromLevelIndex(88, JEV_SCORE_LEVELS.length)).toThrow(
      /outside the 0-5 level scale/
    );
    expect(() => scoreFromLevelIndex(-1, JEV_SCORE_LEVELS.length)).toThrow(
      /outside the 0-5 level scale/
    );
    expect(() => scoreFromLevelIndex(Number.NaN, JEV_SCORE_LEVELS.length)).toThrow(
      /outside the 0-5 level scale/
    );
  });
});

describe("validateJevGateOutput (pure)", () => {
  it("reads the level position and converts it to a 0-100 score", () => {
    const parsed = validateJevGateOutput({
      answers: {
        score: { type: "score", score: 4, confidence: 0.8 },
        deciding_factor: { choice: "good_fit", confidence: 0.88 },
      },
    });
    // Index 4 of six levels is the auto-bid floor.
    expect(parsed.score).toBe(80);
    expect(parsed.factor).toBe("good_fit");
    expect(parsed.confidence).toBe(0.88);
  });

  it("scores the top level as 100, not as 5", () => {
    const parsed = validateJevGateOutput({
      answers: { score: { score: 5 }, deciding_factor: { choice: "good_fit" } },
    });
    expect(parsed.score).toBe(100);
  });

  it("accepts a bare number score and a bare string choice", () => {
    const parsed = validateJevGateOutput({
      answers: { score: 3, deciding_factor: "too_many_bids" },
    });
    expect(parsed.score).toBe(60);
    expect(parsed.factor).toBe("too_many_bids");
    expect(parsed.confidence).toBeNull();
  });

  it("rejects a score that is not a position on the level scale", () => {
    expect(() =>
      validateJevGateOutput({
        answers: { score: 140, deciding_factor: { choice: "good_fit" } },
      })
    ).toThrow(/outside the 0-5 level scale/);
  });

  it("rejects a missing score", () => {
    expect(() =>
      validateJevGateOutput({ answers: { deciding_factor: { choice: "good_fit" } } })
    ).toThrow(/missing or not a number/);
  });

  it("rejects a deciding factor that is not one of ours", () => {
    expect(() =>
      validateJevGateOutput({
        answers: { score: 4, deciding_factor: { choice: "vibes_are_off" } },
      })
    ).toThrow(/not one of the known factors/);
  });

  it("rejects a response with no answers at all", () => {
    expect(() => validateJevGateOutput({})).toThrow(/missing or not a number/);
  });

  it("every factor in the vocabulary is renderable", () => {
    for (const factor of JEV_DECIDING_FACTORS) {
      const parsed = validateJevGateOutput({
        answers: { score: 3, deciding_factor: { choice: factor } },
      });
      expect(parsed.factor).toBe(factor);
    }
  });
});

describe("relevance gate on Jev", () => {
  afterAll(async () => {
    // Leave the installation on the default engine for any later test.
    await setEngine({ analysisEngine: "llm" });
  });

  it("scores with Jev and renders the reason from the chosen factor", async () => {
    expect(await setEngine({ analysisEngine: "jev" })).toBe(200);

    let sent: Record<string, unknown> | null = null;
    stubUpstreams({
      decisions: (body) => {
        sent = body;
        return jevAnswers();
      },
    });

    const { status, analysis } = await analyzeProject();
    expect(status).toBe(200);
    // Jev answered index 4 of six levels, i.e. the auto-bid floor at 80.
    expect(analysis.relevancyScore).toBe(80);
    // Jev cannot write prose — the sentence comes from our factor map.
    expect(analysis.analysis).toBe("Strong match with your profile skills.");

    // The request must carry the state plus both questions.
    expect(sent?.["model"]).toBe("typesafe/jev-1.13");
    const state = sent?.["state"] as Record<string, string> | undefined;
    expect(state?.["job_title"]).toBe("React dashboard with charts");
    expect(state?.["bid_volume"]).toBe("low");
    expect(state?.["client_payment_verified"]).toBe("Unknown");
    const questions = sent?.["questions"] as
      | Record<string, { type: string; criteria?: unknown }>
      | undefined;
    expect(questions?.["score"]?.type).toBe("score");
    // A score question is rejected by the API unless `criteria` is an ORDERED
    // ARRAY of levels the answer's position indexes into.
    expect(Array.isArray(questions?.["score"]?.criteria)).toBe(true);
    expect(questions?.["score"]?.criteria).toEqual([...JEV_SCORE_LEVELS]);
    expect(questions?.["deciding_factor"]?.type).toBe("choice");
    // The choice question must define every factor we accept, or the model
    // could return a factor we cannot render.
    const factorCriteria = questions?.["deciding_factor"]?.criteria as
      | Record<string, string>
      | undefined;
    expect(Object.keys(factorCriteria ?? {}).sort()).toEqual(
      [...JEV_DECIDING_FACTORS].sort()
    );
  });

  it("fails loudly when Jev fails, instead of screening on the chat model", async () => {
    expect(await setEngine({ analysisEngine: "jev" })).toBe(200);

    const calls = stubUpstreams({
      decisions: () => new Response("alpha endpoint exploded", { status: 500 }),
      chat: chatAnswers,
    });

    const { status } = await analyzeProject();
    // Screened by the configured engine or not at all. Falling back to the
    // relevance model is what made a broken Jev setup look healthy.
    expect(status).toBe(502);
    expect(calls.chatCalls).toBe(0);
  });

  it("fails loudly when Jev answers with an unusable factor", async () => {
    expect(await setEngine({ analysisEngine: "jev" })).toBe(200);

    const calls = stubUpstreams({
      decisions: () =>
        new Response(
          JSON.stringify({
            answers: { score: { score: 4 }, deciding_factor: { choice: "nonsense" } },
          }),
          { status: 200 }
        ),
      chat: chatAnswers,
    });

    const { status } = await analyzeProject();
    expect(status).toBe(500);
    expect(calls.chatCalls).toBe(0);
  });

  it("fails rather than mis-scoring an answer given on the wrong scale", async () => {
    expect(await setEngine({ analysisEngine: "jev" })).toBe(200);

    const calls = stubUpstreams({
      // 88 is a 0-100 answer, not a position on a six-level scale.
      decisions: () =>
        new Response(
          JSON.stringify({
            answers: { score: { score: 88 }, deciding_factor: { choice: "good_fit" } },
          }),
          { status: 200 }
        ),
      chat: chatAnswers,
    });

    const { status } = await analyzeProject();
    expect(status).toBe(500);
    expect(calls.chatCalls).toBe(0);
  });

  it("never touches the decisions endpoint when the engine is the chat model", async () => {
    expect(await setEngine({ analysisEngine: "llm" })).toBe(200);

    // `decisions` is left undefined, so the stub throws if it is reached.
    stubUpstreams({ chat: chatAnswers });

    const { status, analysis } = await analyzeProject();
    expect(status).toBe(200);
    expect(analysis.relevancyScore).toBe(72);
  });
});

describe("delivery timeline question", () => {
  const TIMELINE = {
    options: [1, 3, 5, 7, 10],
    instructions: "Pick the shortest honest timeline.",
  };

  it("asks only the two usual questions when the timeline is off", () => {
    expect(Object.keys(buildJevGateQuestions())).toEqual(["score", "deciding_factor"]);
    expect(buildJevGateQuestions(undefined)["delivery_period"]).toBeUndefined();
  });

  it("adds a choice question whose keys are the offered days", () => {
    const questions = buildJevGateQuestions(TIMELINE);
    const question = questions["delivery_period"];
    expect(question?.type).toBe("choice");
    expect(Object.keys((question as { criteria: object }).criteria)).toEqual([
      "1",
      "3",
      "5",
      "7",
      "10",
    ]);
  });

  it("carries the user's instructions into the question", () => {
    const question = buildDeliveryPeriodQuestion(TIMELINE) as {
      instructions: string;
    };
    expect(question.instructions).toContain("Pick the shortest honest timeline.");
  });

  it("dedupes and sorts the offered days", () => {
    const question = buildDeliveryPeriodQuestion({
      options: [10, 1, 1, 3],
      instructions: "Any.",
    }) as { criteria: Record<string, string> };
    expect(Object.keys(question.criteria)).toEqual(["1", "3", "10"]);
  });

  it("asks nothing when the user's list has no usable days", () => {
    // An empty `criteria` would leave the model nothing to answer, so the
    // question is omitted rather than sent broken.
    expect(buildDeliveryPeriodQuestion({ options: [], instructions: "Any." })).toBeNull();
    expect(
      buildJevGateQuestions({ options: [0, -1], instructions: "Any." })["delivery_period"]
    ).toBeUndefined();
  });

  it("reads the answer as a day count", () => {
    const response = {
      answers: { score: 4, deciding_factor: { choice: "good_fit" }, delivery_period: { choice: "3" } },
    };
    const parsed = validateJevGateOutput(response, [1, 3, 5, 7, 10]);
    expect(parsed.deliveryDays).toBe(3);
    expect(parsed.score).toBe(scoreFromLevelIndex(4, JEV_SCORE_LEVELS.length));
  });

  it("tolerates a bare string answer", () => {
    expect(readAnswerChoice("7", ["1", "7"])).toBe("7");
    expect(
      validateJevGateOutput(
        { answers: { score: 4, deciding_factor: { choice: "good_fit" }, delivery_period: "7" } },
        [1, 7]
      ).deliveryDays
    ).toBe(7);
  });

  it("nulls an answer that is missing or was never on offer", () => {
    const base = { answers: { score: 4, deciding_factor: { choice: "good_fit" } } };
    expect(validateJevGateOutput(base, [1, 3]).deliveryDays).toBeNull();
    expect(
      validateJevGateOutput(
        { answers: { ...base.answers, delivery_period: { choice: "4" } } },
        [1, 3]
      ).deliveryDays
    ).toBeNull();
  });

  it("keeps the result shape unchanged when no timeline was asked for", () => {
    // Every pre-feature caller reads this object and must not see a new key.
    const parsed = validateJevGateOutput({
      answers: { score: 4, deciding_factor: { choice: "good_fit" } },
    });
    expect(parsed).toEqual({
      score: scoreFromLevelIndex(4, JEV_SCORE_LEVELS.length),
      factor: "good_fit",
      confidence: null,
    });
  });
});

describe("bid amount question", () => {
  const BID_AMOUNT = {
    options: [250, 375, 500, 750],
    instructions: "Quote a bid that balances win probability with profit.",
  };

  it("asks only the two usual questions when bid amount is off", () => {
    expect(Object.keys(buildJevGateQuestions())).toEqual(["score", "deciding_factor"]);
    expect(buildJevGateQuestions(undefined, undefined)["bid_amount"]).toBeUndefined();
  });

  it("adds a choice question whose keys are the offered dollar values", () => {
    const questions = buildJevGateQuestions(undefined, BID_AMOUNT);
    const question = questions["bid_amount"];
    expect(question?.type).toBe("choice");
    expect(Object.keys((question as { criteria: object }).criteria)).toEqual([
      "250",
      "375",
      "500",
      "750",
    ]);
  });

  it("carries the user's instructions into the question", () => {
    const question = buildBidAmountQuestion(BID_AMOUNT) as {
      instructions: string;
    };
    expect(question.instructions).toContain(
      "Quote a bid that balances win probability with profit."
    );
  });

  it("dedupes and sorts the offered dollar amounts", () => {
    const question = buildBidAmountQuestion({
      options: [750, 250, 250, 500],
      instructions: "Any.",
    }) as { criteria: Record<string, string> };
    expect(Object.keys(question.criteria)).toEqual(["250", "500", "750"]);
  });

  it("asks nothing when the options list has no usable amounts", () => {
    expect(buildBidAmountQuestion({ options: [], instructions: "Any." })).toBeNull();
    expect(
      buildJevGateQuestions(undefined, { options: [0, -100], instructions: "Any." })[
        "bid_amount"
      ]
    ).toBeUndefined();
  });

  it("reads the answer as a dollar number", () => {
    const response = {
      answers: {
        score: 4,
        deciding_factor: { choice: "good_fit" },
        bid_amount: { choice: "500" },
      },
    };
    const parsed = validateJevGateOutput(response, null, [250, 500, 750]);
    expect(parsed.bidAmount).toBe(500);
    expect(parsed.score).toBe(scoreFromLevelIndex(4, JEV_SCORE_LEVELS.length));
  });

  it("tolerates a bare string answer", () => {
    expect(
      validateJevGateOutput(
        {
          answers: {
            score: 4,
            deciding_factor: { choice: "good_fit" },
            bid_amount: "750",
          },
        },
        null,
        [250, 750]
      ).bidAmount
    ).toBe(750);
  });

  it("nulls an answer that is missing or was never on offer", () => {
    const base = { answers: { score: 4, deciding_factor: { choice: "good_fit" } } };
    expect(validateJevGateOutput(base, null, [250, 500]).bidAmount).toBeNull();
    expect(
      validateJevGateOutput(
        { answers: { ...base.answers, bid_amount: { choice: "100" } } },
        null,
        [250, 500]
      ).bidAmount
    ).toBeNull();
  });

  it("keeps the result shape unchanged when no bid amount was asked for", () => {
    const parsed = validateJevGateOutput({
      answers: { score: 4, deciding_factor: { choice: "good_fit" } },
    });
    expect(parsed).toEqual({
      score: scoreFromLevelIndex(4, JEV_SCORE_LEVELS.length),
      factor: "good_fit",
      confidence: null,
    });
  });
});

describe("Jev engine test action", () => {
  it("reports success when the decisions endpoint answers", async () => {
    let sent: Record<string, unknown> | null = null;
    stubUpstreams({
      decisions: (body) => {
        sent = body;
        return jevAnswers(5, "good_fit", 0.9);
      },
    });
    const res = await realFetch(`${baseUrl}/api/credentials/openrouter/test-jev`, {
      method: "POST",
      headers: authed(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { ok: boolean; message: string } };
    expect(body.result.ok).toBe(true);
    expect(body.result.message).toMatch(/reachable/i);

    // The probe must send the gate's own score question, criteria included —
    // a simpler probe would report success while every real screening failed.
    const questions = sent?.["questions"] as
      | Record<string, { type?: string; criteria?: unknown }>
      | undefined;
    expect(questions?.["score"]?.type).toBe("score");
    expect(questions?.["score"]?.criteria).toEqual([...JEV_SCORE_LEVELS]);
  });

  it("probes with the delivery-time question when the user has it on", async () => {
    // The Decisions API validates shapes strictly, and this project has already
    // shipped a bug where a rejected shape 400'd every screening call while the
    // connectivity probe still reported success. So the probe has to send the
    // gate's exact question set, timeline question included.
    await realFetch(`${baseUrl}/api/automation`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        aiDeliveryTimeline: true,
        deliveryTimelineOptions: [1, 3, 5, 7, 10],
      }),
    });

    let sent: Record<string, unknown> | null = null;
    try {
      stubUpstreams({
        decisions: (body) => {
          sent = body;
          return jevAnswers(5, "good_fit", 0.9);
        },
      });
      const res = await realFetch(`${baseUrl}/api/credentials/openrouter/test-jev`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { ok: boolean; message: string } };
      expect(body.result.ok).toBe(true);

      const questions = sent?.["questions"] as
        | Record<string, { type?: string; criteria?: unknown }>
        | undefined;
      expect(questions?.["delivery_period"]?.type).toBe("choice");
      expect(Object.keys(questions?.["delivery_period"]?.criteria ?? {})).toEqual([
        "1",
        "3",
        "5",
        "7",
        "10",
      ]);
    } finally {
      await realFetch(`${baseUrl}/api/automation`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ aiDeliveryTimeline: false }),
      });
      vi.unstubAllGlobals();
    }
  });

  it("probes with the bid-amount question when the user has it on", async () => {
    await realFetch(`${baseUrl}/api/automation`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        aiBidAmount: true,
        bidAmountFractions: ["1/2", "full"],
      }),
    });

    let sent: Record<string, unknown> | null = null;
    try {
      stubUpstreams({
        decisions: (body) => {
          sent = body;
          return jevAnswers(5, "good_fit", 0.9);
        },
      });
      const res = await realFetch(`${baseUrl}/api/credentials/openrouter/test-jev`, {
        method: "POST",
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { ok: boolean; message: string } };
      expect(body.result.ok).toBe(true);

      const questions = sent?.["questions"] as
        | Record<string, { type?: string; criteria?: unknown }>
        | undefined;
      expect(questions?.["bid_amount"]?.type).toBe("choice");
      // The probe uses a round $500 max budget, so 1/2 and full become $250 and $500.
      expect(Object.keys(questions?.["bid_amount"]?.criteria ?? {})).toEqual([
        "250",
        "500",
      ]);
    } finally {
      await realFetch(`${baseUrl}/api/automation`, {
        method: "PUT",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ aiBidAmount: false }),
      });
      vi.unstubAllGlobals();
    }
  });

  it("reports failure when the answer does not land on the score scale", async () => {
    stubUpstreams({
      decisions: () =>
        new Response(
          JSON.stringify({ answers: { score: { score: 88 } } }),
          { status: 200 }
        ),
    });
    const res = await realFetch(`${baseUrl}/api/credentials/openrouter/test-jev`, {
      method: "POST",
      headers: authed(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { ok: boolean; message: string } };
    expect(body.result.ok).toBe(false);
    expect(body.result.message).toMatch(/level scale/);
  });

  it("reports the upstream message when the model id is wrong", async () => {
    stubUpstreams({
      decisions: () => new Response("model not found", { status: 404 }),
    });
    const res = await realFetch(`${baseUrl}/api/credentials/openrouter/test-jev`, {
      method: "POST",
      headers: authed(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { ok: boolean; message: string } };
    expect(body.result.ok).toBe(false);
    expect(body.result.message).toMatch(/rejected the request/i);
  });

  it("does not mark the credential as failed", async () => {
    stubUpstreams({ decisions: () => new Response("boom", { status: 500 }) });
    await realFetch(`${baseUrl}/api/credentials/openrouter/test-jev`, {
      method: "POST",
      headers: authed(),
    });
    const res = await realFetch(`${baseUrl}/api/credentials`, { headers: authed() });
    const body = (await res.json()) as {
      credentials: Array<{ id: string; status: string }>;
    };
    // The gate may legitimately run on the LLM, so a Jev-only failure must not
    // flip the OpenRouter credential to "failed".
    expect(body.credentials.find((c) => c.id === "openrouter")?.status).toBe("ok");
  });
});
