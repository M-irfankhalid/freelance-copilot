import cors from "cors";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { existsSync } from "node:fs";
import { setDefaultAutoSelectFamily } from "node:net";
import { resolve } from "node:path";

// Node's Happy Eyeballs races IPv4 against IPv6 for every outbound fetch.
// On hosts with a broken/unroutable IPv6 path this makes the connection
// intermittently time out — the OpenRouter and Freelancer.com credential
// tests would flakily report "Could not reach …" even though the key works
// and the browser/curl reach the service fine. Resolve IPv4-first instead.
setDefaultAutoSelectFamily(false);

import { APP_ROOT, env } from "./env.js";
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
import { proposalConfigRouter } from "./modules/proposals/proposal-config.routes.js";
import { proposalTraceRouter } from "./modules/proposals/proposal-trace.routes.js";
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
  app.use((_req, res, next) => {
    // Small, dependency-free hardening for the self-hosted single-user app.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()),
      credentials: true,
    })
  );
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
  app.use("/api/proposal-system", requireUser, proposalConfigRouter);
  app.use("/api/proposal-traces", requireUser, proposalTraceRouter);
  app.use("/api/bids", requireUser, bidsRouter);
  app.use("/api/automation", requireUser, automationRouter);
  app.use("/api/logs", requireUser, logsRouter);
  app.use("/api/analytics", requireUser, analyticsRouter);
  app.use("/api/dashboard", requireUser, dashboardRouter);
  app.use("/api/discord", requireUser, discordRouter);
  app.use("/api/agent", requireUser, agentRouter);
  app.use("/api/mcp", requireUser, mcpRouter);

  // In production the built web app sits next to the server package. Serving
  // it from the same origin means a single container (or `pnpm start`) is
  // enough — no separate web server, proxy, or CORS setup for the owner.
  const webDist = resolve(APP_ROOT, "../web/dist");
  if (existsSync(resolve(webDist, "index.html"))) {
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (/[\\/]assets[\\/]/.test(filePath)) {
            // Vite fingerprints asset filenames, so they can be cached forever.
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      })
    );

    // Client-side routes (React Router) fall back to index.html. API paths
    // still reach the JSON not-found handler below.
    app.use((req, res, next) => {
      if (
        (req.method !== "GET" && req.method !== "HEAD") ||
        req.path === "/api" ||
        req.path.startsWith("/api/")
      ) {
        next();
        return;
      }
      res.sendFile(resolve(webDist, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
