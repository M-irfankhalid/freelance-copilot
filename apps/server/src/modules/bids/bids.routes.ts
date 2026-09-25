import { Router } from "express";
import { z } from "zod";

import { parseBody } from "../../lib/validate.js";
import { requireUser } from "../../middleware/require-user.js";
import {
  placeBid,
  listBids,
  getBid,
  reviseBid,
  findMyBidOnFreelancer,
  updateBidOutcome,
  type BidOutcome,
} from "./bids.service.js";

export const bidsRouter = Router();
bidsRouter.use(requireUser);

/**
 * Parse a numeric project id from a route param, returning null on bad input so
 * the route can answer 400 without throwing.
 */
function parseProjectId(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

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

/**
 * Find the user's own bid on a project on Freelancer.com.
 *
 * Declared before `GET /:id` so the path shapes cannot collide. Called only when
 * the user clicks Find in the Update bid dialog — it is one extra upstream call,
 * and it is deliberately not made on their behalf.
 */
bidsRouter.get("/project/:projectId/find", async (req, res, next) => {
  try {
    const projectId = parseProjectId(req.params.projectId ?? "");
    if (projectId === null) {
      res.status(400).json({
        error: { code: "INVALID_ID", message: "Project id must be a positive integer" },
      });
      return;
    }
    const bid = await findMyBidOnFreelancer(projectId);
    res.json({ bid });
  } catch (error) {
    next(error);
  }
});

/**
 * Update a bid that is already on Freelancer.com.
 *
 * Keyed by project rather than by our own bid id: the user may be updating a
 * bid this app never placed, in which case there is no local row to key on and
 * the bid id comes from them.
 */
bidsRouter.put("/project/:projectId", async (req, res, next) => {
  try {
    const projectId = parseProjectId(req.params.projectId ?? "");
    if (projectId === null) {
      res.status(400).json({
        error: { code: "INVALID_ID", message: "Project id must be a positive integer" },
      });
      return;
    }

    const input = parseBody(
      z.object({
        freelancerBidId: z.number().int().positive(),
        description: z.string().min(1),
        // Same rules as POST / — including Freelancer's 20-100 milestone
        // requirement, which it enforces on update as well as on placement.
        amount: z.number().int().positive(),
        milestonePercentage: z.number().min(20).max(100),
      }),
      req.body
    );

    const bid = await reviseBid(req.user!.id, projectId, input);
    res.json({ bid });
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
        // Freelancer.com requires a milestone percentage between 20 and 100;
        // sending 0 (the old default) is rejected upstream with
        // "Please fill in the milestone percentage (20 - 100)".
        milestonePercentage: z.number().min(20).max(100),
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