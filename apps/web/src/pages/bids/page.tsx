import { Bot, UserRound } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { BidOutcomeBadge } from "@/components/dashboard/status-badges";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { bids, bidWinRate } from "@/lib/data/bids";

/** Every bid placed — manual or auto — with outcomes. */
export default function BidsPage() {
  const won = bids.filter((bid) => bid.outcome === "won");
  const totalValue = bids
    .filter((bid) => bid.outcome !== "lost")
    .reduce((sum, bid) => sum + bid.amount, 0);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Bids"
        description="Everything submitted on your behalf or by you, with outcomes."
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Win rate · {bidWinRate.windowLabel}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{bidWinRate.rate}%</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>In review right now</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {bids.filter((b) => b.outcome === "in_review").length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Open value in play</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              ${totalValue.toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Placed</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bids.map((bid) => (
              <TableRow key={bid.id}>
                <TableCell className="max-w-80">
                  <p className="truncate font-medium">{bid.jobTitle}</p>
                  {bid.proposalExcerpt ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {bid.proposalExcerpt}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  ${bid.amount.toLocaleString()}
                  {bid.recurring ? (
                    <span className="text-xs text-muted-foreground">/mo</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="gap-1 font-normal">
                    {bid.via === "auto" ? (
                      <>
                        <Bot aria-hidden />
                        Auto-bid
                      </>
                    ) : (
                      <>
                        <UserRound aria-hidden />
                        Manual
                      </>
                    )}
                  </Badge>
                </TableCell>
                <TableCell>
                  <BidOutcomeBadge outcome={bid.outcome} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {bid.submittedLabel}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {won.length > 0 ? (
        <Card size="sm" className="border-success/25 bg-success/[0.04] ring-success/15">
          <CardContent className="flex items-center gap-2.5 text-sm">
            🏆 Latest win:{" "}
            <span className="font-medium">{won[0].jobTitle}</span> at $
            {won[0].amount.toLocaleString()} — nice.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
