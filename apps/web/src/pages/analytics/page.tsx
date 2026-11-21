import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { KpiCard } from "@/components/dashboard/kpi-card";
import { BarChart, HBarList, OutcomeBreakdown } from "@/components/analytics/charts";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
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
 * Simple, honest numbers: what went out, what came back. Powered by database
 * aggregates.
 */
export default function AnalyticsPage() {
  const { data: snapshot, error, isLoading } = useApi<AnalyticsApiResponse>("/api/analytics");

  if (isLoading && !snapshot) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader
          title="Analytics"
          description="How your bidding is going, straight from your saved data."
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
          description="How your bidding is going, straight from your saved data."
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

  const { won, lost, inReview } = snapshot.outcomes;
  const totalBids = won + lost + inReview;
  const awaiting =
    snapshot.proposalsByStatus.find((point) => point.label === "Awaiting approval")?.value ?? 0;

  const nextStep =
    awaiting > 0
      ? {
          title: `${awaiting} proposal${awaiting === 1 ? "" : "s"} need review`,
          description: "Approve or edit the draft before it is queued to send.",
          to: "/proposals",
          label: "Review proposals",
        }
      : inReview > 0
        ? {
            title: `${inReview} bid${inReview === 1 ? "" : "s"} in review`,
            description: "Clients have your proposals. Keep an eye on your inbox.",
            to: "/bids",
            label: "View bids",
          }
        : totalBids === 0
          ? {
              title: "No bids yet",
              description: "Find a strong match, approve the draft, and send your first bid.",
              to: "/matches",
              label: "Browse matches",
            }
          : {
              title: "All caught up",
              description: "Nothing needs attention right now. Find new work when you are ready.",
              to: "/jobs",
              label: "Find jobs",
            };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Analytics"
        description="How your bidding is going, straight from your saved data."
      />

      <section
        aria-label="Key metrics"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      >
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
            <CardDescription>Across all submitted bids</CardDescription>
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
            <CardDescription>Your current proposal pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            {snapshot.proposalsByStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">No proposals drafted yet.</p>
            ) : (
              <HBarList data={snapshot.proposalsByStatus} />
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Next step</CardTitle>
            <CardDescription>What to do with these numbers</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{nextStep.title}</p>
              <p className="text-sm text-muted-foreground">{nextStep.description}</p>
            </div>
            <Button variant="outline" size="sm" asChild className="self-start">
              <Link to={nextStep.to}>
                {nextStep.label}
                <ArrowRight data-icon="inline-end" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
