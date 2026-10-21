import { Router } from "express";
import { z } from "zod";

import { parseBody } from "../../lib/validate.js";
import {
  MAX_DELIVERY_DAYS,
  MIN_DELIVERY_DAYS,
  isValidBidAmountFraction,
} from "../../lib/delivery-timeline.js";
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
    const input = parseBody(
      z.object({
        scanIntervalSeconds: z.number().int().positive().max(3600).optional(),
        autoAnalyze: z.boolean().optional(),
        autoMatch: z.boolean().optional(),
        autobidEnabled: z.boolean().optional(),
        minMatchScore: z.number().int().min(0).max(100).optional(),
        minBid: z.number().int().positive().optional(),
        maxBid: z.number().int().positive().optional(),
        dailyCap: z.number().int().positive().max(100).optional(),
        rejectStaleJobs: z.boolean().optional(),
        rejectIgnoredCountries: z.boolean().optional(),
        rejectBadReputation: z.boolean().optional(),
        aiDeliveryTimeline: z.boolean().optional(),
        preferredDeliveryDays: z
          .number()
          .int()
          .min(MIN_DELIVERY_DAYS)
          .max(MAX_DELIVERY_DAYS)
          .optional(),
        // At least one value: the list is the AI's whole answer space, so an
        // empty one would leave it nothing to choose (and is not a valid
        // JSON-schema enum either). Sanitized again on write and on read.
        deliveryTimelineOptions: z
          .array(z.number().int().min(MIN_DELIVERY_DAYS).max(MAX_DELIVERY_DAYS))
          .min(1)
          .max(12)
          .optional(),
        deliveryTimelineInstructions: z.string().max(2000).optional(),
        aiBidAmount: z.boolean().optional(),
        // Must be valid fraction strings ("X/Y" or "full") — the gate builds its
        // answer space from these. At least one is required (an empty list would
        // leave the AI nothing to choose, and is not a valid JSON-schema enum).
        bidAmountFractions: z
          .array(z.string().max(20))
          .min(1)
          .max(50)
          .refine((values) => values.every(isValidBidAmountFraction), {
            message:
              "Each option must be a fraction (1/2), a positive multiplier (0.5, 2), or full",
          })
          .optional(),
        bidAmountInstructions: z.string().max(2000).optional(),
        defaultBidMarkupPct: z.number().int().min(0).max(100).optional(),
        bidAmountMarkupInstructions: z.string().max(2000).optional(),
        roundBidUpTo: z.number().int().min(0).max(1000).optional(),
      }),
      req.body
    );

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