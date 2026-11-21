import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";

const { closeDb } = await import("../src/db/index.js");
const { register } = await import("../src/modules/auth/auth.service.js");
const {
  deleteAllSamples,
  getProposalEngineConfig,
  listPlaybooks,
  listSamples,
  normalizeCandidateLanes,
  saveProposalEngineConfig,
  seedDefaultSamples,
  selectSamples,
  selectVoiceSamples,
  upgradeProposalEngineConfig,
  upsertSample,
} = await import("../src/modules/proposals/proposal-config.service.js");
const { DEFAULT_PROPOSAL_ENGINE, DEFAULT_SAMPLES } = await import(
  "../src/lib/proposal-defaults.js"
);

let userId = "";

beforeAll(async () => {
  const registration = await register({
    name: "Config Owner",
    email: "config-owner@example.com",
    password: "correct-horse-battery",
  });
  userId = registration.userId;

  upsertSample(userId, {
    title: "WordPress migration",
    jobType: "migration",
    content: "A WordPress migration voice sample with enough content to be valid.",
    tags: ["wordpress", "migration", "hosting"],
    outcome: "won",
    rating: 5,
    notes: "",
    active: true,
  });
  upsertSample(userId, {
    title: "AI SaaS debugging",
    jobType: "rescue",
    content: "An AI SaaS debugging voice sample with enough content to be valid.",
    tags: ["ai", "saas", "debugging"],
    outcome: "won",
    rating: 5,
    notes: "",
    active: true,
  });
  upsertSample(userId, {
    title: "General voice",
    jobType: "general",
    content: "A general voice sample with enough content to be valid.",
    tags: [],
    outcome: "won",
    rating: 4,
    notes: "",
    active: true,
  });
});

afterAll(() => {
  closeDb();
});

describe("selectSamples", () => {
  it("does not pad a relevant match with unrelated job-specific samples", () => {
    const samples = selectSamples(
      userId,
      "WordPress migration from Bluehost to Hostinger with DNS, SSL, and business email",
      3
    );

    expect(samples.map((sample) => sample.title)).toEqual([
      "WordPress migration",
      "General voice",
    ]);
  });

  it("drops weakly related samples instead of padding the prompt", () => {
    upsertSample(userId, {
      title: "E-commerce build",
      jobType: "ecommerce",
      content: "An e-commerce voice sample with enough content to be valid.",
      tags: ["ecommerce", "shopify", "stripe", "product catalogue", "classic", "payment gateway"],
      outcome: "won",
      rating: 5,
      notes: "",
      active: true,
    });
    upsertSample(userId, {
      title: "Website maintenance",
      jobType: "maintenance",
      content: "A website maintenance voice sample with enough content to be valid.",
      tags: ["website", "desktop", "mobile"],
      outcome: "won",
      rating: 5,
      notes: "",
      active: true,
    });

    const samples = selectSamples(
      userId,
      "Classic ecommerce shopify stripe product catalogue payment gateway website desktop mobile",
      3
    );

    expect(samples.map((sample) => sample.title)).toContain("E-commerce build");
    expect(samples.map((sample) => sample.title)).not.toContain("Website maintenance");
  });

  it("prefers an explicitly preferred general sample over a higher-rated one", () => {
    const preferred = upsertSample(userId, {
      title: "Preferred general voice",
      jobType: "general",
      content: "A preferred general voice sample with enough content to be valid.",
      tags: [],
      outcome: "unknown",
      rating: 3,
      preferred: true,
      notes: "",
      active: true,
    });

    const samples = selectSamples(userId, "Bookkeeping and invoice reconciliation", 2);
    expect(samples[0]?.id).toBe(preferred.id);
  });

  it("never uses inactive or low-rated samples", () => {
    const inactive = upsertSample(userId, {
      title: "Inactive preferred sample",
      jobType: "general",
      content: "An inactive preferred voice sample with enough content to be valid.",
      tags: [],
      outcome: "won",
      rating: 5,
      preferred: true,
      notes: "",
      active: false,
    });
    const lowRated = upsertSample(userId, {
      title: "Low-rated sample",
      jobType: "general",
      content: "A low-rated voice sample with enough content to be valid.",
      tags: [],
      outcome: "won",
      rating: 2,
      preferred: true,
      notes: "",
      active: true,
    });

    const samples = selectSamples(userId, "Unrelated bookkeeping task", 5);
    expect(samples.map((sample) => sample.id)).not.toContain(inactive.id);
    expect(samples.map((sample) => sample.id)).not.toContain(lowRated.id);
  });
});

