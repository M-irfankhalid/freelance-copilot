import { describe, expect, it } from "vitest";
import type { ProposalPromptData } from "../src/modules/ai/ai.service.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const { buildProposalPrompt } = await import("../src/modules/ai/ai.service.js");
const { evaluateProposalQuality } = await import("../src/lib/proposal-quality.js");

const profile: ProposalPromptData["profile"] = {
  name: "Proposal Tester",
  title: "Full-stack developer",
  hourlyRate: "$40/hr",
  about: "I build React dashboards, Node APIs, and network diagnostics tooling.",
  skills: ["React.js", "Node.js", "PostgreSQL", "Elasticsearch", "Linux"],
  wants: ["React"],
  notWants: ["crypto"],
  customInstructions: "Keep it direct and concrete.",
  portfolioSummary: "### Sales Dashboard\nReact + PostgreSQL sales dashboard.",
  proposalTemplates: "Short paragraphs. No flattery.",
  proposalSystemInstructions: "Use only verified facts.",
  proposalWritingInstructions:
    "Start with the client's problem.\nNever fill a gap with an invented fact.",
};

const base: ProposalPromptData = {
  jobTitle: "Diagnose Elasticsearch Network Issue",
  clientName: "Client in India",
  budgetLabel: "$30 - $250",
  jobDescription: [
    "My Elasticsearch cluster returns blank responses. Trace TCP/HTTP traffic, check transport ports, DNS, and firewall rules.",
    "The task ends when queries return the expected JSON and you explain the root cause.",
  ],
  skills: ["Elasticsearch", "Linux", "HTTP", "Firewall"],
  bidCount: 10,
  avgBid: "$107",
  projectType: "fixed",
  bidPeriod: 7,
  bidAmount: 120,
  deliveryDays: 3,
  upgrades: { featured: false, urgent: false, sealed: false },
  competition: {
    bidCount: 10,
    minBid: 80,
    maxBid: 200,
    medianBid: 200,
    isCheapest: false,
  },
  analysis: {
    score: 82,
    recommendedBidLabel: "$999",
    summary: "Strong match on Linux and networking.",
  },
  profile,
};

describe("buildProposalPrompt", () => {
  it("passes the exact commercial values and budget to the model", () => {
    const prompt = buildProposalPrompt(base);
    expect(prompt).toContain("Bid amount to quote: $120 fixed price");
    expect(prompt).toContain("Delivery to quote: 3 days");
    expect(prompt).toContain("Budget range: $30 - $250");
    expect(prompt).toContain("Client: Client in India");
  });

  it("does not leak the analysis bid suggestion into the quote", () => {
    const prompt = buildProposalPrompt(base);
    expect(prompt).not.toContain("Suggested bid");
    expect(prompt).not.toContain("$999");
  });

  it("forbids inventing a price or deadline when they are not chosen", () => {
    const prompt = buildProposalPrompt({
      ...base,
      bidAmount: null,
      deliveryDays: null,
    });
    expect(prompt).toContain("Not set — do not mention a price");
    expect(prompt).toContain("Not set — do not mention a delivery time");
  });

  it("formats an hourly quote per hour", () => {
    const prompt = buildProposalPrompt({
      ...base,
      projectType: "hourly",
      bidAmount: 40,
    });
    expect(prompt).toContain("Bid amount to quote: $40/hour");
  });

  it("places editable writer instructions first and user instructions last", () => {
    const prompt = buildProposalPrompt(base);
    const writerInstructions = prompt.indexOf("Start with the client's problem.");
    const templates = prompt.indexOf("Short paragraphs. No flattery.");
    const userInstructions = prompt.indexOf("Keep it direct and concrete.");

    expect(writerInstructions).toBeGreaterThan(-1);
    expect(writerInstructions).toBeLessThan(prompt.indexOf("=== VERIFIED PROFILE FACTS ==="));
    expect(templates).toBeGreaterThan(-1);
    expect(userInstructions).toBeGreaterThan(templates);
    expect(userInstructions).toBeGreaterThan(prompt.indexOf("=== JOB DESCRIPTION ==="));
    expect(prompt).not.toContain("The final sentence must be a question");
    expect(prompt).not.toContain("state BOTH exact values");
  });
});

