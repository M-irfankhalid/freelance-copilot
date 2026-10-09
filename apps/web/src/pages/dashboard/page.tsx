import { ActivityFeedCard } from "@/components/dashboard/activity-feed-card";
import { ApiStatusChip } from "@/components/dashboard/api-status-chip";
import { JobsRequiringAttentionCard } from "@/components/dashboard/jobs-attention-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { BidAmountSettingsCard } from "@/components/dashboard/bid-amount-settings-card";
import { MatchQualityCard } from "@/components/dashboard/match-quality-card";
import { PlatformStatusCard } from "@/components/dashboard/platform-status-card";
import { RecentBidsCard } from "@/components/dashboard/recent-bids-card";
import { RecentProposalsCard } from "@/components/dashboard/recent-proposals-card";
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

  if (isLoading && !snapshot) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting}, {firstName}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {dateLabel} · Here is how your pipeline stands today.
            <ApiStatusChip />
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-32 animate-pulse rounded-xl border bg-muted/40"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    );
  }

  if (error !== null || snapshot === undefined) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting}, {firstName}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {dateLabel} · Here is how your pipeline stands today.
            <ApiStatusChip />
          </p>
        </header>
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error !== null
            ? `Failed to load your dashboard: ${error.message}`
            : "Your dashboard is not available right now."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}, {firstName}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {dateLabel} · Here is how your pipeline stands today.
          <ApiStatusChip />
        </p>
      </header>

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {snapshot.kpis.map((metric) => (
          <KpiCard key={metric.id} metric={metric} />
        ))}
      </section>

      <section
        aria-label="Pipeline overview"
        className="grid items-stretch gap-4 lg:grid-cols-3"
      >
        <JobsRequiringAttentionCard
          items={snapshot.jobsRequiringAttention}
          className="lg:col-span-2"
        />
        <MatchQualityCard snapshot={snapshot.matchQuality} />
        {snapshot.bidAmount !== null && (
          <BidAmountSettingsCard bidAmount={snapshot.bidAmount} />
        )}
        <RecentProposalsCard
          proposals={snapshot.recentProposals}
          className="lg:col-span-2"
        />
        <PlatformStatusCard platforms={snapshot.platforms} />
        <RecentBidsCard bids={snapshot.recentBids} winRate={snapshot.bidWinRate} />
        <ActivityFeedCard events={snapshot.activity} className="lg:col-span-2" />
      </section>
    </div>
  );
}
