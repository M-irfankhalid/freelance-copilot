import { KpiCard } from "@/components/dashboard/kpi-card";
import { BarChart, HBarList, OutcomeBreakdown } from "@/components/analytics/charts";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/lib/api/hooks";
import { ApiError, NetworkError } from "@/lib/api/client";
import type { AnalyticsSnapshot } from "@/lib/types";

interface AnalyticsApiResponse {
  kpis: AnalyticsSnapshot["kpis"];
  bidsPerWeek: AnalyticsSnapshot["bidsPerWeek"];
  outcomes: AnalyticsSnapshot["outcomes"];
  proposalsByStatus: AnalyticsSnapshot["proposalsByStatus"];
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) {
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
}

/**
 * Simple, honest numbers: what went out, what came back. Powered by real DB
 * aggregates — no mock data.
 */
export default function AnalyticsPage() {
  const { data: snapshot, error, isLoading } = useApi<AnalyticsApiResponse>("/api/analytics");

  if (isLoading && !snapshot) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader
          title="Analytics"
          description="Aggregated metrics from your bidding activity."
        />
        <Card size="sm">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Loading analytics…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader
          title="Analytics"
          description="Aggregated metrics from your bidding activity."
        />
        <Card size="sm">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">Failed to load analytics: {messageFor(error)}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!snapshot) return null;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Analytics"
        description="Aggregated metrics from your bidding activity."
      />

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {snapshot.kpis.map((metric) => (
          <KpiCard key={metric.id} metric={metric} />
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <Card>
          <CardHeader>
            <CardTitle>Bids per week</CardTitle>
            <CardDescription>Submitted bids over the last eight weeks</CardDescription>
          </CardHeader>
          <CardContent>
            {snapshot.bidsPerWeek.every((p) => p.value === 0) ? (
              <p className="text-sm text-muted-foreground">No bids placed in the last 8 weeks.</p>
            ) : (
              <BarChart data={snapshot.bidsPerWeek} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bid outcomes</CardTitle>
            <CardDescription>All submitted bids</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col justify-center gap-6">
            <OutcomeBreakdown
              won={snapshot.outcomes.won}
              lost={snapshot.outcomes.lost}
              inReview={snapshot.outcomes.inReview}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Proposals by status</CardTitle>
            <CardDescription>Where every draft ended up</CardDescription>
          </CardHeader>
          <CardContent>
            {snapshot.proposalsByStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">No proposals drafted yet.</p>
            ) : (
              <HBarList data={snapshot.proposalsByStatus} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity summary</CardTitle>
            <CardDescription>Snapshot of your last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2.5 text-sm leading-relaxed text-muted-foreground">
              <li className="border-l-2 border-success pl-3">
                {snapshot.outcomes.won} project(s) won ·
                {snapshot.proposalsByStatus.find((p) => p.label === "Won")?.value ?? 0} proposals marked as won.
              </li>
              <li className="border-l-2 border-primary pl-3">
                {snapshot.proposalsByStatus.length} distinct proposal statuses across your pipeline.
              </li>
              <li className="border-l-2 border-warning pl-3">
                {snapshot.bidsPerWeek.reduce((sum, p) => sum + p.value, 0)} total bids placed over the last 8 weeks.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
