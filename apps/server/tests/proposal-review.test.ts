import { describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";

const {
  adaptBriefForRelationship,
  detectJobRelationship,
  fallbackBrief,
  jobBriefSchema,
  withCoverageGate,
  withStyleGate,
} = await import("../src/modules/proposals/proposal-pipeline.service.js");
const { evaluateProposalQuality } = await import("../src/lib/proposal-quality.js");

describe("withCoverageGate", () => {
  it("forces a revision when a brief deliverable is missing", () => {
    const review = withCoverageGate({
      verdict: "accept",
      dimensions: {
        jobUnderstanding: 2,
        specificity: 2,
        technicalJudgment: 2,
        evidence: 1,
        voiceMatch: 2,
        naturalness: 2,
        conciseness: 2,
        grounding: 2,
        policy: 2,
        relevance: 2,
        coverage: 2,
        safety: 2,
      },
      issues: [],
      coverage: [
        { deliverable: "Initial design concepts", covered: false, evidence: "missing" },
        { deliverable: "Responsive front end", covered: true, evidence: "fully responsive" },
      ],
      criticalDefects: [],
      revisionInstructions: [],
      mustKeep: ["direct tone"],
    });

    expect(review.verdict).toBe("revise");
    expect(review.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "coverage",
          problem: "Missing deliverable: Initial design concepts",
        }),
      ])
    );
    expect(review.revisionInstructions).toContain(
      "Cover this missing deliverable: Initial design concepts"
    );
  });

  it("leaves an accepted review alone when every deliverable is covered", () => {
    const review = withCoverageGate({
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
        relevance: 2,
        coverage: 2,
        safety: 2,
      },
      issues: [],
      coverage: [{ deliverable: "Responsive front end", covered: true, evidence: "yes" }],
      criticalDefects: [],
      revisionInstructions: [],
      mustKeep: [],
    });

    expect(review.verdict).toBe("accept");
    expect(review.issues).toHaveLength(0);
  });
});

describe("coverage reconciliation", () => {
  it("drops a false missing-deliverable complaint when the draft covers it", () => {
    const review = withCoverageGate(
      {
        verdict: "revise",
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
          relevance: 2,
          coverage: 2,
          safety: 2,
        },
        issues: [
          {
            severity: "major",
            category: "coverage",
            quote: "",
            problem: "Missing deliverable: Ongoing support",
            fix: "Mention ongoing support.",
          },
        ],
        coverage: [{ deliverable: "Ongoing support", covered: false, evidence: "" }],
        criticalDefects: [],
        revisionInstructions: ["Mention ongoing support."],
        mustKeep: [],
      },
      {
        items: [{ item: "Ongoing support", covered: true, matchedTerms: ["support"] }],
        coveredCount: 1,
        total: 1,
        missing: [],
      }
    );

    expect(review.verdict).toBe("accept");
    expect(review.issues).toHaveLength(0);
  });
});

describe("hard review gates", () => {
  const strongDimensions = {
    jobUnderstanding: 2,
    specificity: 2,
    technicalJudgment: 2,
    evidence: 2,
    voiceMatch: 2,
    naturalness: 2,
    conciseness: 2,
    grounding: 2,
    policy: 2,
    relevance: 2,
    coverage: 2,
    safety: 2,
  };

  it("adds deterministic coverage items the reviewer omitted", () => {
    const review = withCoverageGate(
      {
        verdict: "accept",
        dimensions: strongDimensions,
        issues: [],
        coverage: [],
        criticalDefects: [],
        revisionInstructions: [],
        mustKeep: [],
      },
      {
        items: [
          {
            item: "A system you architected or reviewed that used LLMs or agents.",
            covered: false,
            matchedTerms: [],
          },
          {
            item: "Start your message with the word agents.",
            covered: false,
            matchedTerms: [],
          },
        ],
        coveredCount: 0,
        total: 2,
        missing: [
          "A system you architected or reviewed that used LLMs or agents.",
          "Start your message with the word agents.",
        ],
      }
    );

    expect(review.verdict).toBe("revise");
    expect(review.coverage).toHaveLength(2);
    expect(review.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "coverage",
          problem: "Missing deliverable: Start your message with the word agents.",
        }),
      ])
    );
  });

  it("forces a revision when the review accepts a weak draft", () => {
    const review = withCoverageGate({
      verdict: "accept",
      dimensions: {
        ...strongDimensions,
        jobUnderstanding: 1,
        specificity: 1,
        technicalJudgment: 1,
        evidence: 1,
        voiceMatch: 1,
        naturalness: 1,
        conciseness: 1,
        grounding: 1,
        policy: 1,
        relevance: 1,
        coverage: 1,
        safety: 1,
      },
      issues: [],
      coverage: [],
      criticalDefects: [],
      revisionInstructions: [],
      mustKeep: [],
    });

    expect(review.verdict).toBe("revise");
    expect(review.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "review", severity: "major" }),
      ])
    );
  });

  it("forces a revision when the review reports a critical defect", () => {
    const review = withCoverageGate({
      verdict: "accept",
      dimensions: strongDimensions,
      issues: [],
      coverage: [],
      criticalDefects: ["The draft invents a client result."],
      revisionInstructions: [],
      mustKeep: [],
    });

    expect(review.verdict).toBe("revise");
    expect(review.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "review",
          severity: "blocker",
          problem: "Critical defect: The draft invents a client result.",
        }),
      ])
    );
  });
});

