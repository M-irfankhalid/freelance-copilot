import { Link } from "react-router";

import { ActivityFeedCard } from "@/components/dashboard/activity-feed-card";
import { JobsRequiringAttentionCard } from "@/components/dashboard/jobs-attention-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MatchQualityCard } from "@/components/dashboard/match-quality-card";
import { RecentBidsCard } from "@/components/dashboard/recent-bids-card";
import { RecentProposalsCard } from "@/components/dashboard/recent-proposals-card";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { ProposalQualityChecklist } from "@/components/dashboard/proposal-quality-checklist";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth";
import type { DashboardSnapshot } from "@/lib/types";

/** Recomputed on mount so the greeting and date context stay accurate. */
export default function DashboardPage() {
  const { data, error, isLoading } = useApi<{ snapshot: DashboardSnapshot }>(
    "/api/dashboard"
  );
  const { user } = useAuth();

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const firstName = user?.name.trim().split(/\s+/)[0] ?? "";

  const snapshot = data?.snapshot;
  const accountsReady =
    snapshot !== undefined &&
    ["freelancer", "openrouter"].every((id) =>
      snapshot.platforms.some(
        (platform) => platform.id === id && platform.status === "connected"
      )
    );

  if (isLoading && !snapshot) {
    return (
      <div className="flex flex-col gap-5 md:gap-6">
        <DashboardHeader
          greeting={greeting}
          firstName={firstName}
          dateLabel={dateLabel}
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-32 animate-pulse rounded-xl border border-border/80 bg-muted/40"
            />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-64 animate-pulse rounded-xl border border-border/80 bg-muted/40 lg:col-span-2" />
          <div className="h-64 animate-pulse rounded-xl border border-border/80 bg-muted/40" />
        </div>
      </div>
    );
  }

  if (error !== null || snapshot === undefined) {
    return (
      <div className="flex flex-col gap-5 md:gap-6">
        <DashboardHeader
          greeting={greeting}
          firstName={firstName}
          dateLabel={dateLabel}
        />
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error !== null
            ? `Failed to load your dashboard: ${error.message}`
            : "Your dashboard is not available right now."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <DashboardHeader
        greeting={greeting}
        firstName={firstName}
        dateLabel={dateLabel}
        snapshot={snapshot}
      />

      <SetupChecklist platforms={snapshot.platforms} />
      <ProposalQualityChecklist enabled={accountsReady} />

      <section
        aria-label="Key metrics"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {snapshot.kpis.map((metric) => (
          <KpiCard key={metric.id} metric={metric} />
        ))}
      </section>

      <section
        aria-label="Your pipeline"
        className="grid items-stretch gap-4 lg:grid-cols-3"
      >
        <JobsRequiringAttentionCard
          items={snapshot.jobsRequiringAttention}
          className="lg:col-span-2"
        />
        <MatchQualityCard snapshot={snapshot.matchQuality} />
      </section>

      <section
        aria-label="Recent work"
        className="grid items-stretch gap-4 lg:grid-cols-2"
      >
        <RecentProposalsCard proposals={snapshot.recentProposals} />
        <RecentBidsCard
          bids={snapshot.recentBids}
          winRate={snapshot.bidWinRate}
        />
      </section>

      <ActivityFeedCard events={snapshot.activity} />
    </div>
  );
}

function DashboardHeader({
  greeting,
  firstName,
  dateLabel,
  snapshot,
}: {
  greeting: string;
  firstName: string;
  dateLabel: string;
  snapshot?: DashboardSnapshot;
}) {
  const attention = snapshot?.jobsRequiringAttention.length ?? 0;
  const pendingValue =
    snapshot?.kpis.find((metric) => metric.id === "pending-proposals")?.value ??
    "0";
  const pending = Number.parseInt(pendingValue, 10) || 0;

  const statusParts: string[] = [];
  if (attention > 0) {
    statusParts.push(
      `${attention} ${attention === 1 ? "job needs" : "jobs need"} a decision`
    );
  }
  if (pending > 0) {
    statusParts.push(
      `${pending} ${pending === 1 ? "proposal is" : "proposals are"} waiting`
    );
  }

  return (
    <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{dateLabel}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {snapshot
            ? statusParts.length > 0
              ? statusParts.join(" · ")
              : "You're all caught up."
            : "Here is how your pipeline stands today."}
        </p>
      </div>

      {snapshot ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/jobs">Find jobs</Link>
          </Button>
          {pending > 0 ? (
            <Button asChild>
              <Link to="/proposals">
                Review {pending} {pending === 1 ? "proposal" : "proposals"}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
