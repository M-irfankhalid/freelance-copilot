import { useState } from "react";
import { Link } from "react-router";
import {
  BrainCircuit,
  Cpu,
  RotateCcw,
  Save,
  SlidersHorizontal,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import type { AiSettings } from "@/lib/types";

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

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) {
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
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
}) {
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
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Tunable AI behavior. Models stay on Platforms; this page owns the knobs. */
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

  const updateNumber = (key: NumericSetting, raw: string) => {
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

  const numberValue = (key: NumericSetting): string => {
    if (numberText[key] !== undefined) return numberText[key];
    return settings === null ? "" : String(settings[key]);
  };

  const clearDraft = () => {
    setDraft({});
    setNumberText({});
  };

  const save = async () => {
    if (settings === null || bandError !== null) return;
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

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="AI settings"
        description="Tune screening, analysis, proposal writing, and score bands. Changes apply to the next AI call."
        actions={
          <>
            <Button
              variant="outline"
              onClick={reset}
              disabled={saving || resetting || server === null}
            >
              <RotateCcw data-icon="inline-start" />
              {resetting ? "Resetting…" : "Reset defaults"}
            </Button>
            <Button
              onClick={save}
              disabled={saving || !dirty || bandError !== null || server === null}
            >
              <Save data-icon="inline-start" />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      />

      {error ? (
        <Card size="sm" className="border-destructive/25 ring-destructive/15">
          <CardHeader>
            <CardTitle>Could not load AI settings</CardTitle>
            <CardDescription>{error.message}</CardDescription>
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

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="size-4 text-muted-foreground" aria-hidden />
            Active models
          </CardTitle>
          <CardDescription>
            Models and the relevance engine are managed with your OpenRouter
            connection. Changes here apply immediately to new calls.
          </CardDescription>
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link to="/platforms">Manage on Platforms</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {isLoading || settings === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Screening model</span>
                <code className="truncate text-sm">{settings.analysisModelId}</code>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Proposal model</span>
                <code className="truncate text-sm">{settings.proposalModelId}</code>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Agent model</span>
                <code className="truncate text-sm">{settings.agentModelId}</code>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Screening engine</span>
                <span className="text-sm">
                  {settings.analysisEngine === "jev" ? "Jev decision model" : "OpenRouter LLM"}
                </span>
              </div>
              {settings.analysisEngine === "jev" ? (
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs text-muted-foreground">Jev model</span>
                  <code className="truncate text-sm">{settings.jevModelId}</code>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
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
            min={0}
            max={100}
            step={1}
          />
        </CardContent>
      </Card>

      <Card size="sm">
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
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <NumberField
            id="analysis-temperature"
            label="Temperature"
            hint="0–2. Defaults keep scoring consistent."
            value={numberValue("analysisTemperature")}
            onChange={(raw) => updateNumber("analysisTemperature", raw)}
            onBlur={() => blurNumber("analysisTemperature")}
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
            min={10}
            max={600}
            step={1}
          />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="size-4 text-muted-foreground" aria-hidden />
            Proposal writing
          </CardTitle>
          <CardDescription>
            Draft generation plus the automatic repair pass when a draft fails a
            factual or safety check.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <NumberField
            id="proposal-temperature"
            label="Temperature"
            hint="0–2. Higher gives more variation between drafts."
            value={numberValue("proposalTemperature")}
            onChange={(raw) => updateNumber("proposalTemperature", raw)}
            onBlur={() => blurNumber("proposalTemperature")}
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
            min={0}
            max={2}
            step={1}
          />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Score bands</CardTitle>
          <CardDescription>
            Shared by Matches, Dashboard, and newly analyzed jobs. The ignore
            floor must stay at or below the good floor.
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
              min={1}
              max={100}
              step={1}
            />
          </div>
          {settings !== null ? (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Below {settings.relevanceIgnoreFloor} ignored · {settings.relevanceIgnoreFloor}–
              {settings.goodScoreFloor - 1} fair · {settings.goodScoreFloor}–
              {settings.strongScoreFloor - 1} good · {settings.strongScoreFloor}+ strong
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
