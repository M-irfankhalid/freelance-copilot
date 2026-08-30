import { Router } from "express";
import { z } from "zod";

import { parseBody } from "../../lib/validate.js";
import { requireUser } from "../../middleware/require-user.js";
import {
  placeBid,
  listBids,
  getBid,
  updateBidOutcome,
  type BidOutcome,
} from "./bids.service.js";

export const bidsRouter = Router();
bidsRouter.use(requireUser);

/** List user's own bids with optional outcome filter */
bidsRouter.get("/", async (req, res, next) => {
  try {
    const outcomeFilter = req.query.outcome as string | undefined;
    const validOutcomes: BidOutcome[] = ["in_review", "won", "lost"];
    const bids = await listBids(
      req.user!.id,
      outcomeFilter && validOutcomes.includes(outcomeFilter as BidOutcome)
        ? (outcomeFilter as BidOutcome)
        : undefined
    );
    res.json({ bids });
  } catch (error) {
    next(error);
  }
});

/** Get a single bid by ID */
bidsRouter.get("/:id", async (req, res, next) => {
  try {
    const bid = await getBid(req.user!.id, req.params.id);
    if (!bid) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Bid not found" } });
      return;
    }
    res.json({ bid });
  } catch (error) {
    next(error);
  }
});

/** Submit a bid from an approved proposal */
bidsRouter.post("/", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({
        proposalId: z.string().min(1),
        amount: z.number().int().positive(),
        period: z.number().int().positive().max(365),
        milestonePercentage: z.number().int().min(0).max(100).default(0),
      }),
      req.body
    );

    const bid = await placeBid(
      req.user!.id,
      input.proposalId,
      input.amount,
      input.period,
      input.milestonePercentage
    );

    res.status(201).json({ bid });
  } catch (error) {
    next(error);
  }
});

/** Update bid outcome (manual status tracking) */
bidsRouter.put("/:id/outcome", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({ outcome: z.enum(["in_review", "won", "lost"]) }),
      req.body
    );

    await updateBidOutcome(req.user!.id, req.params.id, input.outcome);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});