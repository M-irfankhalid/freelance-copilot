import { KpiCard } from "@/components/dashboard/kpi-card";
import {
  BarChart,
  HBarList,
  OutcomeBreakdown,
} from "@/components/analytics/charts";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { analytics } from "@/lib/data/platforms";

/** Simple, honest numbers: what went out, what came back. */
export default function AnalyticsPage() {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Analytics"
        description="Last 30 days of bidding activity across your workspace."
      />

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {analytics.kpis.map((metric) => (
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
            <BarChart data={analytics.bidsPerWeek} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bid outcomes</CardTitle>
            <CardDescription>All bids in the current window</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col justify-center gap-6">
            <OutcomeBreakdown
              won={analytics.outcomes.won}
              lost={analytics.outcomes.lost}
              inReview={analytics.outcomes.inReview}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Proposals by status</CardTitle>
            <CardDescription>Where every draft ended up</CardDescription>
          </CardHeader>
          <CardContent>
            <HBarList data={analytics.proposalsByStatus} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What is working</CardTitle>
            <CardDescription>Signals from your last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2.5 text-sm leading-relaxed text-muted-foreground">
              <li className="border-l-2 border-success pl-3">
                Bids placed within the first hour of a posting win roughly twice as
                often — auto-bidding on strong matches exploits this.
              </li>
              <li className="border-l-2 border-primary pl-3">
                Your shortlisted proposals average $2,050; declined ones average
                $3,150. Consider tightening the max bid bound.
              </li>
              <li className="border-l-2 border-warning pl-3">
                Laravel and WordPress jobs respond most; scraping-heavy jobs almost
                never reply — already in your not-wants.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
