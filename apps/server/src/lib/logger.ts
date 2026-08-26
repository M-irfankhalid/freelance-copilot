import { env } from "../env.js";
import { getDb } from "../db/index.js";
import { logs } from "../db/schema.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogCategory =
  | "sync"
  | "analysis"
  | "proposal"
  | "bid"
  | "auth"
  | "system";

/** Keys that must never reach disk or stdout. */
const REDACT_PATTERN =
  /(token|key|secret|password|credential|authorization)/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      clone[k] = REDACT_PATTERN.test(k) ? "[REDACTED]" : redact(v);
    }
    return clone;
  }
  return value;
}

function persist(
  time: string,
  level: LogLevel,
  category: LogCategory,
  message: string,
  meta?: unknown
): void {
  try {
    getDb()
      .insert(logs)
      .values({
        id: crypto.randomUUID(),
        time,
        level,
        category,
        message,
        meta: meta === undefined ? null : JSON.stringify(meta),
      })
      .run();
  } catch {
    // Never let log persistence break request handling.
  }
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export function createLogger(category: LogCategory): Logger {
  const threshold = order[env.LOG_LEVEL];
  const shouldLog = (level: LogLevel) => order[level] >= threshold;

  const write = (
    level: LogLevel,
    message: string,
    meta?: unknown
  ): void => {
    if (!shouldLog(level)) return;
    const time = new Date().toISOString();
    const safeMeta = meta === undefined ? undefined : redact(meta);
    const line = JSON.stringify({ time, level, category, message, meta: safeMeta });
    if (level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
    persist(time, level, category, message, safeMeta);
  };

  return {
    debug: (m, meta) => write("debug", m, meta),
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
  };
}

const order: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
