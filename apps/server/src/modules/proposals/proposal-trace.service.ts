import { and, asc, desc, eq, sql } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import {
  proposalGenerationEvents,
  proposalGenerationRuns,
  proposals,
} from "../../db/schema.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("proposals");

export type ProposalGenerationEventStatus =
  | "started"
  | "completed"
  | "warning"
  | "failed"
  | "info";

export type ProposalGenerationRunStatus = "running" | "completed" | "failed";

export type ProposalGenerationTrigger = "generate" | "regenerate";

/** A single progress update emitted by the proposal pipeline. */
export interface ProposalTraceEvent {
  phase: string;
  title: string;
  detail?: string;
  status?: ProposalGenerationEventStatus;
  data?: unknown;
}

export type ProposalTraceEmitter = (event: ProposalTraceEvent) => void;

export interface ProposalGenerationTrace {
  id: string;
  emit: ProposalTraceEmitter;
  /** Brand-new proposals do not have an id until after the pipeline succeeds. */
  attachProposal: (proposalId: string) => void;
  finish: (status: ProposalGenerationRunStatus, error?: string) => void;
}

export interface ProposalGenerationEventView {
  id: number;
  seq: number;
  phase: string;
  title: string;
  detail: string | null;
  status: ProposalGenerationEventStatus;
  data: unknown;
  createdAt: string;
}

export interface ProposalGenerationRunView {
  id: string;
  proposalId: string | null;
  jobId: string;
  trigger: ProposalGenerationTrigger;
  status: ProposalGenerationRunStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  events: ProposalGenerationEventView[];
}

export interface ProposalGenerationRunSummary {
  id: string;
  proposalId: string | null;
  jobId: string;
  jobTitle: string | null;
  client: string | null;
  trigger: ProposalGenerationTrigger;
  status: ProposalGenerationRunStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  eventCount: number;
}

interface StartRunInput {
  userId: string;
  jobId: string;
  proposalId?: string | null;
  trigger: ProposalGenerationTrigger;
}

