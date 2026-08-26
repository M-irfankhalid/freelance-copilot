import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../../db/index.js";
import { platformCredentials, userProfile } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { decrypt } from "../../lib/crypto.js";
import { createLogger } from "../../lib/logger.js";

/**
 * The profile is the only source of truth the agent may use about the user.
 * Everything here is user-entered or imported from Freelancer.com — the AI
 * never invents any of it.
 */

const log = createLogger("system");

export const profileSchema = z.object({
  freelancerUsername: z.string().max(100).nullable(),
  name: z.string().max(200).nullable(),
  title: z.string().max(300).nullable(),
  hourlyRate: z.string().max(50).nullable(),
  about: z.string().max(10_000).nullable(),
  skills: z.array(z.string().min(1).max(60)).max(50),
  experience: z
    .array(
      z.object({
        role: z.string().min(1).max(120),
        company: z.string().min(1).max(120),
        periodLabel: z.string().min(1).max(60),
        summary: z.string().max(2_000).nullable(),
      })
    )
    .max(20),
  portfolio: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        url: z.string().max(500).nullable(),
        description: z.string().max(1_000).nullable(),
      })
    )
    .max(30),
  certifications: z.array(z.string().min(1).max(160)).max(20),
  preferredProjectTypes: z.array(z.string().min(1).max(80)).max(20),
  wants: z.array(z.string().min(1).max(60)).max(30),
  notWants: z.array(z.string().min(1).max(60)).max(30),
  customInstructions: z.string().max(5_000).nullable(),
});

export type ProfileData = z.infer<typeof profileSchema>;

interface ProfileRow {
  freelancerUsername: string | null;
  name: string | null;
  title: string | null;
  hourlyRate: string | null;
  about: string | null;
  skills: string | null;
  experience: string | null;
  portfolio: string | null;
  certifications: string | null;
  preferredProjectTypes: string | null;
  wants: string | null;
  notWants: string | null;
  customInstructions: string | null;
  importedFromFreelancer: string;
}