describe("selectVoiceSamples", () => {
  it("picks a small, varied set instead of overfitting one job type", () => {
    const samples = selectVoiceSamples(userId, 3);

    expect(samples).toHaveLength(3);
    expect(new Set(samples.map((sample) => sample.jobType)).size).toBe(3);
    expect(samples.every((sample) => sample.active && sample.rating >= 3)).toBe(true);
  });

  it("returns nothing when voice samples are disabled", () => {
    expect(selectVoiceSamples(userId, 0)).toEqual([]);
  });
});

describe("upgradeProposalEngineConfig", () => {
  it("is a no-op when the saved config is already current", () => {
    const before = getProposalEngineConfig(userId);
    expect(before.engine.defaultsVersion).toBe(6);

    const result = upgradeProposalEngineConfig(userId);

    expect(result.fromVersion).toBe(6);
    expect(result.toVersion).toBe(6);
    expect(result.upgraded).toEqual([]);
    expect(result.preserved).toEqual([]);
  });

  it("preserves customized settings while advancing the version", () => {
    const current = getProposalEngineConfig(userId);
    saveProposalEngineConfig(userId, {
      engine: { ...current.engine, defaultsVersion: 1 },
      prompts: current.prompts,
      policy: { ...current.policy, words: { min: 90, max: 260 } },
      checks: current.checks,
    });

    const result = upgradeProposalEngineConfig(userId);

    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(6);
    expect(result.preserved).toContain("policy");
    expect(result.config.policy.words).toEqual({ min: 90, max: 260 });
    expect(result.config.engine.defaultsVersion).toBe(6);
  });

  it("seeds editable contracts and saves partial edits", () => {
    const current = getProposalEngineConfig(userId);
    expect(current.engine.contracts.writer).toContain("{{wordTarget}}");
    expect(current.engine.contracts.reviewer).toContain("{{relationshipGuidance}}");

    const saved = saveProposalEngineConfig(userId, {
      engine: { contracts: { writer: "Custom writer rules." } },
    });

    expect(saved.engine.contracts.writer).toBe("Custom writer rules.");
    expect(saved.engine.contracts.reviewer).toBe(current.engine.contracts.reviewer);
  });

  it("preserves customized contracts during an upgrade", () => {
    const current = getProposalEngineConfig(userId);
    saveProposalEngineConfig(userId, {
      engine: {
        ...current.engine,
        defaultsVersion: 2,
        contracts: { ...current.engine.contracts, writer: "My own contract." },
      },
    });

    const result = upgradeProposalEngineConfig(userId);

    expect(result.fromVersion).toBe(2);
    expect(result.toVersion).toBe(6);
    expect(result.preserved).toContain("engine");
    expect(result.config.engine.contracts.writer).toBe("My own contract.");
  });
});

