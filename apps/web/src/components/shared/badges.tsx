import {
  CircleCheck,
  CircleX,
  Info,
  PlugZap,
  Send,
  TriangleAlert,
  Trophy,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConnectionStatus, LogLevel, MatchBand } from "@/lib/types";

/** Status pills for jobs, matches, logs, and platforms. */

const matchBandMeta: Record<
  MatchBand,
  { label: string; className: string }
> = {
  strong: {
    label: "Strong",
    className: "border-transparent bg-success/10 text-success",
  },
  good: {
    label: "Good",
    className: "border-transparent bg-warning/10 text-warning",
  },
  fair: { label: "Fair", className: "border-border text-foreground" },
};

export function MatchBandBadge({ band }: { band: MatchBand }) {
  const meta = matchBandMeta[band];
  return (
    <Badge variant="outline" className={cn("gap-1", meta.className)}>
      {meta.label}
    </Badge>
  );
}

const logLevelMeta: Record<
  LogLevel,
  { icon: typeof Info; className: string }
> = {
  debug: { icon: Info, className: "border-border text-muted-foreground" },
  info: { icon: Info, className: "border-border text-foreground" },
  success: {
    icon: CircleCheck,
    className: "border-transparent bg-success/10 text-success",
  },
  warn: {
    icon: TriangleAlert,
    className: "border-transparent bg-warning/10 text-warning",
  },
  error: {
    icon: CircleX,
    className: "bg-destructive/10 text-destructive border-transparent",
  },
};

export function LogLevelBadge({ level }: { level: LogLevel }) {
  const meta = logLevelMeta[level];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 capitalize", meta.className)}>
      <Icon data-icon="inline-start" aria-hidden />
      {level}
    </Badge>
  );
}

const connectionMeta: Record<
  ConnectionStatus,
  { label: string; icon: typeof Info; className: string }
> = {
  connected: {
    label: "Connected",
    icon: CircleCheck,
    className: "border-transparent bg-success/10 text-success",
  },
  needs_attention: {
    label: "Needs attention",
    icon: TriangleAlert,
    className: "border-transparent bg-warning/10 text-warning",
  },
  not_connected: {
    label: "Not connected",
    icon: PlugZap,
    className: "border-border text-muted-foreground",
  },
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const meta = connectionMeta[status];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1", meta.className)}>
      <Icon data-icon="inline-start" aria-hidden />
      {meta.label}
    </Badge>
  );
}

/** Colored score chip used on job cards and match lists. */
export function ScoreChip({ score }: { score: number }) {
  const tone =
    score >= 85
      ? "bg-success/10 text-success"
      : score >= 70
        ? "bg-warning/10 text-warning"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        tone
      )}
    >
      {score}
    </span>
  );
}

/**
 * Label for a job/match the user already bid. Won and lost get their own pill;
 * anything still in review reads as "Bid placed". Renders nothing when no bid
 * was placed, so callers can drop it in next to the score chip unconditionally.
 */
export function BidStateBadge({
  bidded,
  outcome,
}: {
  bidded?: boolean;
  outcome?: "in_review" | "won" | "lost" | null;
}) {
  if (!bidded) return null;
  if (outcome === "won") {
    return (
      <Badge variant="outline" className="border-transparent bg-success/10 text-success">
        <Trophy className="size-3" aria-hidden />
        Won
      </Badge>
    );
  }
  if (outcome === "lost") {
    return (
      <Badge variant="outline" className="border-transparent bg-destructive/10 text-destructive">
        <CircleX className="size-3" aria-hidden />
        Lost
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-transparent bg-success/10 text-success">
      <Send className="size-3" aria-hidden />
      Bid placed
    </Badge>
  );
}
