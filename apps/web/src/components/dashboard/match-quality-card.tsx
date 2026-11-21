import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MatchBand, MatchQualitySnapshot } from "@/lib/types";

/**
 * Monochrome single-hue ramp: darker = stronger band. Uses foreground
 * opacities so the ordering survives both light and dark surfaces.
 */
const bandFill: Record<MatchBand, string> = {
  strong: "bg-foreground",
  good: "bg-foreground/60",
  fair: "bg-foreground/25",
};

/**
 * Match quality overview — average score plus the score-band distribution of
 * analyzed jobs. The legend doubles as the table view; every value is also
 * directly labeled, so no hover layer is required.
 */
export function MatchQualityCard({
  snapshot,
}: {
  snapshot: MatchQualitySnapshot;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Match quality</CardTitle>
        <CardDescription>
          {snapshot.windowLabel} · {snapshot.jobsAnalyzed} jobs analyzed
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <p className="text-3xl font-semibold tracking-tight">
            {snapshot.averageScore}
          </p>
          <p className="text-sm text-muted-foreground">Average match score</p>
        </div>

        <div
          role="img"
          aria-label={`Match score distribution: ${snapshot.bands
            .map((band) => `${band.count} ${band.label.toLowerCase()}`)
            .join(", ")}`}
        >
          {/* Segmented distribution bar — 2px surface gaps, square baseline,
              rounded data end via container clipping. */}
          <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-[4px]">
            {snapshot.bands.map((band) => (
              <div
                key={band.band}
                style={{ flexGrow: band.count }}
                className={cn("min-w-0", bandFill[band.band])}
              />
            ))}
          </div>
        </div>

        <ul className="flex flex-col gap-2">
          {snapshot.bands.map((band) => (
            <li
              key={band.band}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-[2px]", bandFill[band.band])}
                />
                <span className="truncate">
                  {band.label}{" "}
                  <span className="text-muted-foreground">
                    ({band.rangeLabel})
                  </span>
                </span>
              </span>
              <span className="font-medium tabular-nums">{band.count}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
