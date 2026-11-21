import { Router } from "express";
import { z } from "zod";

import { parseBody } from "../../lib/validate.js";
import { notFound } from "../../lib/errors.js";
import {
  deleteAllSamples,
  deletePlaybook,
  deleteSample,
  getLatestProfileAudit,
  getProfileAuditSettings,
  getProposalEngineConfig,
  importSamplesFromBids,
  listPlaybooks,
  listSamples,
  playbookInputSchema,
  profileAuditSettingsPatchSchema,
  proposalEnginePatchSchema,
  resetProposalEngineConfig,
  sampleInputSchema,
  saveProfileAuditSettings,
  saveProposalEngineConfig,
  upgradeProposalEngineConfig,
  upsertPlaybook,
  upsertSample,
} from "./proposal-config.service.js";
import { runProfileAudit } from "./profile-audit.service.js";

export const proposalConfigRouter = Router();

proposalConfigRouter.get("/", (_req, res) => {
  const userId = _req.user!.id;
  res.json({
    engine: getProposalEngineConfig(userId),
    playbooks: listPlaybooks(userId),
    samples: listSamples(userId),
    auditSettings: getProfileAuditSettings(userId),
    latestAudit: getLatestProfileAudit(userId),
  });
});

proposalConfigRouter.put("/engine", (req, res, next) => {
  try {
    const patch = parseBody(proposalEnginePatchSchema, req.body);
    res.json({ engine: saveProposalEngineConfig(req.user!.id, patch) });
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.post("/engine/reset", (req, res, next) => {
  try {
    res.json({ engine: resetProposalEngineConfig(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.post("/engine/upgrade", (req, res, next) => {
  try {
    res.json(upgradeProposalEngineConfig(req.user!.id));
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.post("/playbooks", (req, res, next) => {
  try {
    const input = parseBody(playbookInputSchema, req.body);
    res.status(201).json({ playbook: upsertPlaybook(req.user!.id, input) });
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.put("/playbooks/:id", (req, res, next) => {
  try {
    const userId = req.user!.id;
    const existing = listPlaybooks(userId).find((playbook) => playbook.id === req.params.id);
    if (existing === undefined) throw notFound(`Playbook ${req.params.id} not found`);
    const patch = parseBody(playbookInputSchema.partial(), req.body);
    const merged = playbookInputSchema.parse({ ...existing, ...patch });
    res.json({ playbook: upsertPlaybook(userId, merged, existing.id) });
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.delete("/playbooks/:id", (req, res, next) => {
  try {
    deletePlaybook(req.user!.id, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

const importSamplesBodySchema = z
  .object({
    bidIds: z.array(z.string().min(1).max(200)).min(1).max(500),
  })
  .strict();

proposalConfigRouter.post("/samples/import", (req, res, next) => {
  try {
    const body = parseBody(importSamplesBodySchema, req.body);
    res.json(importSamplesFromBids(req.user!.id, body.bidIds));
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.delete("/samples", (req, res, next) => {
  try {
    res.json({ ok: true, deleted: deleteAllSamples(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.post("/samples", (req, res, next) => {
  try {
    const input = parseBody(sampleInputSchema, req.body);
    res.status(201).json({ sample: upsertSample(req.user!.id, input) });
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.put("/samples/:id", (req, res, next) => {
  try {
    const userId = req.user!.id;
    const existing = listSamples(userId).find((sample) => sample.id === req.params.id);
    if (existing === undefined) throw notFound(`Sample ${req.params.id} not found`);
    const patch = parseBody(sampleInputSchema.partial(), req.body);
    const merged = sampleInputSchema.parse({ ...existing, ...patch });
    res.json({ sample: upsertSample(userId, merged, existing.id) });
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.delete("/samples/:id", (req, res, next) => {
  try {
    deleteSample(req.user!.id, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.put("/audit/settings", (req, res, next) => {
  try {
    const patch = parseBody(profileAuditSettingsPatchSchema, req.body);
    res.json({ auditSettings: saveProfileAuditSettings(req.user!.id, patch) });
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.post("/audit/run", async (req, res, next) => {
  try {
    res.json(await runProfileAudit(req.user!.id));
  } catch (error) {
    next(error);
  }
});

proposalConfigRouter.get("/audit/latest", (req, res) => {
  res.json({ audit: getLatestProfileAudit(req.user!.id) });
});
