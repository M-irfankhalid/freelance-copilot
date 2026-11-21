import { Router } from "express";

import {
  getProposalGenerationRun,
  listProposalGenerationRuns,
} from "./proposal-trace.service.js";

export const proposalTraceRouter = Router();

/** Read-only list of recent generation attempts, newest first. */
proposalTraceRouter.get("/", (req, res, next) => {
  try {
    const requested = Number(req.query.limit);
    const limit =
      Number.isInteger(requested) && requested > 0 ? Math.min(requested, 100) : 25;
    res.json({ runs: listProposalGenerationRuns(req.user!.id, limit) });
  } catch (error) {
    next(error);
  }
});

/** Read-only detail for one run: full prompts, raw responses, and phase events. */
proposalTraceRouter.get("/:runId", (req, res, next) => {
  try {
    const run = getProposalGenerationRun(req.user!.id, req.params.runId);
    if (run === null) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Generation run not found" },
      });
      return;
    }
    res.json({ run });
  } catch (error) {
    next(error);
  }
});
