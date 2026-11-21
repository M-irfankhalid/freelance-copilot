import { useState } from "react";
import { Link } from "react-router";
import {
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Loader2,
  PenLine,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Undo2,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import type { AiSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AiSettingsApiResponse {
  settings: AiSettings;
}

interface SaveApiResponse extends AiSettingsApiResponse {
  changedFields: string[];
}

type NumericSetting =
  | "relevanceTemperature"
  | "relevanceMaxTokens"
  | "relevanceTimeoutSeconds"
  | "analysisTemperature"
  | "analysisMaxTokens"
  | "analysisTimeoutSeconds"
  | "proposalTemperature"
  | "proposalTimeoutSeconds"
  | "proposalCorrectionAttempts"
  | "relevanceIgnoreFloor"
  | "goodScoreFloor"
  | "strongScoreFloor";

const FIELD_BOUNDS: Record<
  NumericSetting,
  { min: number; max: number; integer: boolean }
> = {
  relevanceTemperature: { min: 0, max: 2, integer: false },
  relevanceMaxTokens: { min: 100, max: 8000, integer: true },
  relevanceTimeoutSeconds: { min: 10, max: 600, integer: true },
  analysisTemperature: { min: 0, max: 2, integer: false },
  analysisMaxTokens: { min: 100, max: 16000, integer: true },
  analysisTimeoutSeconds: { min: 10, max: 600, integer: true },
  proposalTemperature: { min: 0, max: 2, integer: false },
  proposalTimeoutSeconds: { min: 10, max: 600, integer: true },
  proposalCorrectionAttempts: { min: 0, max: 2, integer: true },
  relevanceIgnoreFloor: { min: 0, max: 100, integer: true },
  goodScoreFloor: { min: 0, max: 100, integer: true },
  strongScoreFloor: { min: 1, max: 100, integer: true },
};

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) {
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
}

function SummaryTile({
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
        <p className="truncate text-xl font-semibold tracking-tight" title={value}>
          {value}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={detail}>
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}

function ModelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <code className="truncate text-sm" title={value}>
        {value}
      </code>
    </div>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  onBlur,
  min,
  max,
  step,
  error,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  min: number;
  max: number;
  step: number;
  error?: string;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode={step < 1 ? "decimal" : "numeric"}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hintId}
      />
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function ScoreBandBar({
  ignoreFloor,
  goodFloor,
  strongFloor,
}: {
  ignoreFloor: number;
  goodFloor: number;
  strongFloor: number;
}) {
  const segments = [
    { key: "ignored", width: ignoreFloor, className: "bg-muted-foreground/30" },
    { key: "fair", width: goodFloor - ignoreFloor, className: "bg-warning/70" },
    { key: "good", width: strongFloor - goodFloor, className: "bg-primary/70" },
    { key: "strong", width: 100 - strongFloor, className: "bg-success" },
  ];

  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
      aria-hidden
    >
      {segments.map((segment) =>
        segment.width > 0 ? (
          <div
            key={segment.key}
            className={segment.className}
            style={{ width: `${Math.min(segment.width, 100)}%` }}
          />
        ) : null
      )}
    </div>
  );
}

