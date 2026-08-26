import { Link } from "react-router";
import { ArrowRight, FileText } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ProposalStatusBadge } from "@/components/dashboard/status-badges";
import { formatMoney } from "@/lib/format";
import type { ProposalSummary } from "@/lib/types";

/** Latest AI-drafted proposals across every status. */
export function RecentProposalsCard({
  proposals,
  className,
}: {
  proposals: ProposalSummary[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Recent proposals</CardTitle>
        <CardDescription>Drafts and submissions awaiting outcomes.</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link to="/proposals">
              View all
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-(--card-spacing)">
        {proposals.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No proposals yet"
            description="Generate a proposal from a strong match and it will appear here."
          />
        ) : (
          <ul className="divide-y">
            {proposals.map((proposal) => (
              <li
                key={proposal.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/proposals/${proposal.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {proposal.jobTitle}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {proposal.client} ·{" "}
                    <span className="hidden sm:inline">
                      updated {proposal.updatedLabel}
                    </span>
                    <span className="sm:hidden">{proposal.updatedLabel}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <ProposalStatusBadge status={proposal.status} />
                  <span className="text-sm font-medium tabular-nums">
                    {formatMoney(proposal.bidAmount)}
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