describe("evaluateProposalQuality", () => {
  const context = {
    jobTitle: base.jobTitle,
    jobDescription: base.jobDescription,
    jobSkills: base.skills,
    profileSkills: profile.skills,
    bidAmount: 120,
    deliveryDays: 3,
    allowedUrls: ["https://example.com/sales"],
  };

  const strong = `The blank Elasticsearch responses point to a network path dropping traffic before the cluster can answer. I would start by tracing TCP/HTTP traffic between the nodes, checking the transport and HTTP ports with curl, then reviewing DNS, load-balancer, security-group, and firewall rules for a silent drop. Once the failing hop is isolated, I will correct the rule and verify that queries return the expected JSON. I will also document the root cause and the prevention steps.

Before changing anything, I would capture the current routing and firewall state so the fix is reversible. After remediation, I would rerun the same queries, compare the responses, and leave you with a short incident note covering the failing hop, the correction, and the check to run if it recurs.

I can complete the diagnosis and remediation in 3 days for $120. Should I begin with a read-only network trace so we can confirm the failing hop before changing any configuration?`;

  it("scores a specific, grounded proposal highly", () => {
    const result = evaluateProposalQuality(strong, context);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.checks.find((check) => check.id === "specific")?.passed).toBe(true);
    expect(result.checks.find((check) => check.id === "price")?.passed).toBe(true);
    expect(result.checks.find((check) => check.id === "delivery")?.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("catches generic filler and missing job specifics", () => {
    const weak =
      "Hi there, I am confident I can help you with this project. I have read your description and have years of experience. I am the perfect fit, so look no further.";
    const result = evaluateProposalQuality(weak, context);
    expect(result.score).toBeLessThan(70);
    expect(result.checks.find((check) => check.id === "specific")?.passed).toBe(false);
    expect(result.warnings.some((warning) => warning.id === "generic")).toBe(true);
  });

  it("flags an invented price and a different delivery time", () => {
    const result = evaluateProposalQuality(
      "I can diagnose the Elasticsearch cluster and fix the HTTP and transport ports. I will deliver in 5 days for $500. Shall we start?",
      context
    );
    expect(result.checks.find((check) => check.id === "price")?.passed).toBe(false);
    expect(result.checks.find((check) => check.id === "delivery")?.passed).toBe(false);
  });

  it("allows omitting price and delivery when the instructions do not ask for them", () => {
    const result = evaluateProposalQuality(
      "I would trace the TCP and HTTP ports, inspect the Elasticsearch transport layer, check DNS and firewall rules, and document the failing hop. After the fix I would rerun the same queries and compare the JSON responses.",
      context
    );
    expect(result.checks.find((check) => check.id === "price")?.passed).toBe(true);
    expect(result.checks.find((check) => check.id === "delivery")?.passed).toBe(true);
    expect(result.checks.find((check) => check.id === "delivery")?.detail).toBe(
      "not mentioned"
    );
  });

  it("accepts common delivery phrasings", () => {
    const withHyphen = evaluateProposalQuality(
      "I can diagnose the Elasticsearch network fault in a 7-day turnaround for $120. Can we start with a read-only trace?",
      { ...context, deliveryDays: 7 }
    );
    expect(withHyphen.checks.find((check) => check.id === "delivery")?.passed).toBe(true);

    const withWords = evaluateProposalQuality(
      "I can diagnose the Elasticsearch network fault in one week for $120. Can we start with a read-only trace?",
      { ...context, deliveryDays: 7 }
    );
    expect(withWords.checks.find((check) => check.id === "delivery")?.passed).toBe(true);
  });

  it("accepts a statement-based closing when it asks the client to reply", () => {
    const result = evaluateProposalQuality(
      "I can diagnose the Elasticsearch network fault in 3 days for $120. Let me know if you want to start with a read-only trace.",
      context
    );
    expect(result.checks.find((check) => check.id === "cta")?.passed).toBe(true);
  });

  it("flags competitor and bid-stat leaks", () => {
    const result = evaluateProposalQuality(
      "There are many other freelancers and the median bid is high. I can trace the TCP and HTTP ports and fix the Elasticsearch firewall rule in 3 days for $120. Shall we start?",
      context
    );
    expect(result.checks.find((check) => check.id === "competition")?.passed).toBe(false);
  });

  it("flags links that are not in the verified profile", () => {
    const result = evaluateProposalQuality(
      "I would trace the TCP and HTTP ports, check the Elasticsearch firewall rule, and document the root cause. See https://unverified.example/portfolio for similar work. Can we start with a read-only trace?",
      context
    );
    expect(result.checks.find((check) => check.id === "links")?.passed).toBe(false);
  });

  it("warns when experience is claimed for a job skill missing from the profile", () => {
    const result = evaluateProposalQuality(
      "I have used Kubernetes to run Elasticsearch in production. I would trace the TCP and HTTP ports and check the firewall rule. Can we start with a read-only trace in 3 days for $120?",
      { ...context, jobSkills: [...context.jobSkills, "Kubernetes"] }
    );
    expect(result.warnings.some((warning) => warning.id === "unsupported-skill")).toBe(true);
  });
});
