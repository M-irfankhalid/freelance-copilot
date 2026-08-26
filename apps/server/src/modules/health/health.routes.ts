import { Router } from "express";

export const healthRouter = Router();

/** Liveness probe consumed by the frontend shell and by tests. */
healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
