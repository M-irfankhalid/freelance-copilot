import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft, Bot, CircleCheck, Clock, Eye, FileText, Globe,
  RefreshCw, Send, Sparkles, ThumbsDown, TriangleAlert, Users,
} from "lucide-react";

import { ScoreChip } from "@/components/shared/badges";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import type { JobDetailData } from "@/lib/types";
import { Textarea } from "@/components/ui/textarea";

interface JobDetailResponse {
  job: JobDetailData;
}

interface AnalysisResponse {
  analysis: {
    relevancyScore: number;
    matchedSkills: string[];
    missingSkills: string[];
    concerns: string[];
    analysis: string;
    recommendedBid: string;
  };
}

/**
 * Full job view styled like Freelancer.com's own project page, extended with
 * the agent's grounded suggestion. Data comes from the real backend, which
 * fetches project details from Freelancer.com and stores analysis locally.
 */
export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = id !== undefined && /^\d+$/.test(id) ? Number(id) : null;
  const path = projectId !== null ? `/api/jobs/${projectId}` : null;
  const { data, error, isLoading, refetch } = useApi<JobDetailResponse>(path);
  const job = data?.job ?? null;

  const [proposalText, setProposalText] = useState("");
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [milestonePercentage, setMilestonePercentage] = useState("50");
  const [deliveryTime, setDeliveryTime] = useState("2 weeks");
  const [generatingProposal, setGeneratingProposal] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [placingBid, setPlacingBid] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [ignored, setIgnored] = useState(false);
  const [ignoreError, setIgnoreError] = useState<string | null>(null);
  const [refreshedLabel, setRefreshedLabel] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Load any saved proposal for this job so the proposal box shows what the
  // agent already wrote, and regeneration updates it in place.
  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    api<{ proposal: { id: string; content: string } | null }>(
      `/api/proposals/job/job-${projectId}`
    )
      .then((res) => {
        if (cancelled || res.proposal === null) return;
        setProposalId(res.proposal.id);
        setProposalText(res.proposal.content);
      })
      .catch(() => {
        // Non-fatal: if the lookup fails the proposal box just starts empty.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (projectId === null) {
    return <JobNotFound />;
  }

  if (isLoading && job === null) {
    return <JobDetailSkeleton />;
  }

  if (error !== null || job === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <p className="text-sm text-muted-foreground">
          {error !== null ? messageFor(error) : "This job could not be found."}
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

  const runAnalyze = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      await api<AnalysisResponse>(`/api/jobs/${projectId}/analyze`, {
        method: "POST",
      });
      refetch();
    } catch (cause) {
      setAnalyzeError(messageFor(cause));
    } finally {
      setAnalyzing(false);
    }
  };

  const runIgnore = async () => {
    setIgnoreError(null);
    try {
      await api<{ ok: true }>(`/api/jobs/${projectId}/ignore`, {
        method: "POST",
      });
      setIgnored(true);
      refetch();
    } catch (cause) {
      setIgnoreError(messageFor(cause));
    }
  };

  const generateProposalWithAI = async () => {
    if (generatingProposal || !projectId) return;
    setGeneratingProposal(true);
    setProposalError(null);
    try {
      if (proposalId !== null) {
        // A proposal already exists for this job — regenerate it in place.
        // Calling /api/proposals/generate again would return a 409 conflict.
        const res = await api<{ proposal: { content: string; competitorNote?: string } }>(
          `/api/proposals/${proposalId}/regenerate`,
          {
            method: "POST",
            body: {
              projectType: job.projectType,
              bidPeriod: job.bidPeriod,
              upgrades: job.upgrades,
              competition: job.competition,
            },
          }
        );
        setProposalText(res.proposal.content);
      } else {
        const response = await api<{
          proposal: { id: string; content: string; competitorNote?: string };
        }>(`/api/proposals/generate`, {
          method: "POST",
          body: {
            jobId: `job-${projectId}`,
            projectId,
            jobTitle: job.title,
            clientName: job.client,
            description: job.description,
            jobSkills: job.skills,
            bidStats: {
              bidCount: job.bidCount,
              avgBid: job.avgBidLabel,
              highBid: job.insights.highBidLabel,
              lowBid: job.insights.lowBidLabel,
            },
            projectType: job.projectType,
            bidPeriod: job.bidPeriod,
            upgrades: job.upgrades,
            competition: job.competition,
          },
        });
        setProposalId(response.proposal.id);
        setProposalText(response.proposal.content);
      }
    } catch (cause) {
      setProposalError(messageFor(cause));
    } finally {
      setGeneratingProposal(false);
    }
  };

  const placeBid = async () => {
    if (placingBid || !projectId || !proposalText.trim()) return;
    setPlacingBid(true);
    setBidError(null);
    try {
      const bidValue = bidAmount ? parseInt(bidAmount.replace(/[^0-9]/g, ""), 10) || 0 : 0;
      const milestone = Number(milestonePercentage);
      if (!Number.isFinite(milestone) || milestone < 20 || milestone > 100) {
        setBidError("Milestone percentage must be between 20 and 100.");
        return;
      }

      // 1. Reuse the saved proposal if one exists; otherwise create a draft
      //    from the current text. Reusing avoids the duplicate-proposal 409.
      let pid = proposalId;
      if (pid === null) {
        const proposalRes = await api<{ proposal: { id: string } }>(`/api/proposals`, {
          method: "POST",
          body: {
            jobId: `job-${projectId}`,
            projectId,
            jobTitle: job.title,
            client: job.client,
            content: proposalText,
            bidAmount: bidValue > 0 ? bidValue : undefined,
          },
        });
        pid = proposalRes.proposal.id;
        setProposalId(pid);
      } else {
        // Save any edits made in the box before bidding.
        await api<{ ok: true }>(`/api/proposals/${pid}`, {
          method: "PUT",
          body: { content: proposalText },
        });
      }

      // 2. Approve the proposal so it can be submitted as a bid.
      await api<{ ok: true }>(`/api/proposals/${pid}/status`, {
        method: "PUT",
        body: { status: "approved" },
      });

      // 3. Place the actual bid on Freelancer.com via the approved proposal.
      await api<{ bid: { id: string } }>(`/api/bids`, {
        method: "POST",
        body: {
          proposalId: pid,
          amount: bidValue,
          period: job.bidPeriod ?? 7,
          milestonePercentage: milestone,
        },
      });

      alert("Bid placed! You can track it in the Bids page.");
    } catch (cause) {
      setBidError(messageFor(cause));
    } finally {
      setPlacingBid(false);
    }
  };

  const refreshInsights = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refetch();
      setRefreshedLabel("just now");
    } finally {
      setRefreshing(false);
    }
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
              {job.projectType ? (
                <span className="inline-flex items-center gap-1">
                  <Badge variant="outline" className="font-normal text-xs">
                    {job.projectType === "fixed" ? "Fixed price" : "Hourly"}
                  </Badge>
                </span>
              ) : null}
              {job.bidPeriod ? (
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock aria-hidden />
                  {job.bidPeriod} day{job.bidPeriod > 1 ? "s" : ""} bid period
                </span>
              ) : null}
              <span>Project #{job.projectId}</span>
              <a
                href={`https://www.freelancer.com/projects/${job.projectId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Show on Freelancer
              </a>
            </div>
          </div>
          {job.matchScore !== undefined && job.matchScore > 0 ? (
            <ScoreChip score={job.matchScore} />
          ) : null}
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
                <dt className="text-muted-foreground">Country</dt>
                <dd>{job.clientInfo.country}</dd>
                <dt className="text-muted-foreground">Member since</dt>
                <dd>{job.clientInfo.memberSinceLabel}</dd>
                <dt className="text-muted-foreground">Projects posted</dt>
                <dd>{job.clientInfo.projectsPosted}</dd>
                <dt className="text-muted-foreground">Hire rate</dt>
                <dd>{job.clientInfo.hireRateLabel}</dd>
                {job.clientInfo.reputationScore !== undefined &&
                job.clientInfo.reputationScore !== null ? (
                  <>
                    <dt className="text-muted-foreground">Reputation</dt>
                    <dd>{Math.round(job.clientInfo.reputationScore * 100)}%</dd>
                  </>
                ) : null}
              </dl>
            </CardContent>
          </Card>
          {/* proposal editor */}
          <div className="flex flex-col gap-3">
            {/* Proposal composer — inline, does not navigate away */}
            <Card className="border-primary/25 bg-card ring-primary/15">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="size-4 text-primary" aria-hidden />
                  Write or generate proposal
                </CardTitle>
                <CardDescription>
                  {proposalId !== null
                    ? "Your saved proposal is shown below — edit it, or regenerate it in place."
                    : "Compose directly here. The AI can generate a proposal using your profile facts and this job's details."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {/* Bid amount, milestone and time duration */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="bid-amount" className="text-xs font-medium">Bid amount ($)</Label>
                    <Input
                      id="bid-amount"
                      type="number"
                      placeholder="e.g. 2500"
                      className="h-9"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="milestone-percentage" className="text-xs font-medium">
                      Milestone % <span className="text-muted-foreground">(20–100)</span>
                    </Label>
                    <Input
                      id="milestone-percentage"
                      type="number"
                      min={20}
                      max={100}
                      step={1}
                      placeholder="e.g. 50"
                      className="h-9"
                      value={milestonePercentage}
                      onChange={(e) => setMilestonePercentage(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="delivery-time" className="text-xs font-medium">Delivery time</Label>
                    <div className="relative h-9">
                      <Clock className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                      <Input
                        id="delivery-time"
                        placeholder="e.g. 2 weeks"
                        className="h-9 pl-8"
                        value={deliveryTime}
                        onChange={(e) => setDeliveryTime(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Proposal text area */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="proposal-text" className="text-xs font-medium">Proposal text</Label>
                  <Textarea
                    id="proposal-text"
                    rows={6}
                    placeholder="Write your proposal here, or click 'Generate with AI' below..."
                    className="resize-none text-sm leading-relaxed"
                    value={proposalText}
                    onChange={(e) => setProposalText(e.target.value)}
                  />
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={generateProposalWithAI} disabled={generatingProposal}>
                    <Bot data-icon="inline-start" className={generatingProposal ? "animate-spin" : "size-4"} />
                    {generatingProposal
                      ? "Generating…"
                      : proposalId !== null
                        ? "Regenerate with AI"
                        : "Generate with AI"}
                  </Button>
                  <Button size="sm" onClick={placeBid} disabled={placingBid}>
                    <Send data-icon="inline-start" className="size-4" />
                    {placingBid ? "Submitting…" : "Place bid"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Proposal and bid errors */}
            {proposalError ? (
              <p className="text-sm text-destructive">{proposalError}</p>
            ) : null}
            {bidError ? (
              <p className="text-sm text-destructive">{bidError}</p>
            ) : null}
          </div>
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
                {job.matchScore !== undefined && job.matchScore > 0 ? (
                  <ScoreChip score={job.matchScore} />
                ) : (
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    Not analyzed
                  </Badge>
                )}
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
                  {job.suggestion.reasons.length > 0 ? (
                    job.suggestion.reasons.map((reason) => (
                      <li key={reason} className="flex gap-2 text-sm">
                        <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                        {reason}
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-muted-foreground">No reasons yet.</li>
                  )}
                </ul>
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Watch out for
                </p>
                <ul className="flex flex-col gap-1.5">
                  {job.suggestion.concerns.length > 0 ? (
                    job.suggestion.concerns.map((concern) => (
                      <li key={concern} className="flex gap-2 text-sm">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                        {concern}
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-muted-foreground">No concerns flagged.</li>
                  )}
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

              {analyzeError ? (
                <p className="text-sm text-destructive">{analyzeError}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Bid insights</CardTitle>
              <CardDescription>
                Updated {refreshedLabel ?? job.postedLabel}. Refresh to re-pull live stats.
              </CardDescription>
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void refreshInsights()}
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
            <Button size="lg" onClick={runAnalyze} disabled={analyzing}>
              <Sparkles data-icon="inline-start" className={analyzing ? "animate-pulse" : undefined} />
              {analyzing ? "Analyzing…" : job.matchScore !== undefined && job.matchScore > 0 ? "Re-analyze" : "Analyze"}
            </Button>
          <div className="flex flex-col gap-3">
            {/* Competitor proposal box — aggregate stats, never invented texts */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-4 text-muted-foreground" aria-hidden />
                  Competitor proposals
                </CardTitle>
                <CardDescription>
                  Aggregate bid statistics — never invented proposal texts. Updated {refreshedLabel ?? job.postedLabel}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {job.competition ? (
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase mb-2">Competition summary</p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg border bg-background p-2">
                        <p className="text-base font-semibold tabular-nums">{String(job.competition.bidCount)}</p>
                        <p className="text-xs text-muted-foreground">Bids</p>
                      </div>
                      <div className="rounded-lg border bg-background p-2">
                        <p className="text-base font-semibold tabular-nums">{job.competition.minBid !== null ? `$${job.competition.minBid}` : "—"}</p>
                        <p className="text-xs text-muted-foreground">Lowest</p>
                      </div>
                      <div className="rounded-lg border bg-background p-2">
                        <p className="text-base font-semibold tabular-nums">{job.competition.maxBid !== null ? `$${job.competition.maxBid}` : "—"}</p>
                        <p className="text-xs text-muted-foreground">Highest</p>
                      </div>
                    </div>
                    {job.competition.medianBid !== null ? (
                      <p className="mt-2 text-xs text-muted-foreground">Median bid: <span className="font-medium text-foreground">${job.competition.medianBid}</span></p>
                    ) : null}
                    {job.competition.isCheapest ? (
                      <p className="mt-2 flex items-center gap-1 text-xs text-success">
                        Your current bid is the cheapest
                      </p>
                    ) : null}
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                      {job.competition.bidCount > 0
                        ? `${job.competition.bidCount} bids have been placed on this project. The average bid is ${job.insights.avgBidLabel}. To stand out, reference specific skills from the job requirements and mention relevant experience from your profile.`
                        : "No bids have been placed yet. Being an early bidder can increase visibility."}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase mb-2">Bid insights</p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg border bg-background p-2">
                        <p className="text-base font-semibold tabular-nums">{String(job.bidCount)}</p>
                        <p className="text-xs text-muted-foreground">Bids</p>
                      </div>
                      <div className="rounded-lg border bg-background p-2">
                        <p className="text-base font-semibold tabular-nums">{job.insights.avgBidLabel}</p>
                        <p className="text-xs text-muted-foreground">Average bid</p>
                      </div>
                      <div className="rounded-lg border bg-background p-2">
                        <p className="text-base font-semibold tabular-nums">{job.insights.highBidLabel}</p>
                        <p className="text-xs text-muted-foreground">Top bid</p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                      {job.bidCount > 0
                        ? `${job.bidCount} bids have been placed on this project. The average bid is ${job.insights.avgBidLabel}. To stand out, reference specific skills from the job requirements and mention relevant experience from your profile.`
                        : "No bids have been placed yet. Being an early bidder can increase visibility."}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Button
              variant="destructive"
              disabled={ignored}
              onClick={runIgnore}
            >
              <ThumbsDown data-icon="inline-start" />
              {ignored ? "Ignored" : "Ignore this job"}
            </Button>
            {ignoreError ? (
              <p className="text-sm text-destructive">{ignoreError}</p>
            ) : null}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function JobNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <p className="text-sm text-muted-foreground">Invalid project id.</p>
      <Button variant="outline" asChild>
        <Link to="/jobs">
          <ArrowLeft data-icon="inline-start" />
          Back to jobs
        </Link>
      </Button>
    </div>
  );
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) {
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
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
