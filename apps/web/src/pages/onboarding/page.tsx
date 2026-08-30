import { useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CircleCheck,
  CircleX,
  Download,
  KeyRound,
  PlugZap,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";

import { ChipEditor } from "@/components/shared/chip-editor";
import { ConnectionBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import type { AiModelOption, CredentialTestResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * First-run setup. Credential steps perform REAL verification against the
 * services and store encrypted values; the remaining steps keep their mock
 * behaviour until their phases land (profile import = Phase 6).
 */

const steps = [
  { id: 0, title: "Welcome", icon: Bot },
  { id: 1, title: "Freelancer.com", icon: PlugZap },
  { id: 2, title: "OpenRouter", icon: KeyRound },
  { id: 3, title: "Profile", icon: UserRound },
  { id: 4, title: "Preferences", icon: SlidersHorizontal },
] as const;

const stepDescriptions = [
  "Five quick steps and the agent starts working for you.",
  "Bring your own credential. We verify it with one lightweight call before saving anything.",
  "Your AI budget lives here. Pick whichever model you want the agent to think with.",
  "The agent only knows what this profile says — it will never invent experience or skills.",
  "Tell the agent what to look for, what to avoid, and how often to look.",
];

type TestState = "idle" | "testing" | "ok" | "failed";

interface StepTest {
  state: TestState;
  message?: string;
}

const idleTest: StepTest = { state: "idle" };

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Step 1 — Freelancer token
  const [freelancerToken, setFreelancerToken] = useState("");
  const [freelancer, setFreelancer] = useState<StepTest>(idleTest);
  const [freelancerSaved, setFreelancerSaved] = useState(false);

  // Step 2 — OpenRouter key + model
  const [orKey, setOrKey] = useState("");
  const [openRouter, setOpenRouter] = useState<StepTest>(idleTest);
  const [orSaved, setOrSaved] = useState(false);
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [modelId, setModelId] = useState("");

  // Step 3 - real profile import
  const [profileImported, setProfileImported] = useState(false);
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState<{
    freelancerUsername: string | null;
    name: string | null;
    title: string | null;
    hourlyRate: string | null;
    about: string | null;
    skills: string[] | null;
    skillIds: number[];
    wants: string[] | null;
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Step 4 — preferences (mocked until Phase 6)
  const [skills, setSkills] = useState<string[]>([]);
  const [wants, setWants] = useState<string[]>([]);
  const [notWants, setNotWants] = useState<string[]>([]);
  const [interval, setIntervalSeconds] = useState("60");

  /** Verify against the live service, then store encrypted. */
  const testAndSave = async (
    id: "freelancer" | "openrouter",
    value: string,
    setter: (next: StepTest) => void
  ): Promise<boolean> => {
    setter({ state: "testing" });
    try {
      const probe = await api<{ result: CredentialTestResult }>(
        `/api/credentials/${id}/test`,
        { method: "POST", body: { value } }
      );
      if (!probe.result.ok) {
        setter({ state: "failed", message: probe.result.message });
        return false;
      }
      await api(`/api/credentials/${id}`, { method: "PUT", body: { value } });
      if (id === "openrouter") {
        try {
          const catalogue = await api<{ models: AiModelOption[] }>(
            "/api/credentials/openrouter/models"
          );
          setModels(catalogue.models);
          if (catalogue.models.length > 0) {
            setModelId(catalogue.models[0].id);
          }
          await api("/api/credentials/openrouter/model", {
            method: "PUT",
            body: { modelId: catalogue.models[0].id },
          });
        } catch {
          // Catalogue is optional — the key itself is stored.
        }
      }
      setter({ state: "ok", message: probe.result.message });
      return true;
    } catch (cause) {
      setter({
        state: "failed",
        message:
          cause instanceof NetworkError
            ? "Cannot reach the server"
            : cause instanceof ApiError
              ? cause.message
              : "Verification failed",
      });
      return false;
    }
  };

  const importProfile = async () => {
    if (importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const body = await api<{
        profile: {
          freelancerUsername: string | null;
          name: string | null;
          title: string | null;
          hourlyRate: string | null;
          about: string | null;
          skills: string[];
          skillIds: number[];
          wants: string[];
        };
      }>("/api/profile/import", { method: "POST" });
      setDraft(body.profile);
      setSkills(body.profile.skills ?? []);
      setWants(body.profile.wants ?? []);
      setProfileImported(true);
    } catch (cause) {
      setImportError(
        cause instanceof NetworkError
          ? "Cannot reach the server"
          : cause instanceof ApiError
            ? cause.message
            : "Import failed"
      );
    } finally {
      setImporting(false);
    }
  };

  /** Persist imported data plus preferences, then head to the dashboard. */
  const finishSetup = async () => {
    await api("/api/profile", {
      method: "PUT",
      body: {
        freelancerUsername: draft?.freelancerUsername ?? null,
        name: draft?.name ?? null,
        title: draft?.title ?? null,
        hourlyRate: draft?.hourlyRate ?? null,
        about: draft?.about ?? null,
        skills,
        skillIds: draft?.skillIds ?? [],
        experience: [],
        portfolio: [],
        certifications: [],
        preferredProjectTypes: [],
        wants,
        notWants,
        customInstructions: null,
      },
    });
    navigate("/dashboard");
  };

  return (
    <div className="flex min-h-svh flex-col items-center gap-8 bg-muted/40 p-4 py-10">
      <div className="w-full max-w-xl">
        <ol className="mb-6 flex items-center gap-1.5">
          {steps.map((entry, index) => (
            <li key={entry.id} className="flex flex-1 items-center gap-1.5 last:flex-none">
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                  index < step && "border-transparent bg-primary text-primary-foreground",
                  index === step && "border-primary text-primary",
                  index > step && "border-border bg-background text-muted-foreground"
                )}
                aria-current={index === step ? "step" : undefined}
              >
                {index < step ? <CircleCheck className="size-4" aria-hidden /> : entry.id + 1}
              </div>
              {index < steps.length - 1 ? (
                <div className={cn("h-px flex-1", index < step ? "bg-primary" : "bg-border")} />
              ) : null}
            </li>
          ))}
        </ol>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{steps[step].title}</CardTitle>
            <CardDescription>{stepDescriptions[step]}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {step === 0 ? <WelcomeStep /> : null}

            {step === 1 ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="fl-token">Access token</Label>
                  <Input
                    id="fl-token"
                    type="password"
                    placeholder="Paste your Freelancer.com OAuth token"
                    value={freelancerToken}
                    onChange={(event) => {
                      setFreelancerToken(event.target.value);
                      setFreelancer(idleTest);
                      setFreelancerSaved(false);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Profile settings → API on Freelancer.com. Stored encrypted and never shown again.
                  </p>
                </div>
                <TestRow
                  test={freelancer}
                  disabled={freelancerToken.trim().length < 8}
                  onTest={() => void testAndSave("freelancer", freelancerToken, setFreelancer).then(setFreelancerSaved)}
                />
              </div>
            ) : null}

            {step === 2 ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="or-key">API key</Label>
                    <Input
                      id="or-key"
                      type="password"
                      placeholder="sk-or-v1-…"
                      value={orKey}
                      onChange={(event) => {
                        setOrKey(event.target.value);
                        setOpenRouter(idleTest);
                        setOrSaved(false);
                      }}
                    />
                  </div>
                  <TestRow
                    test={openRouter}
                    disabled={orKey.trim().length < 8}
                    onTest={() => void testAndSave("openrouter", orKey, setOpenRouter).then(setOrSaved)}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>AI model</Label>
                  {models.length > 0 ? (
                    <Select
                      value={modelId || models[0].id}
                      onValueChange={(picked) => {
                        setModelId(picked);
                        void api("/api/credentials/openrouter/model", {
                          method: "PUT",
                          body: { modelId: picked },
                        });
                      }}
                    >
                      <SelectTrigger className="w-full" aria-label="Select model">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.label} · {model.contextLabel}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Model catalogue appears after the key is verified.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Used for analysis, matching, and proposals. Changeable anytime on Platforms.
                  </p>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="flex flex-col gap-4">
                {importError !== null ? (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
                    {importError}
                  </p>
                ) : null}
                {profileImported ? (
                  <div className="rounded-lg border p-3.5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CircleCheck className="size-4 text-success" aria-hidden />
                        <p className="text-sm font-medium">
                          Imported @{draft?.freelancerUsername ?? "unknown"}
                        </p>
                      </div>
                      <ConnectionBadge status="connected" />
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                      <dt className="text-muted-foreground">Name</dt>
                      <dd>{draft?.name ?? "–"}</dd>
                      <dt className="text-muted-foreground">Title</dt>
                      <dd>{draft?.title ?? "–"}</dd>
                      <dt className="text-muted-foreground">Rate</dt>
                      <dd>{draft?.hourlyRate ?? "–"}</dd>
                      <dt className="text-muted-foreground">Skills</dt>
                      <dd>{(draft?.skills ?? []).length} found</dd>
                    </dl>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Live import arrives with the profile phase — everything is editable on the
                      Profile page.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-center">
                    <p className="mx-auto mb-3 max-w-sm text-sm text-muted-foreground">
                      Pull your public name, title, rate, and skills straight from
                      Freelancer.com instead of typing them.
                    </p>
                    <Button onClick={importProfile} disabled={importing}>
                      <Download data-icon="inline-start" />
                      {importing ? "Fetching profile…" : "Fetch my profile"}
                    </Button>
                  </div>
                )}
              </div>
            ) : null}

            {step === 4 ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <Label>Your skills — used as job search keywords</Label>
                  <ChipEditor values={skills} onChange={setSkills} placeholder="e.g. React" />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label>Wants</Label>
                    <ChipEditor values={wants} onChange={setWants} placeholder="e.g. dashboard" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Not-wants</Label>
                    <ChipEditor values={notWants} onChange={setNotWants} placeholder="e.g. crypto" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="scan-interval">Scan interval</Label>
                  <Select value={interval} onValueChange={setIntervalSeconds}>
                    <SelectTrigger id="scan-interval" className="w-full" aria-label="Scan interval">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">Every 30 seconds</SelectItem>
                      <SelectItem value="60">Every 60 seconds</SelectItem>
                      <SelectItem value="120">Every 2 minutes</SelectItem>
                      <SelectItem value="300">Every 5 minutes</SelectItem>
                      <SelectItem value="600">Every 10 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    How often the worker polls Freelancer.com for new jobs. Minimum 30 seconds.
                  </p>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
          {step < steps.length - 1 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={(step === 1 && !freelancerSaved) || (step === 2 && !orSaved)}
            >
              Continue
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button onClick={() => void finishSetup()}>
              Finish setup
              <ArrowRight data-icon="inline-end" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function WelcomeStep() {
  return (
    <ul className="flex flex-col gap-3 text-sm">
      {["Freelancer.com", "OpenRouter"].map((name) => (
        <li key={name} className="flex items-center gap-2.5 rounded-lg border p-3">
          <PlugZap className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Connect your own {name} credentials — verified live, stored encrypted.
        </li>
      ))}
      <li className="flex items-center gap-2.5 rounded-lg border p-3">
        <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        Import your Freelancer.com profile so proposals only ever use real facts about you.
      </li>
      <li className="flex items-center gap-2.5 rounded-lg border p-3">
        <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        Set keywords, wants and not-wants, and how often to scan for fresh jobs.
      </li>
    </ul>
  );
}

function TestRow({
  test,
  disabled,
  onTest,
}: {
  test: StepTest;
  disabled: boolean;
  onTest: () => void;
}) {
  const busy = test.state === "testing";
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          {test.state === "ok" ? (
            <>
              <CircleCheck className="size-4 text-success" aria-hidden />
              <span>Verified &amp; saved encrypted</span>
            </>
          ) : test.state === "failed" ? (
            <>
              <CircleX className="size-4 text-destructive" aria-hidden />
              <span>{test.message ?? "Verification failed"}</span>
            </>
          ) : busy ? (
            <span className="text-muted-foreground">Calling the service…</span>
          ) : (
            <span className="text-muted-foreground">Not verified yet</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onTest} disabled={disabled || busy}>
          {busy ? "Testing…" : "Verify & save"}
        </Button>
      </div>
      {test.state === "ok" && test.message !== undefined ? (
        <p className="text-xs text-muted-foreground">{test.message}</p>
      ) : null}
    </div>
  );
}
