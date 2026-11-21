import { Router } from "express";
import { z } from "zod";

import { parseBody } from "../../lib/validate.js";
import { requireUser } from "../../middleware/require-user.js";
import {
  getOrCreateSettings,
  saveSettings,
  listRuns,
  runAutoBidCheck,
  runPipeline,
  setPaused,
  resetDailyUsage,
} from "./automation.service.js";
import { automationSettingsPatchSchema } from "./automation.schema.js";

export const automationRouter = Router();
automationRouter.use(requireUser);

/** GET /api/automation — returns current settings */
automationRouter.get("/", async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings(req.user!.id);
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/automation — update settings */
automationRouter.put("/", async (req, res, next) => {
  try {
    const input = parseBody(automationSettingsPatchSchema, req.body);

    const settings = await saveSettings(req.user!.id, input);
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

/** GET /api/automation/runs — list automation run log entries */
automationRouter.get("/runs", async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const runs = await listRuns(req.user!.id, limit);
    res.json({ runs });
  } catch (error) {
    next(error);
  }
});

/** POST /api/automation/pause — pause or resume the automation worker */
automationRouter.post("/pause", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({ paused: z.boolean() }),
      req.body
    );

    await setPaused(req.user!.id, input.paused);
    res.json({ ok: true, paused: input.paused });
  } catch (error) {
    next(error);
  }
});

/** POST /api/automation/reset-daily-usage — zero today's bid counter so the
 *  worker can auto-bid again the same day. */
automationRouter.post("/reset-daily-usage", async (req, res, next) => {
  try {
    const settings = await resetDailyUsage(req.user!.id);
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

/** POST /api/automation/auto-bid-check — manually trigger an auto-bid check cycle */
automationRouter.post("/auto-bid-check", async (req, res, next) => {
  try {
    await runAutoBidCheck(req.user!.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/** POST /api/automation/run-pipeline — manually trigger a full pipeline cycle */
automationRouter.post("/run-pipeline", async (req, res, next) => {
  try {
    const result = await runPipeline(req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});