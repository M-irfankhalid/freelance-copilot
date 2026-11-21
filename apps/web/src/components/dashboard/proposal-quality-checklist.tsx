import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Circle, CircleCheck, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api/hooks";

/** Dismissal is device-local; the checklist is a nudge, not a hard gate. */
const DISMISS_KEY = "freelance-copilot.proposal-quality-dismissed.v1";

interface ProfileFacts {
  name?: string | null;
  title?: string | null;
  hourlyRateLabel?: string | null;
  about?: string | null;
  skills?: string[] | null;
  customInstructions?: string | null;
  portfolioSummary?: string | null;
}

interface ProfileResponse {
  profile: ProfileFacts | null;
}

interface EngineResponse {
  samples?: unknown[] | null;
}

interface QualityStep {
  title: string;
  description: string;
  done: boolean;
  href: string;
  action: string;
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function text(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Post-connection checklist shown on the dashboard. It points at the inputs
 * that actually improve proposal quality and disappears once they are filled
 * or dismissed.
 */
export function ProposalQualityChecklist({ enabled }: { enabled: boolean }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const active = enabled && !dismissed;

  const profileApi = useApi<ProfileResponse>(active ? "/api/profile" : null);
  const engineApi = useApi<EngineResponse>(
    active ? "/api/proposal-system" : null
  );

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage can be blocked; hiding for this session is still useful.
    }
  };

  if (!active) return null;
  if (profileApi.isLoading || engineApi.isLoading) return null;
  if (profileApi.error !== null || engineApi.error !== null) return null;

  const profile = profileApi.data?.profile;
  const voiceExamples = engineApi.data?.samples?.length ?? 0;

  const steps: QualityStep[] = [
    {
      title: "Complete your profile facts",
      description: "Name, title, rate, and about.",
      done:
        text(profile?.name).length > 0 &&
        text(profile?.title).length > 0 &&
        text(profile?.hourlyRateLabel).length > 0 &&
        text(profile?.about).length > 0,
      href: "/profile",
      action: "Complete",
    },
    {
      title: "Add at least three skills",
      description: "They ground matching and proposal claims.",
      done: (profile?.skills?.length ?? 0) >= 3,
      href: "/profile",
      action: "Add skills",
    },
    {
      title: "Add portfolio evidence",
      description: "One real project the writer can reference.",
      done: text(profile?.portfolioSummary).length > 0,
      href: "/profile",
      action: "Add work",
    },
    {
      title: "Set a writing style or voice examples",
      description: "Guides tone without inventing facts.",
      done:
        text(profile?.customInstructions).length > 0 || voiceExamples > 0,
      href: "/proposal-system",
      action: "Set style",
    },
  ];

  const remaining = steps.filter((step) => !step.done).length;
  if (remaining === 0) return null;

  return (
    <section
      aria-labelledby="quality-heading"
      className="rounded-xl border border-border/80 bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="quality-heading"
            className="flex items-center gap-2 text-base font-medium"
          >
            <Sparkles className="size-4 text-primary" aria-hidden />
            Make your proposals stronger
          </h2>
          <p className="text-sm text-muted-foreground">
            {remaining === 1
              ? "One optional improvement"
              : `${remaining} optional improvements`}{" "}
            — drafts already work from your imported profile.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to="/proposal-system">
              Open proposal flow
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={dismiss}
            aria-label="Dismiss proposal quality checklist"
            title="Dismiss"
          >
            <X />
          </Button>
        </div>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((step) => (
          <li
            key={step.title}
            className="flex items-start gap-3 rounded-lg border border-border/70 p-3"
          >
            {step.done ? (
              <CircleCheck
                className="mt-0.5 size-4 shrink-0 text-success"
                aria-hidden
              />
            ) : (
              <Circle
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-sm font-medium">
                {step.title}
                <span className="sr-only">
                  {step.done ? " — complete" : " — not complete"}
                </span>
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
            {step.done ? null : (
              <Button asChild variant="ghost" size="xs" className="shrink-0">
                <Link to={step.href}>{step.action}</Link>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
