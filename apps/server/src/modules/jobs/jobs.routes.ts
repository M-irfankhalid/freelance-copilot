import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { parseBody } from "../../lib/validate.js";
import { requireUser } from "../../middleware/require-user.js";
import { getProfile } from "../profile/profile.service.js";
import { getDb } from "../../db/index.js";
import { jobs as jobsTable } from "../../db/schema.js";
import {
  searchJobs as searchJobsService,
  getJobById as getJobByIdService,
  getJobByUrl as getJobUrlService,
  analyzeJob as analyzeJobService,
  ignoreJob as ignoreJobService,
  listMatches,
  listStoredJobs,
} from "./jobs.service.js";

export const jobsRouter = Router();
jobsRouter.use(requireUser);

/**
 * Parse a numeric project id from a route param. Returns NaN on bad input
 * so the route can return a 400 without throwing.
 */
function parseProjectId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return NaN;
  return n;
}

/** Split a comma-separated query param into clean positive integers. */
function parseSkillIdList(value: string | string[] | undefined): number[] | undefined {
  if (value === undefined) return undefined;
  const arr = Array.isArray(value) ? value : [value];
  const ids = arr
    .flatMap((v) => v.split(","))
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length > 0 ? ids : undefined;
}

/** Split a comma-separated query param into a clean string array. */
function splitQueryList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const arr = Array.isArray(value) ? value : [value];
  const flat = arr.flatMap((v) => v.split(","));
  const trimmed = flat.map((s) => s.trim()).filter((s) => s.length > 0);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Search active jobs from Freelancer.com and persist what we find. */
jobsRouter.get("/search", async (req, res, next) => {
  try {
    const skills = splitQueryList(req.query.skills as string | string[] | undefined);
    const skillIds = parseSkillIdList(req.query.skillIds as string | string[] | undefined);
    const keywords = splitQueryList(req.query.keywords as string | string[] | undefined);
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;

    // When the caller provides no explicit skill filter, fall back to the
    // user's saved Freelancer skill IDs (captured during profile import) so
    // the search returns jobs relevant to the user's actual skill set.
    const profile = getProfile(req.user!.id);
    let resolvedSkillIds = skillIds;
    if ((!resolvedSkillIds || resolvedSkillIds.length === 0) && !skills) {
      if (profile?.skillIds && profile.skillIds.length > 0) {
        resolvedSkillIds = profile.skillIds;
      }
    }

    const jobs = await searchJobsService({
      skills,
      skillIds: resolvedSkillIds,
      keywords,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
      ignoredCountries: profile?.ignoredCountries ?? [],
    });
    res.json({ jobs });
  } catch (error) {
    next(error);
  }
});

/** Analyzed jobs scored against the profile, strongest first. */
jobsRouter.get("/matches", (req, res, next) => {
  try {
    const matches = listMatches(req.user!.id);
    res.json({ matches });
  } catch (error) {
    next(error);
  }
});

/** Get job details by project id. */
jobsRouter.get("/:projectId", async (req, res, next) => {
  try {
    const projectId = parseProjectId(req.params.projectId ?? "");
    if (Number.isNaN(projectId)) {
      res
        .status(400)
        .json({ error: { code: "INVALID_ID", message: "Project id must be a positive integer" } });
      return;
    }
    const job = await getJobByIdService(projectId);
    res.json({ job });
  } catch (error) {
    next(error);
  }
});

/** Get job details by URL or bare project id. */
jobsRouter.post("/by-url", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({ url: z.string().min(1).max(2000) }),
      req.body
    );
    const job = await getJobUrlService(input.url);
    res.json({ job });
  } catch (error) {
    next(error);
  }
});

/** Analyze a job using the AI and the saved profile. No body required. */
jobsRouter.post("/:projectId/analyze", async (req, res, next) => {
  try {
    const projectId = parseProjectId(req.params.projectId ?? "");
    if (Number.isNaN(projectId)) {
      res
        .status(400)
        .json({ error: { code: "INVALID_ID", message: "Project id must be a positive integer" } });
      return;
    }
    const analysis = await analyzeJobService(projectId, req.user!.id);
    res.json({ analysis });
  } catch (error) {
    next(error);
  }
});

/** Mark a job as ignored. */
jobsRouter.post("/:projectId/ignore", async (req, res, next) => {
  try {
    const projectId = parseProjectId(req.params.projectId ?? "");
    if (Number.isNaN(projectId)) {
      res
        .status(400)
        .json({ error: { code: "INVALID_ID", message: "Project id must be a positive integer" } });
      return;
    }
    await ignoreJobService(projectId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/**
 * List the locally stored jobs from the DB cache. Does NOT call Freelancer.com.
 * Supports pagination via ?limit= and ?offset= (defaults: 50, 0).
 * Supports status filter (?status=new|analyzed|ignored) and skills name
 * substring filter (?skills=typescript,react).
 */
jobsRouter.get("/", (req, res, next) => {
  try {
    const statusFilter = req.query.status as string | undefined;
    let status: "new" | "analyzed" | "ignored" | undefined = undefined;
    if (statusFilter && statusFilter !== "all") {
      const allowed = new Set(["new", "analyzed", "ignored"]);
      if (!allowed.has(statusFilter)) {
        res
          .status(400)
          .json({ error: { code: "VALIDATION_ERROR", message: "Unknown status filter" } });
        return;
      }
      status = statusFilter as "new" | "analyzed" | "ignored";
    }

    const skills = splitQueryList(req.query.skills as string | string[] | undefined);
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;

    const jobs = listStoredJobs({
      limit: Number.isFinite(limit ?? 0) ? limit : 50,
      offset: Number.isFinite(offset ?? 0) ? offset : 0,
      skills,
      status,
    });

    const effectiveLimit = Number.isFinite(limit ?? 0) ? limit! : 50;
    const effectiveOffset = Number.isFinite(offset ?? 0) ? offset! : 0;

    // Count total matching rows (before in-memory skills filter, which is
    // applied in listStoredJobs and not worth a separate filtered COUNT).
    const totalRow = getDb()
      .select({ count: sql`count(*)` })
      .from(jobsTable)
      .get();
    const total = Number(totalRow?.count ?? 0);

    res.json({
      jobs,
      total,
      hasMore: jobs.length === effectiveLimit && effectiveOffset + effectiveLimit < total,
    });
  } catch (error) {
    next(error);
  }
});
