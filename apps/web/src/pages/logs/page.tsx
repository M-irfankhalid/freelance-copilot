import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";

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
import { useApi } from "@/lib/api/hooks";
import type { LogEntry } from "@/lib/types";

/** Response shape from GET /api/logs. */
interface LogsApiResponse {
  logs: Array<{
    id: string;
    time: string;
    level: string;
    category: string;
    message: string;
    timeLabel: string;
  }>;
  total: number;
  hasMore: boolean;
}

/** Every meaningful thing the system did, newest first. */
export default function LogsPage() {
  const [level, setLevel] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (level !== "all") params.set("level", level);
    if (category !== "all") params.set("category", category);
    if (query.trim()) params.set("q", query.trim());
    const qs = params.toString();
    return qs ? `/api/logs?${qs}` : "/api/logs";
  }, [level, category, query]);

  const { data, error, isLoading, refetch } = useApi<LogsApiResponse>(queryString);

  const entries: LogEntry[] = useMemo(() => {
    if (!data?.logs) return [];
    return data.logs.map((l) => ({
      id: l.id,
      timeLabel: l.timeLabel,
      level: l.level as LogEntry["level"],
      category: l.category as LogEntry["category"],
      message: l.message,
    }));
  }, [data]);

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
          <Button variant="outline" onClick={() => refetch()}>
            <Download data-icon="inline-start" />
            Export
          </Button>
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search messages"
            className="pl-8"
            aria-label="Search logs"
          />
        </div>
        <Select value={level} onValueChange={setLevel}>
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
        <Select value={category} onValueChange={setCategory}>
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

      {data && data.hasMore && (
        <div className="flex justify-center py-4">
          <Button variant="outline" onClick={() => refetch()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
