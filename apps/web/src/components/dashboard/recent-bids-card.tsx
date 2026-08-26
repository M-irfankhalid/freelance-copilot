import { Gavel } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { BidOutcomeBadge } from "@/components/dashboard/status-badges";
import { formatMoney } from "@/lib/format";
import type { BidSummary, DashboardSnapshot } from "@/lib/types";

/** Latest bid submissions and their outcomes, with the rolling win rate. */
export function RecentBidsCard({
  bids,
  winRate,
}: {
  bids: BidSummary[];
  winRate: DashboardSnapshot["bidWinRate"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent bidding activity</CardTitle>
        <CardDescription>
          {winRate.rate}% win rate · {winRate.submitted} submitted ·{" "}
          {winRate.windowLabel.toLowerCase()}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-(--card-spacing)">
        {bids.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="No bids yet"
            description="Approved proposals are submitted as bids and tracked here."
          />
        ) : (
          <ul className="divide-y">
            {bids.map((bid) => (
              <li
                key={bid.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{bid.jobTitle}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Submitted {bid.submittedLabel}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <BidOutcomeBadge outcome={bid.outcome} />
                  <span className="text-sm font-medium tabular-nums">
                    {formatMoney(bid.amount)}
                    {bid.recurring ? "/mo" : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
