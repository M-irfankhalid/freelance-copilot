import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";

const { closeDb } = await import("../src/db/index.js");
const { register } = await import("../src/modules/auth/auth.service.js");
const { createProposal } = await import("../src/modules/proposals/proposals.service.js");
const { getLatestProposalGeneration, startProposalGenerationRun } = await import(
  "../src/modules/proposals/proposal-trace.service.js"
);
const {
  getProposalGenerationRun,
  listProposalGenerationRuns,
} = await import("../src/modules/proposals/proposal-trace.service.js");

let userId = "";

beforeAll(async () => {
  const registration = await register({
    name: "Trace Owner",
    email: "trace-owner@example.com",
    password: "correct-horse-battery",
  });
  userId = registration.userId;
});

afterAll(() => {
  closeDb();
});

describe("proposal generation trace", () => {
  it("persists ordered events and attaches a new proposal", async () => {
    const trace = startProposalGenerationRun({
      userId,
      jobId: "job-trace-1",
      trigger: "generate",
    });

    trace.emit({
      phase: "setup",
      title: "Preparing",
      status: "started",
      detail: "Loading context.",
    });
    trace.emit({
      phase: "write",
      title: "Drafting",
      status: "completed",
      detail: "Draft ready.",
      data: {
        request: { system: "You are the owner.", user: "Write the proposal." },
        response: "Raw model response.",
        durationMs: 42,
      },
    });

    const proposal = await createProposal(userId, {
      jobId: "job-trace-1",
      projectId: 101,
      jobTitle: "Build a dashboard",
      client: "Trace Client",
      content: "A saved draft from the trace test.",
    });

    trace.attachProposal(proposal.id);
    trace.emit({
      phase: "save",
      title: "Saved",
      status: "completed",
    });
    trace.finish("completed");

    const run = getLatestProposalGeneration(userId, proposal.id);
    expect(run).not.toBeNull();
    expect(run?.proposalId).toBe(proposal.id);
    expect(run?.status).toBe("completed");
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(run?.events.map((event) => event.phase)).toEqual([
      "setup",
      "write",
      "save",
    ]);
    expect(run?.events[1]?.data).toEqual({
      request: { system: "You are the owner.", user: "Write the proposal." },
      response: "Raw model response.",
      durationMs: 42,
    });
  });

  it("keeps failed runs and scopes traces to their owner", async () => {
    const trace = startProposalGenerationRun({
      userId,
      jobId: "job-trace-2",
      trigger: "regenerate",
    });

    trace.emit({
      phase: "validate",
      title: "Checks failed",
      status: "failed",
    });
    trace.finish("failed", "Blocking checks failed");

    const proposal = await createProposal(userId, {
      jobId: "job-trace-2",
      projectId: 102,
      jobTitle: "Fix a queue",
      client: "Trace Client",
      content: "A second saved draft from the trace test.",
    });
    trace.attachProposal(proposal.id);

    const run = getLatestProposalGeneration(userId, proposal.id);
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("Blocking checks failed");

    expect(
      getLatestProposalGeneration("another-owner-id", proposal.id)
    ).toBeNull();
  });

  it("lists recent runs with job titles and owner-scoped detail", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const trace = startProposalGenerationRun({
      userId,
      jobId: "job-trace-3",
      trigger: "generate",
    });
    trace.emit({ phase: "setup", title: "Preparing", status: "started" });
    trace.finish("completed");

    const runs = listProposalGenerationRuns(userId, 10);
    expect(runs[0]?.id).toBe(trace.id);
    expect(runs[0]?.jobTitle).toBeNull();
    expect(runs[0]?.eventCount).toBe(1);

    const attached = runs.find((run) => run.jobId === "job-trace-1");
    expect(attached?.jobTitle).toBe("Build a dashboard");
    expect(attached?.client).toBe("Trace Client");
    expect(attached?.eventCount).toBe(3);

    expect(listProposalGenerationRuns("another-owner-id", 10)).toEqual([]);

    const detail = getProposalGenerationRun(userId, trace.id);
    expect(detail?.events).toHaveLength(1);
    expect(detail?.events[0]?.phase).toBe("setup");
    expect(getProposalGenerationRun("another-owner-id", trace.id)).toBeNull();
    expect(getProposalGenerationRun(userId, "missing-run")).toBeNull();
  });
});
