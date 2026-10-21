import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const { createApp } = await import("../src/app.js");
const { closeDb, getDb } = await import("../src/db/index.js");
const { jobs, platformCredentials, users } = await import("../src/db/schema.js");
const { encrypt } = await import("../src/lib/crypto.js");
const {
  AI_SETTINGS_DEFAULTS,
  getAiSettingsView,
  getAiTuningSettings,
  matchBandForScore,
  resetAiSettings,
  saveAiSettings,
} = await import("../src/modules/ai/ai-settings.service.js");
const { checkRelevancyWithAI } = await import("../src/modules/ai/ai.service.js");
const { getDashboard } = await import("../src/modules/dashboard/dashboard.service.js");
const { listMatches } = await import("../src/modules/jobs/jobs.service.js");
const { saveProfile } = await import("../src/modules/profile/profile.service.js");

let app: Express;
let baseUrl: string;
let server: ReturnType<Express["listen"]>;
let cookie: string;
let userId: string;

function authed(extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie, ...extra };
}

beforeAll(async () => {
  app = createApp();
  server = app.listen(0);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  baseUrl = `http://localhost:${address.port}`;

  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "AI Settings Owner",
      email: "ai-settings@example.com",
      password: "correct-horse-battery",
    }),
  });
  cookie = registration.headers.get("set-cookie")?.split(";")[0] ?? "";

  const owner = getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "ai-settings@example.com"))
    .get();
  if (owner === undefined) throw new Error("Registration did not create a user");
  userId = owner.id;
});

afterAll(() => {
  server.close();
  closeDb();
});

