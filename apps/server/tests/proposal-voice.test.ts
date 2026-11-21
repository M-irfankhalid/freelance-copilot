import { describe, expect, it, vi } from "vitest";

import type { SampleView } from "../src/modules/proposals/proposal-config.service.js";
import type { ProposalTraceEvent } from "../src/modules/proposals/proposal-trace.service.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";

const aiMocks = vi.hoisted(() => ({
  callOpenRouterStructured: vi.fn(),
}));

vi.mock("../src/modules/ai/ai.service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/modules/ai/ai.service.js")>();
  return {
    ...actual,
    callOpenRouterStructured: aiMocks.callOpenRouterStructured,
  };
});

const {
  buildFallbackVoiceProfile,
  getVoiceGuide,
  sanitizeVoiceProfile,
  voiceGuideText,
} = await import("../src/modules/proposals/proposal-voice.service.js");

const content =
  "Hi,\n\nReplacing text and images on a live WordPress site with Elementor requires careful handling to avoid layout issues. I'll update the text, replace the Chart 2 image, and test the pages on desktop and mobile.\n\nPlease tell me which word should be removed from the PDF title.\n\nBest Regards,\nIrfan Khalid";

const sample: SampleView = {
  id: "sample-wordpress",
  title: "WordPress content and image update",
  jobType: "wordpress-content-update",
  content,
  tags: ["wordpress", "elementor", "content"],
  outcome: "won",
  rating: 5,
  preferred: false,
  notes: "",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("voice distillation", () => {
  it("describes style without reproducing sample prose", () => {
    const profile = buildFallbackVoiceProfile([sample]);
    const text = voiceGuideText(profile);

    expect(text).toContain("first-person");
    expect(text).toContain("Average sentence");
    expect(text).toContain("conventional sign-off");
    expect(text).not.toContain("Replacing text and images");
    expect(text).not.toContain("Chart 2");
    expect(text).not.toContain("Best Regards");
  });

  it("drops sample sentences, titles, and URLs from AI-generated guides", () => {
    const clean = sanitizeVoiceProfile(
      {
        summary:
          "Replacing text and images on a live WordPress site with Elementor requires careful handling to avoid layout issues.",
        rhythm: "Uses roughly 14-word sentences and compact paragraphs.",
        openings: [
          "Opens with a direct recommendation or a practical observation.",
          "Start with: Replacing text and images on a live WordPress site with Elementor requires careful handling.",
        ],
        structure:
          "Moves from the main recommendation into a short practical approach, then closes.",
        closings: ["Ends with a brief sign-off.", "See https://example.com/work for details."],
        habits: ["Uses contractions.", "Prefers prose over bullets."],
        avoid: ["Never copy the WordPress content and image update sample."],
      },
      [sample]
    );

    const serialized = JSON.stringify(clean);
    expect(serialized).not.toContain("Replacing text and images");
    expect(serialized).not.toContain("WordPress content and image update");
    expect(serialized).not.toContain("https://");
    expect(clean.rhythm).toContain("14-word sentences");
    expect(clean.openings).toContain("Opens with a direct recommendation or a practical observation.");
    expect(clean.closings).toContain("Ends with a brief sign-off.");
    expect(clean.habits).toContain("Uses contractions.");
  });

  it("tells the writer to use the guide for voice, not as a template", () => {
    const text = voiceGuideText(buildFallbackVoiceProfile([sample]));

    expect(text).toContain("not sample text");
    expect(text).toContain("Do not turn it into a template");
    expect(text).toContain("Do not paraphrase the brief");
    expect(text).not.toContain(sample.content);
  });

  it("returns safe generic guidance when there are no samples", () => {
    expect(buildFallbackVoiceProfile([]).summary).toContain("No usable voice samples");
  });

  it("records the voice guide API request and raw response", async () => {
    const raw = JSON.stringify({
      summary: "Writes directly and keeps the focus on the client's problem.",
      rhythm: "Uses short sentences and compact paragraphs.",
      openings: ["Opens with a practical recommendation."],
      structure: "Moves from recommendation to a short approach, then closes.",
      closings: ["Ends with a brief sign-off."],
      habits: ["Uses contractions."],
      avoid: ["Avoid generic consultant language."],
    });
    aiMocks.callOpenRouterStructured.mockResolvedValueOnce(raw);
    const events: ProposalTraceEvent[] = [];

    await getVoiceGuide({
      userId: "voice-trace-user",
      samples: [sample],
      model: "test/voice-model",
      onTrace: (event) => events.push(event),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      phase: "setup",
      title: "Voice guide API response",
      status: "completed",
      data: {
        kind: "model-call",
        response: raw,
        request: { model: "test/voice-model", user: expect.stringContaining("SAMPLE 1") },
      },
    });
  });
});