describe("default pipeline", () => {
  it("uses one analysis call and one writer call", () => {
    expect(DEFAULT_PROPOSAL_ENGINE.engine.stages).toEqual({
      brief: true,
      candidates: false,
      judge: false,
      review: false,
      revision: false,
      deletion: false,
      deterministicValidation: true,
    });
    expect(DEFAULT_PROPOSAL_ENGINE.engine.maxRevisionAttempts).toBe(0);
    expect(DEFAULT_PROPOSAL_ENGINE.engine.maxRepairAttempts).toBe(0);
  });

  it("seeds starter voice examples and playbooks on the first engine read", () => {
    deleteAllSamples(userId);
    expect(listSamples(userId)).toEqual([]);

    seedDefaultSamples(userId);

    const samples = listSamples(userId);
    expect(samples).toHaveLength(DEFAULT_SAMPLES.length);
    expect(samples.every((sample) => sample.title.startsWith("Starter example"))).toBe(true);
    expect(samples.every((sample) => sample.active)).toBe(true);
    expect(listPlaybooks(userId).length).toBeGreaterThanOrEqual(6);

    // Seeding twice must not duplicate the shipped examples.
    seedDefaultSamples(userId);
    expect(listSamples(userId)).toHaveLength(DEFAULT_SAMPLES.length);
  });
});

describe("candidate lanes", () => {
  it("seeds editable lanes with the shipped shapes", () => {
    const config = getProposalEngineConfig(userId);

    expect(config.engine.candidateLanes?.map((lane) => lane.id)).toEqual([
      "short_note",
      "diagnostic",
      "plan",
    ]);
    expect(config.engine.candidateLanes?.every((lane) => lane.enabled)).toBe(true);
  });

  it("converts legacy shape settings into lanes", () => {
    const config = getProposalEngineConfig(userId);
    const normalized = normalizeCandidateLanes({
      ...config.engine,
      candidateLanes: undefined,
      candidateCount: 2,
      shapes: ["short_note", "diagnostic"],
      shapeGuidance: { short_note: "Short guidance.", diagnostic: "Diagnostic guidance." },
    });

    expect(normalized.candidateLanes?.map((lane) => lane.id)).toEqual([
      "short_note",
      "diagnostic",
    ]);
    expect(normalized.candidateLanes?.[1]?.guidance).toBe("Diagnostic guidance.");
  });

  it("saves lane overrides and keeps legacy shape fields in sync", () => {
    const saved = saveProposalEngineConfig(userId, {
      engine: {
        candidateLanes: [
          {
            id: "direct",
            label: "Direct note",
            guidance: "Open with the client-specific risk.",
            model: "openai/gpt-4.1-mini",
            temperature: 0.2,
            timeoutSeconds: 240,
            enabled: true,
          },
        ],
      },
    });

    expect(saved.engine.candidateLanes).toHaveLength(1);
    expect(saved.engine.candidateLanes?.[0]?.model).toBe("openai/gpt-4.1-mini");
    expect(saved.engine.candidateLanes?.[0]?.timeoutSeconds).toBe(240);
    expect(saved.engine.candidateCount).toBe(1);
    expect(saved.engine.shapes).toEqual(["direct"]);
    expect(saved.engine.shapeGuidance.direct).toBe("Open with the client-specific risk.");
  });
});

