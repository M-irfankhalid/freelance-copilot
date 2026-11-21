import { useState } from "react";
import { Link } from "react-router";
import {
  Activity,
  CircleCheck,
  CircleX,
  Clock,
  Inbox,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

type RunStatus = "running" | "completed" | "failed";
type EventStatus = "started" | "completed" | "warning" | "failed" | "info";

const RUN_RESULT_LABEL: Record<RunStatus, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

interface TraceRunSummary {
  id: string;
  proposalId: string | null;
  jobId: string;
  jobTitle: string | null;
  client: string | null;
  trigger: "generate" | "regenerate";
  status: RunStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  eventCount: number;
}

interface TraceEvent {
  id: number;
  seq: number;
  phase: string;
  title: string;
  detail: string | null;
  status: EventStatus;
  data: unknown;
  createdAt: string;
}

interface TraceRun extends Omit<TraceRunSummary, "jobTitle" | "client" | "eventCount"> {
  events: TraceEvent[];
}

interface RunsResponse {
  runs: TraceRunSummary[];
}

interface RunResponse {
  run: TraceRun;
}

function TraceStat({
  icon: Icon,
  label,
  value,
  detail,
  tone = "text-muted-foreground",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </p>
          <Icon className={cn("size-4", tone)} aria-hidden />
        </div>
        <p className="text-xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="truncate text-xs text-muted-foreground" title={detail}>
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}

/** Read-only record of every proposal pipeline run and model call. */
export default function ProposalTracesPage() {
  const { data, error, isLoading, refetch } =
    useApi<RunsResponse>("/api/proposal-traces?limit=50");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runs = data?.runs ?? [];
  const activeRunId = selectedRunId ?? runs[0]?.id ?? null;
  const activeSummary = runs.find((run) => run.id === activeRunId) ?? null;
  const detail = useApi<RunResponse>(
    activeRunId === null
      ? null
      : `/api/proposal-traces/${encodeURIComponent(activeRunId)}`
  );

  const refresh = () => {
    refetch();
    detail.refetch();
  };

  const completedCount = runs.filter((run) => run.status === "completed").length;
  const failedCount = runs.filter((run) => run.status === "failed").length;
  const runningCount = runs.filter((run) => run.status === "running").length;
  const lastRun = runs[0];

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Run history"
        description="A read-only record of proposal generation. Open a run to see each pipeline phase, the exact prompts, and the raw model responses."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline">Read only</Badge>
            <Button variant="outline" onClick={refresh} disabled={isLoading}>
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <Card size="sm" className="border-destructive/25 ring-destructive/15">
          <CardHeader>
            <CardTitle>Could not load run history</CardTitle>
            <CardDescription>{error.message}</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
                <RefreshCw data-icon="inline-start" />
                Retry
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
      ) : null}

      {runs.length > 0 ? (
        <section
          aria-label="Run summary"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          <TraceStat
            icon={Activity}
            label="Runs"
            value={String(runs.length)}
            detail={
              runningCount > 0
                ? `${runningCount} running · latest 50 runs`
                : "Latest 50 proposal runs"
            }
          />
          <TraceStat
            icon={CircleCheck}
            label="Completed"
            value={String(completedCount)}
            detail={
              completedCount === runs.length
                ? "Every run finished cleanly"
                : `${runs.length - completedCount} need review`
            }
            tone="text-success"
          />
          <TraceStat
            icon={CircleX}
            label="Failed"
            value={String(failedCount)}
            detail={
              failedCount === 0
                ? "No failed runs"
                : `${failedCount} error${failedCount === 1 ? "" : "s"} recorded`
            }
            tone={failedCount > 0 ? "text-destructive" : "text-muted-foreground"}
          />
          <TraceStat
            icon={Clock}
            label="Latest run"
            value={lastRun === undefined ? "—" : RUN_RESULT_LABEL[lastRun.status]}
            detail={
              lastRun === undefined
                ? "Generate a proposal to record one"
                : `${durationLabel(lastRun.startedAt, lastRun.finishedAt)} · ${formatDateTime(lastRun.startedAt)}`
            }
            tone={
              lastRun === undefined
                ? "text-muted-foreground"
                : lastRun.status === "failed"
                  ? "text-destructive"
                  : lastRun.status === "running"
                    ? "text-warning"
                    : "text-success"
            }
          />
        </section>
      ) : null}

      {isLoading && data === null ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <Skeleton className="h-[60vh] w-full" />
          <Skeleton className="h-[60vh] w-full" />
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <Inbox className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No proposal runs yet</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Generate or regenerate a proposal, then come back here to inspect every
            prompt and model response.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-1">
            <Link to="/proposals">Go to proposals</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div
            className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-xl border bg-card p-2"
            aria-label="Generation runs"
          >
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedRunId(run.id)}
                aria-current={run.id === activeRunId ? "true" : undefined}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  run.id === activeRunId
                    ? "border-primary bg-muted/50"
                    : "hover:bg-muted/40"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">
                    {run.jobTitle ?? `Job ${run.jobId}`}
                  </span>
                  <RunStatusBadge status={run.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {run.client ?? run.jobId}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{run.trigger === "regenerate" ? "Regenerate" : "Generate"}</span>
                  <span>{run.eventCount} events</span>
                  <span>{durationLabel(run.startedAt, run.finishedAt)}</span>
                  <span>{formatDateTime(run.startedAt)}</span>
                </div>
                {run.error ? (
                  <p className="mt-1 line-clamp-2 text-xs text-destructive">
                    {run.error}
                  </p>
                ) : null}
              </button>
            ))}
          </div>

          <div className="min-w-0 rounded-xl border bg-card">
            {detail.isLoading && detail.data === null ? (
              <div className="flex flex-col gap-3 p-6">
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-12" />
                  ))}
                </div>
                <Skeleton className="mt-4 h-40 w-full" />
              </div>
            ) : detail.error ? (
              <div className="flex flex-col items-start gap-2 p-6">
                <p className="text-sm text-destructive">{detail.error.message}</p>
                <Button variant="outline" size="sm" onClick={() => detail.refetch()}>
                  <RefreshCw data-icon="inline-start" />
                  Retry
                </Button>
              </div>
            ) : detail.data?.run && activeSummary ? (
              <RunDetail run={detail.data.run} summary={activeSummary} />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                Select a generation run.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RunDetail({ run, summary }: { run: TraceRun; summary: TraceRunSummary }) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4 md:p-6">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">
            {summary.jobTitle ?? `Job ${summary.jobId}`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary.client ?? summary.jobId} ·{" "}
            {summary.trigger === "regenerate" ? "Regenerated" : "Generated"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="capitalize">
            {summary.trigger}
          </Badge>
          <RunStatusBadge status={run.status} />
        </div>
      </div>

      <dl className="grid gap-3 border-b p-4 text-sm sm:grid-cols-2 md:p-6 lg:grid-cols-4">
        <RunMeta label="Started" value={formatDateTime(run.startedAt)} />
        <RunMeta label="Duration" value={durationLabel(run.startedAt, run.finishedAt)} />
        <RunMeta label="Events" value={String(run.events.length)} />
        <RunMeta label="Run ID" value={run.id} mono />
      </dl>

      {run.error ? (
        <div className="border-b bg-destructive/5 px-4 py-3 text-sm text-destructive md:px-6">
          {run.error}
        </div>
      ) : null}

      <div className="p-4 md:p-6">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" aria-hidden />
          <h3 className="font-semibold">Pipeline</h3>
        </div>
        <ol className="flex flex-col gap-3">
          {run.events.map((event, index) => (
            <TraceEventRow
              key={event.id}
              event={event}
              isLast={index === run.events.length - 1}
            />
          ))}
        </ol>
        {run.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">This run recorded no events.</p>
        ) : null}
      </div>
    </div>
  );
}

