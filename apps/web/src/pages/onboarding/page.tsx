import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Download,
  Loader2,
  PlugZap,
  Sparkles,
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
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import type {
  AiModelOption,
  CredentialSummary,
  CredentialTestResult,
  UserProfile,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * First-run setup. Three steps: connect both credentials, import the public
 * profile, then optionally add the proposal-quality inputs that matter. Every
 * step performs real API calls — no mock state.
 */

const steps = [
  { id: 0, title: "Connect accounts", icon: PlugZap },
  { id: 1, title: "Your profile", icon: UserRound },
  { id: 2, title: "Better proposals", icon: Sparkles },
] as const;

const stepDescriptions = [
  "Paste your Freelancer.com token and OpenRouter key. Both are verified live and stored encrypted — this is the only required step.",
  "We import your public name, title, rate, and skills so every proposal uses real facts about you.",
  "Optional polish that makes drafts noticeably stronger, plus how often to scan for fresh jobs.",
];

type TestState = "idle" | "testing" | "ok" | "failed";

interface StepTest {
  state: TestState;
  message?: string;
}

const idleTest: StepTest = { state: "idle" };

interface ImportedProfile {
  freelancerUsername: string | null;
  name: string | null;
  title: string | null;
  hourlyRate: string | null;
  about: string | null;
  skills: string[];
  skillIds: number[];
  wants: string[];
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof NetworkError) return "Cannot reach the server";
  if (cause instanceof ApiError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return fallback;
}

/** Imported value wins when present, otherwise keep what is already stored. */
function prefer<T>(
  imported: T | null | undefined,
  stored: T | null | undefined
): T | null {
  return imported ?? stored ?? null;
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Step 0 — both credentials
  const [freelancerToken, setFreelancerToken] = useState("");
  const [freelancer, setFreelancer] = useState<StepTest>(idleTest);
  const [freelancerSaved, setFreelancerSaved] = useState(false);

  const [orKey, setOrKey] = useState("");
  const [openRouter, setOpenRouter] = useState<StepTest>(idleTest);
  const [orSaved, setOrSaved] = useState(false);
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [modelId, setModelId] = useState("");

  // Step 1 — real profile import
  const [profileImported, setProfileImported] = useState(false);
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState<ImportedProfile | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Step 2 — search preferences and proposal-quality inputs
  const [skills, setSkills] = useState<string[]>([]);
  const [wants, setWants] = useState<string[]>([]);
  const [notWants, setNotWants] = useState<string[]>([]);
  const [interval, setIntervalSeconds] = useState("60");
  const [customInstructions, setCustomInstructions] = useState("");
  const [portfolio, setPortfolio] = useState("");

  // Existing profile is preserved when setup is re-run.
  const [existingProfile, setExistingProfile] = useState<UserProfile | null>(
    null
  );
  const [existingLoaded, setExistingLoaded] = useState(false);

  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const importStarted = useRef(false);

  // Hydrate saved state so re-running setup does not ask for keys again or
  // wipe fields that are not part of this flow.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [profileResult, credentialsResult, automationResult] =
        await Promise.allSettled([
          api<{ profile: UserProfile | null }>("/api/profile"),
          api<{ credentials: CredentialSummary[] }>("/api/credentials"),
          api<{ settings: { scanIntervalSeconds: number } }>("/api/automation"),
        ]);

      if (cancelled) return;

      if (profileResult.status === "fulfilled") {
        const profile = profileResult.value.profile;
        setExistingProfile(profile);
        setExistingLoaded(true);
        if (profile !== null) {
          setSkills((current) =>
            current.length > 0 ? current : (profile.skills ?? [])
          );
          setWants((current) =>
            current.length > 0 ? current : (profile.wants ?? [])
          );
          setNotWants((current) =>
            current.length > 0 ? current : (profile.notWants ?? [])
          );
          setCustomInstructions((current) =>
            current.trim().length > 0 ? current : (profile.customInstructions ?? "")
          );
          setPortfolio((current) =>
            current.trim().length > 0 ? current : (profile.portfolioSummary ?? "")
          );
        }
      } else {
        setExistingLoaded(true);
      }

      if (credentialsResult.status === "fulfilled") {
        const credentials = credentialsResult.value.credentials;

        const fl = credentials.find((credential) => credential.id === "freelancer");
        if (fl?.connected) {
          setFreelancer({ state: "ok", message: "Already connected." });
          setFreelancerSaved(true);
        }

        const or = credentials.find((credential) => credential.id === "openrouter");
        if (or?.connected) {
          setOpenRouter({ state: "ok", message: "Already connected." });
          setOrSaved(true);
          if (or.proposalModelId !== null) setModelId(or.proposalModelId);
          try {
            const catalogue = await api<{ models: AiModelOption[] }>(
              "/api/credentials/openrouter/models"
            );
            if (!cancelled) {
              setModels(catalogue.models);
              if (or.proposalModelId === null && catalogue.models[0] !== undefined) {
                setModelId(catalogue.models[0].id);
              }
            }
          } catch {
            // Catalogue is optional; the stored key still works.
          }
        }
      }

      if (automationResult.status === "fulfilled") {
        setIntervalSeconds(
          String(automationResult.value.settings.scanIntervalSeconds)
        );
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
          if (catalogue.models[0] !== undefined) {
            setModelId(catalogue.models[0].id);
            await api("/api/credentials/openrouter/model", {
              method: "PUT",
              body: { modelId: catalogue.models[0].id },
            });
          }
        } catch {
          // Catalogue is optional — the key itself is stored.
        }
      }
      setter({ state: "ok", message: probe.result.message });
      return true;
    } catch (cause) {
      setter({
        state: "failed",
        message: errorMessage(cause, "Verification failed"),
      });
      return false;
    }
  };

  const importProfile = async () => {
    if (importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const body = await api<{ profile: ImportedProfile }>(
        "/api/profile/import",
        { method: "POST" }
      );
      setDraft(body.profile);
      // Keep any preferences already loaded from a previous setup run.
      setSkills((current) =>
        current.length > 0 ? current : (body.profile.skills ?? [])
      );
      setWants((current) =>
        current.length > 0 ? current : (body.profile.wants ?? [])
      );
      setProfileImported(true);
    } catch (cause) {
      setImportError(errorMessage(cause, "Import failed"));
    } finally {
      setImporting(false);
    }
  };

  // Fetch the profile as soon as the user reaches the import step.
  useEffect(() => {
    if (step !== 1 || importStarted.current) return;
    importStarted.current = true;
    void importProfile();
    // importProfile only calls state setters; this runs once per step entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  /** Persist the profile (merged with anything already saved) and interval. */
  const finishSetup = async () => {
    if (finishing) return;
    setFinishing(true);
    setFinishError(null);
    try {
      let base = existingProfile;
      if (!existingLoaded) {
        try {
          const current = await api<{ profile: UserProfile | null }>(
            "/api/profile"
          );
          base = current.profile;
          setExistingProfile(current.profile);
          setExistingLoaded(true);
        } catch {
          // Continue with whatever was loaded earlier.
        }
      }

      const imported = profileImported ? draft : null;

      try {
        await api("/api/automation", {
          method: "PUT",
          body: { scanIntervalSeconds: Number(interval) },
        });
      } catch (cause) {
        setFinishError(
          `Your search interval could not be saved: ${errorMessage(cause, "unknown error")}`
        );
        return;
      }

      await api("/api/profile", {
        method: "PUT",
        body: {
          freelancerUsername: prefer(
            imported?.freelancerUsername,
            base?.freelancerUsername
          ),
          name: prefer(imported?.name, base?.name),
          title: prefer(imported?.title, base?.title),
          hourlyRate: prefer(imported?.hourlyRate, base?.hourlyRateLabel),
          about: prefer(imported?.about, base?.about),
          skills,
          skillIds: imported !== null ? imported.skillIds : (base?.skillIds ?? []),
          preferredProjectTypes: base?.preferredProjectTypes ?? [],
          wants,
          notWants,
          ignoredCountries: base?.ignoredCountries ?? [],
          customInstructions:
            customInstructions.trim().length > 0
              ? customInstructions.trim()
              : (base?.customInstructions ?? null),
          relevancyInstructions: base?.relevancyInstructions ?? null,
          portfolioSummary:
            portfolio.trim().length > 0
              ? portfolio.trim()
              : (base?.portfolioSummary ?? null),
          proposalTemplates: base?.proposalTemplates ?? null,
          proposalSystemInstructions: base?.proposalSystemInstructions ?? null,
          proposalWritingInstructions: base?.proposalWritingInstructions ?? null,
        },
      });

      navigate("/dashboard");
    } catch (cause) {
      setFinishError(errorMessage(cause, "Could not finish setup"));
    } finally {
      setFinishing(false);
    }
  };

  const accountsReady = freelancerSaved && orSaved;

  return (
    <div className="flex min-h-svh flex-col items-center gap-8 bg-muted/40 p-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Step {step + 1} of {steps.length} — {steps[step].title}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => navigate("/dashboard")}
          >
            Set up later
          </Button>
        </div>
        <ol className="mb-6 flex items-center gap-1.5" aria-label="Setup steps">
          {steps.map((entry, index) => (
            <li
              key={entry.id}
              className="flex flex-1 items-center gap-1.5 last:flex-none"
            >
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                  index < step &&
                    "border-transparent bg-primary text-primary-foreground",
                  index === step && "border-primary text-primary",
                  index > step &&
                    "border-border bg-background text-muted-foreground"
                )}
                aria-current={index === step ? "step" : undefined}
                title={entry.title}
              >
                {index < step ? (
                  <CircleCheck className="size-4" aria-hidden />
                ) : (
                  entry.id + 1
                )}
                <span className="sr-only">{entry.title}</span>
              </div>
              {index < steps.length - 1 ? (
                <div
                  className={cn(
                    "h-px flex-1",
                    index < step ? "bg-primary" : "bg-border"
                  )}
                />
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
            {step === 0 ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3 rounded-lg border p-3.5">
                  <div className="flex items-center gap-2">
                    <PlugZap className="size-4 text-muted-foreground" aria-hidden />
                    <p className="text-sm font-medium">Freelancer.com</p>
                    {freelancerSaved ? (
                      <ConnectionBadge status="connected" />
                    ) : null}
                  </div>
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
                      Freelancer.com → Settings → API tokens. Stored encrypted
                      and never shown again.
                    </p>
                  </div>
                  <TestRow
                    test={freelancer}
                    disabled={freelancerToken.trim().length < 8}
                    onTest={() =>
                      void testAndSave(
                        "freelancer",
                        freelancerToken,
                        setFreelancer
                      ).then(setFreelancerSaved)
                    }
                  />
                </div>

                <div className="flex flex-col gap-3 rounded-lg border p-3.5">
                  <div className="flex items-center gap-2">
                    <Sparkles
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                    <p className="text-sm font-medium">OpenRouter</p>
                    {orSaved ? <ConnectionBadge status="connected" /> : null}
                  </div>
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
                    <p className="text-xs text-muted-foreground">
                      Create a key at openrouter.ai/keys. It powers screening,
                      proposals, and the in-app agent.
                    </p>
                  </div>
                  <TestRow
                    test={openRouter}
                    disabled={orKey.trim().length < 8}
                    onTest={() =>
                      void testAndSave(
                        "openrouter",
                        orKey,
                        setOpenRouter
                      ).then(setOrSaved)
                    }
                  />

                  {orSaved ? (
                    <div className="flex flex-col gap-1.5">
                      <Label>AI model</Label>
                      {models.length > 0 ? (
                        <Select
                          value={modelId}
                          onValueChange={(picked) => {
                            setModelId(picked);
                            void api("/api/credentials/openrouter/model", {
                              method: "PUT",
                              body: { modelId: picked },
                            });
                          }}
                        >
                          <SelectTrigger
                            className="w-full"
                            aria-label="Select model"
                          >
                            <SelectValue placeholder="Choose a model" />
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
                          Loading the model catalogue…
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Used for analysis, matching, and proposals. Changeable
                        anytime on Platforms.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="flex flex-col gap-4">
                {importing ? (
                  <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Fetching your Freelancer.com profile…
                  </div>
                ) : profileImported ? (
                  <div className="rounded-lg border p-3.5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CircleCheck
                          className="size-4 text-success"
                          aria-hidden
                        />
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
                      Everything is editable later on the Profile page.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
                    {importError !== null ? (
                      <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-left text-sm text-destructive">
                        <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {importError}
                      </p>
                    ) : (
                      <p className="max-w-sm text-sm text-muted-foreground">
                        Pull your public name, title, rate, and skills straight
                        from Freelancer.com instead of typing them.
                      </p>
                    )}
                    <Button onClick={() => void importProfile()}>
                      <Download data-icon="inline-start" />
                      {importError !== null ? "Retry import" : "Fetch my profile"}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      You can also continue and fill this in later.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3.5 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    <Sparkles className="size-4 text-primary" aria-hidden />
                    What makes proposals stronger
                  </p>
                  <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                    <li className="flex items-center gap-1.5">
                      {profileImported ? (
                        <CircleCheck
                          className="size-3.5 shrink-0 text-success"
                          aria-hidden
                        />
                      ) : (
                        <CircleAlert
                          className="size-3.5 shrink-0 text-warning"
                          aria-hidden
                        />
                      )}
                      Verified profile facts{" "}
                      {profileImported
                        ? "— imported"
                        : "— add them later on Profile"}
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CircleAlert
                        className="size-3.5 shrink-0 text-warning"
                        aria-hidden
                      />
                      A writing style and one real portfolio project — optional
                      below
                    </li>
                  </ul>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ob-instructions">
                    How should proposals sound? (optional)
                  </Label>
                  <Textarea
                    id="ob-instructions"
                    rows={4}
                    value={customInstructions}
                    onChange={(event) =>
                      setCustomInstructions(event.target.value)
                    }
                    placeholder="e.g. Direct and specific. Reference relevant experience. Always end with one clarifying question."
                    className="bg-background text-[13px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Applied after your verified facts — it can never make the
                    writer invent experience.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ob-portfolio">
                    Portfolio evidence (optional)
                  </Label>
                  <Textarea
                    id="ob-portfolio"
                    rows={5}
                    value={portfolio}
                    onChange={(event) => setPortfolio(event.target.value)}
                    placeholder={"### Project name\nWhat you built:\nResult:\nLink:"}
                    className="bg-background font-mono text-[13px] leading-relaxed"
                  />
                  <p className="text-xs text-muted-foreground">
                    Real projects the writer may reference. Add only work you can
                    stand behind.
                  </p>
                </div>

                <details className="group rounded-lg border bg-background">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3.5 [&::-webkit-details-marker]:hidden">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        Job search preferences
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Skills, wants, not-wants, and scan interval.
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground group-open:hidden">
                      Show
                    </span>
                    <span className="hidden text-xs text-muted-foreground group-open:inline">
                      Hide
                    </span>
                  </summary>
                  <div className="flex flex-col gap-4 border-t p-3.5">
                    <div className="flex flex-col gap-1.5">
                      <Label>Your skills — used as job search keywords</Label>
                      <ChipEditor
                        values={skills}
                        onChange={setSkills}
                        placeholder="e.g. React"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label>Wants</Label>
                        <ChipEditor
                          values={wants}
                          onChange={setWants}
                          placeholder="e.g. dashboard"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Not-wants</Label>
                        <ChipEditor
                          values={notWants}
                          onChange={setNotWants}
                          placeholder="e.g. crypto"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="scan-interval">Scan interval</Label>
                      <Select
                        value={interval}
                        onValueChange={setIntervalSeconds}
                      >
                        <SelectTrigger
                          id="scan-interval"
                          className="w-full"
                          aria-label="Scan interval"
                        >
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
                        How often the worker polls Freelancer.com for new jobs.
                        Minimum 30 seconds.
                      </p>
                    </div>
                  </div>
                </details>

                {finishError !== null ? (
                  <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">
                    <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {finishError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="mt-4 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || finishing}
          >
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
          {step < steps.length - 1 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 0 && !accountsReady}
            >
              Continue
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button onClick={() => void finishSetup()} disabled={finishing}>
              {finishing ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : null}
              {finishing ? "Saving…" : "Finish setup"}
              {finishing ? null : <ArrowRight data-icon="inline-end" />}
            </Button>
          )}
        </div>
      </div>
    </div>
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
        <Button
          variant="outline"
          size="sm"
          onClick={onTest}
          disabled={disabled || busy}
        >
          {busy ? "Testing…" : "Verify & save"}
        </Button>
      </div>
      {test.state === "ok" && test.message !== undefined ? (
        <p className="text-xs text-muted-foreground">{test.message}</p>
      ) : null}
    </div>
  );
}
