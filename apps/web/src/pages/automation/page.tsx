import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  DollarSign,
  Filter,
  Gauge,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  skipStaleBids: boolean;
  maxBidAgeHours: number;
  cheapScreeningEnabled: boolean;
  rejectIgnoredCountries: boolean;
  rejectNotWants: boolean;
  rejectMissingWants: boolean;
  rejectMissingSkills: boolean;
  rejectBadReputation: boolean;
  aiDeliveryTimeline: boolean;
  preferredDeliveryDays: number;
  deliveryTimelineOptions: number[];
  deliveryTimelineInstructions: string;
  aiBidAmount: boolean;
  bidAmountFractions: string[];
  bidAmountInstructions: string;
  defaultBidMarkupPct: number;
  bidAmountMarkupInstructions: string;
  roundBidUpTo: number;
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
    skipStaleBids: s.skipStaleBids ?? true,
    maxBidAgeHours: s.maxBidAgeHours ?? 12,
    cheapScreeningEnabled: s.cheapScreeningEnabled ?? true,
    rejectIgnoredCountries: s.rejectIgnoredCountries,
    rejectNotWants: s.rejectNotWants ?? true,
    rejectMissingWants: s.rejectMissingWants ?? true,
    rejectMissingSkills: s.rejectMissingSkills ?? true,
    rejectBadReputation: s.rejectBadReputation,
    aiDeliveryTimeline: s.aiDeliveryTimeline,
    preferredDeliveryDays: s.preferredDeliveryDays,
    deliveryTimelineOptions: s.deliveryTimelineOptions ?? [],
    deliveryTimelineInstructions: s.deliveryTimelineInstructions ?? "",
    aiBidAmount: s.aiBidAmount ?? false,
    bidAmountFractions: s.bidAmountFractions ?? [],
    bidAmountInstructions: s.bidAmountInstructions ?? "",
    defaultBidMarkupPct: s.defaultBidMarkupPct ?? 0,
    bidAmountMarkupInstructions: s.bidAmountMarkupInstructions ?? "",
    roundBidUpTo: s.roundBidUpTo ?? 0,
  };
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) {
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
}

/** Mirrors MIN_DELIVERY_DAYS / MAX_DELIVERY_DAYS on the server. */
const MIN_DELIVERY_DAYS = 1;
const MAX_DELIVERY_DAYS = 365;

/**
 * Parse the comma-separated allowed-times field. Returns `null` when nothing
 * usable is typed yet — an empty box or a trailing comma mid-edit — so the
 * caller can leave the last saved list alone instead of sending an empty one
 * (the server requires at least one value).
 */
function parseDaysList(text: string): number[] | null {
  const values = text
    .split(",")
    .map((part) => Number(part.trim()))
    .filter(
      (value) =>
        Number.isInteger(value) &&
        value >= MIN_DELIVERY_DAYS &&
        value <= MAX_DELIVERY_DAYS
    );
  return values.length > 0 ? values : null;
}

/**
 * Parse the comma-separated bid-amount fractions field. Returns `null` when
 * nothing usable is typed yet — an empty box or a trailing comma mid-edit —
 * so the caller can leave the last saved list alone instead of sending an empty
 * one (the server requires at least one valid fraction).
 */
function parseFractionsList(text: string): string[] | null {
  const values = text
    .split(",")
    .map((part) => part.trim())
    .filter((value) => value.length > 0 && isValidFraction(value));
  return values.length > 0 ? values : null;
}

/**
 * A valid fraction/marker string: `"X/Y"` (0 < X ≤ Y), `"full"`, or a plain
 * positive number interpreted as a multiplier of the project's max budget
 * (e.g. `"0.5"` = 50% of max, `"2"` = 200% of max).
 */