describe("AI settings", () => {
  it("returns the documented defaults for a new user", async () => {
    const response = await fetch(`${baseUrl}/api/ai/settings`, {
      headers: authed(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      settings: Record<string, unknown>;
    };

    expect(body.settings.relevanceTemperature).toBe(
      AI_SETTINGS_DEFAULTS.relevanceTemperature
    );
    expect(body.settings.relevanceMaxTokens).toBe(
      AI_SETTINGS_DEFAULTS.relevanceMaxTokens
    );
    expect(body.settings.relevanceTimeoutSeconds).toBe(
      AI_SETTINGS_DEFAULTS.relevanceTimeoutSeconds
    );
    expect(body.settings.analysisTemperature).toBe(
      AI_SETTINGS_DEFAULTS.analysisTemperature
    );
    expect(body.settings.proposalCorrectionAttempts).toBe(
      AI_SETTINGS_DEFAULTS.proposalCorrectionAttempts
    );
    expect(body.settings.goodScoreFloor).toBe(75);
    expect(body.settings.strongScoreFloor).toBe(90);
    expect(body.settings.analysisEngine).toBe("llm");
    expect(body.settings.updatedAt).toBeNull();
  });

  it("persists tuning changes through the API", async () => {
    const response = await fetch(`${baseUrl}/api/ai/settings`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        relevanceIgnoreFloor: 55,
        goodScoreFloor: 70,
        strongScoreFloor: 88,
        proposalTemperature: 0.7,
        proposalCorrectionAttempts: 2,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      settings: Record<string, unknown>;
      changedFields: string[];
    };
    expect(body.changedFields).toEqual([
      "proposalTemperature",
      "proposalCorrectionAttempts",
      "relevanceIgnoreFloor",
      "goodScoreFloor",
      "strongScoreFloor",
    ]);
    expect(body.settings.relevanceIgnoreFloor).toBe(55);
    expect(body.settings.strongScoreFloor).toBe(88);

    const persisted = getAiTuningSettings(userId);
    expect(persisted.goodScoreFloor).toBe(70);
    expect(persisted.proposalTemperature).toBe(0.7);
    expect(persisted.relevanceMaxTokens).toBe(
      AI_SETTINGS_DEFAULTS.relevanceMaxTokens
    );
  });

  it("rejects overlapping score bands", async () => {
    const response = await fetch(`${baseUrl}/api/ai/settings`, {
      method: "PUT",
      headers: authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ goodScoreFloor: 90, strongScoreFloor: 88 }),
    });
    expect(response.status).toBe(400);

    expect(() =>
      saveAiSettings(userId, {
        relevanceIgnoreFloor: 80,
        goodScoreFloor: 70,
        strongScoreFloor: 90,
      })
    ).toThrow(/ignore floor/i);
  });

  it("restores tuning defaults through the API", async () => {
    const response = await fetch(`${baseUrl}/api/ai/settings/reset`, {
      method: "POST",
      headers: authed(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      settings: Record<string, unknown>;
    };
    expect(body.settings.goodScoreFloor).toBe(75);
    expect(body.settings.strongScoreFloor).toBe(90);
    expect(body.settings.proposalTemperature).toBe(
      AI_SETTINGS_DEFAULTS.proposalTemperature
    );
  });

  it("keeps model choices when tuning is reset", () => {
    const now = new Date().toISOString();
    const key = encrypt("sk-or-v1-ai-settings-test");
    getDb()
      .insert(platformCredentials)
      .values({
        id: "openrouter",
        cipherText: key.cipherText,
        iv: key.iv,
        authTag: key.authTag,
        meta: JSON.stringify({ proposalModelId: "old/proposal" }),
        status: "ok",
        lastTestedAt: now,
        updatedAt: now,
      })
      .run();

    const saved = saveAiSettings(userId, {
      analysisModelId: "test/analysis",
      proposalModelId: "test/proposal",
      agentModelId: "test/agent",
      analysisEngine: "jev",
      jevModelId: "test/jev",
    });
    expect(saved.settings.analysisModelId).toBe("test/analysis");
    expect(saved.settings.analysisEngine).toBe("jev");

    const reset = resetAiSettings(userId);
    expect(reset.relevanceIgnoreFloor).toBe(
      AI_SETTINGS_DEFAULTS.relevanceIgnoreFloor
    );
    expect(reset.goodScoreFloor).toBe(AI_SETTINGS_DEFAULTS.goodScoreFloor);
    expect(reset.analysisModelId).toBe("test/analysis");
    expect(reset.proposalModelId).toBe("test/proposal");
    expect(reset.agentModelId).toBe("test/agent");
    expect(reset.analysisEngine).toBe("jev");
    expect(reset.jevModelId).toBe("test/jev");
  });

  it("passes saved screening tuning into the model call", async () => {
    saveAiSettings(userId, {
      analysisEngine: "llm",
      relevanceTemperature: 0.7,
      relevanceMaxTokens: 1234,
      relevanceTimeoutSeconds: 30,
    });

    let requestBody: Record<string, unknown> | null = null;
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ score: 82, reason: "Strong overlap." }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );

    try {
      const result = await checkRelevancyWithAI(
        {
          jobTitle: "React dashboard",
          jobDescription: ["Build a dashboard."],
        },
        undefined,
        undefined,
        userId
      );
      expect(result.score).toBe(82);
      expect(requestBody?.["temperature"]).toBe(0.7);
      expect(requestBody?.["max_tokens"]).toBe(1234);
    } finally {
      vi.stubGlobal("fetch", realFetch);
    }
  });

  it("uses the saved bands for match labels", async () => {
    saveProfile(userId, {
      freelancerUsername: "ai_settings_tester",
      name: "AI Settings Tester",
      title: "Developer",
      hourlyRate: "$50/hr",
      about: "Builds web apps.",
      skills: ["React.js"],
      skillIds: [759],
      preferredProjectTypes: [],
      wants: [],
      notWants: [],
      ignoredCountries: [],
      customInstructions: null,
      relevancyInstructions: null,
      portfolioSummary: null,
      proposalTemplates: null,
    });

    const now = new Date().toISOString();
    getDb()
      .insert(jobs)
      .values({
        id: "job-ai-settings-band",
        projectId: 991001,
        title: "Band test job",
        client: "Client in Germany",
        clientCountry: "Germany",
        budgetLabel: "$1,000",
        skills: JSON.stringify(["React.js"]),
        postedLabel: "1h ago",
        bidCount: 1,
        avgBidLabel: "$500",
        matchScore: 70,
        status: "analyzed",
        analysis: JSON.stringify({ summary: "Solid fit.", concerns: [] }),
        lastAnalyzedAt: now,
        importedAt: now,
        updatedAt: now,
      })
      .run();

    saveAiSettings(userId, {
      relevanceIgnoreFloor: 50,
      goodScoreFloor: 60,
      strongScoreFloor: 80,
    });
    expect(listMatches(userId).find((item) => item.projectId === 991001)?.band).toBe(
      "good"
    );

    const dashboard = await getDashboard(userId);
    expect(
      dashboard.matchQuality.bands.map((band) => band.rangeLabel)
    ).toEqual(["80–100", "60–79", "Below 60"]);
    expect(
      dashboard.jobsRequiringAttention.find((item) => item.id === "991001")?.severity
    ).toBe("warning");

    saveAiSettings(userId, {
      relevanceIgnoreFloor: 50,
      goodScoreFloor: 75,
      strongScoreFloor: 90,
    });
    expect(listMatches(userId).find((item) => item.projectId === 991001)?.band).toBe(
      "fair"
    );

    expect(
      matchBandForScore(90, { goodScoreFloor: 75, strongScoreFloor: 90 })
    ).toBe("strong");
    expect(
      matchBandForScore(89, { goodScoreFloor: 75, strongScoreFloor: 90 })
    ).toBe("good");
    expect(getAiSettingsView(userId).goodScoreFloor).toBe(75);
  });
});
