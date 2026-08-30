import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Clock,
  Filter,
  Link2,
  MapPin,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ScoreChip } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import { useInfiniteJobs } from "@/lib/api/hooks";

type StatusFilter = "all" | "new" | "analyzed" | "ignored";
type SortBy = "newest" | "score" | "budget";

/**
 * Jobs discovered by the sync worker plus anything added manually.
 * On mount the hook tries the local DB cache first. If the cache is empty it
 * automatically scans Freelancer.com for fresh jobs, then switches to reading
 * cached rows for infinite scroll as the user scrolls.
 */
export default function JobsPage() {
  const {
    jobs,
    error,
    isLoading,
    isFetchingNext,
    scanning,
    sentinelRef,
    reset,
    scan,
  } = useInfiniteJobs();

  const [addingManual, setAddingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const [manualUrl, setManualUrl] = useState("");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("newest");

  const visible = useMemo(() => {
    let list = [...jobs];
    if (statusFilter !== "all") {
      list = list.filter((job) => job.status === statusFilter);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (job) =>
          job.title.toLowerCase().includes(q) ||
          job.client.toLowerCase().includes(q) ||
          job.skills.some((skill) => skill.toLowerCase().includes(q))
      );
    }
    if (sortBy === "score") {
      list.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));
    } else if (sortBy === "budget") {
      list.sort((a, b) => b.bidCount - a.bidCount);
    }
    return list;
  }, [jobs, query, sortBy, statusFilter]);

  const handleScan = async () => {
    try {
      await scan();
    } catch {
      // Errors are handled inside the hook; this is a no-op.
    }
  };

  const addManual = async () => {
    if (!manualUrl.trim() || addingManual) return;
    setAddingManual(true);
    setManualError(null);
    const url = manualUrl.trim();
    const body = /^\d+$/.test(url)
      ? { url: `https://www.freelancer.com/projects/${url}` }
      : { url };
    try {
      await api<{ job: unknown }>("/api/jobs/by-url", {
        method: "POST",
        body,
      });
      setManualUrl("");
      reset();
    } catch (cause) {
      setManualError(messageFor(cause));
    } finally {
      setAddingManual(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Jobs"
        description="Everything the worker found for your keywords, plus anything you add manually."
        actions={
          <Button onClick={handleScan} disabled={scanning || isLoading}>
            <RefreshCw
              className={scanning ? "animate-spin" : undefined}
              data-icon="inline-start"
            />
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, client, or skill"
            className="pl-8"
            aria-label="Search jobs"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger aria-label="Filter by status">
            <Filter data-icon="inline-start" className="-ml-1 size-4 opacity-60" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="analyzed">Analyzed</SelectItem>
            <SelectItem value="ignored">Ignored</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="score">Match score</SelectItem>
            <SelectItem value="budget">Most bids</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Manual add */}
      <form
        className="flex flex-col gap-2 rounded-xl border border-dashed bg-muted/30 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          addManual();
        }}
      >
        <div className="flex flex-wrap gap-2">
          <Link2 className="mt-2 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            value={manualUrl}
            onChange={(event) => setManualUrl(event.target.value)}
            placeholder="Paste a Freelancer.com job URL or project ID to fetch and review it"
            className="min-w-64 flex-1"
            aria-label="Job URL or ID"
          />
          <Button type="submit" variant="outline" disabled={!manualUrl.trim() || addingManual}>
            {addingManual ? "Fetching…" : "Add job"}
          </Button>
        </div>
        {manualError ? (
          <p className="text-sm text-destructive">{manualError}</p>
        ) : null}
      </form>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Could not load jobs: {messageFor(error)}
        </p>
      ) : scanning && jobs.length === 0 ? (
        <div className="col-span-2 rounded-xl border border-dashed p-10 text-center">
          <Search className="mx-auto size-10 animate-bounce text-muted-foreground/40" aria-hidden />
          <p className="mt-3 text-sm text-muted-foreground">
            Scanning Freelancer.com for fresh jobs…
          </p>
        </div>
      ) : isLoading && jobs.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((key) => (
            <Card key={key}>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3.5 w-1/2" />
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3.5 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.length === 0 ? (
            <p className="col-span-2 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              No jobs match these filters.{" "}
              {jobs.length > 0
                ? "Try adjusting your search — cached jobs exist but none match."
                : 'Click "Scan now" to discover jobs from Freelancer.com.'}
            </p>
          ) : null}
          {visible.map((job) => (
            <Link key={job.id} to={`/jobs/${job.projectId}`} className="group outline-none">
              <Card className="h-full transition-shadow group-hover:shadow-md group-focus-visible:ring-3 group-focus-visible:ring-ring/50">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="group-hover:underline">{job.title}</CardTitle>
                    {job.matchScore !== undefined && job.matchScore > 0 ? (
                      <ScoreChip score={job.matchScore} />
                    ) : (
                      <Badge variant="outline" className="shrink-0 text-muted-foreground">
                        Not analyzed
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{job.client}</span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin aria-hidden />
                      {job.clientCountry}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex min-h-11 flex-wrap items-center gap-1.5">
                  {job.skills.slice(0, 4).map((skill) => (
                    <Badge key={skill} variant="secondary" className="font-normal">
                      {skill}
                    </Badge>
                  ))}
                  {job.skills.length > 4 ? (
                    <Badge variant="secondary" className="font-normal text-muted-foreground">
                      +{job.skills.length - 4}
                    </Badge>
                  ) : null}
                </CardContent>
                <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{job.budgetLabel}</span>
                  <span className="inline-flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <Users aria-hidden />
                      {job.bidCount} bids · avg {job.avgBidLabel}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock aria-hidden />
                      {job.postedLabel}
                    </span>
                  </span>
                </CardFooter>
              </Card>
            </Link>
          ))}
          {isFetchingNext ? (
            <>
              {[0, 1].map((key) => (
                <Card key={`skeleton-${key}`}>
                  <CardHeader>
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-3.5 w-1/2" />
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <Skeleton className="h-3.5 w-1/3" />
                    <Skeleton className="h-3.5 w-2/3" />
                  </CardContent>
                </Card>
              ))}
            </>
          ) : null}
          {/* Sentinel for infinite scroll — observed by useInfiniteJobs */}
          <div ref={sentinelRef} className="col-span-2" />
        </div>
      )}
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
