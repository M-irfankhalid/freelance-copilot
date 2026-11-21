import { and, desc, eq, sql, type SQL } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { logs as logsTable } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("system");

export interface LogEntry {
  id: string;
  time: string;
  level: string;
  category: string;
  message: string;
  meta: unknown | null;
}

export interface LogListResponse {
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

export const MAX_LOGS = 5000;
const MAX_CONSECUTIVE_ERRORS = 5;

const VALID_LEVELS = ["debug", "info", "warn", "error"];
const VALID_CATEGORIES = ["sync", "analysis", "proposal", "proposals", "ai", "bid", "auth", "system"];

/**
 * List system logs with optional search, level, and category filters. Results
 * are newest-first with pagination.
 */
export function listLogs(params: {
  limit?: number;
  offset?: number;
  level?: string;
  category?: string;
  search?: string;
}): LogListResponse {
  try {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_LOGS);
    const offset = Math.max(params.offset ?? 0, 0);

    // Build WHERE conditions in a single .where() call (Drizzle's query
    // builder is immutable — chaining .where() twice is a no-op + type error).
    const conditions: SQL[] = [];

    if (params.level && VALID_LEVELS.includes(params.level)) {
      conditions.push(eq(logsTable.level, params.level));
    }

    if (params.category && VALID_CATEGORIES.includes(params.category)) {
      conditions.push(eq(logsTable.category, params.category));
    }

    if (params.search && params.search.trim().length > 0) {
      const pattern = `%${params.search.trim()}%`;
      conditions.push(sql`${logsTable.message} LIKE ${pattern} ESCAPE '\\'`);
    }

    const db = getDb();
    const rows = conditions.length > 0
      ? db.select()
          .from(logsTable)
          .where(and(...conditions))
          .orderBy(desc(logsTable.time))
          .limit(limit)
          .offset(offset)
          .all()
      : db.select()
          .from(logsTable)
          .orderBy(desc(logsTable.time))
          .limit(limit)
          .offset(offset)
          .all();

    // Total count for the current filter set.
    const totalRow = conditions.length > 0
      ? db.select({ count: sql`count(*)` })
          .from(logsTable)
          .where(and(...conditions))
          .get()
      : db.select({ count: sql`count(*)` })
          .from(logsTable)
          .get();

    const total = Number(totalRow?.count ?? 0);

    const now = Date.now();

    const formatLabel = (iso: string): string => {
      const diffMs = now - new Date(iso).getTime();
      const minutes = Math.round(diffMs / 60000);
      if (minutes < 1) return "just now";
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.round(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.round(hours / 24);
      if (days < 7) return `${days}d ago`;
      const weeks = Math.round(days / 7);
      return `${weeks}w ago`;
    };

    return {
      logs: rows.map((row) => ({
        id: row.id,
        time: row.time,
        level: row.level,
        category: row.category,
        message: row.message,
        timeLabel: formatLabel(row.time),
      })),
      total,
      hasMore: rows.length === limit && offset + limit < total,
    };
  } catch (error) {
    log.error("Failed to list logs:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new AppError(
      500,
      "DATABASE_ERROR",
      `Failed to list logs: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export { MAX_CONSECUTIVE_ERRORS };