function RunMeta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}

function TraceEventRow({
  event,
  isLast,
}: {
  event: TraceEvent;
  isLast: boolean;
}) {
  const payload = isRecord(event.data) ? event.data : null;
  const isModelCall = payload?.kind === "model-call";

  return (
    <li className="flex gap-3">
      <span className="flex flex-col items-center pt-2" aria-hidden>
        <span
          className={cn(
            "size-2.5 shrink-0 rounded-full ring-4 ring-card",
            eventDotClass[event.status]
          )}
        />
        {!isLast ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
      </span>
      <div className="min-w-0 flex-1 rounded-lg border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            #{event.seq}
          </span>
          <Badge variant="outline" className="capitalize">
            {event.phase}
          </Badge>
          <span className="font-medium">{event.title}</span>
          <EventStatusBadge status={event.status} />
          <span className="ml-auto text-xs text-muted-foreground">
            {formatTime(event.createdAt)}
          </span>
        </div>
        {event.detail ? (
          <p className="mt-1.5 text-sm text-muted-foreground">{event.detail}</p>
        ) : null}
        {event.data !== null && event.data !== undefined ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none hover:text-foreground">
              {isModelCall ? "Inspect request & response" : "Inspect event data"}
            </summary>
            <div className="mt-2">
              {isModelCall && payload ? (
                <ModelCallPayload data={payload} />
              ) : (
                <PayloadBlock label="Event data" text={prettyJson(event.data)} />
              )}
            </div>
          </details>
        ) : null}
      </div>
    </li>
  );
}

