import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { KpiMetric } from "@/lib/types";

const deltaToneClass = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
} as const;

/**
 * Stat tile: label, value, and a signed delta versus a named period.
 * Direction is carried by the icon and sign, tone only by color.
 */
export function KpiCard({ metric }: { metric: KpiMetric }) {
  const DeltaIcon = metric.delta?.direction === "down" ? TrendingDown : TrendingUp;

  return (
    <Card size="sm" className="gap-2">
      <CardContent className="flex flex-col gap-1">
        <p className="truncate text-sm font-medium text-muted-foreground">
          {metric.label}
        </p>
        <p className="text-2xl font-semibold tracking-tight">{metric.value}</p>
        <div className="flex items-baseline justify-between gap-2">
          {metric.delta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-medium whitespace-nowrap",
                deltaToneClass[metric.delta.tone]
              )}
            >
              <DeltaIcon className="size-3" aria-hidden />
              {metric.delta.value}
              <span className="sr-only"> {metric.delta.direction}</span>
            </span>
          ) : null}
          {metric.context ? (
            <span className="truncate text-xs text-muted-foreground">
              {metric.context}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
