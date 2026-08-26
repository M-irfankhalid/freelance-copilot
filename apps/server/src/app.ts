import cors from "cors";
import express, { type Express } from "express";

import { env } from "./env.js";
import { requestLogger } from "./middleware/request-logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { healthRouter } from "./modules/health/health.routes.js";

/**
 * Application factory. Modular monolith: feature modules mount their own
 * routers under /api, and every failure funnels into one error envelope.
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: env.CLIENT_ORIGIN.split(","), credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);

  // Feature modules — one router per module, mounted under /api.
  app.use("/api/health", healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
