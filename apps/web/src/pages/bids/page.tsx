import { useMemo } from "react";
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
import { useApi } from "@/lib/api/hooks";
import type { BidSummary } from "@/lib/types";

interface BidsApiResponse {
  bids: BidResponseRow[];
}

interface BidResponseRow {
  id: string;
  jobTitle: string;
  amount: number;
  outcome: "in_review" | "won" | "lost" | null;
  submittedLabel: string;
  via: "manual" | "auto";
  proposalExcerpt?: string | null;
}

/** Every bid placed — manual or auto — with outcomes. */
export default function BidsPage() {
  const { data, error, isLoading } = useApi<BidsApiResponse>("/api/bids");

  const bids = useMemo(() => {
    const rows = data?.bids;
    if (!rows) return [];
    return rows.map((b) => ({
      id: b.id,
      jobTitle: b.jobTitle,
      amount: b.amount,
      // The API doesn't track recurring vs fixed; default to false.
      recurring: false,
      outcome: (b.outcome ?? "in_review") as BidSummary["outcome"],
      submittedLabel: b.submittedLabel,
      via: b.via,
      proposalExcerpt: b.proposalExcerpt ?? undefined,
    }));
  }, [data?.bids]);

  const won = bids.filter((bid) => bid.outcome === "won");
  const totalValue = bids
    .filter((bid) => bid.outcome !== "lost")
    .reduce((sum, bid) => sum + bid.amount, 0);

  if (isLoading && bids.length === 0) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader title="Bids" description="Everything submitted on your behalf or by you, with outcomes." />
        <Card size="sm">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Loading bids…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader title="Bids" description="Everything submitted on your behalf or by you, with outcomes." />
        <Card size="sm">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">Failed to load bids: {error.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Bids"
        description="Everything submitted on your behalf or by you, with outcomes."
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Win rate</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {bids.length > 0
                ? `${Math.round((won.length / bids.length) * 100)}%`
                : "—"}
            </CardTitle>
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
            {bids.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No bids yet. Draft and approve a proposal, then submit one from the Proposals or job pages.
                </TableCell>
              </TableRow>
            ) : null}
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
