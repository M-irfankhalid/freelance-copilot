import { useState } from "react";
import { CircleCheck, CircleX, KeyRound, Lock, PlugZap, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
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

export default function PlatformsPage() {
  const credentials = useApi<CredentialSummary[]>("/api/credentials");

  const [testingId, setTestingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TestFeedback>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [replaceValue, setReplaceValue] = useState("");
  const [savingReplace, setSavingReplace] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);

  const models = useApi<{ models: AiModelOption[] }>(
    credentials.data?.some((c) => c.id === "openrouter" && c.connected)
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

  const changeModel = async (modelId: string) => {
    try {
      await api("/api/credentials/openrouter/model", {
        method: "PUT",
        body: { modelId },
      });
      void credentials.refetch();
    } catch {
      // surfaced via list refresh failure or next interaction
    }
  };

  const list = credentials.data ?? [];

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
                      <ModelSelector
                        current={credential.modelId}
                        options={models.data?.models ?? []}
                        onPick={changeModel}
                      />
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
  current,
  options,
  onPick,
}: {
  current: string | null;
  options: AiModelOption[];
  onPick: (modelId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="model">AI model</Label>
      {options.length > 0 ? (
        <Select value={current ?? undefined} onValueChange={onPick}>
          <SelectTrigger id="model" className="w-full" aria-label="AI model">
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
    </div>
  );
}
