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
  /** Numeric Freelancer.com skill/category ids paired 1:1 with `skills`. */
  skillIds: z.array(z.number().int().positive()).max(50),
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
  /** Country names/codes whose jobs are excluded before any analysis. */
  ignoredCountries: z.array(z.string().min(1).max(60)).max(50),
  customInstructions: z.string().max(20_000).nullable(),
  userSummary: z.string().max(10_000).nullable().optional(),
  /** Free-text guidance for the relevance model, e.g. "no web3 projects". */
  relevancyInstructions: z.string().max(20_000).nullable().optional(),
  /** Markdown summary of portfolio projects, used during proposal generation. */
  portfolioSummary: z.string().max(40_000).nullable().optional(),
  /** Markdown block holding all proposal templates, used during proposal generation. */
  proposalTemplates: z.string().max(40_000).nullable().optional(),
});

export type ProfileData = z.infer<typeof profileSchema>;

interface ProfileRow {
  freelancerUsername: string | null;
  name: string | null;
  title: string | null;
  hourlyRate: string | null;
  about: string | null;
  skills: string | null;
  skillIds: string | null;
  experience: string | null;
  portfolio: string | null;
  certifications: string | null;
  preferredProjectTypes: string | null;
  wants: string | null;
  notWants: string | null;
  ignoredCountries: string | null;
  customInstructions: string | null;
  importedFromFreelancer: string;
  userSummary: string | null;
  relevancyInstructions: string | null;
  portfolioSummary: string | null;
  proposalTemplates: string | null;
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
    skillIds: parseJsonArray(r.skillIds).filter(
      (v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0
    ),
    experience: parseJsonArray(r.experience),
    portfolio: parseJsonArray(r.portfolio),
    certifications: parseJsonArray(r.certifications),
    preferredProjectTypes: parseJsonArray(r.preferredProjectTypes),
    wants: parseJsonArray(r.wants),
    notWants: parseJsonArray(r.notWants),
    ignoredCountries: parseJsonArray(r.ignoredCountries),
    customInstructions: r.customInstructions,
    userSummary: r.userSummary,
    relevancyInstructions: r.relevancyInstructions,
    portfolioSummary: r.portfolioSummary,
    proposalTemplates: r.proposalTemplates,
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
    skillIds: JSON.stringify(data.skillIds),
    experience: JSON.stringify(data.experience),
    portfolio: JSON.stringify(data.portfolio),
    certifications: JSON.stringify(data.certifications),
    preferredProjectTypes: JSON.stringify(data.preferredProjectTypes),
    wants: JSON.stringify(data.wants),
    notWants: JSON.stringify(data.notWants),
    ignoredCountries: JSON.stringify(data.ignoredCountries),
    customInstructions: data.customInstructions,
    userSummary: data.userSummary ?? null,
    relevancyInstructions: data.relevancyInstructions ?? null,
    portfolioSummary: data.portfolioSummary ?? null,
    proposalTemplates: data.proposalTemplates ?? null,
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
      "https://www.freelancer.com/api/users/0.1/self/?compact=false&avatar=true&country_details=true&profile_description=true&display_info=true&jobs=true&membership_details=true&location_details=true&portfolio_details=true&preferred_details=true&cover_image=true&past_cover_images=true&mobile_tracking=true&user_recommendations=true&sanction_details=true&rising_star=true&shareholder_details=true",
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

  // Build skills and skill IDs from the real API. The self endpoint returns
  // jobs[] as { id, name, category, ... } — we store the names for display
  // matching and the numeric IDs for direct use in the jobs search API
  // (jobs[]=id) without relying on the incomplete manual name-to-id table.
  const skillObjects = Array.isArray(r.jobs)
    ? r.jobs
        .filter(
          (j): j is { id: number; name: string } =>
            j !== null &&
            typeof j === "object" &&
            typeof (j as { id?: unknown }).id === "number" &&
            Number.isInteger((j as { id?: unknown }).id) &&
            typeof (j as { name?: unknown }).name === "string"
        )
        .map((j) => ({ id: j.id, name: j.name.trim() }))
        .filter((s) => s.name.length > 0)
        .slice(0, 50)
    : [];

  const skillsData = skillObjects.map((s) => s.name);
  const skillIdsData = skillObjects.map((s) => s.id);

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
    skills: skillsData,
    skillIds: skillIdsData,
    experience: [],
    portfolio,
    certifications: [],
    preferredProjectTypes: [],
    wants: [],
    notWants: [],
    ignoredCountries: [],
    customInstructions: null,
    // These are written by the user or the summary generator — never the import.
    relevancyInstructions: null,
    portfolioSummary: null,
    proposalTemplates: null,
  });

  log.info(
    `Imported Freelancer profile for @${draft.freelancerUsername ?? "unknown"}`,
    { portfolioCount: portfolio.length, skillCount: draft.skills.length }
  );
  return draft;
}
