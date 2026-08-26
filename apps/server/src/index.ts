import { createApp } from "./app.js";
import { env } from "./env.js";
import { closeDb } from "./db/index.js";
import { createLogger } from "./lib/logger.js";

const log = createLogger("system");

/** Bootstrap: start listening, then shut down cleanly on signals. */
const app = createApp();
const server = app.listen(env.SERVER_PORT, () => {
  log.info(`Server listening on http://localhost:${env.SERVER_PORT}`, {
    nodeEnv: env.NODE_ENV,
    database: env.DATABASE_PATH,
  });
});

function shutdown(signal: string): void {
  log.info(`${signal} received, shutting down`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
