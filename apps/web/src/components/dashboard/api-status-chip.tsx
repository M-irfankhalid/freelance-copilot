import { useApi } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

interface HealthBody {
  status: string;
  uptimeSeconds: number;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * First piece of live data in the UI: the agent's backend status, polled
 * once per mount. Demonstrates the api client + useApi pattern that all
 * later integrations follow.
 */
export function ApiStatusChip() {
  const { data, error, isLoading } = useApi<HealthBody>("/api/health");

  const online = data !== null && error === null;
  const dotClass = isLoading
    ? "bg-muted-foreground/50"
    : online
      ? "bg-success"
      : "bg-destructive";
  const label = isLoading
    ? "Connecting…"
    : online
      ? `Agent API online · up ${formatUptime(data.uptimeSeconds)}`
      : "Agent API offline";

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", dotClass)} aria-hidden />
      {label}
    </span>
  );
}
