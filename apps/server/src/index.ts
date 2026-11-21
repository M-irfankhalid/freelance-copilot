import { createApp } from "./app.js";
import { env } from "./env.js";
import { closeDb } from "./db/index.js";
import { createLogger } from "./lib/logger.js";
import { startScheduler, stopScheduler } from "./modules/automation/scheduler.js";
import { resumeTunnel, stopTunnel } from "./modules/mcp/tunnel-manager.js";

const log = createLogger("system");

/** Bootstrap: start listening, then shut down cleanly on signals. */
const app = createApp();
const server = app.listen(env.SERVER_PORT, () => {
  log.info(`Server listening on http://localhost:${env.SERVER_PORT}`, {
    nodeEnv: env.NODE_ENV,
    database: env.DATABASE_PATH,
  });
});

// Start the automation scheduler (one-user-per-install model).
startScheduler();

// Reconnect a tunnel the user left connected. Runs after listen so the status
// endpoint is available while installation/startup is in progress.
void resumeTunnel();

async function shutdown(signal: string): Promise<void> {
  log.info(`${signal} received, shutting down`);
  stopScheduler();
  await stopTunnel();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
