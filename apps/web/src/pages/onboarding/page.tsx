import { useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CircleCheck,
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
import { openRouter as openRouterData, platformCredentials } from "@/lib/data/platforms";
import { profile as importedProfile } from "@/lib/data/profile";
import { cn } from "@/lib/utils";

/**
 * First-run setup: credentials with real test actions later, profile import,
 * then relevancy preferences and scan interval. Every backend call here is
 * mocked with a short delay so the flow feels real.
 */

const steps = [
  { id: 0, title: "Welcome", icon: Bot },
  { id: 1, title: "Freelancer.com", icon: PlugZap },
  { id: 2, title: "OpenRouter", icon: KeyRound },
  { id: 3, title: "Profile", icon: UserRound },
  { id: 4, title: "Preferences", icon: SlidersHorizontal },
] as const;

type TestState = "idle" | "testing" | "ok" | "failed";

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Step 1 — Freelancer token
  const [freelancerToken, setFreelancerToken] = useState("");
  const [freelancerTest, setFreelancerTest] = useState<TestState>("idle");

  // Step 2 — OpenRouter key + model
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [openRouterTest, setOpenRouterTest] = useState<TestState>("idle");
  const [modelId, setModelId] = useState(openRouterData.selectedModelId);

  // Step 3 — profile import
  const [profileImported, setProfileImported] = useState(false);
  const [importing, setImporting] = useState(false);

  // Step 4 — preferences
  const [skills, setSkills] = useState<string[]>([]);
  const [wants, setWants] = useState<string[]>([]);
  const [notWants, setNotWants] = useState<string[]>([]);
  const [interval, setIntervalSeconds] = useState("60");

  const runTest = (
    state: TestState,
    done: (next: TestState) => void
  ) => {
    if (state === "testing") return;
    done("testing");
    window.setTimeout(() => done("ok"), 900);
  };

  const importProfile = () => {
    setImporting(true);
    window.setTimeout(() => {
      setSkills(importedProfile.skills);
      setWants(importedProfile.wants);
      setNotWants(importedProfile.notWants);
      setProfileImported(true);
      setImporting(false);
    }, 1100);
  };

  return (
    <div className="flex min-h-svh flex-col items-center gap-8 bg-muted/40 p-4 py-10">
      <div className="w-full max-w-xl">
        {/* Stepper */}
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
                      setFreelancerTest("idle");
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Profile → Account settings → API. Stored encrypted and never shown again.
                  </p>
                </div>
                <TestRow
                  state={freelancerTest}
                  disabled={freelancerToken.trim().length === 0}
                  okLabel="Token valid — scopes verified"
                  onTest={() =>
                    runTest(freelancerTest, (next) => setFreelancerTest(next))
                  }
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
                      value={openRouterKey}
                      onChange={(event) => {
                        setOpenRouterKey(event.target.value);
                        setOpenRouterTest("idle");
                      }}
                    />
                  </div>
                  <TestRow
                    state={openRouterTest}
                    disabled={openRouterKey.trim().length === 0}
                    okLabel={`Key valid — ${openRouterData.creditLabel}`}
                    onTest={() =>
                      runTest(openRouterTest, (next) => setOpenRouterTest(next))
                    }
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>AI model</Label>
                  <Select value={modelId} onValueChange={setModelId}>
                    <SelectTrigger className="w-full" aria-label="Select model">
                      <SelectValue placeholder="Choose a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {openRouterData.models.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.label} · {model.contextLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Used for analysis, matching, and proposals. Changeable anytime on Platforms.
                  </p>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="flex flex-col gap-4">
                {profileImported ? (
                  <div className="rounded-lg border p-3.5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CircleCheck className="size-4 text-success" aria-hidden />
                        <p className="text-sm font-medium">
                          Imported @{importedProfile.freelancerUsername}
                        </p>
                      </div>
                      <ConnectionBadge status="connected" />
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                      <dt className="text-muted-foreground">Title</dt>
                      <dd>{importedProfile.title}</dd>
                      <dt className="text-muted-foreground">Rate</dt>
                      <dd>{importedProfile.hourlyRateLabel}</dd>
                      <dt className="text-muted-foreground">Skills</dt>
                      <dd>{importedProfile.skills.length} found</dd>
                    </dl>
                    <p className="mt-3 text-xs text-muted-foreground">
                      You can enrich everything manually on the Profile page after setup.
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
                  <ChipEditor
                    values={skills}
                    onChange={setSkills}
                    placeholder="e.g. React"
                  />
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
              disabled={(step === 1 && freelancerTest !== "ok") || (step === 2 && openRouterTest !== "ok")}
            >
              Continue
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button onClick={() => navigate("/dashboard")}>
              Finish setup
              <ArrowRight data-icon="inline-end" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const stepDescriptions = [
  "Five quick steps and the agent starts working for you.",
  "Bring your own credential. We verify it with one lightweight call before saving anything.",
  "Your AI budget lives here. Pick whichever model you want the agent to think with.",
  "The agent only knows what this profile says — it will never invent experience or skills.",
  "Tell the agent what to look for, what to avoid, and how often to look.",
];

function WelcomeStep() {
  const freelancer = platformCredentials.find((c) => c.id === "freelancer");
  return (
    <ul className="flex flex-col gap-3 text-sm">
      {[freelancer?.name ?? "Freelancer.com", "OpenRouter"].map((name) => (
        <li key={name} className="flex items-center gap-2.5 rounded-lg border p-3">
          <PlugZap className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Connect your own {name} credentials — stored encrypted, tested before saving.
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
  state,
  disabled,
  okLabel,
  onTest,
}: {
  state: TestState;
  disabled: boolean;
  okLabel: string;
  onTest: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        {state === "ok" ? (
          <>
            <CircleCheck className="size-4 text-success" aria-hidden />
            <span>{okLabel}</span>
          </>
        ) : state === "failed" ? (
          <>
            <CircleCheck className="size-4 text-destructive" aria-hidden />
            <span>Test failed — check the value and try again.</span>
          </>
        ) : state === "testing" ? (
          <span className="text-muted-foreground">Calling API…</span>
        ) : (
          <span className="text-muted-foreground">Not verified yet</span>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onTest}
        disabled={disabled || state === "testing"}
      >
        {state === "testing" ? "Testing…" : "Test connection"}
      </Button>
    </div>
  );
}
