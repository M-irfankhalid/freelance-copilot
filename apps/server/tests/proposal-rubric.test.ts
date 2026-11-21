import { describe, expect, it } from "vitest";

import {
  ensureReadableParagraphs,
  evaluateBriefCoverage,
  evaluateDeletionCandidate,
  genericClaims,
  hasGenericOpening,
  repeatedSentences,
} from "../src/lib/proposal-rubric.js";

const brief = {
  deliverables: ["Migrate the WordPress site", "Set up DNS and business email"],
  mustAddress: ["Preserve existing posts"],
  explicitQuestions: ["Can you keep the current URLs?"],
};

describe("proposal rubric helpers", () => {
  it("detects generic openings and generic claims", () => {
    expect(hasGenericOpening("I'd be happy to help with this project.")).toBe(true);
    expect(hasGenericOpening("The blank response is probably a transport-level failure.")).toBe(
      false
    );
    expect(genericClaims("I will provide a seamless, robust solution.")).toEqual([
      "seamless",
      "robust",
    ]);
  });

  it("finds repeated sentences", () => {
    const text =
      "We should test the redirect map first. We should test the redirect map first.";
    expect(repeatedSentences(text)).toHaveLength(1);
  });

  it("splits a dense proposal into readable paragraphs without changing words", () => {
    const text =
      "I can build the service store with a responsive catalog and a clear booking flow. The catalog will support service variants, pricing, and availability so clients can compare options easily. Checkout will use a secure payment gateway, and an admin dashboard will let you manage bookings without touching code. I will also configure basic SEO and analytics, then test the full booking path on desktop and mobile before handoff.";
    const formatted = ensureReadableParagraphs(text);
    expect(formatted.split(/\n\s*\n/)).toHaveLength(2);
    expect(formatted.replace(/\s+/g, " ").trim()).toBe(text.replace(/\s+/g, " ").trim());
  });

  it("leaves existing paragraphs and very short notes unchanged", () => {
    const paragraphs = "First point.\n\nSecond point.";
    expect(ensureReadableParagraphs(paragraphs)).toBe(paragraphs);
    const shortNote = "I can fix this today.";
    expect(ensureReadableParagraphs(shortNote)).toBe(shortNote);
  });

  it("evaluates deliverable and question coverage with synonyms", () => {
    const coverage = evaluateBriefCoverage(
      "I would migrate the WordPress site, set up DNS and business email, preserve existing posts, and keep the current URLs.",
      brief
    );
    expect(coverage.missing).toEqual([]);
    expect(coverage.coveredCount).toBe(coverage.total);
  });

  it("treats application requirements as mandatory coverage", () => {
    const coverage = evaluateBriefCoverage(
      "I would migrate the WordPress site, set up DNS and business email, preserve existing posts, and keep the current URLs.",
      {
        ...brief,
        applicationRequirements: ["Start your message with the word agents."],
      }
    );
    expect(coverage.missing).toContain("Start your message with the word agents.");
  });

  it("recognizes a required opening even when the rest of the wording differs", () => {
    const coverage = evaluateBriefCoverage(
      'agents\n\nI would map the architecture and explain the data flow.',
      {
        applicationRequirements: ['Start message with the word "agents".'],
      }
    );
    expect(coverage.missing).toEqual([]);
  });

  it("reports missing deliverables instead of accepting a partial draft", () => {
    const coverage = evaluateBriefCoverage(
      "I would migrate the WordPress site and preserve existing posts, then keep the current URLs.",
      brief
    );
    expect(coverage.missing).toContain("Set up DNS and business email");
  });

  it("does not accept adjacent launch words as marketing or ongoing support", () => {
    const coverage = evaluateBriefCoverage(
      "After launch, I stay hands-on. The first two things I do post-launch are monitor sales and source alternatives.",
      {
        deliverables: [
          "A marketing and launch plan with ad/content guidance to drive first sales",
          "Ongoing support after launch for product refinement and scaling",
        ],
      }
    );
    expect(coverage.missing).toHaveLength(2);
  });

  it("accepts a marketing deliverable when the draft names the channel work", () => {
    const coverage = evaluateBriefCoverage(
      "I will provide a marketing plan with paid ads and content for the first sales.",
      {
        deliverables: [
          "A marketing and launch plan with ad/content guidance to drive first sales",
        ],
      }
    );
    expect(coverage.missing).toEqual([]);
  });
});

describe("evaluateDeletionCandidate", () => {
  const longDraft = [
    "I would migrate the WordPress site and set up DNS and business email.",
    "I would preserve existing posts and keep the current URLs.",
    "The redirect map should be tested before cutover.",
    "The final check is a live query against the new host.",
    ...Array.from({ length: 30 }, () => "This sentence is filler that adds no new information."),
  ].join(" ");

  it("rejects a cut below the policy minimum", () => {
    const result = evaluateDeletionCandidate({
      before: longDraft,
      after: "I would migrate the WordPress site.",
      minWords: 80,
      maxWords: 240,
      brief,
    });
    expect(result.accept).toBe(false);
    expect(result.reasons.join(" ")).toContain("below the 80-word minimum");
  });

  it("rejects a cut that loses coverage", () => {
    const after = longDraft
      .replace("I would migrate the WordPress site and set up DNS and business email.", "I would set up DNS and business email.")
      .replace("I would preserve existing posts and keep the current URLs.", "I would keep the current URLs.");
    const result = evaluateDeletionCandidate({
      before: longDraft,
      after,
      minWords: 80,
      maxWords: 240,
      brief,
    });
    expect(result.accept).toBe(false);
    expect(result.reasons.join(" ")).toContain("lost coverage");
  });

  it("accepts a shorter draft that keeps coverage and stays in range", () => {
    const after = [
      "I would migrate the WordPress site and set up DNS and business email.",
      "I would preserve existing posts and keep the current URLs.",
      "The redirect map should be tested before cutover.",
      "The final check is a live query against the new host.",
      ...Array.from({ length: 14 }, () => "This sentence is filler that adds no new information."),
    ].join(" ");
    const result = evaluateDeletionCandidate({
      before: longDraft,
      after,
      minWords: 20,
      maxWords: 240,
      brief,
    });
    expect(result.accept).toBe(true);
    expect(result.afterWords).toBeLessThan(result.beforeWords);
  });
});
