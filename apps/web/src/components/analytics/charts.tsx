import { CircleX, Eye, Trophy } from "lucide-react";

import type { SeriesPoint } from "@/lib/types";

/**
 * Charts built from plain markup so they inherit the app theme in light and
 * dark mode. Single-hue marks; identity comes from labels, never color alone.
 */

/** Thin vertical bars, rounded at the data end, baseline anchored. */
export function BarChart({ data }: { data: SeriesPoint[] }) {
  const max = Math.max(...data.map((point) => point.value), 1);

  return (
    <div role="img" aria-label="Bids submitted per week">
      <div className="flex h-36 items-end gap-1.5">
        {data.map((point) => (
          <div
            key={point.label}
            className="group relative flex h-full flex-1 flex-col justify-end"
          >
            <span className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-md border bg-popover px-1.5 py-0.5 text-xs font-medium tabular-nums opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {point.value} bids · {point.label}
            </span>
            <div
              className="w-full rounded-t-[4px] bg-primary/85 transition-colors group-hover:bg-primary"
              style={{ height: `${Math.max((point.value / max) * 100, 4)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 border-t pt-1.5">
        {data.map((point) => (
          <span
            key={point.label}
            className="flex-1 text-center text-[10px] text-muted-foreground"
          >
            {point.label}
          </span>
        ))}
      </div>

      {/* Accessible fallback */}
      <table className="sr-only">
        <caption>Bids submitted per week</caption>
        <tbody>
          {data.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{point.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One horizontal track split by status, 2px surface gaps, labeled below. */
export function OutcomeBreakdown({
  won,
  lost,
  inReview,
}: {
  won: number;
  lost: number;
  inReview: number;
}) {
  const total = won + lost + inReview || 1;
  const segments = [
    { label: "Won", value: won, className: "bg-success", icon: Trophy },
    { label: "In review", value: inReview, className: "bg-muted-foreground/40", icon: Eye },
    { label: "Lost", value: lost, className: "bg-destructive/70", icon: CircleX },
  ];

  return (
    <div>
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={`Bid outcomes: ${won} won, ${inReview} in review, ${lost} lost`}
      >
        {segments.map((segment) =>
          segment.value > 0 ? (
            <div
              key={segment.label}
              className={segment.className}
              style={{ width: `${(segment.value / total) * 100}%` }}
            />
          ) : null
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-1.5 text-sm">
            <span className={`size-2 rounded-full ${segment.className}`} aria-hidden />
            <span className="text-muted-foreground">{segment.label}</span>
            <span className="font-medium tabular-nums">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal magnitude bars sharing one hue; category named beside each. */
export function HBarList({ data }: { data: SeriesPoint[] }) {
  const max = Math.max(...data.map((point) => point.value), 1);

  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((point) => (
        <li key={point.label} className="flex items-center gap-3 text-sm">
          <span className="w-32 shrink-0 truncate text-muted-foreground">{point.label}</span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary/85"
              style={{ width: `${Math.max((point.value / max) * 100, 3)}%` }}
            />
          </span>
          <span className="w-6 shrink-0 text-right font-medium tabular-nums">
            {point.value}
          </span>
        </li>
      ))}
    </ul>
  );
}
