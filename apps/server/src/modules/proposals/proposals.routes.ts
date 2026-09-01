import { Router } from "express";
import { z } from "zod";

import { parseBody } from "../../lib/validate.js";
import {
  createProposal,
  listProposals,
  getProposal,
  getProposalByJob,
  updateProposalStatus,
  saveProposal,
  generateProposal,
  regenerateProposal,
  type ProposalStatus,
  proposalStatusEnum,
} from "./proposals.service.js";

export const proposalsRouter = Router();

/** List proposals with optional status filter */
proposalsRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const statusFilter = req.query.status as string | undefined;
    const proposals = await listProposals(
      userId,
      statusFilter && proposalStatusEnum.includes(statusFilter as ProposalStatus)
        ? (statusFilter as ProposalStatus)
        : undefined
    );
    res.json({ proposals });
  } catch (error) {
    next(error);
  }
});

/** Get the proposal for a job (if one exists). Used by the job detail page to
 *  prefill the proposal box and to enable in-place regeneration. */
proposalsRouter.get("/job/:jobId", async (req, res, next) => {
  try {
    const proposal = await getProposalByJob(req.user!.id, req.params.jobId);
    res.json({ proposal });
  } catch (error) {
    next(error);
  }
});

/** Get a single proposal by ID */
proposalsRouter.get("/:id", async (req, res, next) => {
  try {
    const proposal = await getProposal(req.user!.id, req.params.id);
    if (!proposal) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Proposal not found" } });
      return;
    }
    res.json({ proposal });
  } catch (error) {
    next(error);
  }
});

/** Create a new proposal (draft) */
proposalsRouter.post("/", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({
        jobId: z.string().min(1),
        projectId: z.number().int().positive(),
        jobTitle: z.string().min(1).max(500),
        client: z.string().min(1).max(200),
        content: z.string().min(10),
        bidAmount: z.number().optional(),
        competitorNote: z.string().optional(),
      }),
      req.body
    );

    const proposal = await createProposal(req.user!.id, {
      jobId: input.jobId,
      projectId: input.projectId,
      jobTitle: input.jobTitle,
      client: input.client,
      content: input.content,
      bidAmount: input.bidAmount,
      competitorNote: input.competitorNote,
    });

    res.status(201).json({ proposal });
  } catch (error) {
    next(error);
  }
});

/** Generate proposal using AI (grounded in profile facts) */
proposalsRouter.post("/generate", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({
        jobId: z.string().min(1),
        projectId: z.number().int().positive(),
        jobTitle: z.string().min(1).max(500),
        clientName: z.string().min(1).max(200),
        description: z.array(z.string()).default([]),
        jobSkills: z.array(z.string()).default([]),
        bidStats: z
          .object({
            bidCount: z.number().optional(),
            avgBid: z.string().optional(),
            highBid: z.string().optional(),
            lowBid: z.string().optional(),
          })
          .optional(),
        projectType: z.string().nullable().optional(),
        bidPeriod: z.number().nullable().optional(),
        upgrades: z
          .object({
            featured: z.boolean(),
            urgent: z.boolean(),
            sealed: z.boolean(),
          })
          .optional(),
        competition: z
          .object({
            bidCount: z.number(),
            minBid: z.number().nullable(),
            maxBid: z.number().nullable(),
            medianBid: z.number().nullable(),
            isCheapest: z.boolean(),
          })
          .nullable()
          .optional(),
      }),
      req.body
    );

    const result = await generateProposal(
      req.user!.id,
      input.jobId,
      input.projectId,
      input.jobTitle,
      input.clientName,
      input.description,
      input.jobSkills,
      input.bidStats,
      input.projectType,
      input.bidPeriod,
      input.upgrades,
      input.competition
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Regenerate a proposal using AI with fresh context. */
proposalsRouter.post("/:id/regenerate", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({
        projectType: z.string().nullable().optional(),
        bidPeriod: z.number().nullable().optional(),
        upgrades: z
          .object({
            featured: z.boolean(),
            urgent: z.boolean(),
            sealed: z.boolean(),
          })
          .optional(),
        competition: z
          .object({
            bidCount: z.number(),
            minBid: z.number().nullable(),
            maxBid: z.number().nullable(),
            medianBid: z.number().nullable(),
            isCheapest: z.boolean(),
          })
          .nullable()
          .optional(),
      }),
      req.body
    );

    const { content, competitorNote } = await regenerateProposal(
      req.user!.id,
      req.params.id,
      input.projectType,
      input.bidPeriod,
      input.upgrades,
      input.competition
    );

    res.json({ proposal: { content, competitorNote }, competitorNote });
  } catch (error) {
    next(error);
  }
});

/** Update proposal status (approval queue) */
proposalsRouter.put("/:id/status", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({ status: z.enum(["draft", "queued", "awaiting_approval", "approved", "submitted", "viewed", "shortlisted", "declined", "won"]) }),
      req.body
    );

    await updateProposalStatus(req.user!.id, req.params.id, input.status);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/** Save (edit) proposal content */
proposalsRouter.put("/:id", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({
        content: z.string().min(10),
        bidAmount: z.number().optional(),
      }),
      req.body
    );

    await saveProposal(req.user!.id, req.params.id, input.content, input.bidAmount);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
