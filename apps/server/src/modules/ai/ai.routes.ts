import { Router } from "express";
import { z } from "zod";

import { parseBody } from "../../lib/validate.js";
import { analyzeJob } from "./ai.service.js";
import { generateUserSummary } from "./summary.service.js";

export const aiRouter = Router();

/** Analyze a job using the AI with profile-grounded facts. */
aiRouter.post("/analyze", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({
        jobTitle: z.string().min(1).max(500),
        jobDescription: z.array(z.string()).default([]),
        skills: z.array(z.string()).default([]),
        profileSkills: z.array(z.string()).min(1, "Profile skills are required"),
        wants: z.array(z.string()).default([]),
        notWants: z.array(z.string()).default([]),
        hourlyRate: z.string().max(50).nullable().optional(),
        budgetLabel: z.string().max(100).optional(),
        clientName: z.string().max(200).optional(),
        bidCount: z.number().optional(),
        avgBid: z.string().max(50).optional(),
      }),
      req.body
    );

    const result = await analyzeJob({
      jobTitle: input.jobTitle,
      jobDescription: input.jobDescription,
      skills: input.skills,
      profileSkills: input.profileSkills,
      wants: input.wants,
      notWants: input.notWants,
      hourlyRate: input.hourlyRate ?? null,
      budgetLabel: input.budgetLabel,
      clientName: input.clientName,
      bidCount: input.bidCount,
      avgBid: input.avgBid,
    });

    res.json({ result });
  } catch (error) {
    next(error);
  }
});

/** Generate a user summary from the saved profile data. */
aiRouter.post("/summary", async (req, res, next) => {
  try {
    
    const userId = req.user!.id;
    const input = parseBody(
      z.object({
        model: z.string().max(200).optional(),
      }),
      req.body
    );
    const summary = await generateUserSummary(userId, input.model);
    res.json({ summary });
  } catch (error) {
    next(error);
  }
});
