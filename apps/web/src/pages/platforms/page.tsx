import { useState } from "react";
import { CircleCheck, CircleX, Info, KeyRound, Lock, PlugZap, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { DiscordCard } from "@/components/discord/discord-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/lib/api/hooks";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import type {
  AiModelOption,
  CredentialSummary,
  CredentialTestResult,
} from "@/lib/types";

/**
 * BYOC control room backed by the real credentials API. Plaintext values are
 * written once and never displayed again — only masked previews come back.
 */

interface PlatformDisplayInfo {
  name: string;
  description: string;
  keyInputLabel: string;
  placeholder: string;
}

const platformMeta: Record<CredentialSummary["id"], PlatformDisplayInfo> = {
  freelancer: {
    name: "Freelancer.com",
    description:
      "Personal access token used to search jobs, fetch details, and place bids.",
    keyInputLabel: "Access token",
    placeholder: "Paste your Freelancer.com OAuth token",
  },
  openrouter: {
    name: "OpenRouter",
    description:
      "API key powering job analysis, matching, and proposal drafting.",
    keyInputLabel: "API key",
    placeholder: "sk-or-v1-…",
  },
};

/** Test result shown under a card after a test action. */
type TestFeedback =
  | { platform: string; ok: true; message: string }
  | { platform: string; ok: false; message: string }
  | null;

/** Result of the Jev engine test — the same shape, without a platform tag. */
type EngineTestFeedback = { ok: boolean; message: string } | null;

/**
 * Jev model shown when the user has not picked one. Mirrors the backend
 * default in `ai/jev.service.ts`.
 */
const DEFAULT_JEV_MODEL = "typesafe/jev-1.13";

export default function PlatformsPage() {
  const credentials = useApi<{ credentials: CredentialSummary[] }>("/api/credentials");

  const [testingId, setTestingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TestFeedback>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [replaceValue, setReplaceValue] = useState("");
  const [savingReplace, setSavingReplace] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [testingJev, setTestingJev] = useState(false);
  const [jevFeedback, setJevFeedback] = useState<EngineTestFeedback>(null);
  /** Null until edited, so the field tracks the saved value once it loads. */
  const [jevModelDraft, setJevModelDraft] = useState<string | null>(null);

  const credentialsList = credentials.data?.credentials ?? [];

  const models = useApi<{ models: AiModelOption[] }>(
    credentialsList.some((c) => c.id === "openrouter" && c.connected)
      ? "/api/credentials/openrouter/models"
      : null
  );

  const runTestStored = async (id: CredentialSummary["id"]) => {
    if (testingId !== null) return;
    setTestingId(id);
    setFeedback(null);
    try {
      const body = await api<{ result: CredentialTestResult }>(
        `/api/credentials/${id}/test`,
        { method: "POST" }
      );
      setFeedback({ platform: id, ok: body.result.ok, message: body.result.message });
      void credentials.refetch();
    } catch (cause) {
      setFeedback({
        platform: id,
        ok: false,
        message:
          cause instanceof NetworkError
            ? "Cannot reach the server"
            : cause instanceof ApiError
              ? cause.message
              : "Test failed",
      });
    } finally {
      setTestingId(null);
    }
  };

  const saveReplace = async () => {
    if (replacing === null || savingReplace) return;
    setSavingReplace(true);
    setReplaceError(null);
    try {
      await api(`/api/credentials/${replacing}`, {
        method: "PUT",
        body: { value: replaceValue },
      });
      setReplacing(null);
      setReplaceValue("");
      void credentials.refetch();
    } catch (cause) {
      setReplaceError(
        cause instanceof ApiError ? cause.message : "Could not save credential"
      );
    } finally {
      setSavingReplace(false);
    }
  };

  const changeModel = async (body: {
    analysisModelId?: string;
    proposalModelId?: string;
    analysisEngine?: "llm" | "jev";
    jevModelId?: string;
  }): Promise<boolean> => {
    try {
      await api("/api/credentials/openrouter/model", { method: "PUT", body });
      void credentials.refetch();
      return true;
    } catch {
      // surfaced via list refresh failure or next interaction
      return false;
    }
  };

  /**
   * Save the Jev model id. On success the typed value stays put — clearing the
   * draft here would briefly show the stale saved value, since `refetch` only
   * schedules the reload. On failure the field reverts to the saved value
   * rather than pretending the edit stuck.
   */
  const saveJevModel = async (modelId: string) => {
    if (!(await changeModel({ jevModelId: modelId }))) {
      setJevModelDraft(null);
    }
  };

  const runJevTest = async () => {
    if (testingJev) return;
    setTestingJev(true);
    setJevFeedback(null);
    try {
      const body = await api<{ result: CredentialTestResult }>(
        "/api/credentials/openrouter/test-jev",
        { method: "POST" }
      );
      setJevFeedback({ ok: body.result.ok, message: body.result.message });
    } catch (cause) {
      setJevFeedback({
        ok: false,
        message:
          cause instanceof NetworkError
            ? "Cannot reach the server"
            : cause instanceof ApiError
              ? cause.message
              : "Test failed",
      });
    } finally {
      setTestingJev(false);
    }
  };

  const list = credentialsList;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Platforms"
        description="Your own credentials, encrypted at rest. Test actions make one real API call."
      />

      {credentials.error !== null && !credentials.isLoading ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Could not load credentials — is the server running?
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        {(credentials.isLoading ? [] : list).map((credential) => {
          const meta = platformMeta[credential.id];
          const busy = testingId === credential.id;
          const feedbackFor = feedback?.platform === credential.id ? feedback : null;
          // The Jev model is free text: the catalogue does not always list
          // decision models. The draft wins while it exists, so a save never
          // snaps the field back to a stale value.
          const jevModelValue =
            jevModelDraft ?? credential.jevModelId ?? DEFAULT_JEV_MODEL;
          // While Jev screens jobs, the relevance model has no part in the
          // pipeline — so its control is disabled rather than left looking live.
          const jevEngine = credential.analysisEngine === "jev";
          return (
            <Card key={credential.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PlugZap className="size-4 text-muted-foreground" aria-hidden />
                  {meta.name}
                </CardTitle>
                <CardDescription>{meta.description}</CardDescription>
                <CardAction>
                  <StatusBadge status={credential.status} connected={credential.connected} />
                </CardAction>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col justify-center gap-4 py-2">
                {credential.connected ? (
                  <>
                    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
                      <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">{meta.keyInputLabel}</p>
                        <p className="truncate font-mono text-sm">{credential.keyPreview}</p>
                      </div>
                      <Button variant="ghost" size="xs" onClick={() => setReplacing(credential.id)}>
                        Replace
                      </Button>
                    </div>

                    {feedbackFor !== null ? (
                      <p
                        className={
                          feedbackFor.ok
                            ? "flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-2.5 text-sm text-success"
                            : "flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive"
                        }
                      >
                        {feedbackFor.ok ? (
                          <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                        ) : (
                          <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
                        )}
                        {feedbackFor.message}
                      </p>
                    ) : credential.lastTestMessage !== null ? (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden />
                        Last test: {credential.lastTestMessage}
                      </p>
                    ) : null}

                    {credential.usage !== undefined ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{credential.usage.label}</span>
                          <span className="tabular-nums">
                            {credential.usage.used.toLocaleString()} /{" "}
                            {credential.usage.limit.toLocaleString()}
                          </span>
                        </div>
                        <Progress
                          value={(credential.usage.used / credential.usage.limit) * 100}
                          indicatorClassName={
                            credential.usage.used / credential.usage.limit > 0.8
                              ? "bg-warning"
                              : undefined
                          }
                          aria-label={credential.usage.label}
                        />
                      </div>
                    ) : null}

                    {credential.id === "openrouter" ? (
                      <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">
                          Screening runs on one of two engines: your relevance
                          model, or Jev — a decision model that returns a score
                          without writing prose. A strong model writes proposals.
                        </p>

                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="analysis-engine">Relevance engine</Label>
                          <Select
                            value={credential.analysisEngine}
                            onValueChange={(value) =>
                              void changeModel({
                                analysisEngine: value as "llm" | "jev",
                              })
                            }
                          >
                            <SelectTrigger
                              id="analysis-engine"
                              className="w-full"
                              aria-label="Relevance engine"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="llm">Chat model (LLM)</SelectItem>
                              <SelectItem value="jev">Jev (decision model)</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            Jev scores jobs faster and far cheaper than a chat
                            model, but cannot explain itself in words — the
                            reason shown on a job comes from a fixed list of
                            factors. Its endpoint is alpha: if it fails, the job
                            is left unscreened and the error appears in Logs.
                            The relevance model is never used as a stand-in.
                          </p>
                        </div>

                        {credential.analysisEngine === "jev" ? (
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="jev-model">Jev model</Label>
                            <div className="flex items-center gap-2">
                              <Input
                                id="jev-model"
                                value={jevModelValue}
                                onChange={(event) => setJevModelDraft(event.target.value)}
                                placeholder={DEFAULT_JEV_MODEL}
                                spellCheck={false}
                                className="font-mono text-sm"
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={jevModelValue.trim().length === 0}
                                onClick={() => void saveJevModel(jevModelValue.trim())}
                              >
                                Save
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={testingJev}
                                onClick={() => void runJevTest()}
                              >
                                <RefreshCw
                                  className={testingJev ? "animate-spin" : undefined}
                                  data-icon="inline-start"
                                />
                                {testingJev ? "Testing…" : "Test Jev"}
                              </Button>
                              {jevFeedback !== null ? (
                                <span
                                  className={`flex items-center gap-1.5 text-xs ${
                                    jevFeedback.ok
                                      ? "text-muted-foreground"
                                      : "text-destructive"
                                  }`}
                                >
                                  {jevFeedback.ok ? (
                                    <CircleCheck className="size-3.5 shrink-0" aria-hidden />
                                  ) : (
                                    <CircleX className="size-3.5 shrink-0" aria-hidden />
                                  )}
                                  {jevFeedback.message}
                                </span>
                              ) : null}
                            </div>
                            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                              The model id is free text because the catalogue
                              does not always list decision models. Defaults to{" "}
                              {DEFAULT_JEV_MODEL}.
                            </p>
                          </div>
                        ) : null}

                        <ModelSelector
                          label="Relevance model"
                          hint={
                            jevEngine
                              ? "Not used while the relevance engine is Jev: Jev does the screening, and no chat model stands in for it. Switch the engine back to Chat model to use this again."
                              : "Must support structured JSON output (response_format): screening and analysis ask this model for a strict JSON schema, and models without it fail relevance checks."
                          }
                          current={credential.analysisModelId}
                          options={models.data?.models ?? []}
                          disabled={jevEngine}
                          onPick={(modelId) => void changeModel({ analysisModelId: modelId })}
                        />
                        <ModelSelector
                          label="Proposal model"
                          current={credential.proposalModelId}
                          options={models.data?.models ?? []}
                          onPick={(modelId) => void changeModel({ proposalModelId: modelId })}
                        />
                      </div>
                    ) : null}

                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="size-3.5 shrink-0" aria-hidden />
                      Stored encrypted · tested{" "}
                      {credential.lastTestedAt === null
                        ? "never"
                        : new Date(credential.lastTestedAt).toLocaleString()}
                    </p>
                  </>
                ) : (
                  <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
                    <p className="text-sm text-muted-foreground">
                      No {meta.name} credential saved yet.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setReplacing(credential.id)}>
                      Add credential
                    </Button>
                  </div>
                )}
              </CardContent>

              {credential.connected ? (
                <CardFooter className="justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void runTestStored(credential.id)}
                  >
                    <RefreshCw className={busy ? "animate-spin" : undefined} data-icon="inline-start" />
                    {busy ? "Testing…" : "Test connection"}
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          );
        })}
      </div>

      <DiscordCard />

      <p className="flex items-start gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        Credentials are encrypted with AES-256-GCM before storage and never sent back to
        this page — only masked previews exist after saving. Nothing is ever logged.
      </p>

      <Dialog
        open={replacing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReplacing(null);
            setReplaceValue("");
            setReplaceError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {replacing === null
                ? ""
                : list.find((c) => c.id === replacing)?.connected
                  ? "Replace credential"
                  : "Add credential"}
            </DialogTitle>
            <DialogDescription>
              The value is verified with one real API call before being stored, then
              encrypted and never shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-key">New value</Label>
            <Input
              id="new-key"
              type="password"
              value={replaceValue}
              onChange={(event) => setReplaceValue(event.target.value)}
              placeholder={
                replacing === null
                  ? ""
                  : platformMeta[replacing as keyof typeof platformMeta].placeholder
              }
            />
            {replaceError !== null ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
                {replaceError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplacing(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveReplace}
              disabled={savingReplace || replaceValue.trim().length < 8}
            >
              {savingReplace ? "Verifying…" : "Verify & save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({
  status,
  connected,
}: {
  status: CredentialSummary["status"];
  connected: boolean;
}) {
  if (!connected) {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        Not saved
      </Badge>
    );
  }
  if (status === "ok") {
    return (
      <Badge variant="outline" className="border-transparent bg-success/10 text-success">
        Working
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="bg-destructive/10 text-destructive border-transparent">
        Failed test
      </Badge>
    );
  }
  return <Badge variant="outline">Untested</Badge>;
}

function ModelSelector({
  label,
  current,
  options,
  onPick,
  hint,
  disabled,
}: {
  label: string;
  current: string | null;
  options: AiModelOption[];
  onPick: (modelId: string) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const fieldId = `model-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId} className={disabled ? "opacity-50" : undefined}>
        {label}
      </Label>
      {options.length > 0 ? (
        <Select value={current ?? undefined} onValueChange={onPick} disabled={disabled}>
          <SelectTrigger
            id={fieldId}
            className="w-full"
            aria-label={label}
            disabled={disabled}
          >
            <SelectValue placeholder="Choose a model" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label} · {option.provider}
                {option.contextLabel.length > 0 ? ` · ${option.contextLabel}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-xs text-muted-foreground">Loading model catalogue…</p>
      )}
      {hint !== undefined ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {hint}
        </p>
      ) : null}
    </div>
  );
}