describe("custom flow", () => {
  it("seeds a disabled but editable starter flow", () => {
    const config = getProposalEngineConfig(userId);

    expect(config.engine.flow.enabled).toBe(false);
    expect(config.engine.flow.steps.map((step) => step.type)).toEqual([
      "brief",
      "write",
      "judge",
      "review",
      "revise",
      "final",
    ]);
    expect(config.engine.flow.steps.find((step) => step.id === "writer")?.user).toContain(
      "{{jobBriefJson}}"
    );
  });

  it("saves ordered steps and context files, and keeps them on a partial toggle", () => {
    const saved = saveProposalEngineConfig(userId, {
      engine: {
        flow: {
          enabled: true,
          files: [
            {
              id: "services",
              label: "Service notes",
              content: "I build and maintain WordPress sites.",
              enabled: true,
            },
          ],
          steps: [
            {
              id: "write_first",
              label: "Write first",
              type: "write",
              enabled: true,
              system: "Write as the owner.",
              user: "{{jobJson}}\n\n{{files}}",
              model: "openai/gpt-4.1-mini",
              temperature: 0.4,
              timeoutSeconds: 240,
              position: null,
              fileIds: ["services"],
            },
            {
              id: "final",
              label: "Final",
              type: "final",
              enabled: true,
              system: "",
              user: "",
              model: null,
              temperature: null,
              timeoutSeconds: null,
              position: null,
              fileIds: [],
            },
          ],
        },
      },
    });

    expect(saved.engine.flow.enabled).toBe(true);
    expect(saved.engine.flow.steps.map((step) => step.id)).toEqual(["write_first", "final"]);
    expect(saved.engine.flow.steps[0]?.model).toBe("openai/gpt-4.1-mini");
    expect(saved.engine.flow.files[0]?.content).toContain("WordPress");

    const toggled = saveProposalEngineConfig(userId, {
      engine: { flow: { enabled: false } },
    });
    expect(toggled.engine.flow.enabled).toBe(false);
    expect(toggled.engine.flow.steps.map((step) => step.id)).toEqual(["write_first", "final"]);
  });

  it("rejects duplicate step IDs and unknown context files", () => {
    expect(() =>
      saveProposalEngineConfig(userId, {
        engine: {
          flow: {
            enabled: true,
            steps: [
              {
                id: "same",
                label: "First",
                type: "custom",
                enabled: true,
                system: "System",
                user: "User",
                model: null,
                temperature: null,
                timeoutSeconds: null,
                position: null,
                fileIds: [],
              },
              {
                id: "same",
                label: "Second",
                type: "custom",
                enabled: true,
                system: "System",
                user: "User",
                model: null,
                temperature: null,
                timeoutSeconds: null,
                position: null,
                fileIds: [],
              },
            ],
          },
        },
      })
    ).toThrow(/validation/i);

    expect(() =>
      saveProposalEngineConfig(userId, {
        engine: {
          flow: {
            enabled: true,
            files: [],
            steps: [
              {
                id: "missing_file",
                label: "Missing file",
                type: "custom",
                enabled: true,
                system: "System",
                user: "User",
                model: null,
                temperature: null,
                timeoutSeconds: null,
                position: null,
                fileIds: ["not_there"],
              },
            ],
          },
        },
      })
    ).toThrow(/validation/i);
  });

  it("requires a text-producing step and caps total context size", () => {
    let stepError: unknown;
    try {
      saveProposalEngineConfig(userId, {
        engine: {
          flow: {
            enabled: true,
            steps: [
              {
                id: "review_only",
                label: "Review only",
                type: "review",
                enabled: true,
                system: "System",
                user: "User",
                model: null,
                temperature: null,
                timeoutSeconds: null,
                position: null,
                fileIds: [],
              },
              {
                id: "final",
                label: "Final",
                type: "final",
                enabled: true,
                system: "",
                user: "",
                model: null,
                temperature: null,
                timeoutSeconds: null,
                position: null,
                fileIds: [],
              },
            ],
          },
        },
      });
    } catch (error) {
      stepError = error;
    }
    expect(JSON.stringify((stepError as { details?: unknown } | undefined)?.details)).toMatch(/text-producing/i);

    let fileError: unknown;
    try {
      saveProposalEngineConfig(userId, {
        engine: {
          flow: {
            enabled: false,
            files: [
              {
                id: "one",
                label: "One",
                content: "a".repeat(60_000),
                enabled: true,
              },
              {
                id: "two",
                label: "Two",
                content: "b".repeat(60_001),
                enabled: true,
              },
            ],
          },
        },
      });
    } catch (error) {
      fileError = error;
    }
    expect(JSON.stringify((fileError as { details?: unknown } | undefined)?.details)).toMatch(/120,000/i);
  });

  it("preserves a customized flow during an upgrade", () => {
    const current = getProposalEngineConfig(userId);
    saveProposalEngineConfig(userId, {
      engine: { ...current.engine, defaultsVersion: 2 },
    });

    const result = upgradeProposalEngineConfig(userId);

    expect(result.preserved).toContain("engine");
    expect(result.config.engine.flow.steps.map((step) => step.id)).toEqual([
      "write_first",
      "final",
    ]);
  });
});