function isValidFraction(value: string): boolean {
  if (value.toLowerCase() === "full") return true;

  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (match !== null) {
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    return denominator > 0 && numerator > 0 && numerator <= denominator;
  }

  // Plain positive number (decimal or integer)
  if (/^\d+(\.\d+)?$/.test(value)) {
    const num = Number(value);
    return num > 0 && Number.isFinite(num);
  }

  return false;
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `every ${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "every minute" : `every ${minutes} minutes`;
}

const RUN_RESULT_LABEL: Record<AutomationRun["result"], string> = {
  ok: "Completed",
  skipped: "Skipped",
  error: "Failed",
};

function StatusTile({
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
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Automation control. Auto-bid is off until explicitly switched on, and even
 * then it is fenced by threshold, bounds, and a daily cap.
 */
export default function AutomationPage() {
  const { data: settingsData, error: settingsError, isLoading, refetch } = useApi<AutomationApiResponse>("/api/automation");
  const { data: runsData, error: runsError, refetch: refetchRuns } = useApi<RunsApiResponse>("/api/automation/runs");

  // Local draft edits on top of the server's settings. Merged with server
  // data via useMemo so we avoid setState-in-effect entirely.
  const [draft, setDraft] = useState<Partial<AutomationSettings>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );

  // Raw text of the allowed-times field. Kept as typed (a trailing comma, a
  // stray letter) and only pushed to the server once it parses to a usable
  // list, so mid-typing states never round-trip a broken value.
  const [optionsText, setOptionsText] = useState<string | null>(null);

  // Raw text of the bid-amount fractions field. Same rationale as above.
  const [bidAmountOptionsText, setBidAmountOptionsText] = useState<string | null>(null);

  // Debounce timer for settings updates.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftVersionRef = useRef(0);

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
    draftVersionRef.current += 1;
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveStatus("saving");
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
    const version = draftVersionRef.current;
    setActionError(null);
    setSaveStatus("saving");
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
          skipStaleBids: current.skipStaleBids,
          maxBidAgeHours: current.maxBidAgeHours,
          cheapScreeningEnabled: current.cheapScreeningEnabled,
          rejectIgnoredCountries: current.rejectIgnoredCountries,
          rejectNotWants: current.rejectNotWants,
          rejectMissingWants: current.rejectMissingWants,
          rejectMissingSkills: current.rejectMissingSkills,
          rejectBadReputation: current.rejectBadReputation,
          aiDeliveryTimeline: current.aiDeliveryTimeline,
          preferredDeliveryDays: current.preferredDeliveryDays,
          deliveryTimelineOptions: current.deliveryTimelineOptions,
          deliveryTimelineInstructions: current.deliveryTimelineInstructions,
          aiBidAmount: current.aiBidAmount,
          bidAmountFractions: current.bidAmountFractions,
          bidAmountInstructions: current.bidAmountInstructions,
          defaultBidMarkupPct: current.defaultBidMarkupPct,
          bidAmountMarkupInstructions: current.bidAmountMarkupInstructions,
          roundBidUpTo: current.roundBidUpTo,
        },
      });
      const stillCurrent = draftVersionRef.current === version;
      if (stillCurrent) setDraft({});
      setSaveStatus(stillCurrent ? "saved" : "saving");
      // Refresh to pick up server-computed fields (bidsToday, paused, etc.).
      refetch();
    } catch (cause) {
      // Re-throw so the debounced caller can surface the real API error.
      setSaveStatus("error");
      throw cause;
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
  const capReached = settings !== null && settings.bidsToday >= settings.dailyCap;
  const lastRun = runs[0];
  const remainingBids = settings
    ? Math.max(settings.dailyCap - settings.bidsToday, 0)
    : 0;
  const lastRunTone =
    lastRun === undefined
      ? "text-muted-foreground"
      : lastRun.result === "ok"
        ? "text-success"
        : lastRun.result === "error"
          ? "text-destructive"
          : "text-warning";

  if (isLoading && !settings) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader title="Automation" description="Control how the worker scans, screens, writes, and bids." />
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
        <PageHeader title="Automation" description="Control how the worker scans, screens, writes, and bids." />
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
        description="Choose how far the worker can go on its own — and where it waits for you."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={runPipelineNow}
              disabled={pipelineRunning || settings.paused}
            >
              {pipelineRunning ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Bot className="size-4" aria-hidden />
              )}
              {pipelineRunning ? "Running pipeline…" : "Run pipeline now"}
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

      <p
        className={cn(
          "flex items-center gap-1.5 text-xs",
          saveStatus === "error" ? "text-destructive" : "text-muted-foreground"
        )}
        aria-live="polite"
      >
        {saveStatus === "saving" ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : saveStatus === "saved" ? (
          <CheckCircle2 className="size-3.5 text-success" aria-hidden />
        ) : null}
        {saveStatus === "saving"
          ? "Saving changes."
          : saveStatus === "saved"
            ? "All changes saved."
            : saveStatus === "error"
              ? "The last change could not be saved."
              : "Changes save automatically."}
      </p>

      <section
        aria-label="Automation status"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatusTile
          icon={Bot}
          label="Worker"
          value={settings.paused ? "Paused" : "Active"}
          detail={
            settings.paused
              ? "No scans until you resume"
              : `Scans ${formatInterval(settings.scanIntervalSeconds)}`
          }
          tone={settings.paused ? "text-warning" : "text-success"}
        />
        <StatusTile
          icon={Zap}
          label="Auto-bid"
          value={settings.autobidEnabled ? "On" : "Off"}
          detail={
            settings.autobidEnabled
              ? `Score ${settings.minMatchScore}+ · cap ${settings.dailyCap}/day`
              : "Every match waits for you"
          }
          tone={settings.autobidEnabled ? "text-warning" : "text-muted-foreground"}
        />
        <StatusTile
          icon={Gauge}
          label="Bids today"
          value={`${settings.bidsToday} / ${settings.dailyCap}`}
          detail={
            capReached
              ? "Daily cap reached"
              : `${remainingBids} ${remainingBids === 1 ? "bid" : "bids"} left today`
          }
          tone={capReached ? "text-destructive" : "text-primary"}
        />
        <StatusTile
          icon={Activity}
          label="Last run"
          value={
            runsError
              ? "Unavailable"
              : lastRun === undefined
                ? "No runs"
                : RUN_RESULT_LABEL[lastRun.result]
          }
          detail={
            runsError
              ? "Activity could not load"
              : lastRun === undefined
                ? "Run the pipeline to see activity"
                : `${lastRun.action} · ${lastRun.timeLabel}`
          }
          tone={runsError ? "text-destructive" : lastRunTone}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* Pipeline */}
        <Card>
          <CardHeader>
            <CardTitle>Worker pipeline</CardTitle>
            <CardDescription>
              New jobs are scanned, analyzed, and matched automatically. Auto-bid adds
              proposal writing and bidding on top.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            <div className="flex items-center justify-between py-3 first:pt-0">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="scan-interval">Scan interval</Label>
                <p className="text-xs font-normal text-muted-foreground">
                  Poll Freelancer.com for new jobs. Minimum 10 seconds.
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

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="toggle-skipStaleBids">Skip stale jobs</Label>
                  <p className="text-xs font-normal text-muted-foreground">
                    Don&apos;t auto-bid jobs posted longer ago than the limit below.
                  </p>
                </div>
                <Switch
                  id="toggle-skipStaleBids"
                  checked={settings.skipStaleBids}
                  onCheckedChange={(checked) => update("skipStaleBids", checked)}
                />
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                <Label htmlFor="max-bid-age-hours">Maximum job age (hours)</Label>
                <Input
                  id="max-bid-age-hours"
                  type="number"
                  min={1}
                  max={168}
                  disabled={!settings.skipStaleBids}
                  value={settings.maxBidAgeHours}
                  onChange={(event) => update("maxBidAgeHours", Number(event.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Applies only to auto-bid. Screening keeps its own 12-hour rule.
                </p>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Auto-bid starts from the project&apos;s minimum budget, applies your
              markup or AI-picked fraction, then clamps the result between your lower
              and upper bounds. Every decision lands in Logs.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {settings.autobidEnabled
                  ? "Check eligible jobs without waiting for the next scan."
                  : "Turn auto-bid on to run a manual eligibility check."}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={runAutoBidCheck}
                disabled={settings.paused || !settings.autobidEnabled}
              >
                <Zap className="size-4" aria-hidden />
                Run auto-bid check
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* Delivery timeline */}
        <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock
              className={cn(
                "size-4",
                settings.aiDeliveryTimeline ? "text-primary" : "text-muted-foreground"
              )}
              aria-hidden
            />
            Delivery timeline
          </CardTitle>
          <CardDescription>
            How long you promise to take. Auto-bid sends this as the bid&apos;s delivery
            time, and the manual bid form starts from the same number.
          </CardDescription>
          <CardAction>
            <Switch
              id="toggle-ai-delivery-timeline"
              checked={settings.aiDeliveryTimeline}
              onCheckedChange={(checked) => update("aiDeliveryTimeline", checked)}
              aria-label="Let the AI choose the delivery time"
            />
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="preferred-delivery-days">Preferred delivery time (days)</Label>
              <Input
                id="preferred-delivery-days"
                type="number"
                min={MIN_DELIVERY_DAYS}
                max={MAX_DELIVERY_DAYS}
                value={settings.preferredDeliveryDays}
                onChange={(event) =>
                  update("preferredDeliveryDays", Number(event.target.value))
                }
              />
            </div>
          </div>

          {settings.aiDeliveryTimeline ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delivery-timeline-options">
                  Times the AI may choose (days)
                </Label>
                <Input
                  id="delivery-timeline-options"
                  value={optionsText ?? settings.deliveryTimelineOptions.join(", ")}
                  placeholder="1, 3, 5, 7, 10"
                  onChange={(event) => {
                    const text = event.target.value;
                    setOptionsText(text);
                    const parsed = parseDaysList(text);
                    // Ignore unparseable text: keep the last saved list.
                    if (parsed !== null) update("deliveryTimelineOptions", parsed);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated. The AI picks one of these per project during
                  screening; small, well-defined jobs should land on the shortest.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delivery-timeline-instructions">
                  Instructions for choosing
                </Label>
                <Textarea
                  id="delivery-timeline-instructions"
                  rows={7}
                  value={settings.deliveryTimelineInstructions}
                  onChange={(event) =>
                    update("deliveryTimelineInstructions", event.target.value)
                  }
                />
              </div>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Every bid quotes your preferred time of{" "}
              <span className="font-medium text-foreground">
                {settings.preferredDeliveryDays}{" "}
                {settings.preferredDeliveryDays === 1 ? "day" : "days"}
              </span>
              . Turn the switch on to let the AI pick per project instead.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Bid amount */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign
              className={cn(
                "size-4",
                settings.aiBidAmount ? "text-primary" : "text-muted-foreground"
              )}
              aria-hidden
            />
            Bid amount
          </CardTitle>
          <CardDescription>
            How much you bid. Auto-bid sends this as the bid amount, and the manual
            bid form starts from the same number.
          </CardDescription>
          <CardAction>
            <Switch
              id="toggle-ai-bid-amount"
              checked={settings.aiBidAmount}
              onCheckedChange={(checked) => update("aiBidAmount", checked)}
              aria-label="Let the AI choose the bid amount"
            />
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {settings.aiBidAmount ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bid-amount-fractions">
                  Bid amount options (fractions of max budget)
                </Label>
                <Input
                  id="bid-amount-fractions"
                  value={bidAmountOptionsText ?? settings.bidAmountFractions.join(", ")}
                  placeholder="1/4, 1/3, 1/2, 2/3, full"
                  onChange={(event) => {
                    const text = event.target.value;
                    setBidAmountOptionsText(text);
                    const parsed = parseFractionsList(text);
                    // Ignore unparseable text: keep the last saved list.
                    if (parsed !== null) update("bidAmountFractions", parsed);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated fractions of the project&apos;s maximum budget. The
                  AI picks one of these per project during screening; small, well-defined
                  jobs should land on the lower fraction.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bid-amount-instructions">
                  Instructions for choosing
                </Label>
                <Textarea
                  id="bid-amount-instructions"
                  rows={7}
                  value={settings.bidAmountInstructions}
                  onChange={(event) =>
                    update("bidAmountInstructions", event.target.value)
                  }
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bid-amount-markup">
                    Default bid markup (%)
                  </Label>
                  <Input
                    id="bid-amount-markup"
                    type="number"
                    min={0}
                    max={100}
                    value={settings.defaultBidMarkupPct}
                    onChange={(event) =>
                      update("defaultBidMarkupPct", Number(event.target.value))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    When a project is priced $250–$750, a 50% markup bids $250 +
                    ($750 × 0.5) = $625. Clamped to your min/max bounds.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bid-amount-markup-instructions">
                  Instructions for the default markup
                </Label>
                <Textarea
                  id="bid-amount-markup-instructions"
                  rows={4}
                  value={settings.bidAmountMarkupInstructions}
                  onChange={(event) =>
                    update("bidAmountMarkupInstructions", event.target.value)
                  }
                />
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Auto-bid prices each project at the minimum budget plus this
                percentage of the project maximum, clamped between your lower and
                upper bounds. A 0% markup reproduces the original behaviour (bid the
                minimum). Turn the switch on to let the AI pick a bid amount per
                project instead.
              </p>
            </>
          )}

          {/* Rounding applies to BOTH AI-picked and default-markup amounts on
              fixed-price projects. Shown regardless of the AI toggle so users who
              have AI selection on can still enable rounding for the gate's picks. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="round-bid-up-to">
              Round bid to nearest
            </Label>
            <Input
              id="round-bid-up-to"
              type="number"
              min={0}
              max={1000}
              value={settings.roundBidUpTo}
              onChange={(event) =>
                update("roundBidUpTo", Number(event.target.value))
              }
            />
            <p className="text-xs text-muted-foreground">
              {settings.roundBidUpTo > 1
                ? `Rounds fixed-price bids to the nearest $${settings.roundBidUpTo} (e.g. $187 → $${Math.round(187 / settings.roundBidUpTo) * settings.roundBidUpTo}). Hourly bids are not rounded.`
                : "0 or 1 = no rounding (bids use exact values)."}
            </p>
          </div>
        </CardContent>
      </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* Job screening rules */}
        <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" aria-hidden />
            Job screening rules
          </CardTitle>
          <CardDescription>
            Jobs that fail a rule are rejected before the AI ever sees them — no
            analysis cost. Turn a rule off and those jobs move on to normal
            analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="toggle-cheapScreeningEnabled">Cheap screening</Label>
              <p className="text-xs font-normal text-muted-foreground">
                Free checks run before analysis, using the job's title, preview,
                skills, and full description when available. No AI call. Turn it
                off to let the relevance model judge every job.
              </p>
            </div>
            <Switch
              id="toggle-cheapScreeningEnabled"
              checked={settings.cheapScreeningEnabled}
              onCheckedChange={(checked) => update("cheapScreeningEnabled", checked)}
            />
          </div>

          {(
            [
              [
                "rejectIgnoredCountries",
                "Reject jobs from excluded countries",
                "Jobs whose client is in a country on your profile ignore list never reach analysis.",
              ],
              [
                "rejectNotWants",
                "Reject jobs matching not-wants",
                "Drops a job when any of your not-wants keywords appears in its title, preview, or skills.",
              ],
              [
                "rejectMissingWants",
                "Reject jobs missing wanted keywords",
                "Drops a job when none of your wants keywords appears in its title, preview, or skills.",
              ],
              [
                "rejectMissingSkills",
                "Reject jobs missing profile-skill keywords",
                "Drops a job when none of your profile skills appears in its title or listed skills.",
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
                disabled={!settings.cheapScreeningEnabled}
                onCheckedChange={(checked) => update(key, checked)}
              />
            </div>
          ))}

          {(
            [
              [
                "rejectStaleJobs",
                "Reject jobs older than 12 hours",
                "A job posted more than 12 hours ago can no longer be won competitively, so it is dropped before analysis.",
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" aria-hidden />
              Recent activity
            </CardTitle>
            <CardDescription>
              The latest scans, drafts, bids, and skips from the worker.
            </CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="xs">
                <Link to="/logs">
                  View logs
                  <ArrowRight data-icon="inline-end" aria-hidden />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {runsError ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Could not load activity: {runsError.message}
              </p>
            ) : null}
            {!runsError && runs.length === 0 ? (
              <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed p-6 text-center">
                <Activity className="size-5 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium">No runs yet</p>
                <p className="text-xs text-muted-foreground">
                  Run the pipeline or wait for the next scheduled scan.
                </p>
              </div>
            ) : null}
            {!runsError
              ? runs.slice(0, 8).map((run) => (
                  <div
                    key={run.id}
                    className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                  >
                    <span
                      className={cn(
                        "mt-1 size-2 shrink-0 rounded-full",
                        run.result === "ok" && "bg-success",
                        run.result === "skipped" && "bg-warning",
                        run.result === "error" && "bg-destructive"
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{run.action}</p>
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                            run.result === "ok" &&
                              "border-success/30 bg-success/10 text-success",
                            run.result === "skipped" &&
                              "border-warning/30 bg-warning/10 text-warning",
                            run.result === "error" &&
                              "border-destructive/30 bg-destructive/10 text-destructive"
                          )}
                        >
                          {RUN_RESULT_LABEL[run.result]}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {run.detail}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {run.timeLabel}
                    </span>
                  </div>
                ))
              : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
