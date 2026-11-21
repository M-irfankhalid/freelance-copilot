import { useState } from "react";
import {
  Bot,
  Briefcase,
  CircleCheck,
  CircleX,
  FileText,
  Info,
  KeyRound,
  Loader2,
  Lock,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { DiscordCard } from "@/components/discord/discord-card";
import { McpCard } from "@/components/mcp/mcp-card";
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
  icon: LucideIcon;
}

const platformMeta: Record<CredentialSummary["id"], PlatformDisplayInfo> = {
  freelancer: {
    name: "Freelancer.com",
    description:
      "Personal access token used to search jobs, fetch details, and place bids.",
    keyInputLabel: "Access token",
    placeholder: "Paste your Freelancer.com OAuth token",
    icon: Briefcase,
  },
  openrouter: {
    name: "OpenRouter",
    description:
      "API key powering job analysis, matching, and proposal drafting.",
    keyInputLabel: "API key",
    placeholder: "sk-or-v1-…",
    icon: Sparkles,
  },
};

/** Test result shown under a card after a test action. */
type TestFeedback =
  | { platform: string; ok: true; message: string }
  | { platform: string; ok: false; message: string }
  | null;

type SingleFeedback = { ok: boolean; message: string } | null;

/**
 * Jev model shown when the user has not picked one. Mirrors the backend
 * default in `ai/jev.service.ts`.
 */
