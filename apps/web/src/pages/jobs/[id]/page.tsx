import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  Bot,
  CircleCheck,
  Eye,
  FileText,
  Globe,
  Paperclip,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  TriangleAlert,
  Trophy,
  Users,
} from "lucide-react";

import { MatchBandBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getJobDetail } from "@/lib/data/jobs";

/**
 * Full job view styled like Freelancer.com's own project page, extended with
 * the agent's grounded suggestion and a cached bid-insights card that only
 * refreshes on demand.
 */
export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const job = id ? getJobDetail(id) : undefined;

  // Cached insights age — refresh simulates one fresh API call.
  const [refreshedLabel, setRefreshedLabel] = useState(job?.insights.refreshedLabel ?? "");
  const [refreshing, setRefreshing] = useState(false);
  const [ignored, setIgnored] = useState(false);

  if (!job) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <p className="text-sm text-muted-foreground">
          This job could not be found. It may have been removed by the client.
        </p>
        <Button variant="outline" asChild>
          <Link to="/jobs">
            <ArrowLeft data-icon="inline-start" />
            Back to jobs
          </Link>
        </Button>
      </div>
    );
  }

  const refreshInsights = () => {
    if (refreshing) return;
    setRefreshing(true);
    window.setTimeout(() => {
      setRefreshedLabel("just now");
      setRefreshing(false);
    }, 900);
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground" asChild>
          <Link to="/jobs">
            <ArrowLeft data-icon="inline-start" />
            Jobs
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{job.title}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{job.budgetLabel}</span>
              <span className="inline-flex items-center gap-1">
                <Globe aria-hidden />
                {job.clientCountry}
              </span>
              <span className="inline-flex items-center gap-1">
                <Eye aria-hidden />
                Posted {job.postedLabel}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users aria-hidden />
                {job.bidCount} bids · avg {job.avgBidLabel}
              </span>
              <span>Project #{job.projectId}</span>
            </div>
          </div>
          {job.matchScore !== undefined ? <ScoreHeader score={job.matchScore} /> : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Project description</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 leading-relaxed text-foreground/90">
              {job.description.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Required skills</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {job.skills.map((skill) => (
                <Badge key={skill} variant="secondary" className="font-normal">
                  {skill}
                </Badge>
              ))}
              {job.skills.length === 0 ? (
                <p className="text-sm text-muted-foreground">No skills listed yet.</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>About the client</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
                <dt className="text-muted-foreground">Member since</dt>
                <dd>{job.clientInfo.memberSinceLabel}</dd>
                <dt className="text-muted-foreground">Projects posted</dt>
                <dd>{job.clientInfo.projectsPosted}</dd>
                <dt className="text-muted-foreground">Hire rate</dt>
                <dd>{job.clientInfo.hireRateLabel}</dd>
                <dt className="text-muted-foreground">Payment</dt>
                <dd className="inline-flex items-center gap-1 text-success">
                  <CircleCheck aria-hidden className="size-4" />
                  Verified
                </dd>
              </dl>
            </CardContent>
          </Card>

          {job.attachments.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Attachments</CardTitle>
                <CardDescription>
                  The agent can download and inspect these during analysis.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col divide-y">
                {job.attachments.map((file) => (
                  <div key={file.name} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                    <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate font-mono text-sm">{file.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {file.sizeLabel}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-[4.5rem]">
          <Card className="border-primary/25 bg-primary/[0.03] ring-primary/15">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" aria-hidden />
                Agent suggestion
              </CardTitle>
              <CardAction>
                <MatchBandBadge band={verdictToBand(job.suggestion.verdict)} />
              </CardAction>
              <CardDescription>{job.suggestion.summary}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Recommended bid range
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">
                  {job.suggestion.recommendedBidLabel}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Why it fits
                </p>
                <ul className="flex flex-col gap-1.5">
                  {job.suggestion.reasons.map((reason) => (
                    <li key={reason} className="flex gap-2 text-sm">
                      <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Watch out for
                </p>
                <ul className="flex flex-col gap-1.5">
                  {job.suggestion.concerns.map((concern) => (
                    <li key={concern} className="flex gap-2 text-sm">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                      {concern}
                    </li>
                  ))}
                </ul>
              </div>

              {job.suggestion.competitorNote ? (
                <>
                  <Separator />
                  <div className="flex gap-2.5">
                    <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {job.suggestion.competitorNote}
                    </p>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Bid insights</CardTitle>
              <CardDescription>
                Updated {refreshedLabel}. Not fetched on page load — refresh on demand.
              </CardDescription>
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={refreshInsights}
                  disabled={refreshing}
                  aria-label="Refresh bid insights"
                >
                  <RefreshCw className={refreshing ? "animate-spin" : undefined} />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Bids", value: String(job.insights.bidCount) },
                { label: "Average", value: job.insights.avgBidLabel },
                { label: "Top bid", value: job.insights.highBidLabel },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border p-2">
                  <p className="text-base font-semibold tabular-nums">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <Button size="lg" asChild>
              <Link to="/proposals?compose=1">
                <FileText data-icon="inline-start" />
                Generate proposal
              </Link>
            </Button>
            <Button
              variant="destructive"
              disabled={ignored}
              onClick={() => setIgnored(true)}
            >
              <ThumbsDown data-icon="inline-start" />
              {ignored ? "Ignored" : "Ignore this job"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreHeader({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2">
      <Trophy className="size-4 text-warning" aria-hidden />
      <div className="leading-tight">
        <p className="text-lg font-semibold tabular-nums">{score}</p>
        <p className="text-xs text-muted-foreground">match score</p>
      </div>
    </div>
  );
}

function verdictToBand(verdict: "strong" | "good" | "fair" | "poor") {
  return verdict === "poor" ? "fair" : verdict;
}

// Skeleton export kept for route-level Suspense parity with the dashboard.
export function JobDetailSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Skeleton className="h-96 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
