import { Router } from "express";

import {
  DEFAULT_PROPOSAL_SYSTEM_INSTRUCTIONS,
  DEFAULT_PROPOSAL_WRITING_INSTRUCTIONS,
} from "../../lib/proposal-instructions.js";
import { parseBody } from "../../lib/validate.js";
import { buildProfileBrief } from "./profile-brief.js";
import {
  getProfile,
  importFromFreelancer,
  profileSchema,
  saveProfile,
} from "./profile.service.js";

export const profileRouter = Router();

/** The owner's profile, or null before it is first saved. */
profileRouter.get("/", (req, res) => {
  const profile = getProfile(req.user!.id);
  res.json({
    profile,
    aiBrief: profile === null ? null : buildProfileBrief(profile),
    writerDefaults: {
      proposalSystemInstructions: DEFAULT_PROPOSAL_SYSTEM_INSTRUCTIONS,
      proposalWritingInstructions: DEFAULT_PROPOSAL_WRITING_INSTRUCTIONS,
    },
  });
});

/** Replace the whole profile. Validated strictly — this grounds all AI output. */
profileRouter.put("/", (req, res, next) => {
  try {
    const data = parseBody(profileSchema, req.body);
    saveProfile(req.user!.id, data);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/**
 * Pull the owner's public data from Freelancer.com and map it to our shape.
 * Returns a draft for review; nothing is stored until PUT arrives.
 */
profileRouter.post("/import", async (_req, res, next) => {
  try {
    res.json({ profile: await importFromFreelancer() });
  } catch (error) {
    next(error);
  }
});
