import {
  AlarmClock,
  CircleX,
  Eye,
  Send,
  Star,
  Timer,
  TriangleAlert,
  Trophy,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  BidOutcome,
  JobAttentionItem,
  ProposalStatus,
} from "@/lib/types";

/**
 * Status pills shared by the dashboard sections. Every state pairs an icon
 * with its label so meaning never rides on color alone.
 */

const proposalStatusMeta: Record<
  ProposalStatus,
  { label: string; icon?: typeof Eye; className?: string }
> = {
  awaiting_approval: {
    label: "Awaiting approval",
    icon: AlarmClock,
    className: "border-border text-foreground",
  },
  queued: { label: "Queued for submission", icon: Timer },
  submitted: { label: "Submitted", icon: Send },
  viewed: { label: "Viewed", icon: Eye },
  shortlisted: {
    label: "Shortlisted",
    icon: Star,
    className: "border-transparent bg-success/10 text-success",
  },
  declined: {
    label: "Declined",
    icon: X,
    className: "bg-destructive/10 text-destructive border-transparent",
  },
};

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  const meta = proposalStatusMeta[status];
  const Icon = meta.icon;

  return (
    <Badge variant="outline" className={cn("gap-1", meta.className)}>
      {Icon ? (
        <Icon data-icon="inline-start" aria-hidden />
      ) : null}
      {meta.label}
    </Badge>
  );
}

const bidOutcomeMeta: Record<
  BidOutcome,
  { label: string; icon: typeof Eye; className: string }
> = {
  in_review: {
    label: "In review",
    icon: Eye,
    className: "border-border text-foreground",
  },
  won: {
    label: "Won",
    icon: Trophy,
    className: "border-transparent bg-success/10 text-success",
  },
  lost: {
    label: "Lost",
    icon: CircleX,
    className: "bg-destructive/10 text-destructive border-transparent",
  },
};

export function BidOutcomeBadge({ outcome }: { outcome: BidOutcome }) {
  const meta = bidOutcomeMeta[outcome];
  const Icon = meta.icon;

  return (
    <Badge variant="outline" className={cn("gap-1", meta.className)}>
      <Icon data-icon="inline-start" aria-hidden />
      {meta.label}
    </Badge>
  );
}

const severityMeta: Record<
  JobAttentionItem["severity"],
  { icon: typeof Eye; className: string }
> = {
  urgent: { icon: AlarmClock, className: "bg-destructive/10 text-destructive border-transparent" },
  warning: { icon: TriangleAlert, className: "border-transparent bg-warning/10 text-warning" },
  info: { icon: Star, className: "border-border text-foreground" },
};

export function AttentionReasonBadge({ item }: { item: JobAttentionItem }) {
  const meta = severityMeta[item.severity];
  const Icon = meta.icon;

  return (
    <Badge variant="outline" className={cn("gap-1", meta.className)}>
      <Icon data-icon="inline-start" aria-hidden />
      {item.reason}
    </Badge>
  );
}
