import { ActivityFeedCard } from "@/components/dashboard/activity-feed-card";
import { JobsRequiringAttentionCard } from "@/components/dashboard/jobs-attention-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MatchQualityCard } from "@/components/dashboard/match-quality-card";
import { PlatformStatusCard } from "@/components/dashboard/platform-status-card";
import { RecentBidsCard } from "@/components/dashboard/recent-bids-card";
import { RecentProposalsCard } from "@/components/dashboard/recent-proposals-card";
import { getDashboardSnapshot } from "@/lib/data/dashboard";

/** Recomputed on mount so the greeting and date context stay accurate. */
export default function DashboardPage() {
  const snapshot = getDashboardSnapshot();

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

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}, Muhammad
        </h1>
        <p className="text-sm text-muted-foreground">
          {dateLabel} · Here is how your pipeline stands today.
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
