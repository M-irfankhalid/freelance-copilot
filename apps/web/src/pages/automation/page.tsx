import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Filter, Pause, Play, RefreshCw, TriangleAlert, Zap } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import type { AutomationSettings, AutomationRun } from "@/lib/types";

interface PipelineApiResponse {
  status: "ok" | "skipped" | "paused" | "error";
  jobsFound: number;
  analyzed: number;
  drafted: number;
  bidsPlaced: number;
}
import { cn } from "@/lib/utils";

interface AutomationApiResponse {
  settings: BackendSettings;
}

interface BackendSettings {
  scanIntervalSeconds: number;
  autoAnalyze: boolean;
  autoMatch: boolean;
  autobidEnabled: boolean;
  minMatchScore: number;
  minBid: number;
  maxBid: number;
  dailyCap: number;
  bidsToday: number;
  capDate: string | null;
  paused: boolean;
  rejectStaleJobs: boolean;
  rejectIgnoredCountries: boolean;
  rejectBadReputation: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RunsApiResponse {
  runs: AutomationRun[];
}

function normalizeSettings(s: BackendSettings): AutomationSettings {
  return {
    scanIntervalSeconds: s.scanIntervalSeconds,
    autoAnalyze: s.autoAnalyze,
    autoMatch: s.autoMatch,
    autobidEnabled: s.autobidEnabled,
    minMatchScore: s.minMatchScore,
    minBid: s.minBid,
    maxBid: s.maxBid,
    dailyCap: s.dailyCap,
    bidsToday: s.bidsToday,
    paused: s.paused,
    rejectStaleJobs: s.rejectStaleJobs,
    rejectIgnoredCountries: s.rejectIgnoredCountries,
    rejectBadReputation: s.rejectBadReputation,
  };
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) {
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
}

/**
 * Automation control. Auto-bid is off until explicitly switched on, and even
 * then it is fenced by threshold, bounds, and a daily cap.
 */
export default function AutomationPage() {
  const { data: settingsData, error: settingsError, isLoading, refetch } = useApi<AutomationApiResponse>("/api/automation");
  const { data: runsData, refetch: refetchRuns } = useApi<RunsApiResponse>("/api/automation/runs");

  // Local draft edits on top of the server's settings. Merged with server
  // data via useMemo so we avoid setState-in-effect entirely.
  const [draft, setDraft] = useState<Partial<AutomationSettings>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  // Debounce timer for settings updates.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Merge server settings with any local draft overrides.
  const serverSettings = settingsData?.settings;
  const settings = useMemo<AutomationSettings | null>(() => {
    if (!serverSettings) return null;
    return { ...normalizeSettings(serverSettings), ...draft };
  }, [serverSettings, draft]);

  // Keep a ref pointing at the latest merged settings so the debounced save
  // always sends the freshest values. A closure over `settings` would capture
  // the pre-draft value and silently revert whatever the user just toggled.
  const settingsRef = useRef<AutomationSettings | null>(null);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const runs = runsData?.runs ?? [];

  const update = <K extends keyof AutomationSettings>(
    key: K,
    value: AutomationSettings[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    // Debounce the save: only send to the API after 750ms of calm.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveSettings().catch((cause) => {
        setActionError(messageFor(cause));
      });
    }, 750);
  };

  const saveSettings = async () => {
    const current = settingsRef.current;
    if (!current) return;
    setActionError(null);
    try {
      await api<{ settings: BackendSettings }>("/api/automation", {
        method: "PUT",
        body: {
          scanIntervalSeconds: current.scanIntervalSeconds,
          autoAnalyze: current.autoAnalyze,
          autoMatch: current.autoMatch,
          autobidEnabled: current.autobidEnabled,
          minMatchScore: current.minMatchScore,
          minBid: current.minBid,
          maxBid: current.maxBid,
          dailyCap: current.dailyCap,
          rejectStaleJobs: current.rejectStaleJobs,
          rejectIgnoredCountries: current.rejectIgnoredCountries,
          rejectBadReputation: current.rejectBadReputation,
        },
      });
      // Clear local drafts since server now reflects the new state.
      setDraft({});
      // Refresh to pick up server-computed fields (bidsToday, paused, etc.).
      refetch();
    } catch {
      // Re-throw so the debounced caller can surface the error.
      throw new Error("Failed to save settings");
    }
  };

  const togglePause = async () => {
    if (!settings) return;
    setActionError(null);
    try {
      await api<{ ok: true; paused: boolean }>("/api/automation/pause", {
        method: "POST",
        body: { paused: !settings.paused },
      });
      refetch();
      refetchRuns();
    } catch (cause) {
      setActionError(messageFor(cause));
    }
  };

  const runAutoBidCheck = async () => {
    setActionError(null);
    try {
      await api<{ ok: true }>("/api/automation/auto-bid-check", { method: "POST" });
      refetch();
      refetchRuns();
    } catch (cause) {
      setActionError(messageFor(cause));
    }
  };

  const [pipelineRunning, setPipelineRunning] = useState(false);

  const runPipelineNow = async () => {
    setActionError(null);
    setPipelineRunning(true);
    try {
      const result = await api<PipelineApiResponse>("/api/automation/run-pipeline", {
        method: "POST",
      });
      if (result.status === "error") {
        setActionError(
          `Pipeline failed — ${result.jobsFound} found, ${result.analyzed} analyzed, ${result.drafted} drafted, ${result.bidsPlaced} bids placed`
        );
      }
      refetch();
      refetchRuns();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setPipelineRunning(false);
    }
  };

  const [resettingUsage, setResettingUsage] = useState(false);

  const resetDailyUsage = async () => {
    setActionError(null);
    setResettingUsage(true);
    try {
      await api<{ settings: BackendSettings }>(
        "/api/automation/reset-daily-usage",
        { method: "POST" }
      );
      // Clear any pending draft so the counter we just zeroed isn't overwritten
      // by a stale debounced save, then pull fresh settings + run log.
      setDraft({});
      refetch();
      refetchRuns();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setResettingUsage(false);
    }
  };

  const capUsed = settings ? Math.min((settings.bidsToday / settings.dailyCap) * 100, 100) : 0;

  if (isLoading && !settings) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader title="Automation" description="How hard the worker runs — and how much it may do without you." />
        <Card size="sm">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Loading automation settings…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (settingsError) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader title="Automation" description="How hard the worker runs — and how much it may do without you." />
        <Card size="sm">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">Failed to load settings: {settingsError.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Automation"
        description="How hard the worker runs — and how much it may do without you."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={runPipelineNow}
              disabled={pipelineRunning || settings.paused}
            >
              <Bot className="size-4" aria-hidden />
              {pipelineRunning ? "Running pipeline…" : "Run pipeline now"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={runAutoBidCheck}
              disabled={settings.paused || !settings.autobidEnabled}
            >
              <Zap className="size-4" aria-hidden />
              Run auto-bid check now
            </Button>
            <Button
              variant={settings.paused ? "default" : "outline"}
              onClick={togglePause}
            >
              {settings.paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
              {settings.paused ? "Resume worker" : "Pause worker"}
            </Button>
          </>
        }
      />

      {actionError ? (
        <p className="text-sm text-destructive">{actionError}</p>
      ) : null}

      {!settings.paused ? null : (
        <p className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
          <TriangleAlert className="size-4 text-warning" aria-hidden />
          Worker paused — no scans or actions run until you resume.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* Pipeline */}
        <Card>
          <CardHeader>
            <CardTitle>Worker pipeline</CardTitle>
            <CardDescription>
              Each step can run unattended. With auto-bid on, the worker writes the
              proposal too — off, you review matches and write your own.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            <div className="flex items-center justify-between py-3 first:pt-0">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="scan-interval">Scan interval</Label>
                <p className="text-xs font-normal text-muted-foreground">
                  Poll Freelancer.com for new jobs. Minimum 30 seconds.
                </p>
              </div>
              <Select
                value={String(settings.scanIntervalSeconds)}
                onValueChange={(value) => update("scanIntervalSeconds", Number(value))}
              >
                <SelectTrigger id="scan-interval" className="w-44" aria-label="Scan interval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">Every 10 seconds</SelectItem>
                  <SelectItem value="30">Every 30 seconds</SelectItem>
                  <SelectItem value="60">Every 60 seconds</SelectItem>
                  <SelectItem value="120">Every 2 minutes</SelectItem>
                  <SelectItem value="300">Every 5 minutes</SelectItem>
                  <SelectItem value="600">Every 10 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(
              [
                ["autoAnalyze", "Automatic analysis", "Send new jobs to the AI after each scan"],
                ["autoMatch", "Automatic matching", "Score every analyzed job against your profile"],
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key} className="flex items-center justify-between gap-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`toggle-${key}`}>{label}</Label>
                  <p className="text-xs font-normal text-muted-foreground">{hint}</p>
                </div>
                <Switch
                  id={`toggle-${key}`}
                  checked={settings[key]}
                  onCheckedChange={(checked) => update(key, checked)}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Auto-bid */}
        <Card className={cn(!settings.autobidEnabled && "opacity-95")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap
                className={cn("size-4", settings.autobidEnabled ? "text-warning" : "text-muted-foreground")}
                aria-hidden
              />
              Auto-bid
            </CardTitle>
            <CardDescription>
              Off by default. When on, every job that clears your match score gets a
              proposal written and a bid placed inside these bounds — no review.
            </CardDescription>
            <CardAction>
              <Switch
                id="toggle-autobid"
                checked={settings.autobidEnabled}
                onCheckedChange={(checked) => update("autobidEnabled", checked)}
                aria-label="Enable auto-bid"
              />
            </CardAction>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                <span>Daily usage</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">
                    {settings.bidsToday} / {settings.dailyCap} bids today
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={resetDailyUsage}
                    disabled={resettingUsage || settings.bidsToday === 0}
                    aria-label="Reset today's bid count"
                  >
                    <RefreshCw
                      data-icon="inline-start"
                      className={cn(resettingUsage && "animate-spin")}
                    />
                    Reset
                  </Button>
                </div>
              </div>
              <Progress
                value={capUsed}
                aria-label="Daily bid usage"
                indicatorClassName={capUsed >= 100 ? "bg-destructive" : undefined}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Worker pauses auto-bidding when the cap is reached; resumes tomorrow.
                Reset the counter to keep bidding the same day.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="min-score">Minimum match score</Label>
                <Input
                  id="min-score"
                  type="number"
                  min={50}
                  max={100}
                  value={settings.minMatchScore}
                  onChange={(event) => update("minMatchScore", Number(event.target.value))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="daily-cap">Daily bid cap</Label>
                <Input
                  id="daily-cap"
                  type="number"
                  min={1}
                  max={20}
                  value={settings.dailyCap}
                  onChange={(event) => update("dailyCap", Number(event.target.value))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="min-bid">Minimum bid ($)</Label>
                <Input
                  id="min-bid"
                  type="number"
                  min={0}
                  value={settings.minBid}
                  onChange={(event) => update("minBid", Number(event.target.value))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="max-bid">Maximum bid ($)</Label>
                <Input
                  id="max-bid"
                  type="number"
                  min={0}
                  value={settings.maxBid}
                  onChange={(event) => update("maxBid", Number(event.target.value))}
                />
              </div>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Bids are priced at the project&apos;s minimum budget, clamped between your
              lower and upper bounds. Every decision lands in Logs with its reasoning.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Job screening rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" aria-hidden />
            Job screening rules
          </CardTitle>
          <CardDescription>
            Jobs that fail a rule are rejected before the AI ever sees them — no
            analysis cost, no storage. Turn a rule off and those jobs move on to
            normal analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {(
            [
              [
                "rejectStaleJobs",
                "Reject jobs older than 12 hours",
                "A job posted more than 12 hours ago can no longer be won competitively, so it is dropped before analysis.",
              ],
              [
                "rejectIgnoredCountries",
                "Reject jobs from excluded countries",
                "Jobs whose client is in a country on your profile ignore list never reach analysis.",
              ],
              [
                "rejectBadReputation",
                "Reject brand-new, unverified clients",
                "Drops jobs from accounts under 30 days old with no verified payment, no escrow deposit, and no project upgrades.",
              ],
            ] as const
          ).map(([key, label, hint]) => (
            <div key={key} className="flex items-center justify-between gap-4 py-3">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`toggle-${key}`}>{label}</Label>
                <p className="text-xs font-normal text-muted-foreground">{hint}</p>
              </div>
              <Switch
                id={`toggle-${key}`}
                checked={settings[key]}
                onCheckedChange={(checked) => update(key, checked)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recent runs */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" aria-hidden />
            Recent pipeline activity
          </CardTitle>
          <Separator className="mt-3" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No automation runs yet.</p>
          ) : null}
          {runs.map((run) => (
            <div key={run.id} className="flex items-start gap-3 rounded-lg border p-2.5 text-sm">
              <span
                className={cn(
                  "mt-0.5 size-2 shrink-0 rounded-full",
                  run.result === "ok" && "bg-success",
                  run.result === "skipped" && "bg-warning",
                  run.result === "error" && "bg-destructive"
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{run.action}</p>
                <p className="truncate text-xs text-muted-foreground">{run.detail}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {run.timeLabel}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
