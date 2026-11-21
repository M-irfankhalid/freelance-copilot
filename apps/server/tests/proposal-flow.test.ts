import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";

const aiMocks = vi.hoisted(() => ({
  callOpenRouter: vi.fn(),
  callOpenRouterStructured: vi.fn(),
}));

vi.mock("../src/modules/ai/ai.service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/modules/ai/ai.service.js")>();
  return {
    ...actual,
    callOpenRouter: aiMocks.callOpenRouter,
    callOpenRouterStructured: aiMocks.callOpenRouterStructured,
  };
});

const { closeDb } = await import("../src/db/index.js");
const { register } = await import("../src/modules/auth/auth.service.js");
const { saveProfile } = await import("../src/modules/profile/profile.service.js");
const { getProposalEngineConfig, saveProposalEngineConfig } = await import(
  "../src/modules/proposals/proposal-config.service.js"
);
const { generateProposalWithPipeline } = await import(
  "../src/modules/proposals/proposal-pipeline.service.js"
);

let userId = "";

beforeAll(async () => {
  const registration = await register({
    name: "Flow Owner",
    email: "flow-owner@example.com",
    password: "correct-horse-battery",
  });
  userId = registration.userId;

  saveProfile(userId, {
    freelancerUsername: null,
    name: "Irfan Khalid",
    title: "Full-stack developer",
    hourlyRate: "$60",
    about: "I build pragmatic web applications.",
    skills: ["React", "Node.js", "PostgreSQL"],
    skillIds: [],
    preferredProjectTypes: [],
    wants: [],
    notWants: [],
    ignoredCountries: [],
    customInstructions: "Use plain English.",
    userSummary: null,
    relevancyInstructions: null,
    portfolioSummary:
      "Internal dashboard - React and PostgreSQL analytics dashboard with live updates.",
    proposalTemplates: null,
    proposalSystemInstructions: null,
    proposalWritingInstructions: null,
  });

  saveProposalEngineConfig(userId, {
    engine: {
      flow: {
        enabled: true,
        files: [
          {
            id: "notes",
            label: "Service notes",
            content: "FILE-ONLY-CONTENT: I test migrations before DNS changes.",
            enabled: true,
          },
        ],
        steps: [
          {
            id: "write",
            label: "Write",
            type: "write",
            enabled: true,
            system: "You are the owner. Follow the brief.",
            user: [
              "JOB={{jobJson}}",
              "FILES={{files}}",
              "PREVIOUS={{lastOutput}}",
            ].join("\n"),
            model: "test/writer-model",
            temperature: 0.2,
            timeoutSeconds: 60,
            position: null,
            fileIds: ["notes"],
          },
          {
            id: "review",
            label: "Review",
            type: "review",
            enabled: true,
            system: "Review the draft.",
            user: "DRAFT={{draft}}",
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
});

afterAll(() => {
  closeDb();
});

beforeEach(() => {
  aiMocks.callOpenRouter.mockReset();
  aiMocks.callOpenRouterStructured.mockReset();
});

describe("custom proposal flow", () => {
  it("runs configured steps with only referenced prompt variables", async () => {
    const draft =
      "I can build the dashboard, verify the event sources, and leave a short runbook so your team can operate it. Can we confirm the first chart you need live?";
    aiMocks.callOpenRouter.mockResolvedValue(draft);
    aiMocks.callOpenRouterStructured.mockResolvedValue(
      JSON.stringify({
        verdict: "accept",
        dimensions: {
          jobUnderstanding: 2,
          specificity: 2,
          technicalJudgment: 2,
          evidence: 2,
          voiceMatch: 2,
          naturalness: 2,
          conciseness: 2,
          grounding: 2,
          policy: 2,
        },
        issues: [],
        coverage: [],
        criticalDefects: [],
        revisionInstructions: [],
        mustKeep: [],
      })
    );

    const traceEvents: Array<{
      phase: string;
      title: string;
      data?: unknown;
    }> = [];
    const result = await generateProposalWithPipeline(
      {
        jobTitle: "React analytics dashboard",
        jobDescription: [
          "Build a React dashboard connected to PostgreSQL with live charts.",
        ],
        skills: ["React", "PostgreSQL"],
        clientName: "Acme",
      },
      userId,
      { onTrace: (event) => traceEvents.push(event) }
    );

    expect(result.content).toBe(draft);
    expect(result.candidates).toEqual([draft]);
    expect(result.reviewStatus).toBe("accepted");
    expect(result.approvable).toBe(true);

    expect(aiMocks.callOpenRouter).toHaveBeenCalledTimes(1);
    const [system, user, model, timeout, options] = aiMocks.callOpenRouter.mock.calls[0] as [
      string,
      string,
      string,
      number,
      { temperature: number },
    ];
    expect(system).toContain("You are the owner");
    expect(user).toContain("React analytics dashboard");
    expect(user).toContain("FILE-ONLY-CONTENT");
    expect(user.trimEnd().endsWith("PREVIOUS=")).toBe(true);
    expect(user).not.toContain("{{");
    expect(model).toBe("test/writer-model");
    expect(timeout).toBe(60_000);
    expect(options.temperature).toBe(0.2);

    expect(aiMocks.callOpenRouterStructured).toHaveBeenCalledTimes(1);
    const reviewUser = aiMocks.callOpenRouterStructured.mock.calls[0]?.[1] as string;
    expect(reviewUser).toContain(draft);

    const writeCall = traceEvents.find(
      (event) => event.phase === "write" && event.title === "Write API response"
    ) as
      | {
          data: {
            request: { system: string; user: string; model: string };
            response: string;
          };
        }
      | undefined;
    expect(writeCall).toBeDefined();
    expect(writeCall?.data.request.system).toContain("You are the owner");
    expect(writeCall?.data.request.user).toContain("React analytics dashboard");
    expect(writeCall?.data.request.model).toBe("test/writer-model");
    expect(writeCall?.data.response).toBe(draft);
  });

  it("applies one targeted revision when review asks for changes and no revise step follows", async () => {
    const draft =
      "I can build the dashboard, verify the event sources, and leave a short runbook. Which payment gateway do you use?";
    const revised =
      "I can build the dashboard, verify the event sources, and leave a short runbook so your team can operate it. Can we confirm the first chart you need live?";
    aiMocks.callOpenRouter.mockResolvedValueOnce(draft).mockResolvedValueOnce(revised);
    aiMocks.callOpenRouterStructured.mockResolvedValue(
      JSON.stringify({
        verdict: "revise",
        dimensions: {
          jobUnderstanding: 2,
          relevance: 1,
          voiceMatch: 2,
          coverage: 1,
          conciseness: 2,
          grounding: 2,
          policy: 2,
          safety: 2,
        },
        issues: [
          {
            severity: "major",
            category: "question",
            quote: "Which payment gateway do you use?",
            problem: "The client already named the payment requirement.",
            fix: "Remove the question and keep the runbook promise.",
          },
        ],
        criticalDefects: [],
        revisionInstructions: ["Remove the payment-gateway question."],
        mustKeep: ["the runbook promise"],
      })
    );

    const result = await generateProposalWithPipeline(
      {
        jobTitle: "React analytics dashboard",
        jobDescription: [
          "Build a React dashboard connected to PostgreSQL with live charts.",
        ],
        skills: ["React", "PostgreSQL"],
        clientName: "Acme",
      },
      userId
    );

    expect(result.content).toBe(revised);
    expect(result.reviewStatus).toBe("needs_revision");
    expect(aiMocks.callOpenRouter).toHaveBeenCalledTimes(2);
    const revisionUser = aiMocks.callOpenRouter.mock.calls[1]?.[1] as string;
    expect(revisionUser).toContain(draft);
    expect(revisionUser).toContain("Remove the payment-gateway question.");
    expect(revisionUser).toContain("the runbook promise");
  });

  it("passes advanced brief fields through to the writer", async () => {
    const original = getProposalEngineConfig(userId);
    saveProposalEngineConfig(userId, {
      engine: {
        flow: {
          enabled: true,
          files: [],
          steps: [
            {
              id: "brief",
              label: "Brief",
              type: "brief",
              enabled: true,
              system: "Build a brief.",
              user: "JOB={{jobJson}}",
              model: null,
              temperature: null,
              timeoutSeconds: null,
              position: null,
              fileIds: [],
            },
            {
              id: "writer",
              label: "Writer",
              type: "write",
              enabled: true,
              system: "Write from the blueprint.",
              user: "BLUEPRINT={{jobBriefJson}}",
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

    aiMocks.callOpenRouterStructured.mockResolvedValue(
      JSON.stringify({
        goal: "Build a booking store for services.",
        facts: ["Customers must book and pay online."],
        hypotheses: [],
        deliverables: ["Booking flow", "Admin dashboard"],
        explicitQuestions: [],
        mustAddress: ["Mobile responsive"],
        acceptanceCriteria: ["A customer can book and pay."],
        dependencies: [],
        unresolved: [],
        risks: [
          {
            type: "scope",
            severity: "medium",
            reason: "Availability rules can expand the calendar work.",
          },
        ],
        avoidAssumptions: [],
        bestQuestion: "",
        bestQuestionWhy: "",
        angle: {
          type: "de_risk",
          statement: "Reduce booking-flow risk.",
          why: "The client needs a reliable flow.",
        },
        shape: "plan",
        omit: [],
        evidenceNeeds: [],
        toneHints: [],
        clarificationNeeded: false,
        complexity: { level: "moderate", reason: "Catalog, calendar, and checkout." },
        urgency: { level: "unknown", evidence: "No urgency stated." },
        clientPriorities: ["booking flow", "non-technical admin"],
        targetWords: { min: 60, max: 115, target: 85 },
        proposalStructure: ["recommend a stack", "name relevant proof"],
        include: ["booking and payment flow"],
        portfolioDecision: {
          mention: true,
          projectNames: ["AutoShine"],
          reason: "Direct booking and service-catalog match.",
        },
        questionDecision: {
          ask: false,
          reason: "The client already named the core requirements.",
        },
        safetyDecision: { status: "normal", reason: "No unsafe commitment." },
      })
    );
    aiMocks.callOpenRouter.mockResolvedValue(
      "I can build the booking store with a service catalog and admin dashboard."
    );

    try {
      const result = await generateProposalWithPipeline(
        {
          jobTitle: "Online Service Store Development",
          jobDescription: ["Build a store where customers book and pay for services."],
          skills: ["Ecommerce"],
          clientName: "Acme",
        },
        userId
      );

      const writerUser = aiMocks.callOpenRouter.mock.calls[0]?.[1] as string;
      expect(writerUser).toContain('"portfolioDecision"');
      expect(writerUser).toContain("AutoShine");
      expect(writerUser).toContain('"questionDecision"');
      expect(writerUser).toContain('"ask": false');
      expect(writerUser).toContain('"complexity"');
      expect(writerUser).toContain('"targetWords"');
      expect(result.jobBrief.portfolioDecision?.projectNames).toEqual(["AutoShine"]);
    } finally {
      saveProposalEngineConfig(userId, {
        engine: { flow: original.engine.flow },
      });
    }
  });

  it("does not run a revise step when review accepted the draft", async () => {
    const original = getProposalEngineConfig(userId);
    const write = original.engine.flow.steps.find((step) => step.id === "write");
    const review = original.engine.flow.steps.find((step) => step.id === "review");
    const final = original.engine.flow.steps.find((step) => step.id === "final");
    expect(write && review && final).toBeTruthy();

    saveProposalEngineConfig(userId, {
      engine: {
        flow: {
          enabled: true,
          files: original.engine.flow.files,
          steps: [
            write!,
            review!,
            {
              ...write!,
              id: "revise",
              label: "Revise",
              type: "revise",
              system: "Revise the draft.",
              user: "DRAFT={{draft}}",
            },
            final!,
          ],
        },
      },
    });

    const draft =
      "I can build the dashboard, verify the event sources, and leave a short runbook so your team can operate it.";
    aiMocks.callOpenRouter.mockResolvedValue(draft);
    aiMocks.callOpenRouterStructured.mockResolvedValue(
      JSON.stringify({
        verdict: "accept",
        dimensions: {
          jobUnderstanding: 2,
          relevance: 2,
          voiceMatch: 2,
          coverage: 2,
          conciseness: 2,
          grounding: 2,
          policy: 2,
          safety: 2,
        },
        issues: [],
        criticalDefects: [],
        revisionInstructions: [],
        mustKeep: [],
      })
    );

    try {
      const result = await generateProposalWithPipeline(
        {
          jobTitle: "React analytics dashboard",
          jobDescription: [
            "Build a React dashboard connected to PostgreSQL with live charts.",
          ],
          skills: ["React", "PostgreSQL"],
          clientName: "Acme",
        },
        userId
      );

      expect(result.content).toBe(draft);
      expect(aiMocks.callOpenRouter).toHaveBeenCalledTimes(1);
    } finally {
      saveProposalEngineConfig(userId, {
        engine: { flow: original.engine.flow },
      });
    }
  });
});
