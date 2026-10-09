import { Link } from "react-router";
import { DollarSign, Settings } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import type { BidAmountSettingsSummary } from "@/lib/types";

/**
 * Read-only summary of the user's bid-amount configuration on the dashboard.
 * When AI selection is on it shows the fraction options; when off it shows the
 * default markup rule. A quick link opens the Automation page to edit.
 */
export function BidAmountSettingsCard({
  bidAmount,
}: {
  bidAmount: BidAmountSettingsSummary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="size-4" aria-hidden />
          Bid amount
        </CardTitle>
        <CardDescription>
          {bidAmount.aiBidAmount
            ? "AI selects a bid per project from fractions of the max budget."
            : "Auto-bid prices at minimum + a markup of the max budget."}
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link to="/automation">
              <Settings data-icon="inline-start" aria-hidden />
              Configure
            </Link>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Mode</span>
          <Badge
            variant={bidAmount.aiBidAmount ? "default" : "outline"}
            className="shrink-0"
          >
            {bidAmount.aiBidAmount ? "AI selection" : "Default markup"}
          </Badge>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Bounds</span>
          <span className="tabular-nums">
            {formatMoney(bidAmount.minBid)} – {formatMoney(bidAmount.maxBid)}
          </span>
        </div>

        {bidAmount.aiBidAmount ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Fractions</span>
            <span className="text-xs">
              {bidAmount.bidAmountFractions.map((f) => `"${f}"`).join(", ")}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Markup</span>
            <span className="tabular-nums font-medium">
              {bidAmount.defaultBidMarkupPct}% of project max
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Rounding</span>
          <span className="tabular-nums">
            {bidAmount.roundBidUpTo > 1
              ? `Nearest $${bidAmount.roundBidUpTo} (fixed-price only)`
              : "None"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