function runId(): string {
  return `gen-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function serializeData(data: unknown): string | null {
  if (data === undefined) return null;
  try {
    return JSON.stringify(data);
  } catch {
    return null;
  }
}

function parseData(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown error").slice(0, 2_000);
}

/**
 * Start a persisted progress run. Tracing is diagnostic: a database failure
 * must never abort proposal generation, so every write is best-effort.
 */
export function startProposalGenerationRun(
  input: StartRunInput
): ProposalGenerationTrace {
  const id = runId();
  const startedAt = new Date().toISOString();
  let seq = 0;
  let finished = false;

  try {
    getDb()
      .insert(proposalGenerationRuns)
      .values({
        id,
        userId: input.userId,
        proposalId: input.proposalId ?? null,
        jobId: input.jobId,
        trigger: input.trigger,
        status: "running",
        startedAt,
      })
      .run();
  } catch (error) {
    log.warn("Failed to start proposal trace", { error: errorMessage(error) });
  }

  return {
    id,
    emit(event) {
      if (finished) return;
      seq += 1;
      try {
        getDb()
          .insert(proposalGenerationEvents)
          .values({
            runId: id,
            seq,
            phase: event.phase,
            title: event.title,
            detail: event.detail ?? null,
            status: event.status ?? "info",
            data: serializeData(event.data),
            createdAt: new Date().toISOString(),
          })
          .run();
      } catch (error) {
        log.warn("Failed to save proposal trace event", {
          runId: id,
          phase: event.phase,
          error: errorMessage(error),
        });
      }
    },
    attachProposal(proposalId) {
      try {
        getDb()
          .update(proposalGenerationRuns)
          .set({ proposalId })
          .where(eq(proposalGenerationRuns.id, id))
          .run();
      } catch (error) {
        log.warn("Failed to attach proposal trace", {
          runId: id,
          proposalId,
          error: errorMessage(error),
        });
      }
    },
    finish(status, error) {
      if (finished) return;
      finished = true;
      try {
        getDb()
          .update(proposalGenerationRuns)
          .set({
            status,
            finishedAt: new Date().toISOString(),
            error: error ? error.slice(0, 2_000) : null,
          })
          .where(eq(proposalGenerationRuns.id, id))
          .run();
      } catch (cause) {
        log.warn("Failed to finish proposal trace", {
          runId: id,
          error: errorMessage(cause),
        });
      }
    },
  };
}

type RunRow = typeof proposalGenerationRuns.$inferSelect;

function runView(run: RunRow): ProposalGenerationRunView {
  const events = getDb()
    .select()
    .from(proposalGenerationEvents)
    .where(eq(proposalGenerationEvents.runId, run.id))
    .orderBy(asc(proposalGenerationEvents.seq))
    .all();

  return {
    id: run.id,
    proposalId: run.proposalId,
    jobId: run.jobId,
    trigger: run.trigger as ProposalGenerationTrigger,
    status: run.status as ProposalGenerationRunStatus,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    events: events.map((event) => ({
      id: event.id,
      seq: event.seq,
      phase: event.phase,
      title: event.title,
      detail: event.detail,
      status: event.status as ProposalGenerationEventStatus,
      data: parseData(event.data),
      createdAt: event.createdAt,
    })),
  };
}

/** Latest generation run for a proposal, scoped to its owner. */
export function getLatestProposalGeneration(
  userId: string,
  proposalId: string
): ProposalGenerationRunView | null {
  const run = getDb()
    .select()
    .from(proposalGenerationRuns)
    .where(
      and(
        eq(proposalGenerationRuns.userId, userId),
        eq(proposalGenerationRuns.proposalId, proposalId)
      )
    )
    .orderBy(desc(proposalGenerationRuns.startedAt))
    .limit(1)
    .get();

  return run ? runView(run) : null;
}

/** Recent generation runs for the owner, newest first. */
export function listProposalGenerationRuns(
  userId: string,
  limit = 25,
  filters: { proposalId?: string; jobId?: string } = {}
): ProposalGenerationRunSummary[] {
  const conditions = [eq(proposalGenerationRuns.userId, userId)];
  if (filters.proposalId !== undefined) {
    conditions.push(eq(proposalGenerationRuns.proposalId, filters.proposalId));
  }
  if (filters.jobId !== undefined) {
    conditions.push(eq(proposalGenerationRuns.jobId, filters.jobId));
  }

  const rows = getDb()
    .select({
      id: proposalGenerationRuns.id,
      proposalId: proposalGenerationRuns.proposalId,
      jobId: proposalGenerationRuns.jobId,
      trigger: proposalGenerationRuns.trigger,
      status: proposalGenerationRuns.status,
      error: proposalGenerationRuns.error,
      startedAt: proposalGenerationRuns.startedAt,
      finishedAt: proposalGenerationRuns.finishedAt,
      jobTitle: proposals.jobTitle,
      client: proposals.client,
      eventCount: sql<number>`(
        SELECT COUNT(*) FROM ${proposalGenerationEvents}
        WHERE ${proposalGenerationEvents.runId} = ${proposalGenerationRuns.id}
      )`,
    })
    .from(proposalGenerationRuns)
    .leftJoin(
      proposals,
      and(
        eq(proposals.id, proposalGenerationRuns.proposalId),
        eq(proposals.userId, userId)
      )
    )
    .where(and(...conditions))
    .orderBy(desc(proposalGenerationRuns.startedAt))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    ...row,
    trigger: row.trigger as ProposalGenerationTrigger,
    status: row.status as ProposalGenerationRunStatus,
    eventCount: Number(row.eventCount),
  }));
}

/** One generation run with its ordered events, scoped to its owner. */
export function getProposalGenerationRun(
  userId: string,
  runId: string
): ProposalGenerationRunView | null {
  const run = getDb()
    .select()
    .from(proposalGenerationRuns)
    .where(
      and(
        eq(proposalGenerationRuns.userId, userId),
        eq(proposalGenerationRuns.id, runId)
      )
    )
    .get();

  return run ? runView(run) : null;
}

