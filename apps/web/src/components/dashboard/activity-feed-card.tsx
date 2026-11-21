import {
  CirclePause,
  RefreshCw,
  Send,
  Star,
  Target,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ActivityEvent, ActivityKind } from "@/lib/types";

const kindIcon: Record<ActivityKind, LucideIcon> = {
  bid_won: Trophy,
  bid_submitted: Send,
  strong_match: Target,
  proposal_shortlisted: Star,
  sync_completed: RefreshCw,
  automation_paused: CirclePause,
};

/** Chronological feed of wins, matches, and automation events. */
export function ActivityFeedCard({
  events,
  className,
}: {
  events: ActivityEvent[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Latest events across your workspace.</CardDescription>
      </CardHeader>
      <CardContent className="px-(--card-spacing)">
        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing has happened yet. Events appear as your pipeline moves.
          </p>
        ) : (
          <ul className="flex flex-col">
            {events.map((event) => {
              const Icon = kindIcon[event.kind];

              return (
                <li key={event.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted/40"
                    )}
                  >
                    <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{event.message}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {event.timeLabel}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
