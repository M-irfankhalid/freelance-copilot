import { createLogger } from "../../lib/logger.js";
import { getDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { getOrCreateSettings, runPipeline } from "./automation.service.js";

const log = createLogger("system");

/** Minimum scan interval enforced for the scheduled worker (seconds). */
export const MIN_SCAN_INTERVAL_SECONDS = 30;

/** Default scan interval when no user settings exist (seconds). */
export const DEFAULT_SCAN_INTERVAL_SECONDS = 60;

/**
 * In the one-user-per-install model there is always exactly one owner user.
 * The scheduler polls this row to find the userId to run pipelines for.
 */
function getOwnerId(): string | null {
  const row = getDb()
    .select({ id: users.id })
    .from(users)
    .orderBy(users.createdAt)
    .limit(1)
    .get();
  return row?.id ?? null;
}

/** Clamp the configured interval so we never hammer the Freelancer API. */
function clampInterval(seconds: number): number {
  const safe = Math.max(seconds, MIN_SCAN_INTERVAL_SECONDS);
  return safe * 1000;
}

let timeoutId: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

/**
 * Start the background scheduler. Uses a self-rescheduling setTimeout so the
 * scan interval is re-read from user settings on every tick — if the user
 * changes it in the UI the next cycle picks it up without a server restart.
 */
export function startScheduler(): void {
  if (timeoutId !== null) return; // already running
  scheduleNext();
}

async function scheduleNext(): Promise<void> {
  const userId = getOwnerId();
  let intervalMs: number;

  if (userId) {
    try {
      const settings = await getOrCreateSettings(userId);
      intervalMs = clampInterval(settings.scanIntervalSeconds);
    } catch {
      intervalMs = clampInterval(DEFAULT_SCAN_INTERVAL_SECONDS);
    }
  } else {
    intervalMs = clampInterval(DEFAULT_SCAN_INTERVAL_SECONDS);
  }

  timeoutId = setTimeout(() => {
    void tick();
  }, intervalMs);
}

/** Run one pipeline cycle for the owner user, then re-schedule. */
async function tick(): Promise<void> {
  if (isRunning) {
    log.debug("Pipeline still running, skipping tick");
    void scheduleNext();
    return;
  }
  isRunning = true;

  try {
    const userId = getOwnerId();
    if (userId === null) {
      log.warn("No user found, skipping pipeline tick");
    } else {
      await runPipeline(userId);
    }
  } catch (error) {
    log.error("Scheduler tick failed:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    isRunning = false;
    void scheduleNext();
  }
}

/** Stop the background scheduler. Safe to call even if not started. */
export function stopScheduler(): void {
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
    log.info("Scheduler stopped");
  }
}

/** For testing: expose whether the scheduler is currently scheduled. */
export function isSchedulerRunning(): boolean {
  return timeoutId !== null;
}
