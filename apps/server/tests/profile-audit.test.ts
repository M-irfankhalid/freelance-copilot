import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE_AUDIT_SETTINGS } from "../src/lib/profile-audit-defaults.js";
import { DEFAULT_PROPOSAL_ENGINE } from "../src/lib/proposal-defaults.js";
import type { ProfileData } from "../src/modules/profile/profile.service.js";
import {
  aiFindingIsGrounded,
  deterministicProfileFindings,
  type ProfileFinding,
} from "../src/modules/proposals/profile-audit.service.js";

function profile(overrides: Partial<ProfileData> = {}): ProfileData {
  return {
    freelancerUsername: null,
    name: "Test User",
    title: "Full-stack developer",
    hourlyRate: null,
    about: "I build React and Node applications for small teams. ".repeat(4),
    skills: ["React.js", "Node.js"],
    skillIds: [759, 500],
    preferredProjectTypes: ["SaaS"],
    wants: ["React"],
    notWants: [],
    ignoredCountries: [],
    customInstructions: null,
    userSummary: null,
    relevancyInstructions: null,
    portfolioSummary: "A portfolio summary with enough detail to pass the minimum length check.",
    proposalTemplates: null,
    proposalSystemInstructions: null,
    proposalWritingInstructions: null,
    ...overrides,
  };
}

function findingsFor(overrides: Partial<ProfileData>) {
  return deterministicProfileFindings(
    profile(overrides),
    DEFAULT_PROFILE_AUDIT_SETTINGS,
    DEFAULT_PROPOSAL_ENGINE.policy
  );
}

describe("deterministic profile audit", () => {
  it("does not treat a negated rule as a contradiction", () => {
    const findings = findingsFor({
      customInstructions: "Do not include price, delivery, or portfolio links in the proposal body.",
      proposalWritingInstructions: "Never mention a timeline.",
    });

    expect(findings.some((finding) => finding.ruleId === "conflicting-instructions")).toBe(false);
  });

  it("flags genuinely contradictory sentences", () => {
    const findings = findingsFor({
      customInstructions:
        "Include a price when the client asks.\nNever include a price in the proposal body.",
    });

    expect(findings.some((finding) => finding.ruleId === "conflicting-instructions")).toBe(true);
  });

  it("ignores excluded countries mentioned only in screening instructions", () => {
    const findings = findingsFor({
      ignoredCountries: ["India"],
      relevancyInstructions: "Do not pursue jobs whose client is in India.",
    });

    expect(findings.some((finding) => finding.ruleId === "ignored-country-conflict")).toBe(false);
  });

  it("flags an excluded country that is also a target preference", () => {
    const findings = findingsFor({
      ignoredCountries: ["India"],
      wants: ["India"],
    });

    expect(findings.some((finding) => finding.ruleId === "ignored-country-conflict")).toBe(true);
  });
});

describe("AI profile-audit grounding", () => {
  const finding = (ruleId: string): ProfileFinding => ({
    ruleId,
    severity: "warning",
    category: "conflict",
    field: "customInstructions",
    title: "AI finding",
    evidence: "AI evidence",
    why: "AI reason",
    recommendation: "Fix it",
  });

  it("drops a wall-of-rules finding when no instruction block is over 4000 characters", () => {
    expect(
      aiFindingIsGrounded(
        finding("wall-of-rules"),
        profile({ customInstructions: "Keep it short." }),
        DEFAULT_PROPOSAL_ENGINE.policy
      )
    ).toBe(false);
  });

  it("drops a legacy-format finding for a greeting preference", () => {
    expect(
      aiFindingIsGrounded(
        finding("legacy-format-conflict"),
        profile({ customInstructions: "Start with \"Hi,\" and keep the rest natural." }),
        DEFAULT_PROPOSAL_ENGINE.policy
      )
    ).toBe(false);
  });

  it("drops an ignored-country finding based only on related wants", () => {
    expect(
      aiFindingIsGrounded(
        finding("ignored-country-conflict"),
        profile({
          ignoredCountries: ["India"],
          wants: ["WordPress website maintenance"],
        }),
        DEFAULT_PROPOSAL_ENGINE.policy
      )
    ).toBe(false);
  });
});