describe("fallback brief application requirements", () => {
  it("keeps application asks out of deliverables and captures mandatory answers", () => {
    const brief = fallbackBrief({
      jobTitle: "AI Agent Architecture Review",
      skills: ["TypeScript", "AI Agents", "PostgreSQL"],
      jobDescription: [
        "[Hiring] Architect who can read an AI agents codebase",
        "**What I need**",
        "Deliverables:",
        "1. An architecture map with components and data flow.",
        "2. A written document with diagrams for engineers and non-technical readers.",
        "**To apply**, share this:",
        "- A system you architected or reviewed that used LLMs or agents.",
        "- A document or diagram you made that explains a complex system.",
        "- Your rate and availability.",
        'Start your message with the word "agents" so I know you read this far.',
      ],
      clientName: "Client in Colombia",
    });

    expect(brief.deliverables).toEqual(
      expect.arrayContaining([
        "An architecture map with components and data flow.",
        "A written document with diagrams for engineers and non-technical readers.",
      ])
    );
    expect(brief.deliverables.join(" ")).not.toContain("A system you architected");
    expect(brief.deliverables.join(" ")).not.toContain("Your rate and availability.");
    expect(brief.applicationRequirements).toEqual(
      expect.arrayContaining([
        "A system you architected or reviewed that used LLMs or agents.",
        "A document or diagram you made that explains a complex system.",
        "Your rate and availability.",
        'Start your message with the word "agents" so I know you read this far.',
      ])
    );
  });
});

describe("job relationship", () => {
  it("detects a recruiter offering a role or partnership", () => {
    expect(
      detectJobRelationship({
        jobTitle: "Seeking Software Engineers & Full Stack Developers in LATAM",
        jobDescription: [
          "We're looking to connect with skilled developers in LATAM.",
          "What our team offers: ongoing projects so you can grow your income.",
          "We'll help you succeed with technical support during hiring.",
        ],
        skills: ["React", "Node.js"],
      })
    ).toBe("candidate_opportunity");
  });

  it("keeps a normal client project as a service purchase", () => {
    expect(
      detectJobRelationship({
        jobTitle: "Shopify Dropshipping Store Setup",
        jobDescription: [
          "I need a complete Shopify store built and configured.",
          "I want the store ready to launch with about 50 products.",
        ],
        skills: ["Shopify", "Ecommerce"],
      })
    ).toBe("client_buys_service");
  });

  it("keeps the advanced fields used by custom flow briefs", () => {
    const brief = jobBriefSchema.parse({
      goal: "Build a service booking store.",
      angle: { type: "de_risk", statement: "Reduce booking-flow risk." },
      shape: "plan",
      complexity: { level: "moderate", reason: "Catalog, calendar, and checkout." },
      urgency: { level: "time_sensitive", evidence: "Seven-day bid period." },
      clientPriorities: ["booking flow", "non-technical admin"],
      risks: [
        {
          type: "scope",
          severity: "medium",
          reason: "Availability rules can expand the calendar work.",
        },
      ],
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
    });

    expect(brief.complexity?.level).toBe("moderate");
    expect(brief.risks[0]).toMatchObject({ type: "scope", severity: "medium" });
    expect(brief.portfolioDecision?.projectNames).toEqual(["AutoShine"]);
    expect(brief.questionDecision?.ask).toBe(false);
  });

  it("rewrites a candidate brief as a short applicant pitch", () => {
    const brief = jobBriefSchema.parse({
      relationship: "candidate_opportunity",
      goal: "Advise the client on their partnership program.",
      deliverables: ["Partnership agreements with LATAM developers"],
      bestQuestion: "Should we structure this as a contract or a partnership?",
      angle: { type: "de_risk", statement: "Reduce program risk." },
      shape: "plan",
    });

    const adapted = adaptBriefForRelationship(brief);

    expect(adapted.shape).toBe("short_note");
    expect(adapted.bestQuestion).toBe("");
    expect(adapted.deliverables.join(" ")).not.toContain("Partnership agreements");
    expect(adapted.toneHints.join(" ")).toContain("applicant voice");
  });
});

describe("withStyleGate", () => {
  it("forces a revision when fluent prose still sounds generic", () => {
    const draft =
      "Translating complex requirements into a tailored solution requires both technical insight and communication precision. I have comprehensive experience delivering robust systems.";
    const quality = evaluateProposalQuality(draft, {
      jobTitle: "AI Agent Architecture Review",
      jobDescription: ["Review an AI agents codebase and document the architecture."],
      jobSkills: ["TypeScript", "AI Agents"],
      targetWords: { min: 20, max: 200 },
    });
    const review = withStyleGate(
      {
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
          relevance: 2,
          coverage: 2,
          safety: 2,
        },
        issues: [],
        coverage: [],
        criticalDefects: [],
        revisionInstructions: [],
        mustKeep: [],
      },
      quality
    );

    expect(review.verdict).toBe("revise");
    expect(review.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "generic", severity: "major" }),
      ])
    );
    expect(review.revisionInstructions.join(" ")).toContain("Remove generic writing");
  });

  it("leaves a specific draft accepted", () => {
    const draft =
      "The first thing I would map is how your agent graph stores shared state, because that usually exposes where retries duplicate tool calls. I would trace one failing run, document the boundary between planner and tools, and leave you with a component map plus the two fixes that remove the duplicate writes.";
    const quality = evaluateProposalQuality(draft, {
      jobTitle: "AI Agent Architecture Review",
      jobDescription: ["Review an AI agents codebase and document the architecture."],
      jobSkills: ["TypeScript", "AI Agents"],
      targetWords: { min: 20, max: 200 },
    });
    const review = withStyleGate(
      {
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
          relevance: 2,
          coverage: 2,
          safety: 2,
        },
        issues: [],
        coverage: [],
        criticalDefects: [],
        revisionInstructions: [],
        mustKeep: [],
      },
      quality
    );

    expect(review.verdict).toBe("accept");
    expect(review.issues).toHaveLength(0);
  });
});

