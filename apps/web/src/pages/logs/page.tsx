import { useMemo, useState } from "react";
import {
  CircleX,
  Download,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { LogLevelBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import { useToast } from "@/components/ui/toast";
import type { LogEntry } from "@/lib/types";

/** Response shape from GET /api/logs. */
interface LogRow {
  id: string;
  time: string;
  level: string;
  category: string;
  message: string;
  timeLabel: string;
}

interface LogsApiResponse {
  logs: LogRow[];
  total: number;
  hasMore: boolean;
}

const LOG_PAGE_SIZE = 50;
const MAX_EXPORT_LOGS = 5000;

function toLogEntry(log: LogRow): LogEntry {
  return {
    id: log.id,
    timeLabel: log.timeLabel,
    level: log.level as LogEntry["level"],
    category: log.category as LogEntry["category"],
    message: log.message,
  };
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Every meaningful thing the system did, newest first. */
export default function LogsPage() {
  const { toast } = useToast();
  const [level, setLevel] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [extraEntries, setExtraEntries] = useState<LogEntry[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (level !== "all") params.set("level", level);
    if (category !== "all") params.set("category", category);
    if (query.trim()) params.set("q", query.trim());
    const qs = params.toString();
    return qs ? `/api/logs?${qs}` : "/api/logs";
  }, [level, category, query]);

  const { data, error, isLoading, refetch } = useApi<LogsApiResponse>(queryString);

  const entries = useMemo<LogEntry[]>(
    () => [...(data?.logs ?? []).map(toLogEntry), ...extraEntries],
    [data, extraEntries]
  );

  const withParams = (params: URLSearchParams) => {
    const separator = queryString.includes("?") ? "&" : "?";
    return `${queryString}${separator}${params.toString()}`;
  };

  const resetPaging = () => setExtraEntries([]);

  const activeFilters =
    level !== "all" || category !== "all" || query.trim().length > 0;

  const clearFilters = () => {
    setLevel("all");
    setCategory("all");
    setQuery("");
    resetPaging();
  };

  const refresh = () => {
    resetPaging();
    refetch();
  };

  const loadMore = async () => {
    if (loadingMore || data === null) return;
    setLoadingMore(true);
    try {
      const page = await api<LogsApiResponse>(
        withParams(
          new URLSearchParams({
            limit: String(LOG_PAGE_SIZE),
            offset: String(entries.length),
          })
        )
      );
      setExtraEntries((current) => [...current, ...page.logs.map(toLogEntry)]);
    } catch (cause) {
      toast({
        title: "Could not load more logs",
        description: cause instanceof Error ? cause.message : "Unknown error",
        variant: "error",
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const exportLogs = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await api<LogsApiResponse>(
        withParams(
          new URLSearchParams({
            limit: String(MAX_EXPORT_LOGS),
            offset: "0",
          })
        )
      );
      const csv = [
        ["Time", "Level", "Category", "Message"],
        ...result.logs.map((log) => [log.time, log.level, log.category, log.message]),
      ]
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n");
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `logs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Logs exported",
        description: `${result.logs.length} entries downloaded.`,
        variant: "success",
      });
    } catch (cause) {
      toast({
        title: "Could not export logs",
        description: cause instanceof Error ? cause.message : "Unknown error",
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Logs"
        description={
          error
            ? "Some log data could not be loaded."
            : data
              ? `Showing ${entries.length.toLocaleString()} of ${data.total.toLocaleString()} entries${activeFilters ? " matching your filters" : ""}.`
              : "Scans, analyses, proposals, bids, and errors — the full audit trail."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={refresh} disabled={isLoading}>
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={() => void exportLogs()}
              disabled={exporting || entries.length === 0}
            >
              {exporting ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <span className="flex items-start gap-2">
            <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error.message}
          </span>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            <RefreshCw data-icon="inline-start" />
            Retry
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              resetPaging();
            }}
            placeholder="Search messages"
            className="pl-8"
            aria-label="Search logs"
          />
        </div>
        <Select
          value={level}
          onValueChange={(value) => {
            setLevel(value);
            resetPaging();
          }}
        >
          <SelectTrigger aria-label="Filter by level" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="debug">Debug</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warning</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={category}
          onValueChange={(value) => {
            setCategory(value);
            resetPaging();
          }}
        >
          <SelectTrigger aria-label="Filter by category" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="sync">Sync</SelectItem>
            <SelectItem value="analysis">Analysis</SelectItem>
            <SelectItem value="ai">AI</SelectItem>
            <SelectItem value="proposal">Proposal</SelectItem>
            <SelectItem value="proposals">Proposals</SelectItem>
            <SelectItem value="bid">Bid</SelectItem>
            <SelectItem value="auth">Auth</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
        {activeFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X data-icon="inline-start" aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Time</TableHead>
              <TableHead className="w-24">Level</TableHead>
              <TableHead className="w-24">Category</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                  {log.timeLabel}
                </TableCell>
                <TableCell>
                  <LogLevelBadge level={log.level} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground capitalize">
                  {log.category}
                </TableCell>
                <TableCell className="text-sm">{log.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {isLoading && entries.length === 0 ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            {error ? (
              <CircleX className="size-6 text-destructive" aria-hidden />
            ) : (
              <Inbox className="size-6 text-muted-foreground" aria-hidden />
            )}
            <p className="text-sm font-medium">
              {error
                ? "Logs could not load"
                : activeFilters
                  ? "No entries match these filters"
                  : "No log entries yet"}
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              {error
                ? "Check the server connection, then try again."
                : activeFilters
                  ? "Try a broader level, category, or search term."
                  : "Scans, analyses, proposals, bids, and errors will appear here as the worker runs."}
            </p>
            {error ? (
              <Button variant="outline" size="sm" onClick={refresh} className="mt-1">
                <RefreshCw data-icon="inline-start" />
                Retry
              </Button>
            ) : activeFilters ? (
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="mt-1"
              >
                <X data-icon="inline-start" aria-hidden />
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {data && entries.length > 0 ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground tabular-nums">
            Showing {entries.length.toLocaleString()} of{" "}
            {data.total.toLocaleString()}
          </p>
          {entries.length < data.total ? (
            <Button
              variant="outline"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : null}
              {loadingMore
                ? "Loading…"
                : `Load ${Math.min(LOG_PAGE_SIZE, data.total - entries.length)} more`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