const DEFAULT_JEV_MODEL = "typesafe/jev-1.13";

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
          <Icon className={`size-4 ${tone}`} aria-hidden />
        </div>
        <p className="truncate text-xl font-semibold tracking-tight">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="text-base font-medium">
        {title}
      </h2>
      <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function CredentialCard({
  credential,
  meta,
  busy,
  feedback,
  onTest,
  onReplace,
}: {
  credential: CredentialSummary;
  meta: PlatformDisplayInfo;
  busy: boolean;
  feedback: TestFeedback;
  onTest: () => void;
  onReplace: () => void;
}) {
  const Icon = meta.icon;
  const usagePercent =
    credential.usage !== undefined && credential.usage.limit > 0
      ? Math.min(
          (credential.usage.used / credential.usage.limit) * 100,
          100
        )
      : 0;
  const lastTestOk = credential.status === "ok";

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {meta.name}
        </CardTitle>
        <CardDescription>{meta.description}</CardDescription>
        <CardAction>
          <StatusBadge status={credential.status} connected={credential.connected} />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {credential.connected ? (
          <>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{meta.keyInputLabel}</p>
                <p className="truncate font-mono text-sm">{credential.keyPreview}</p>
              </div>
              <Button variant="ghost" size="xs" onClick={onReplace}>
                Replace
              </Button>
            </div>

            {feedback !== null ? (
              <p
                className={
                  feedback.ok
                    ? "flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-2.5 text-sm text-success"
                    : "flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive"
                }
                aria-live="polite"
              >
                {feedback.ok ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                ) : (
                  <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                {feedback.message}
              </p>
            ) : credential.lastTestMessage !== null ? (
              <p
                className={`flex items-center gap-1.5 text-xs ${
                  lastTestOk ? "text-muted-foreground" : "text-destructive"
                }`}
              >
                {lastTestOk ? (
                  <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden />
                ) : (
                  <CircleX className="size-3.5 shrink-0" aria-hidden />
                )}
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
                  value={usagePercent}
                  indicatorClassName={usagePercent > 80 ? "bg-warning" : undefined}
                  aria-label={credential.usage.label}
                />
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-start justify-center gap-3 rounded-lg border border-dashed p-4">
            <div>
              <p className="text-sm font-medium">No credential saved</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your {meta.keyInputLabel.toLowerCase()} to connect {meta.name}.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onReplace}>
              Add credential
            </Button>
          </div>
        )}
      </CardContent>

      {credential.connected ? (
        <CardFooter className="flex-wrap justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            {credential.lastTestedAt === null
              ? "Not tested yet"
              : `Last checked ${new Date(credential.lastTestedAt).toLocaleString()}`}
          </p>
          <Button variant="outline" size="sm" disabled={busy} onClick={onTest}>
            <RefreshCw
              className={busy ? "animate-spin" : undefined}
              data-icon="inline-start"
            />
            {busy ? "Testing…" : "Test connection"}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export default function PlatformsPage() {
  const credentials = useApi<{ credentials: CredentialSummary[] }>("/api/credentials");

  const [testingId, setTestingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TestFeedback>(null);
  const [replacing, setReplacing] = useState<CredentialSummary["id"] | null>(null);
  const [replaceValue, setReplaceValue] = useState("");
  const [savingReplace, setSavingReplace] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [testingJev, setTestingJev] = useState(false);
  const [jevFeedback, setJevFeedback] = useState<SingleFeedback>(null);
  /** Null until edited, so the field tracks the saved value once it loads. */
  const [jevModelDraft, setJevModelDraft] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const [modelNotice, setModelNotice] = useState<SingleFeedback>(null);

  const credentialsList = credentials.data?.credentials ?? [];

  const models = useApi<{ models: AiModelOption[] }>(
    credentialsList.some((c) => c.id === "openrouter" && c.connected)
      ? "/api/credentials/openrouter/models"
      : null
  );

  const openrouter = credentialsList.find((credential) => credential.id === "openrouter");
  const connectedCount = credentialsList.filter((credential) => credential.connected).length;
  const jevEngine = openrouter?.analysisEngine === "jev";
  const proposalModelLabel =
    models.data?.models.find((model) => model.id === openrouter?.proposalModelId)?.label ??
    openrouter?.proposalModelId ??
    "Not set";
  const jevModelValue =
    jevModelDraft ?? openrouter?.jevModelId ?? DEFAULT_JEV_MODEL;

  const closeReplace = () => {
    setReplacing(null);
    setReplaceValue("");
    setReplaceError(null);
  };

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
        message: messageFor(cause),
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
      closeReplace();
      void credentials.refetch();
    } catch (cause) {
      setReplaceError(messageFor(cause));
    } finally {
      setSavingReplace(false);
    }
  };

  const changeModel = async (body: {
    analysisModelId?: string;
    proposalModelId?: string;
    agentModelId?: string;
    analysisEngine?: "llm" | "jev";
    jevModelId?: string;
  }): Promise<boolean> => {
    if (savingModel) return false;
    setSavingModel(true);
    setModelNotice(null);
    try {
      await api("/api/credentials/openrouter/model", { method: "PUT", body });
      setModelNotice({ ok: true, message: "Model routing saved." });
      void credentials.refetch();
      return true;
    } catch (cause) {
      setModelNotice({ ok: false, message: messageFor(cause) });
      return false;
    } finally {
      setSavingModel(false);
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
        message: messageFor(cause),
      });
    } finally {
      setTestingJev(false);
    }
  };

  const list = credentialsList;
  const replacingMeta = replacing === null ? null : platformMeta[replacing];
  const loadingCredentials = credentials.isLoading && credentials.data === undefined;
  const credentialsUnavailable = credentials.error !== null;
  const modelsError = models.error?.message ?? null;

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <PageHeader
        title="Platforms"
        description="Connect the accounts the worker uses. Keys are verified once, encrypted, and only shown as masked previews."
      />

      {credentialsUnavailable ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>Could not load credentials: {credentials.error?.message}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void credentials.refetch()}
          >
            <RefreshCw data-icon="inline-start" aria-hidden />
            Try again
          </Button>
        </div>
      ) : null}

      <section
        aria-label="Connection status"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <SummaryTile
          icon={PlugZap}
          label="Connections"
          value={
            loadingCredentials
              ? "Loading"
              : credentialsUnavailable
                ? "Unavailable"
                : `${connectedCount}/${list.length}`
          }
          detail={
            credentialsUnavailable
              ? "Credential status unavailable"
              : `${list.length} credential${list.length === 1 ? "" : "s"} configured`
          }
          tone={credentialsUnavailable ? "text-destructive" : "text-success"}
        />
        <SummaryTile
          icon={Bot}
          label="Screening"
          value={
            loadingCredentials
              ? "Loading"
              : !openrouter?.connected
                ? "Not set"
                : jevEngine
                  ? "Jev"
                  : "Chat model"
          }
          detail="Engine that scores new jobs"
          tone={openrouter?.connected ? "text-primary" : "text-muted-foreground"}
        />
        <SummaryTile
          icon={FileText}
          label="Proposal model"
          value={openrouter?.proposalModelId ? "Selected" : "Not set"}
          detail={proposalModelLabel}
          tone={openrouter?.proposalModelId ? "text-primary" : "text-muted-foreground"}
        />
        <SummaryTile
          icon={ShieldCheck}
          label="Storage"
          value="Encrypted"
          detail="AES-256-GCM at rest"
          tone="text-success"
        />
      </section>

      <section
        aria-labelledby="connections-heading"
        className="flex flex-col gap-3"
      >
        <SectionHeading
          id="connections-heading"
          title="Connections"
          description="Freelancer.com finds and bids on jobs. OpenRouter supplies the AI models used to screen and write."
        />

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          {loadingCredentials ? (
            <>
              <div className="h-52 animate-pulse rounded-xl border border-border/80 bg-muted/40" />
              <div className="h-52 animate-pulse rounded-xl border border-border/80 bg-muted/40" />
            </>
          ) : null}

          {!loadingCredentials && list.length === 0 && !credentialsUnavailable ? (
            <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground lg:col-span-2">
              No platform credentials are configured yet.
            </p>
          ) : null}

          {list.map((credential) => (
            <CredentialCard
              key={credential.id}
              credential={credential}
              meta={platformMeta[credential.id]}
              busy={testingId === credential.id}
              feedback={feedback?.platform === credential.id ? feedback : null}
              onTest={() => void runTestStored(credential.id)}
              onReplace={() => setReplacing(credential.id)}
            />
          ))}
        </div>

        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Credentials are encrypted with AES-256-GCM before storage and never sent
          back to this page. Nothing is ever logged.
        </p>
      </section>

      {openrouter?.connected ? (
        <section aria-labelledby="models-heading" className="flex flex-col gap-3">
          <SectionHeading
            id="models-heading"
            title="Model routing"
            description="One OpenRouter key, three jobs. Choose a fast screener, a strong writer, and a tool-capable Agent model."
          />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-muted-foreground" aria-hidden />
                OpenRouter models
              </CardTitle>
              <CardDescription>
                Changes save immediately. Screening can run on a chat model or on
                Jev, a decision model.
              </CardDescription>
              <CardAction>
                {savingModel ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Saving
                  </span>
                ) : (
                  <Badge variant="outline">OpenRouter</Badge>
                )}
              </CardAction>
            </CardHeader>

            <CardContent className="flex flex-col gap-5">
              <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
                <div className="flex flex-col gap-4 rounded-lg border p-3">
                  <div>
                    <h3 className="text-sm font-medium">Job screening</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Runs before proposals. It needs a cheap, fast model that can
                      return structured JSON.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="analysis-engine">Relevance engine</Label>
                    <Select
                      value={openrouter.analysisEngine}
                      onValueChange={(value) =>
                        void changeModel({
                          analysisEngine: value as "llm" | "jev",
                        })
                      }
                      disabled={savingModel}
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
                  </div>

                  {jevEngine ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-end gap-2">
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <Label htmlFor="jev-model">Jev model</Label>
                          <Input
                            id="jev-model"
                            value={jevModelValue}
                            onChange={(event) => setJevModelDraft(event.target.value)}
                            placeholder={DEFAULT_JEV_MODEL}
                            spellCheck={false}
                            className="font-mono text-sm"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={savingModel || jevModelValue.trim().length === 0}
                          onClick={() => void saveJevModel(jevModelValue.trim())}
                        >
                          Save
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
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
                            aria-live="polite"
                          >
                            {jevFeedback.ok ? (
                              <CircleCheck
                                className="size-3.5 shrink-0 text-success"
                                aria-hidden
                              />
                            ) : (
                              <CircleX className="size-3.5 shrink-0" aria-hidden />
                            )}
                            {jevFeedback.message}
                          </span>
                        ) : null}
                      </div>
                      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        Jev scores jobs faster and cheaper, but explains itself with a
                        fixed factor list instead of free text. Its endpoint is alpha:
                        failures leave the job unscreened and appear in Logs.
                      </p>
                    </div>
                  ) : (
                    <>
                      <ModelSelector
                        label="Relevance model"
                        hint="Must support structured JSON output (response_format): screening and analysis ask this model for a strict JSON schema."
                        current={openrouter.analysisModelId}
                        options={models.data?.models ?? []}
                        loading={models.isLoading}
                        error={modelsError}
                        disabled={savingModel}
                        onPick={(modelId) => void changeModel({ analysisModelId: modelId })}
                      />
                      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        Jev is a cheaper alpha alternative that cannot explain itself
                        in words. If it fails, the job is left unscreened; the chat
                        model is never used as a silent stand-in.
                      </p>
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-4 rounded-lg border p-3">
                  <div>
                    <h3 className="text-sm font-medium">Writing & Agent</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      The proposal model writes bids. The Agent model runs in-app chat
                      and must support tool calling.
                    </p>
                  </div>

                  <ModelSelector
                    label="Proposal model"
                    current={openrouter.proposalModelId}
                    options={models.data?.models ?? []}
                    loading={models.isLoading}
                    error={modelsError}
                    disabled={savingModel}
                    onPick={(modelId) => void changeModel({ proposalModelId: modelId })}
                  />
                  <ModelSelector
                    label="Agent model"
                    hint="Used only for Agent chat. Must support tool calling; the agent reads your saved data and, when you enable Allow changes, writes profile and draft-proposal edits."
                    current={openrouter.agentModelId}
                    options={models.data?.models ?? []}
                    loading={models.isLoading}
                    error={modelsError}
                    disabled={savingModel}
                    onPick={(modelId) => void changeModel({ agentModelId: modelId })}
                  />
                </div>
              </div>

              {modelNotice !== null ? (
                <p
                  className={
                    modelNotice.ok
                      ? "flex items-center gap-1.5 text-sm text-success"
                      : "flex items-center gap-1.5 text-sm text-destructive"
                  }
                  aria-live="polite"
                >
                  {modelNotice.ok ? (
                    <CircleCheck className="size-4 shrink-0" aria-hidden />
                  ) : (
                    <CircleX className="size-4 shrink-0" aria-hidden />
                  )}
                  {modelNotice.message}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="integrations-heading" className="flex flex-col gap-3">
        <SectionHeading
          id="integrations-heading"
          title="Integrations"
          description="Optional ways to reach the worker and your data from outside this app."
        />
        <McpCard />
        <DiscordCard />
      </section>

      <Dialog
        open={replacing !== null}
        onOpenChange={(open) => {
          if (!open) closeReplace();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {replacingMeta === null
                ? ""
                : `${
                    list.find((credential) => credential.id === replacing)?.connected
                      ? "Replace"
                      : "Add"
                  } ${replacingMeta.name} credential`}
            </DialogTitle>
            <DialogDescription>
              We verify this with one real API call before storing it, then encrypt it
              and show only a masked preview.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-key">
              {replacingMeta?.keyInputLabel ?? "Credential value"}
            </Label>
            <Input
              id="new-key"
              type="password"
              autoComplete="off"
              value={replaceValue}
              onChange={(event) => setReplaceValue(event.target.value)}
              placeholder={replacingMeta?.placeholder ?? ""}
            />
            {replaceError !== null ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
                {replaceError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeReplace}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveReplace()}
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
      <Badge variant="outline" className="border-transparent bg-destructive/10 text-destructive">
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
  loading,
  error,
}: {
  label: string;
  current: string | null;
  options: AiModelOption[];
  onPick: (modelId: string) => void;
  hint?: string;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
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
        <p className="text-xs text-muted-foreground">
          {loading
            ? "Loading model catalogue…"
            : error !== null && error !== undefined
              ? `Could not load models: ${error}`
              : "No models available."}
        </p>
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
