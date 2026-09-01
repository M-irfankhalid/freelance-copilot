import { Router } from "express";

import { getDashboard } from "./dashboard.service.js";

export const dashboardRouter = Router();

/** Aggregate home-page snapshot from the local database. */
dashboardRouter.get("/", async (req, res, next) => {
  try {
    const snapshot = await getDashboard(req.user!.id);
    res.json({ snapshot });
  } catch (error) {
    next(error);
  }
});
