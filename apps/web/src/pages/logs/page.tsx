import { useMemo, useState } from "react";
import { Download, Loader2, RefreshCw, Search } from "lucide-react";

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
            ? "Error loading logs — check your connection."
            : data
              ? `Showing ${entries.length} of ${data.total} log entries`
              : "Scans, analyses, proposals, bids, and errors — the full audit trail."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
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

      <div className="flex flex-wrap items-center gap-2">
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

        {entries.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {isLoading ? "Loading logs…" : "No log entries match these filters."}
          </p>
        ) : null}
      </div>

      {data && entries.length < data.total ? (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : null}
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