function ModelCallPayload({ data }: { data: Record<string, unknown> }) {
  const request = isRecord(data.request) ? data.request : null;

  return (
    <div className="flex flex-col gap-2">
      {request ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Model: {textValue(request.model)}</span>
          <span>Temperature: {textValue(request.temperature)}</span>
          <span>Timeout: {textValue(request.timeoutMs)}ms</span>
          {data.durationMs !== undefined ? (
            <span>Call time: {textValue(data.durationMs)}ms</span>
          ) : null}
        </p>
      ) : null}
      {typeof request?.system === "string" ? (
        <PayloadBlock label="System prompt" text={request.system} />
      ) : null}
      {typeof request?.user === "string" ? (
        <PayloadBlock label="User prompt" text={request.user} />
      ) : null}
      {request?.responseFormat !== undefined ? (
        <PayloadBlock
          label="Response schema"
          text={prettyJson(request.responseFormat)}
        />
      ) : null}
      {typeof data.response === "string" ? (
        <PayloadBlock label="Raw response" text={data.response} />
      ) : data.response !== undefined ? (
        <PayloadBlock label="Response" text={prettyJson(data.response)} />
      ) : null}
      {typeof data.error === "string" ? (
        <PayloadBlock label="Error" text={data.error} tone="error" />
      ) : null}
    </div>
  );
}

function PayloadBlock({
  label,
  text,
  tone = "default",
}: {
  label: string;
  text: string;
  tone?: "default" | "error";
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <pre
        className={cn(
          "max-h-80 overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap",
          tone === "error"
            ? "bg-destructive/5 text-destructive"
            : "bg-muted/40 text-foreground"
        )}
      >
        {text}
      </pre>
    </div>
  );
}

const runStatusClass: Record<RunStatus, string> = {
  completed: "border-transparent bg-success/10 text-success",
  failed: "border-transparent bg-destructive/10 text-destructive",
  running: "border-transparent bg-warning/10 text-warning",
};

function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge variant="outline" className={cn("capitalize", runStatusClass[status])}>
      {status}
    </Badge>
  );
}

const eventStatusClass: Record<EventStatus, string> = {
  completed: "border-transparent bg-success/10 text-success",
  failed: "border-transparent bg-destructive/10 text-destructive",
  warning: "border-transparent bg-warning/10 text-warning",
  started: "border-border text-foreground",
  info: "border-border text-muted-foreground",
};

const eventDotClass: Record<EventStatus, string> = {
  completed: "bg-success",
  failed: "bg-destructive",
  warning: "bg-warning",
  started: "bg-primary",
  info: "bg-muted-foreground",
};

function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <Badge variant="outline" className={cn("capitalize", eventStatusClass[status])}>
      {status}
    </Badge>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return prettyJson(value);
}

function prettyJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDateTime(value: string | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

function durationLabel(startedAt: string, finishedAt: string | null): string {
  if (finishedAt === null) return "running";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}