function parseJsonArray(raw: string | null): unknown[] {
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getProfile(userId: string): ProfileData | null {
  const row = getDb()
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .get();
  if (row === undefined) {
    return null;
  }
  const r = row as ProfileRow;
  // Stored rows were validated on write; parse defensively anyway.
  const parsed = profileSchema.safeParse({
    freelancerUsername: r.freelancerUsername,
    name: r.name,
    title: r.title,
    hourlyRate: r.hourlyRate,
    about: r.about,
    skills: parseJsonArray(r.skills),
    experience: parseJsonArray(r.experience),
    portfolio: parseJsonArray(r.portfolio),
    certifications: parseJsonArray(r.certifications),
    preferredProjectTypes: parseJsonArray(r.preferredProjectTypes),
    wants: parseJsonArray(r.wants),
    notWants: parseJsonArray(r.notWants),
    customInstructions: r.customInstructions,
  });
  return parsed.success ? parsed.data : null;
}

export function saveProfile(userId: string, data: ProfileData): void {
  const now = new Date().toISOString();
  const values = {
    userId,
    freelancerUsername: data.freelancerUsername,
    name: data.name,
    title: data.title,
    hourlyRate: data.hourlyRate,
    about: data.about,
    skills: JSON.stringify(data.skills),
    experience: JSON.stringify(data.experience),
    portfolio: JSON.stringify(data.portfolio),
    certifications: JSON.stringify(data.certifications),
    preferredProjectTypes: JSON.stringify(data.preferredProjectTypes),
    wants: JSON.stringify(data.wants),
    notWants: JSON.stringify(data.notWants),
    customInstructions: data.customInstructions,
    updatedAt: now,
  };
  const existing = getDb()
    .select({ userId: userProfile.userId })
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .get();
  if (existing !== undefined) {
    getDb()
      .update(userProfile)
      .set(values)
      .where(eq(userProfile.userId, userId))
      .run();
  } else {
    getDb()
      .insert(userProfile)
      .values({ ...values, importedFromFreelancer: "0" })
      .run();
  }
}

interface FreelancerPortfolio {
  id: number;
  title: string;
  description: string | null;
  files: Array<{
    cdn_url: string | null;
    thumbnails?: Array<{ cdn_url: string | null }>;
  }>;
}

/**
 * Fetch the owner's own public data from Freelancer.com using their stored
 * token and map it onto our profile shape. Returns a draft — nothing is
 * saved until the user reviews and saves it.
 *
 * Two API calls are made:
 *  1. Self endpoint with profile_description=true and jobs=true to get the
 *     profile text, skills (jobs array), and the user's Freelancer ID.
 *  2. Portfolios endpoint using the user ID to fetch portfolio projects.
 */
export async function importFromFreelancer(): Promise<ProfileData> {
  const credRow = getDb()
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "freelancer"))
    .get();
  if (credRow === undefined) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Save a Freelancer.com access token first (Platforms page)"
    );
  }
  const token = decrypt(credRow);
  const authHeaders = { Authorization: `Bearer ${token}` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  // Step 1: Fetch self endpoint with expanded params.
  let selfResponse: Response;
  try {
    selfResponse = await fetch(
      "https://www.freelancer.com/api/users/0.1/self/?compact=false&profile_description=true&jobs=true",
      { headers: authHeaders, signal: controller.signal }
    );
  } catch {
    throw new AppError(502, "UPSTREAM_ERROR", "Could not reach Freelancer.com");
  } finally {
    clearTimeout(timer);
  }

  if (!selfResponse.ok) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Freelancer.com responded with status ${selfResponse.status}`
    );
  }
  const selfBody = (await selfResponse.json()) as {
    status?: string;
    result?: Record<string, unknown>;
  };
  if (selfBody.status !== "success" || selfBody.result === undefined) {
    throw new AppError(502, "UPSTREAM_ERROR", "Freelancer.com returned no profile");
  }

  const r = selfBody.result;
  const asString = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

  // Extract user ID for the portfolios API call.
  const userId = typeof r.id === "number" ? r.id : Number(r.id);

  // Step 2: Fetch portfolios using the user ID.
  let portfolio: ProfileData["portfolio"] = [];
  if (!Number.isNaN(userId) && userId > 0) {
    const pt = setTimeout(() => controller.abort(), 10_000);
    let portfoliosResponse: Response | null = null;
    try {
      portfoliosResponse = await fetch(
        `https://www.freelancer.com/api/users/0.1/portfolios/?users[]=${userId}&compact=false`,
        { headers: authHeaders }
      );
    } catch {
      // Portfolio fetch failure is non-fatal — import still returns basics.
      clearTimeout(pt);
      portfolio = [];
    } finally {
      clearTimeout(pt);
    }

    if (portfoliosResponse?.ok) {
      const pBody = (await portfoliosResponse.json()) as {
        status?: string;
        result?: {
          portfolios?: Record<string, FreelancerPortfolio[]>;
        };
      };
      if (pBody.status === "success" && pBody.result?.portfolios) {
        const items = pBody.result.portfolios[String(userId)] ?? [];
        portfolio = items
          .filter(
            (p): p is FreelancerPortfolio =>
              p !== null &&
              typeof p === "object" &&
              typeof p.title === "string" &&
              p.title.trim().length > 0
          )
          .map((p) => {
            const url =
              p.files?.[0]?.cdn_url ??
              p.files?.[0]?.thumbnails?.[0]?.cdn_url ??
              null;
            return {
              title: p.title.trim(),
              url: url ? `https:${url}` : null,
              description: asString(p.description),
            };
          })
          .slice(0, 30);
      }
    }
  }

  // The self endpoint returns only public profile fields. With
  // profile_description=true we get the full About text. With jobs=true we get
  // the user's skill/job categories (name field).
  const draft = profileSchema.parse({
    freelancerUsername: asString(r.username),
    name: asString(r.display_name) ?? asString(r.username),
    title: asString(r.public_name),
    hourlyRate:
      typeof r.hourly_rate === "number" ? `$${r.hourly_rate}/hr` : null,
    about: asString(r.profile_description),
    skills:
      Array.isArray(r.jobs)
        ? r.jobs
            .filter(
              (j): j is { name: string } =>
                j !== null &&
                typeof j === "object" &&
                "name" in j &&
                typeof (j as { name: unknown }).name === "string"
            )
            .map((j) => (j as { name: string }).name)
            .slice(0, 50)
        : [],
    experience: [],
    portfolio,
    certifications: [],
    preferredProjectTypes: [],
    wants: [],
    notWants: [],
    customInstructions: null,
  });

  log.info(
    `Imported Freelancer profile for @${draft.freelancerUsername ?? "unknown"}`,
    { portfolioCount: portfolio.length, skillCount: draft.skills.length }
  );
  return draft;
}
