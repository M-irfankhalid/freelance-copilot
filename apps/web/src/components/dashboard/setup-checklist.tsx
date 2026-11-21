import { Link } from "react-router";
import { ArrowRight, CircleCheck, Circle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PlatformConnection } from "@/lib/types";

type SetupStep = {
  title: string;
  description: string;
  done: boolean;
  href: string;
  action: string;
};

/**
 * Two-step setup for a fresh install. It disappears once both credentials are
 * connected, so the dashboard stays quiet for returning users.
 */
export function SetupChecklist({
  platforms,
}: {
  platforms: PlatformConnection[];
}) {
  const connected = (id: PlatformConnection["id"]) =>
    platforms.find((platform) => platform.id === id)?.status === "connected";

  const steps: SetupStep[] = [
    {
      title: "Connect your Freelancer.com token",
      description: "Required to find jobs and place bids on your account.",
      done: connected("freelancer"),
      href: "/platforms",
      action: "Connect",
    },
    {
      title: "Add your OpenRouter key",
      description: "The agent uses it to score jobs and draft proposals.",
      done: connected("openrouter"),
      href: "/platforms",
      action: "Add key",
    },
  ];

  if (steps.every((step) => step.done)) {
    return null;
  }

  const remaining = steps.filter((step) => !step.done).length;

  return (
    <section
      aria-labelledby="setup-heading"
      className="rounded-xl border border-border/80 bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="setup-heading" className="text-base font-medium">
            Finish setup
          </h2>
          <p className="text-sm text-muted-foreground">
            {remaining === 1
              ? "One step left before the agent can start."
              : "Two quick steps before the agent can start."}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/onboarding">
            Open setup guide
            <ArrowRight data-icon="inline-end" aria-hidden />
          </Link>
        </Button>
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
