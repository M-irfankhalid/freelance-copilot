import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  CircleCheck,
  Eye,
  FileText,
  ThumbsDown,
  TriangleAlert,
} from "lucide-react";

import { MatchBandBadge, ScoreChip } from "@/components/shared/badges";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { matches as allMatches } from "@/lib/data/matches";
import type { MatchItem } from "@/lib/types";

/**
 * Jobs the relevancy filter passed and AI scored, strongest first.
 * Each card explains itself: matched skills, gaps, concerns.
 */
export default function MatchesPage() {
  const [matches, setMatches] = useState<MatchItem[]>(allMatches);
  const [bandFilter, setBandFilter] = useState("all");

  const visible = useMemo(
    () =>
      bandFilter === "all"
        ? matches
        : matches.filter((match) => match.band === bandFilter),
    [bandFilter, matches]
  );

  const ignore = (id: string) =>
    setMatches((current) => current.filter((match) => match.id !== id));

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Matches"
        description="Scored against your profile — skills you have, gaps to address, and what to watch out for."
        actions={
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
              </CardAction>
            </CardHeader>

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

            <CardFooter className="justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => ignore(match.id)}>
                <ThumbsDown data-icon="inline-start" />
                Ignore
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/jobs/${match.jobId}`}>View job</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to={`/proposals?compose=${match.jobId}`}>
                  <FileText data-icon="inline-start" />
                  Draft proposal
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nothing in this band right now. The worker keeps scanning every interval.
        </p>
      ) : null}
    </div>
  );
}
