import cors from "cors";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";

import { env } from "./env.js";
import { requestLogger } from "./middleware/request-logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { credentialsRouter } from "./modules/platforms/credentials.routes.js";
import { profileRouter } from "./modules/profile/profile.routes.js";
import { jobsRouter } from "./modules/jobs/jobs.routes.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { proposalsRouter } from "./modules/proposals/proposals.routes.js";
import { requireUser } from "./middleware/require-user.js";

/**
 * Application factory. Modular monolith: feature modules mount their own
 * routers under /api, and every failure funnels into one error envelope.
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: env.CLIENT_ORIGIN.split(","), credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requestLogger);

  // Feature modules — one router per module, mounted under /api.
  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/credentials", requireUser, credentialsRouter);
  app.use("/api/profile", requireUser, profileRouter);
  app.use("/api/jobs", requireUser, jobsRouter);
  app.use("/api/ai", requireUser, aiRouter);
  app.use("/api/proposals", requireUser, proposalsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
