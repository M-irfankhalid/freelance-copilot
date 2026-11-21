import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  CircleCheck,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  ThumbsDown,
  TriangleAlert,
} from "lucide-react";

import { BidStateBadge, MatchBandBadge, ScoreChip } from "@/components/shared/badges";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import { useToast } from "@/components/ui/toast";
import type { MatchItem } from "@/lib/types";

/**
 * Jobs the relevancy filter passed and AI scored, strongest first.
 * Each card explains itself: matched skills, gaps, concerns.
 */

export default function MatchesPage() {
  const { data, isLoading, refetch } = useApi<{ matches: MatchItem[] }>(
    "/api/jobs/matches"
  );
  const { toast } = useToast();
  const [bandFilter, setBandFilter] = useState("all");
  const [ignoringId, setIgnoringId] = useState<string | null>(null);
  // A job with a placed bid is no longer actionable — hide it from the queue
  // by default, and let the toggle bring the labeled cards back for review.
  const [hideBidded, setHideBidded] = useState(true);
  // Hide stale matches by default, using Freelancer's own posting timestamp.
  // A blank/zero value turns the age filter off.
  const [maxAgeInput, setMaxAgeInput] = useState("12");
  const [now, setNow] = useState(() => Date.now());
  const matches = useMemo(() => data?.matches ?? [], [data]);
  const biddedCount = useMemo(() => matches.filter((m) => m.bidded).length, [matches]);
  const maxAgeHours = Number(maxAgeInput);
  const ageLimitMs =
    Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours * 60 * 60 * 1000 : null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const staleCount = useMemo(
    () =>
      ageLimitMs === null
        ? 0
        : matches.filter(
            (match) =>
              match.postedAt !== null && now - match.postedAt * 1000 > ageLimitMs
          ).length,
    [ageLimitMs, matches, now]
  );

  const visible = useMemo(() => {
    const byBand =
      bandFilter === "all"
        ? matches
        : matches.filter((match) => match.band === bandFilter);
    const byBidded = hideBidded ? byBand.filter((match) => !match.bidded) : byBand;
    if (ageLimitMs === null) return byBidded;
    return byBidded.filter(
      (match) =>
        match.postedAt === null || now - match.postedAt * 1000 <= ageLimitMs
    );
  }, [ageLimitMs, bandFilter, matches, hideBidded, now]);

  const ignore = async (jobId: string, title: string) => {
    if (ignoringId !== null) return;
    setIgnoringId(jobId);
    try {
      await api<{ ok: true }>(`/api/jobs/${jobId}/ignore`, { method: "POST" });
      toast({
        title: "Job ignored",
        description: `“${title}” was removed from your matches.`,
        variant: "success",
      });
      refetch();
    } catch (cause) {
      toast({
        title: "Could not ignore job",
        description: cause instanceof Error ? cause.message : "Unknown error",
        variant: "error",
      });
    } finally {
      setIgnoringId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Matches"
        description="Scored against your profile — skills you have, gaps to address, and what to watch out for."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground"
              title="Hide projects posted more than this many hours ago, using Freelancer's posting time. Leave blank to show every age."
            >
              <Clock className="size-4 opacity-60" aria-hidden />
              <label htmlFor="match-max-age" className="select-none">
                Max age
              </label>
              <Input
                id="match-max-age"
                type="number"
                inputMode="numeric"
                min={1}
                max={168}
                value={maxAgeInput}
                onChange={(event) => setMaxAgeInput(event.target.value)}
                className="h-7 w-16 px-1 text-center"
                aria-label="Maximum project age in hours"
              />
              <span className="select-none">h</span>
              {ageLimitMs !== null && staleCount > 0 ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                  {staleCount} hidden
                </span>
              ) : null}
            </div>
            <Select value={bandFilter} onValueChange={setBandFilter}>
              <SelectTrigger aria-label="Filter by band">
                <Eye className="-ml-1 size-4 opacity-60" data-icon="inline-start" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All bands</SelectItem>
                <SelectItem value="strong">Strong</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="fair">Fair</SelectItem>
              </SelectContent>
            </Select>
            <label
              className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60"
              title="Jobs you already bid are no longer actionable. Uncheck to review them with their labels."
            >
              <Checkbox
                checked={hideBidded}
                onCheckedChange={(value) => setHideBidded(value === true)}
              />
              <span className="select-none">Hide jobs I bid on</span>
              {hideBidded && biddedCount > 0 ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                  {biddedCount} hidden
                </span>
              ) : null}
            </label>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        {visible.map((match) => (
          <Card key={match.id} size="sm">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  to={`/jobs/${match.jobId}`}
                  className="hover:underline"
                >
                  {match.title}
                </Link>
              </CardTitle>
              <CardDescription>
                {match.client} · {match.budgetLabel} · posted {match.postedLabel}
              </CardDescription>
              <CardAction className="flex items-center gap-2">
                <MatchBandBadge band={match.band} />
                <ScoreChip score={match.score} />
                {match.bidFailed ? (
                  <Badge
                    variant="outline"
                    className="border-transparent bg-destructive/10 text-destructive"
                  >
                    <TriangleAlert className="size-3" aria-hidden />
                    Bid failed
                  </Badge>
                ) : null}
                <BidStateBadge bidded={match.bidded} outcome={match.bidOutcome} />
              </CardAction>
            </CardHeader>

            {match.bidError ? (
              <div className="px-(--card-spacing)">
                <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    Automatic bid failed — handle this one manually.
                    <span className="block text-xs text-destructive/80">{match.bidError}</span>
                  </span>
                </p>
              </div>
            ) : null}

            <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-2">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {match.explanation}
                </p>
              </div>
              <div className="flex flex-col gap-2.5 text-sm">
                <div>
                  <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Matching your profile
                  </p>
                  <ul className="flex flex-wrap gap-1">
                    {match.matchedSkills.map((skill) => (
                      <li
                        key={skill}
                        className="inline-flex items-center gap-1 rounded-md bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success"
                      >
                        <CircleCheck className="size-3" aria-hidden />
                        {skill}
                      </li>
                    ))}
                  </ul>
                </div>
                {match.missingSkills.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Not in your profile
                    </p>
                    <ul className="flex flex-wrap gap-1">
                      {match.missingSkills.map((skill) => (
                        <li
                          key={skill}
                          className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {skill}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {match.concerns.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {match.concerns.map((concern) => (
                      <li key={concern} className="flex items-start gap-1.5 text-xs text-warning">
                        <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                        {concern}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </CardContent>

            <CardFooter className="flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" asChild>
                <a
                  href={`https://www.freelancer.com/projects/${match.projectId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink data-icon="inline-start" />
                  Show on Freelancer
                </a>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void ignore(match.jobId, match.title)}
                disabled={ignoringId !== null}
              >
                {ignoringId === match.jobId ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <ThumbsDown data-icon="inline-start" />
                )}
                {ignoringId === match.jobId ? "Ignoring…" : "Ignore"}
              </Button>
              <Button
                variant={match.bidded ? "outline" : "default"}
                size="sm"
                asChild
              >
                <Link to={`/jobs/${match.jobId}`}>
                  {match.bidded ? (
                    "View job"
                  ) : (
                    <>
                      <FileText data-icon="inline-start" />
                      Draft proposal
                    </>
                  )}
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Loading matches…
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {matches.length === 0
            ? "Nothing in this band right now. The worker keeps scanning every interval."
            : ageLimitMs !== null && staleCount > 0
              ? `No matches within ${maxAgeHours}h. ${staleCount} older match${staleCount === 1 ? "" : "es"} hidden; increase the max age or clear it to see them.`
              : hideBidded && biddedCount > 0
                ? "Every match in this view already has a bid. Uncheck “Hide jobs I bid on” to review them."
                : "Nothing matches this band filter right now."}
        </p>
      ) : null}
    </div>
  );
}
