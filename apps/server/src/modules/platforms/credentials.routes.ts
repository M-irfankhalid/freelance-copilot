import { Router } from "express";
import { z } from "zod";

import { parseBody } from "../../lib/validate.js";
import {
  deleteCredential,
  getModels,
  listCredentials,
  saveCredential,
  setModel,
  testJevEngine,
  testStored,
  testUnsaved,
} from "./credentials.service.js";

export const credentialsRouter = Router();

function platformParam(value: string) {
  return z
    .enum(["freelancer", "openrouter"])
    .safeParse(value).success;
}

const credentialValue = z
  .string()
  .min(8, "That value looks too short to be a credential");

/** Masked overview — plaintext never leaves the server. */
credentialsRouter.get("/", (_req, res) => {
  res.json({ credentials: listCredentials() });
});

/** Select the OpenRouter models. Two roles — analysis (cheap/fast) and
 *  proposal (strong) — plus the engine behind the relevance gate. The legacy
 *  single `modelId` field still works and applies to both roles. */
credentialsRouter.put("/openrouter/model", (req, res, next) => {
  try {
    const input = parseBody(
      z
        .object({
          modelId: z.string().min(1).max(200).optional(),
          analysisModelId: z.string().min(1).max(200).optional(),
          proposalModelId: z.string().min(1).max(200).optional(),
          analysisEngine: z.enum(["llm", "jev"]).optional(),
          jevModelId: z.string().min(1).max(200).optional(),
        })
        .refine(
          (d) =>
            d.modelId !== undefined ||
            d.analysisModelId !== undefined ||
            d.proposalModelId !== undefined ||
            d.analysisEngine !== undefined ||
            d.jevModelId !== undefined,
          { message: "Provide at least one setting" }
        ),
      req.body
    );
    setModel(input);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

credentialsRouter.post("/openrouter/test-jev", async (req, res, next) => {
  try {
    res.json({ result: await testJevEngine(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

/** Live model catalogue from OpenRouter, requires a saved key. */
credentialsRouter.get("/openrouter/models", async (_req, res, next) => {
  try {
    res.json({ models: await getModels() });
  } catch (error) {
    next(error);
  }
});
/**
 * Test without saving: body carries the not-yet-stored value (onboarding).
 * An empty body tests whatever is stored for that platform.
 */
credentialsRouter.post("/:id/test", async (req, res, next) => {
  try {
    if (!platformParam(req.params.id)) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown platform" } });
      return;
    }
    const id = req.params.id as "freelancer" | "openrouter";
    const hasBody =
      typeof req.body === "object" &&
      req.body !== null &&
      Object.keys(req.body).length > 0;

    if (!hasBody) {
      res.json({ result: await testStored(id) });
      return;
    }
    const input = parseBody(z.object({ value: credentialValue }), req.body);
    res.json({ result: await testUnsaved(id, input.value) });
  } catch (error) {
    next(error);
  }
});

/** Save (or replace) a credential. The value is tested before being stored. */
credentialsRouter.put("/:id", async (req, res, next) => {
  try {
    if (!platformParam(req.params.id)) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown platform" } });
      return;
    }
    const id = req.params.id as "freelancer" | "openrouter";
    const input = parseBody(z.object({ value: credentialValue }), req.body);
    await saveCredential(id, input.value);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

credentialsRouter.delete("/:id", (req, res, next) => {
  try {
    if (!platformParam(req.params.id)) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown platform" } });
      return;
    }
    deleteCredential(req.params.id as "freelancer" | "openrouter");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