export default function AiSettingsPage() {
  const { data, error, isLoading, refetch } =
    useApi<AiSettingsApiResponse>("/api/ai/settings");
  const { toast } = useToast();

  const [draft, setDraft] = useState<Partial<AiSettings>>({});
  const [numberText, setNumberText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const server = data?.settings ?? null;
  const settings = server === null ? null : { ...server, ...draft };
  const dirty = Object.keys(draft).length > 0;

  const bandError =
    settings !== null && settings.relevanceIgnoreFloor > settings.goodScoreFloor
      ? "The ignore floor cannot be higher than the good-score floor."
      : settings !== null && settings.goodScoreFloor >= settings.strongScoreFloor
        ? "The strong-score floor must be higher than the good-score floor."
        : null;

  const numberValue = (key: NumericSetting): string => {
    if (numberText[key] !== undefined) return numberText[key];
    return settings === null ? "" : String(settings[key]);
  };

  const numberError = (key: NumericSetting): string | null => {
    const raw = numberValue(key);
    if (raw.trim() === "") return "Enter a value.";
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return "Enter a number.";
    const bounds = FIELD_BOUNDS[key];
    if (bounds.integer && !Number.isInteger(parsed)) {
      return `Use a whole number between ${bounds.min} and ${bounds.max}.`;
    }
    if (parsed < bounds.min || parsed > bounds.max) {
      return `Must be between ${bounds.min.toLocaleString()} and ${bounds.max.toLocaleString()}.`;
    }
    return null;
  };

  const fieldErrors: Partial<Record<NumericSetting, string>> = {};
  if (settings !== null) {
    for (const key of Object.keys(FIELD_BOUNDS) as NumericSetting[]) {
      const message = numberError(key);
      if (message !== null) fieldErrors[key] = message;
    }
  }
  const errorCount = Object.keys(fieldErrors).length;
  const blocked = bandError !== null || errorCount > 0;

  const updateNumber = (key: NumericSetting, raw: string) => {
    setActionError(null);
    setNumberText((current) => ({ ...current, [key]: raw }));
    const parsed = Number(raw);
    setDraft((current) => {
      const next = { ...current };
      if (raw.trim() === "" || !Number.isFinite(parsed)) {
        delete next[key];
      } else {
        next[key] = parsed;
      }
      return next;
    });
  };

  const blurNumber = (key: NumericSetting) => {
    const raw = numberText[key];
    if (raw === undefined) return;
    if (raw.trim() === "" || !Number.isFinite(Number(raw))) {
      setNumberText((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const clearDraft = () => {
    setActionError(null);
    setDraft({});
    setNumberText({});
  };

  const save = async () => {
    if (settings === null || blocked) return;
    setSaving(true);
    setActionError(null);
    try {
      const result = await api<SaveApiResponse>("/api/ai/settings", {
        method: "PUT",
        body: {
          relevanceTemperature: settings.relevanceTemperature,
          relevanceMaxTokens: settings.relevanceMaxTokens,
          relevanceTimeoutSeconds: settings.relevanceTimeoutSeconds,
          analysisTemperature: settings.analysisTemperature,
          analysisMaxTokens: settings.analysisMaxTokens,
          analysisTimeoutSeconds: settings.analysisTimeoutSeconds,
          proposalTemperature: settings.proposalTemperature,
          proposalTimeoutSeconds: settings.proposalTimeoutSeconds,
          proposalCorrectionAttempts: settings.proposalCorrectionAttempts,
          relevanceIgnoreFloor: settings.relevanceIgnoreFloor,
          goodScoreFloor: settings.goodScoreFloor,
          strongScoreFloor: settings.strongScoreFloor,
        },
      });
      clearDraft();
      refetch();
      toast({
        title: "AI settings saved",
        description:
          result.changedFields.length > 0
            ? `Updated ${result.changedFields.length} setting${result.changedFields.length === 1 ? "" : "s"}.`
            : "No values changed.",
        variant: "success",
      });
    } catch (cause) {
      const message = messageFor(cause);
      setActionError(message);
      toast({ title: "Could not save AI settings", description: message, variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setResetting(true);
    setActionError(null);
    try {
      await api<AiSettingsApiResponse>("/api/ai/settings/reset", {
        method: "POST",
      });
      clearDraft();
      refetch();
      toast({
        title: "AI settings reset",
        description: "Tuning restored to defaults. Model choices were kept.",
        variant: "success",
      });
    } catch (cause) {
      const message = messageFor(cause);
      setActionError(message);
      toast({ title: "Could not reset AI settings", description: message, variant: "error" });
    } finally {
      setResetting(false);
    }
  };

  if (isLoading && server === null) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader
          title="AI settings"
          description="Tune screening, analysis, proposal writing, and score bands. Changes apply to the next AI call."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-72 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error !== null && server === null) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader
          title="AI settings"
          description="Tune screening, analysis, proposal writing, and score bands. Changes apply to the next AI call."
        />
        <Card className="border-destructive/25 ring-destructive/15">
          <CardHeader>
            <CardTitle>Could not load AI settings</CardTitle>
            <CardDescription>{error.message}</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw data-icon="inline-start" aria-hidden />
                Retry
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (settings === null) return null;

  const statusTone = blocked ? "text-warning" : "text-muted-foreground";
  const savedDate =
    settings.updatedAt === null ? null : new Date(settings.updatedAt);
  const savedAt =
    savedDate !== null && !Number.isNaN(savedDate.getTime())
      ? savedDate.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="AI settings"
        description="Tune screening, analysis, proposal writing, and score bands. Changes apply to the next AI call."
        actions={
          <>
            <Button
              variant="outline"
              onClick={clearDraft}
              disabled={saving || resetting || !dirty}
            >
              <Undo2 data-icon="inline-start" aria-hidden />
              Discard
            </Button>
            <Button
              variant="outline"
              onClick={reset}
              disabled={saving || resetting}
            >
              <RotateCcw data-icon="inline-start" aria-hidden />
              {resetting ? "Resetting…" : "Reset defaults"}
            </Button>
            <Button onClick={save} disabled={saving || resetting || !dirty || blocked}>
              <Save data-icon="inline-start" aria-hidden />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      />

      <p
        className={cn("flex items-center gap-1.5 text-xs", statusTone)}
        aria-live="polite"
      >
        {saving || resetting ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : dirty ? (
          <span className="size-1.5 rounded-full bg-warning" aria-hidden />
        ) : (
          <CheckCircle2 className="size-3.5 text-success" aria-hidden />
        )}
        {saving
          ? "Saving changes…"
          : resetting
            ? "Restoring defaults…"
            : dirty
              ? blocked
                ? `${errorCount > 0 ? `${errorCount} field${errorCount === 1 ? "" : "s"} need attention.` : "Fix the score bands before saving."}`
                : "Unsaved changes — save when ready."
              : savedAt === null
                ? "Using built-in defaults."
                : `Tuning last saved ${savedAt}.`}
      </p>

      {error !== null ? (
        <Card size="sm" className="border-destructive/25 ring-destructive/15">
          <CardHeader>
            <CardTitle>Could not refresh AI settings</CardTitle>
            <CardDescription>{error.message}</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw data-icon="inline-start" aria-hidden />
                Retry
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
      ) : null}

      {actionError || bandError ? (
        <Card size="sm" className="border-destructive/25 ring-destructive/15">
          <CardContent className="pt-4 text-sm text-destructive">
            {bandError ?? actionError}
          </CardContent>
        </Card>
      ) : null}

      <section
        aria-label="AI configuration summary"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <SummaryTile
          icon={Cpu}
          label="Screening engine"
          value={settings.analysisEngine === "jev" ? "Jev" : "OpenRouter"}
          detail={
            settings.analysisEngine === "jev"
              ? settings.jevModelId
              : "LLM relevance gate"
          }
          tone={settings.analysisEngine === "jev" ? "text-primary" : undefined}
        />
        <SummaryTile
          icon={BrainCircuit}
          label="Screening model"
          value={settings.analysisModelId}
          detail="Screening and deep analysis"
        />
        <SummaryTile
          icon={PenLine}
          label="Proposal model"
          value={settings.proposalModelId}
          detail="Drafts and repair passes"
        />
        <SummaryTile
          icon={SlidersHorizontal}
          label="Match floors"
          value={`${settings.relevanceIgnoreFloor} / ${settings.goodScoreFloor} / ${settings.strongScoreFloor}`}
          detail="Ignore / Good / Strong"
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="size-4 text-muted-foreground" aria-hidden />
            Models and engine
          </CardTitle>
          <CardDescription>
            Model choices and the relevance engine are managed with your OpenRouter
            connection on Platforms.
          </CardDescription>
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link to="/platforms">Manage on Platforms</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ModelRow label="Screening and analysis" value={settings.analysisModelId} />
          <ModelRow label="Proposal writing" value={settings.proposalModelId} />
          <ModelRow label="Agent" value={settings.agentModelId} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-muted-foreground">Screening engine</span>
            <Badge
              variant={settings.analysisEngine === "jev" ? "secondary" : "outline"}
              className="w-fit"
            >
              {settings.analysisEngine === "jev" ? "Jev decision model" : "OpenRouter LLM"}
            </Badge>
          </div>
          {settings.analysisEngine === "jev" ? (
            <ModelRow label="Jev model" value={settings.jevModelId} />
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BrainCircuit className="size-4 text-muted-foreground" aria-hidden />
              Screening
            </CardTitle>
            <CardDescription>
              The fast relevance gate that decides whether a job is worth deeper
              analysis or is ignored outright.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="relevance-temperature"
              label="Temperature"
              hint="0–2. Lower is more consistent; higher is more varied."
              value={numberValue("relevanceTemperature")}
              onChange={(raw) => updateNumber("relevanceTemperature", raw)}
              onBlur={() => blurNumber("relevanceTemperature")}
              error={fieldErrors.relevanceTemperature}
              min={0}
              max={2}
              step={0.1}
            />
            <NumberField
              id="relevance-max-tokens"
              label="Max output tokens"
              hint="Caps the gate's one-score reply. 100–8,000."
              value={numberValue("relevanceMaxTokens")}
              onChange={(raw) => updateNumber("relevanceMaxTokens", raw)}
              onBlur={() => blurNumber("relevanceMaxTokens")}
              error={fieldErrors.relevanceMaxTokens}
              min={100}
              max={8000}
              step={1}
            />
            <NumberField
              id="relevance-timeout"
              label="Timeout (seconds)"
              hint="Applies to both the LLM and Jev screening calls. 10–600."
              value={numberValue("relevanceTimeoutSeconds")}
              onChange={(raw) => updateNumber("relevanceTimeoutSeconds", raw)}
              onBlur={() => blurNumber("relevanceTimeoutSeconds")}
              error={fieldErrors.relevanceTimeoutSeconds}
              min={10}
              max={600}
              step={1}
            />
            <NumberField
              id="relevance-ignore-floor"
              label="Ignore floor"
              hint="Scores below this are ignored and never surface as matches."
              value={numberValue("relevanceIgnoreFloor")}
              onChange={(raw) => updateNumber("relevanceIgnoreFloor", raw)}
              onBlur={() => blurNumber("relevanceIgnoreFloor")}
              error={fieldErrors.relevanceIgnoreFloor}
              min={0}
              max={100}
              step={1}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden />
              Deep analysis
            </CardTitle>
            <CardDescription>
              Produces the match score, summary, concerns, and recommended bid for
              each imported job.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="analysis-temperature"
              label="Temperature"
              hint="0–2. Defaults keep scoring consistent."
              value={numberValue("analysisTemperature")}
              onChange={(raw) => updateNumber("analysisTemperature", raw)}
              onBlur={() => blurNumber("analysisTemperature")}
              error={fieldErrors.analysisTemperature}
              min={0}
              max={2}
              step={0.1}
            />
            <NumberField
              id="analysis-max-tokens"
              label="Max output tokens"
              hint="Bounds the structured analysis. 100–16,000."
              value={numberValue("analysisMaxTokens")}
              onChange={(raw) => updateNumber("analysisMaxTokens", raw)}
              onBlur={() => blurNumber("analysisMaxTokens")}
              error={fieldErrors.analysisMaxTokens}
              min={100}
              max={16000}
              step={1}
            />
            <NumberField
              id="analysis-timeout"
              label="Timeout (seconds)"
              hint="Deep analysis can be slow. 10–600."
              value={numberValue("analysisTimeoutSeconds")}
              onChange={(raw) => updateNumber("analysisTimeoutSeconds", raw)}
              onBlur={() => blurNumber("analysisTimeoutSeconds")}
              error={fieldErrors.analysisTimeoutSeconds}
              min={10}
              max={600}
              step={1}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PenLine className="size-4 text-muted-foreground" aria-hidden />
              Proposal writing
            </CardTitle>
            <CardDescription>
              Draft generation plus the automatic repair pass when a draft fails a
              factual or safety check.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="proposal-temperature"
              label="Temperature"
              hint="0–2. Higher gives more variation between drafts."
              value={numberValue("proposalTemperature")}
              onChange={(raw) => updateNumber("proposalTemperature", raw)}
              onBlur={() => blurNumber("proposalTemperature")}
              error={fieldErrors.proposalTemperature}
              min={0}
              max={2}
              step={0.1}
            />
            <NumberField
              id="proposal-timeout"
              label="Timeout (seconds)"
              hint="Applies to the draft and every repair attempt. 10–600."
              value={numberValue("proposalTimeoutSeconds")}
              onChange={(raw) => updateNumber("proposalTimeoutSeconds", raw)}
              onBlur={() => blurNumber("proposalTimeoutSeconds")}
              error={fieldErrors.proposalTimeoutSeconds}
              min={10}
              max={600}
              step={1}
            />
            <NumberField
              id="proposal-corrections"
              label="Repair attempts"
              hint="0–2 automatic rewrites after a failed validation."
              value={numberValue("proposalCorrectionAttempts")}
              onChange={(raw) => updateNumber("proposalCorrectionAttempts", raw)}
              onBlur={() => blurNumber("proposalCorrectionAttempts")}
              error={fieldErrors.proposalCorrectionAttempts}
              min={0}
              max={2}
              step={1}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Score bands</CardTitle>
            <CardDescription>
              Shared by Matches, Dashboard, and newly analyzed jobs. Bands must stay
              in order: ignore, then good, then strong.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                id="good-score-floor"
                label="Good match from"
                hint="Scores at or above this are Good (and eligible for attention)."
                value={numberValue("goodScoreFloor")}
                onChange={(raw) => updateNumber("goodScoreFloor", raw)}
                onBlur={() => blurNumber("goodScoreFloor")}
                error={fieldErrors.goodScoreFloor}
                min={0}
                max={100}
                step={1}
              />
              <NumberField
                id="strong-score-floor"
                label="Strong match from"
                hint="Scores at or above this are Strong. Must be above Good."
                value={numberValue("strongScoreFloor")}
                onChange={(raw) => updateNumber("strongScoreFloor", raw)}
                onBlur={() => blurNumber("strongScoreFloor")}
                error={fieldErrors.strongScoreFloor}
                min={1}
                max={100}
                step={1}
              />
            </div>
            <ScoreBandBar
              ignoreFloor={settings.relevanceIgnoreFloor}
              goodFloor={settings.goodScoreFloor}
              strongFloor={settings.strongScoreFloor}
            />
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground tabular-nums">
              Below {settings.relevanceIgnoreFloor} ignored · {settings.relevanceIgnoreFloor}–
              {settings.goodScoreFloor - 1} fair · {settings.goodScoreFloor}–
              {settings.strongScoreFloor - 1} good · {settings.strongScoreFloor}+ strong
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
