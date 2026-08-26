import { Link } from "react-router";
import { Inbox } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { AttentionReasonBadge } from "@/components/dashboard/status-badges";
import type { JobAttentionItem } from "@/lib/types";

/**
 * Jobs flagged by matching rules — deadlines, invitations, and threshold
 * breaches that need a decision before the next automation run.
 */
export function JobsRequiringAttentionCard({
  items,
  className,
}: {
  items: JobAttentionItem[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Jobs requiring attention</CardTitle>
        <CardDescription>
          Flagged by your match rules across connected platforms.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-(--card-spacing)">
        {items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="You're all caught up"
            description="No jobs currently need your attention. New matches will appear here."
          />
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/jobs/${item.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {item.client} · {item.platform} · {item.budgetLabel} ·{" "}
                    <span className="font-medium tabular-nums">
                      {item.matchScore}
                    </span>{" "}
                    match
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <AttentionReasonBadge item={item} />
                  <Button asChild size="xs" variant="outline">
                    <Link to={`/jobs/${item.id}`}>Review</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
