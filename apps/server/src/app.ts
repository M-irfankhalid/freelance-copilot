import cors from "cors";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { setDefaultAutoSelectFamily } from "node:net";

// Node's Happy Eyeballs races IPv4 against IPv6 for every outbound fetch.
// On hosts with a broken/unroutable IPv6 path this makes the connection
// intermittently time out — the OpenRouter and Freelancer.com credential
// tests would flakily report "Could not reach …" even though the key works
// and the browser/curl reach the service fine. Resolve IPv4-first instead.
setDefaultAutoSelectFamily(false);

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
import { bidsRouter } from "./modules/bids/bids.routes.js";
import { automationRouter } from "./modules/automation/automation.routes.js";
import { logsRouter } from "./modules/logs/logs.routes.js";
import { analyticsRouter } from "./modules/analytics/analytics.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { discordRouter } from "./modules/discord/discord.routes.js";
import { agentRouter } from "./modules/agent/agent.routes.js";
import { mcpRouter } from "./modules/mcp/mcp.routes.js";

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
  app.use("/api/bids", requireUser, bidsRouter);
  app.use("/api/automation", requireUser, automationRouter);
  app.use("/api/logs", requireUser, logsRouter);
  app.use("/api/analytics", requireUser, analyticsRouter);
  app.use("/api/dashboard", requireUser, dashboardRouter);
  app.use("/api/discord", requireUser, discordRouter);
  app.use("/api/agent", requireUser, agentRouter);
  app.use("/api/mcp", requireUser, mcpRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
