import { Router } from "express";

import { getAnalytics } from "./analytics.service.js";

export const analyticsRouter = Router();

/** GET /api/analytics — aggregate KPIs, bid outcomes, and proposal breakdown. */
analyticsRouter.get("/", async (req, res, next) => {
  try {
    const snapshot = await getAnalytics(req.user!.id);
    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});
