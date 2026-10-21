import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../../db/index.js";
import {
  automationSettings,
  jobs as jobsTable,
  userBids,
} from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import { evaluateProposalQuality, extractUrls } from "../../lib/proposal-quality.js";
import { getOrCreateSettings } from "../automation/automation.service.js";
import { getBid, listBids, placeBid, type BidOutcome } from "../bids/bids.service.js";
import { getDashboard } from "../dashboard/dashboard.service.js";
import {
  deriveSkillIds,
  splitParagraphs,
  type FreelancerProject,
} from "../jobs/jobs.client.js";
import {
  analyzeJob,
  getJobById,
  listMatches,
  listStoredJobs,
  searchJobs,
} from "../jobs/jobs.service.js";
import { listLogs } from "../logs/logs.service.js";
import {
  getProfile,
  profileSchema,
  saveProfile,
  type ProfileData,
} from "../profile/profile.service.js";
import { buildProfileBrief } from "../profile/profile-brief.js";
import { testStored } from "../platforms/credentials.service.js";
import {
  aiSettingsPatchSchema,
  getAiSettingsView,
  saveAiSettings,
} from "../ai/ai-settings.service.js";
import {
  generateProposal,
  getProposal,
  getProposalByJob,
  listProposals,
  proposalStatusEnum,
  regenerateProposal,
  saveProposal,
  updateProposalStatus,
} from "../proposals/proposals.service.js";

const log = createLogger("ai");

export interface AgentAction {
  tool: string;
  detail: string;
  changedFields?: string[];
}

export interface AgentToolResult {
  data: Record<string, unknown>;
  action?: AgentAction;
}

export interface AgentToolContext {
  userId: string;
  allowWrites: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  write: boolean;
  execute: (args: unknown, context: AgentToolContext) => Promise<AgentToolResult>;
}

const EMPTY_PROFILE: ProfileData = {
  freelancerUsername: null,
  name: null,
  title: null,
  hourlyRate: null,
  about: null,
  skills: [],
  skillIds: [],
  preferredProjectTypes: [],
  wants: [],
  notWants: [],
  ignoredCountries: [],
  customInstructions: null,
  userSummary: null,
  relevancyInstructions: null,
  portfolioSummary: null,
  proposalTemplates: null,
  proposalSystemInstructions: null,
  proposalWritingInstructions: null,
};

const statusSchema = z.enum(["new", "analyzed", "ignored"]);
const proposalStatusSchema = z.enum(proposalStatusEnum);
const textField = z.string().max(40_000).nullable().optional();

const profilePatchSchema = z
  .object({
    name: z.string().max(200).nullable().optional(),
    title: z.string().max(300).nullable().optional(),
    hourlyRate: z.string().max(50).nullable().optional(),
    about: z.string().max(10_000).nullable().optional(),
    relevancyInstructions: z.string().max(20_000).nullable().optional(),
    portfolioSummary: textField,
    proposalTemplates: textField,
    proposalSystemInstructions: textField,
    proposalWritingInstructions: textField,
    customInstructions: z.string().max(20_000).nullable().optional(),
    wants: z.array(z.string().min(1).max(60)).max(30).optional(),
    notWants: z.array(z.string().min(1).max(60)).max(30).optional(),
    ignoredCountries: z.array(z.string().min(1).max(60)).max(50).optional(),
    skills: z.array(z.string().min(1).max(60)).max(50).optional(),
    skillIds: z.array(z.number().int().positive()).max(50).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field is required",
  });

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw.trim().length === 0) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseStringArray(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function storedJob(projectId: number) {
  return getDb()
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.projectId, projectId))
    .get();
}

function jobSnapshot(row: typeof jobsTable.$inferSelect): Record<string, unknown> {
  const raw = parseObject(row.rawData);
  const project = raw as Partial<FreelancerProject> | null;
  const description =
    typeof project?.description === "string"
      ? project.description
      : typeof project?.preview_description === "string"
        ? project.preview_description
        : "";
  const jobSkills = parseStringArray(row.skills);
  return {
    projectId: row.projectId,
    jobId: row.id,
    title: row.title,
    client: row.client,
    clientCountry: row.clientCountry,
    budgetLabel: row.budgetLabel,
    postedLabel: row.postedLabel,
    bidCount: row.bidCount,
    avgBidLabel: row.avgBidLabel,
    matchScore: row.matchScore,
    severity: row.severity,
    status: row.status,
    rejectionReason: row.rejectionReason,
    skills: jobSkills,
    analysis: parseObject(row.analysis),
    projectType: project?.type ?? null,
    bidPeriod: project?.bidperiod ?? null,
    deliveryDays: row.deliveryDays,
    bidAmount: row.bidAmount,
    description: splitParagraphs(description),
  };
}

function mergeSkillIds(existing: ProfileData | null, skills: string[]): number[] {
  const existingByName = new Map<string, number>();
  if (existing) {
    existing.skills.forEach((name, index) => {
      const id = existing.skillIds[index];
      if (typeof id === "number") {
        existingByName.set(name.trim().toLowerCase(), id);
      }
    });
  }

  const ids: number[] = [];
  for (const skill of skills) {
    const known = existingByName.get(skill.trim().toLowerCase());
    if (known !== undefined) {
      ids.push(known);
    } else {
      ids.push(...deriveSkillIds([skill]));
    }
  }
  return [...new Set(ids)];
}

function changedProfileFields(
  before: ProfileData,
  after: ProfileData,
  fields: string[]
): string[] {
  const beforeRecord = before as unknown as Record<string, unknown>;
  const afterRecord = after as unknown as Record<string, unknown>;
  return fields.filter(
    (field) => JSON.stringify(beforeRecord[field]) !== JSON.stringify(afterRecord[field])
  );
}

const getProfileTool: AgentTool = {
  name: "get_profile",
  description:
    "Read the user's saved profile: name, title, hourly rate, about, skills, filters, summaries, templates, and instructions. This is the only source of truth for user facts.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  write: false,
  async execute(_args, context) {
    const profile = getProfile(context.userId);
    const facts =
      profile === null
        ? null
        : Object.fromEntries(
            Object.entries(profile).filter(([key]) => key !== "userSummary")
          );
    return {
      data: {
        ok: true,
        profile: facts,
        brief: profile === null ? null : buildProfileBrief(profile),
        note:
          profile === null
            ? "No profile has been saved yet."
            : "Use only these saved facts and brief. Never invent profile details.",
      },
    };
  },
};

const getAutomationSettingsTool: AgentTool = {
  name: "get_automation_settings",
  description:
    "Read the user's automation settings, including bid bounds, thresholds, daily cap, delivery timeline, bid amount, and pre-analysis rejection toggles.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  write: false,
  async execute(_args, context) {
    return { data: { ok: true, settings: await getOrCreateSettings(context.userId) } };
  },
};

const getAiSettingsTool: AgentTool = {
  name: "get_ai_settings",
  description:
    "Read the user's AI settings: the active models/engine plus temperatures, token caps, timeouts, correction attempts, and relevance score bands. This never exposes API keys.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  write: false,
  async execute(_args, context) {
    return { data: { ok: true, settings: getAiSettingsView(context.userId) } };
  },
};

const updateAiSettingsTool: AgentTool = {
  name: "update_ai_settings",
  description:
    "Update AI tuning values and/or the active models and analysis engine. The relevance ignore floor must be at or below the good-score floor, and the strong-score floor must be above the good-score floor. This does not test the models; use test_ai_settings after changing models.",
  parameters: {
    type: "object",
    properties: {
      relevanceTemperature: { type: "number", minimum: 0, maximum: 2 },
      relevanceMaxTokens: { type: "integer", minimum: 100, maximum: 8000 },
      relevanceTimeoutSeconds: { type: "integer", minimum: 10, maximum: 600 },
      analysisTemperature: { type: "number", minimum: 0, maximum: 2 },
      analysisMaxTokens: { type: "integer", minimum: 100, maximum: 16000 },
      analysisTimeoutSeconds: { type: "integer", minimum: 10, maximum: 600 },
      proposalTemperature: { type: "number", minimum: 0, maximum: 2 },
      proposalTimeoutSeconds: { type: "integer", minimum: 10, maximum: 600 },
      proposalCorrectionAttempts: { type: "integer", minimum: 0, maximum: 2 },
      relevanceIgnoreFloor: { type: "integer", minimum: 0, maximum: 100 },
      goodScoreFloor: { type: "integer", minimum: 0, maximum: 100 },
      strongScoreFloor: { type: "integer", minimum: 1, maximum: 100 },
      analysisModelId: { type: "string", minLength: 1, maxLength: 200 },
      proposalModelId: { type: "string", minLength: 1, maxLength: 200 },
      agentModelId: { type: "string", minLength: 1, maxLength: 200 },
      analysisEngine: { type: "string", enum: ["llm", "jev"] },
      jevModelId: { type: "string", minLength: 1, maxLength: 200 },
    },
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const patch = aiSettingsPatchSchema.parse(args ?? {});
    const { settings, changedFields } = saveAiSettings(context.userId, patch);
    return {
      data: { ok: true, settings, changedFields },
      ...(changedFields.length > 0
        ? {
            action: {
              tool: "update_ai_settings",
              detail: `Updated AI settings: ${changedFields.join(", ")}`,
              changedFields,
            },
          }
        : {}),
    };
  },
};

const testAiSettingsTool: AgentTool = {
  name: "test_ai_settings",
  description:
    "Test the saved OpenRouter connection used by the active AI models and return the current settings. This makes a network call and updates the credential's test status, but does not change tuning values.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  write: true,
  async execute(_args, context) {
    const result = await testStored("openrouter");
    return {
      data: {
        ok: result.ok,
        message: result.message,
        usage: result.usage ?? null,
        settings: getAiSettingsView(context.userId),
      },
    };
  },
};

const listJobsTool: AgentTool = {
  name: "list_jobs",
  description:
    "List locally stored jobs, strongest or newest first. Use this to explain what was found, analyzed, ignored, or scored.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["new", "analyzed", "ignored"],
        description: "Optional status filter.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Maximum jobs to return. Default 20.",
      },
    },
    additionalProperties: false,
  },
  write: false,
  async execute(args, context) {
    const input = z
      .object({
        status: statusSchema.optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      })
      .strict()
      .parse(args ?? {});
    const jobs = listStoredJobs(context.userId, {
      status: input.status,
      limit: input.limit ?? 20,
    });
    return { data: { ok: true, count: jobs.length, jobs } };
  },
};

const listMatchesTool: AgentTool = {
  name: "list_matches",
  description:
    "List analyzed jobs scored against the saved profile, strongest first. Includes matched skills, missing skills, concerns, bid state, and any failed auto-bid. Does not call Freelancer.com.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Maximum matches to return. Default 20.",
      },
    },
    additionalProperties: false,
  },
  write: false,
  async execute(args, context) {
    const input = z
      .object({ limit: z.coerce.number().int().min(1).max(50).optional() })
      .strict()
      .parse(args ?? {});
    const matches = listMatches(context.userId).slice(0, input.limit ?? 20);
    return { data: { ok: true, count: matches.length, matches } };
  },
};

const searchJobsTool: AgentTool = {
  name: "search_jobs",
  description:
    "Search Freelancer.com for active jobs and save the results locally. Uses the profile's saved skill ids and ignored countries when no filters are supplied. Does not analyze jobs, write proposals, or bid.",
  parameters: {
    type: "object",
    properties: {
      keywords: {
        type: "array",
        items: { type: "string" },
        maxItems: 10,
        description: "Optional search keywords, for example [\"react\", \"dashboard\"].",
      },
      skills: {
        type: "array",
        items: { type: "string" },
        maxItems: 20,
        description: "Optional skill names to search for. Overrides the profile skill ids.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Maximum jobs to fetch. Default 20.",
      },
    },
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const input = z
      .object({
        keywords: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
        skills: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      })
      .strict()
      .parse(args ?? {});
    const profile = getProfile(context.userId);
    const hasSkills = input.skills !== undefined && input.skills.length > 0;
    const jobs = await searchJobs({
      keywords: input.keywords,
      skills: hasSkills ? input.skills : undefined,
      skillIds: hasSkills ? undefined : profile?.skillIds,
      limit: input.limit ?? 20,
      ignoredCountries: profile?.ignoredCountries ?? [],
      userId: context.userId,
    });
    return {
      data: {
        ok: true,
        count: jobs.length,
        jobs: jobs.map((job) => ({
          projectId: job.projectId,
          title: job.title,
          client: job.client,
          clientCountry: job.clientCountry,
          budgetLabel: job.budgetLabel,
          skills: job.skills,
          postedLabel: job.postedLabel,
          bidCount: job.bidCount,
          status: job.status,
        })),
        note: "Jobs were saved locally. Use get_job for details or refresh_job for current Freelancer.com data.",
      },
      action: {
        tool: "search_jobs",
        detail: `Found ${jobs.length} job(s) on Freelancer.com`,
      },
    };
  },
};

const refreshJobTool: AgentTool = {
  name: "refresh_job",
  description:
    "Refresh one stored job from Freelancer.com, including its description, bid count, and competition data. Use this when the cached get_job data may be stale. Does not analyze or bid.",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "integer", description: "Freelancer.com project id." },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const input = z
      .object({ projectId: z.coerce.number().int().positive() })
      .strict()
      .parse(args);
    const job = await getJobById(input.projectId, context.userId);
    return {
      data: {
        ok: true,
        job: {
          projectId: job.projectId,
          title: job.title,
          client: job.client,
          clientCountry: job.clientCountry,
          budgetLabel: job.budgetLabel,
          skills: job.skills,
          postedLabel: job.postedLabel,
          bidCount: job.bidCount,
          avgBidLabel: job.avgBidLabel,
          matchScore: job.matchScore ?? null,
          status: job.status,
          projectType: job.projectType ?? null,
          bidPeriod: job.bidPeriod ?? null,
          deliveryDays: job.deliveryDays ?? null,
          bidAmount: job.bidAmount ?? null,
          suggestedBidAmount: job.suggestedBidAmount ?? null,
          description: job.description,
          competition: job.competition ?? null,
          myBid: job.myBid ?? null,
          rejectionReason: job.rejectionReason ?? null,
          bidError: job.bidError ?? null,
        },
        note: "Live job data and competition were refreshed in the local cache.",
      },
      action: {
        tool: "refresh_job",
        detail: `Refreshed job "${job.title}" (project ${job.projectId})`,
      },
    };
  },
};

const getJobTool: AgentTool = {
  name: "get_job",
  description:
    "Read one stored job by Freelancer.com project id, including its skills, stored analysis, match score, and rejection reason. Does not call Freelancer.com.",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "integer", description: "Freelancer.com project id." },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  write: false,
  async execute(args, context) {
    void context;
    const input = z
      .object({ projectId: z.coerce.number().int().positive() })
      .strict()
      .parse(args);
    const row = storedJob(input.projectId);
    if (row === undefined) {
      return {
        data: { ok: false, error: `No stored job with project id ${input.projectId}.` },
      };
    }
    return { data: { ok: true, job: jobSnapshot(row) } };
  },
};

const listProposalsTool: AgentTool = {
  name: "list_proposals",
  description:
    "List saved proposals with status, bid amount, timestamps, and a short content preview. Use this before diagnosing proposal quality.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: [...proposalStatusEnum],
        description: "Optional proposal status filter.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Maximum proposals to return. Default 20.",
      },
    },
    additionalProperties: false,
  },
  write: false,
  async execute(args, context) {
    const input = z
      .object({
        status: proposalStatusSchema.optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      })
      .strict()
      .parse(args ?? {});
    const all = await listProposals(context.userId);
    const filtered =
      input.status === undefined ? all : all.filter((item) => item.status === input.status);
    const proposals = filtered.slice(0, input.limit ?? 20).map((item) => ({
      id: item.id,
      jobTitle: item.jobTitle,
      client: item.client,
      bidAmount: item.bidAmount,
      status: item.status,
      updatedLabel: item.updatedLabel,
      contentPreview: item.content.slice(0, 400),
    }));
    return { data: { ok: true, count: proposals.length, proposals } };
  },
};

const getProposalTool: AgentTool = {
  name: "get_proposal",
  description:
    "Read one proposal in full by proposal id, including its current content and competitor note.",
  parameters: {
    type: "object",
    properties: {
      proposalId: { type: "string", description: "Proposal id, for example prop-123." },
    },
    required: ["proposalId"],
    additionalProperties: false,
  },
  write: false,
  async execute(args, context) {
    const input = z
      .object({ proposalId: z.string().min(1).max(100) })
      .strict()
      .parse(args);
    const proposal = await getProposal(context.userId, input.proposalId);
    if (proposal === null) {
      return {
        data: { ok: false, error: `Proposal ${input.proposalId} was not found.` },
      };
    }
    return { data: { ok: true, proposal } };
  },
};

const checkProposalQualityTool: AgentTool = {
  name: "check_proposal_quality",
  description:
    "Run deterministic quality checks on a saved proposal and return failed checks, warnings, and the job context used. Use this to diagnose weak proposals before suggesting edits.",
  parameters: {
    type: "object",
    properties: {
      proposalId: { type: "string", description: "Proposal id to check." },
    },
    required: ["proposalId"],
    additionalProperties: false,
  },
  write: false,
  async execute(args, context) {
    const input = z
      .object({ proposalId: z.string().min(1).max(100) })
      .strict()
      .parse(args);
    const proposal = await getProposal(context.userId, input.proposalId);
    if (proposal === null) {
      return {
        data: { ok: false, error: `Proposal ${input.proposalId} was not found.` },
      };
    }
    const row = storedJob(proposal.projectId);
    const raw = row === undefined ? null : parseObject(row.rawData);
    const project = raw as Partial<FreelancerProject> | null;
    const description =
      typeof project?.description === "string"
        ? project.description
        : typeof project?.preview_description === "string"
          ? project.preview_description
          : "";
    const jobSkills =
      row === undefined ? [] : parseStringArray(row.skills);
    const profile = getProfile(context.userId);
    const profileSkills = profile?.skills ?? [];
    const quality = evaluateProposalQuality(proposal.content, {
      jobTitle: row?.title ?? proposal.jobTitle,
      jobDescription: splitParagraphs(description),
      jobSkills,
      profileSkills,
      bidAmount: proposal.bidAmount,
      deliveryDays: row?.deliveryDays ?? null,
      allowedUrls: extractUrls(
        [profile?.portfolioSummary ?? "", profile?.about ?? ""].join("\n")
      ),
    });
    return {
      data: {
        ok: true,
        proposal: {
          id: proposal.id,
          jobTitle: proposal.jobTitle,
          status: proposal.status,
          bidAmount: proposal.bidAmount,
        },
        quality,
        failedChecks: quality.checks.filter((check) => !check.passed),
        warnings: quality.warnings,
      },
    };
  },
};

const createProposalDraftTool: AgentTool = {
  name: "create_proposal_draft",
  description:
    "Generate a new AI proposal draft for a stored job using the saved profile and job details. The proposal stays in draft status and is never approved, submitted, or bid. Refuses when a proposal already exists for the job.",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "integer", description: "Freelancer.com project id." },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const input = z
      .object({ projectId: z.coerce.number().int().positive() })
      .strict()
      .parse(args);
    const row = storedJob(input.projectId);
    if (row === undefined) {
      return {
        data: {
          ok: false,
          error: `No stored job with project id ${input.projectId}. Use search_jobs or refresh_job first.`,
        },
      };
    }

    const existing = await getProposalByJob(context.userId, row.id);
    if (existing !== null) {
      return {
        data: {
          ok: false,
          error: `A proposal already exists for this job (${existing.id}, status "${existing.status}"). Use get_proposal or update_proposal instead.`,
          proposalId: existing.id,
        },
      };
    }

    const raw = parseObject(row.rawData);
    const project = raw as Partial<FreelancerProject> | null;
    const description =
      typeof project?.description === "string"
        ? project.description
        : typeof project?.preview_description === "string"
          ? project.preview_description
          : "";
    const jobSkills = parseStringArray(row.skills);
    const { proposal, competitorNote } = await generateProposal(
      context.userId,
      row.id,
      row.projectId,
      row.title,
      row.client,
      splitParagraphs(description),
      jobSkills,
      { bidCount: row.bidCount, avgBid: row.avgBidLabel },
      project?.type ?? null,
      project?.bidperiod ?? null,
      undefined,
      null,
      row.budgetLabel,
      row.bidAmount,
      row.deliveryDays
    );

    return {
      data: {
        ok: true,
        proposal: {
          id: proposal.id,
          jobTitle: proposal.jobTitle,
          status: proposal.status,
          content: proposal.content,
          competitorNote,
        },
        note: "Draft saved. No bid was placed and nothing was approved or submitted. Review it in the Proposals page.",
      },
      action: {
        tool: "create_proposal_draft",
        detail: `Created draft proposal for "${proposal.jobTitle}"`,
      },
    };
  },
};

const updateProfileTool: AgentTool = {
  name: "update_profile",
  description:
    "Update saved profile fields. Only use facts the user explicitly supplied or that already exist in the profile. Never invent skills, projects, or history. When skills change without skillIds, ids are matched or derived automatically.",
  parameters: {
    type: "object",
    properties: {
      name: { type: ["string", "null"] },
      title: { type: ["string", "null"] },
      hourlyRate: { type: ["string", "null"] },
      about: { type: ["string", "null"] },
      relevancyInstructions: { type: ["string", "null"] },
      portfolioSummary: { type: ["string", "null"] },
      proposalTemplates: { type: ["string", "null"] },
      proposalSystemInstructions: { type: ["string", "null"] },
      proposalWritingInstructions: { type: ["string", "null"] },
      customInstructions: { type: ["string", "null"] },
      wants: { type: "array", items: { type: "string" } },
      notWants: { type: "array", items: { type: "string" } },
      ignoredCountries: { type: "array", items: { type: "string" } },
      skills: { type: "array", items: { type: "string" } },
      skillIds: { type: "array", items: { type: "integer" } },
    },
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const parsed = profilePatchSchema.parse(args);
    const existing = getProfile(context.userId);
    const defined = Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value !== undefined)
    );
    const base = existing ?? EMPTY_PROFILE;
    const resolvedSkillIds =
      parsed.skills !== undefined && parsed.skillIds === undefined
        ? mergeSkillIds(existing, parsed.skills)
        : parsed.skillIds;
    const next = profileSchema.parse({
      ...base,
      ...defined,
      ...(resolvedSkillIds !== undefined ? { skillIds: resolvedSkillIds } : {}),
    });
    const fields = Object.keys(defined);
    if (parsed.skills !== undefined && parsed.skillIds === undefined) {
      fields.push("skillIds");
    }
    const changedFields = changedProfileFields(base, next, [...new Set(fields)]);
    if (changedFields.length === 0) {
      return {
        data: { ok: true, changedFields: [], note: "No profile values changed." },
      };
    }
    saveProfile(context.userId, next);
    return {
      data: {
        ok: true,
        changedFields,
        note: "Profile saved. Tell the user exactly which fields changed.",
      },
      action: {
        tool: "update_profile",
        detail: `Updated profile fields: ${changedFields.join(", ")}`,
        changedFields,
      },
    };
  },
};

const updateProfileSkillsTool: AgentTool = {
  name: "update_profile_skills",
  description:
    "Add or remove named profile skills without replacing the rest of the list. Matching is case-insensitive, existing skill ids are preserved, and new ids are derived automatically. Never invent skills the user did not provide.",
  parameters: {
    type: "object",
    properties: {
      add: {
        type: "array",
        items: { type: "string" },
        maxItems: 50,
        description: "Skill names to add.",
      },
      remove: {
        type: "array",
        items: { type: "string" },
        maxItems: 50,
        description: "Skill names to remove, case-insensitive.",
      },
    },
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const input = z
      .object({
        add: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
        remove: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
      })
      .strict()
      .refine((value) => (value.add?.length ?? 0) > 0 || (value.remove?.length ?? 0) > 0, {
        message: "Provide at least one skill to add or remove",
      })
      .parse(args);

    const existing = getProfile(context.userId) ?? EMPTY_PROFILE;
    const removeSet = new Set(
      (input.remove ?? []).map((skill) => skill.toLowerCase())
    );
    const nextSkills = existing.skills.filter(
      (skill) => !removeSet.has(skill.trim().toLowerCase())
    );
    const present = new Set(nextSkills.map((skill) => skill.trim().toLowerCase()));
    for (const skill of input.add ?? []) {
      if (!present.has(skill.toLowerCase())) {
        nextSkills.push(skill);
        present.add(skill.toLowerCase());
      }
    }

    const nextSkillIds = mergeSkillIds(existing, nextSkills);
    const next = profileSchema.parse({
      ...existing,
      skills: nextSkills,
      skillIds: nextSkillIds,
    });
    const changedFields = changedProfileFields(existing, next, ["skills", "skillIds"]);
    if (changedFields.length === 0) {
      return {
        data: { ok: true, changedFields: [], note: "No profile skills changed." },
      };
    }

    saveProfile(context.userId, next);
    return {
      data: {
        ok: true,
        skills: next.skills,
        changedFields,
        note: "Profile skills saved. Tell the user which skills were added or removed.",
      },
      action: {
        tool: "update_profile_skills",
        detail: `Updated profile skills (${changedFields.join(", ")})`,
        changedFields,
      },
    };
  },
};

const updateProposalTool: AgentTool = {
  name: "update_proposal",
  description:
    "Replace the text of a draft proposal after the user asks for a fix. Refuses any proposal that is not in draft status, so approved and submitted work cannot be changed silently.",
  parameters: {
    type: "object",
    properties: {
      proposalId: { type: "string", description: "Proposal id to edit." },
      content: {
        type: "string",
        description: "The complete replacement proposal text, grounded only in saved profile facts and the job.",
      },
    },
    required: ["proposalId", "content"],
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const input = z
      .object({
        proposalId: z.string().min(1).max(100),
        content: z.string().min(50).max(20_000),
      })
      .strict()
      .parse(args);
    const proposal = await getProposal(context.userId, input.proposalId);
    if (proposal === null) {
      return {
        data: { ok: false, error: `Proposal ${input.proposalId} was not found.` },
      };
    }
    if (proposal.status !== "draft") {
      return {
        data: {
          ok: false,
          error: `Proposal ${proposal.id} has status "${proposal.status}". Only draft proposals can be edited.`,
        },
      };
    }
    await saveProposal(context.userId, proposal.id, input.content);
    return {
      data: {
        ok: true,
        proposalId: proposal.id,
        note: "Proposal text replaced. The user can still edit or regenerate it in the Proposals page.",
      },
      action: {
        tool: "update_proposal",
        detail: `Updated proposal for "${proposal.jobTitle}"`,
      },
    };
  },
};

const getDashboardTool: AgentTool = {
  name: "get_dashboard",
  description:
    "Read the same dashboard snapshot the home page shows: KPIs, match-quality bands, jobs needing attention, recent proposals and bids, platform connection state, and activity. Uses local data only.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  write: false,
  async execute(_args, context) {
    return { data: { ok: true, dashboard: await getDashboard(context.userId) } };
  },
};

const listBidsTool: AgentTool = {
  name: "list_bids",
  description:
    "List the user's own submitted bids, newest first, with amount, delivery period, milestone, outcome, and whether the bid was manual or automatic. Does not call Freelancer.com.",
  parameters: {
    type: "object",
    properties: {
      outcome: {
        type: "string",
        enum: ["in_review", "won", "lost"],
        description: "Optional outcome filter.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Maximum bids to return. Default 20.",
      },
    },
    additionalProperties: false,
  },
  write: false,
  async execute(args, context) {
    const input = z
      .object({
        outcome: z.enum(["in_review", "won", "lost"]).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      })
      .strict()
      .parse(args ?? {});
    const bids = await listBids(context.userId, input.outcome as BidOutcome | undefined);
    const limited = bids.slice(0, input.limit ?? 20);
    return { data: { ok: true, count: limited.length, bids: limited } };
  },
};

const getBidTool: AgentTool = {
  name: "get_bid",
  description:
    "Read one of the user's own bids in full by local bid id, including the submitted proposal text and Freelancer bid id.",
  parameters: {
    type: "object",
    properties: {
      bidId: { type: "string", description: "Local bid id, for example bid-123-..." },
    },
    required: ["bidId"],
    additionalProperties: false,
  },
  write: false,
  async execute(args, context) {
    const input = z
      .object({ bidId: z.string().min(1).max(100) })
      .strict()
      .parse(args);
    const bid = await getBid(context.userId, input.bidId);
    if (bid === null) {
      return { data: { ok: false, error: `Bid ${input.bidId} was not found.` } };
    }
    return { data: { ok: true, bid } };
  },
};

const getProposalForJobTool: AgentTool = {
  name: "get_proposal_for_job",
  description:
    "Read the full proposal attached to a stored job by Freelancer.com project id, plus the job's current bid amount and delivery days. Use this before updating terms or placing a bid.",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "integer", description: "Freelancer.com project id." },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  write: false,
  async execute(args, context) {
    const input = z
      .object({ projectId: z.coerce.number().int().positive() })
      .strict()
      .parse(args);
    const row = storedJob(input.projectId);
    if (row === undefined) {
      return {
        data: { ok: false, error: `No stored job with project id ${input.projectId}.` },
      };
    }
    const proposal = await getProposalByJob(context.userId, row.id);
    if (proposal === null) {
      return {
        data: {
          ok: true,
          proposal: null,
          job: {
            projectId: row.projectId,
            title: row.title,
            bidAmount: row.bidAmount,
            deliveryDays: row.deliveryDays,
          },
          note: "This job has no proposal yet. Use create_proposal_draft.",
        },
      };
    }
    return {
      data: {
        ok: true,
        proposal,
        job: {
          projectId: row.projectId,
          title: row.title,
          bidAmount: row.bidAmount,
          deliveryDays: row.deliveryDays,
        },
      },
    };
  },
};

const getRecentLogsTool: AgentTool = {
  name: "get_recent_logs",
  description:
    "Read recent application logs for diagnostics, optionally filtered by level, category, or message text. Use this to explain scan, analysis, proposal, and bid failures.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Maximum entries to return. Default 25.",
      },
      level: {
        type: "string",
        enum: ["debug", "info", "warn", "error"],
        description: "Optional level filter.",
      },
      category: {
        type: "string",
        description:
          "Optional category: sync, analysis, proposal, proposals, ai, bid, auth, or system.",
      },
      search: {
        type: "string",
        description: "Optional case-insensitive substring to match in the message.",
      },
    },
    additionalProperties: false,
  },
  write: false,
  async execute(args) {
    const input = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
        level: z.enum(["debug", "info", "warn", "error"]).optional(),
        category: z.string().trim().max(40).optional(),
        search: z.string().trim().max(200).optional(),
      })
      .strict()
      .parse(args ?? {});
    const result = listLogs({
      limit: input.limit ?? 25,
      level: input.level,
      category: input.category,
      search: input.search,
    });
    return { data: { ok: true, ...result } };
  },
};

const runScanTool: AgentTool = {
  name: "run_scan",
  description:
    "Scan Freelancer.com for new jobs using the saved profile filters, cache them, and analyze every newly found job immediately. Never writes proposals and never places bids. Use list_matches afterwards for the strongest results.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "Maximum new jobs to fetch and analyze. Default 5.",
      },
    },
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const input = z
      .object({ limit: z.coerce.number().int().min(1).max(10).optional() })
      .strict()
      .parse(args ?? {});
    const profile = getProfile(context.userId);
    if (profile === null) {
      return {
        data: { ok: false, error: "Save a profile before running a scan." },
      };
    }

    const found = await searchJobs({
      skills: profile.skills.length > 0 ? profile.skills : undefined,
      skillIds: profile.skillIds.length > 0 ? profile.skillIds : undefined,
      keywords: profile.wants.length > 0 ? profile.wants : undefined,
      limit: input.limit ?? 5,
      ignoredCountries: profile.ignoredCountries,
      userId: context.userId,
    });

    const fresh = found.filter((job) => job.status === "new");
    const analyses: Array<{ projectId: number; title: string; analysis: unknown }> = [];
    const errors: Array<{ projectId: number; title: string; error: string }> = [];
    for (const job of fresh) {
      try {
        const analysis = await analyzeJob(job.projectId, context.userId);
        analyses.push({ projectId: job.projectId, title: job.title, analysis });
      } catch (error) {
        errors.push({
          projectId: job.projectId,
          title: job.title,
          error: error instanceof Error ? error.message : "Analysis failed",
        });
      }
    }

    return {
      data: {
        ok: true,
        found: found.length,
        newJobs: fresh.length,
        analyzed: analyses.length,
        failed: errors.length,
        analyses,
        errors,
        note: "Scan complete. No proposal was written and no bid was placed.",
      },
      action: {
        tool: "run_scan",
        detail: `Scanned ${found.length} job(s); analyzed ${analyses.length}`,
      },
    };
  },
};

const analyzeJobTool: AgentTool = {
  name: "analyze_job",
  description:
    "Run the saved relevance analysis against one stored job by Freelancer.com project id. Updates its score and analysis only; never writes a proposal or places a bid.",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "integer", description: "Freelancer.com project id." },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const input = z
      .object({ projectId: z.coerce.number().int().positive() })
      .strict()
      .parse(args);
    const analysis = await analyzeJob(input.projectId, context.userId);
    const row = storedJob(input.projectId);
    return {
      data: {
        ok: true,
        projectId: input.projectId,
        analysis,
        job: row === undefined ? null : jobSnapshot(row),
        note: "Analysis complete. No proposal was written and no bid was placed.",
      },
      action: {
        tool: "analyze_job",
        detail: `Analyzed project ${input.projectId}`,
      },
    };
  },
};

const regenerateProposalDraftTool: AgentTool = {
  name: "regenerate_proposal_draft",
  description:
    "Regenerate a draft proposal with the AI, optionally updating its bid amount and the job's delivery days at the same time. Refuses any proposal that is not in draft status.",
  parameters: {
    type: "object",
    properties: {
      proposalId: { type: "string", description: "Draft proposal id to regenerate." },
      bidAmount: {
        type: "integer",
        minimum: 1,
        description: "Optional new bid amount to quote in the regenerated draft.",
      },
      deliveryDays: {
        type: "integer",
        minimum: 1,
        maximum: 365,
        description: "Optional new delivery time in days.",
      },
    },
    required: ["proposalId"],
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const input = z
      .object({
        proposalId: z.string().min(1).max(100),
        bidAmount: z.coerce.number().int().min(1).optional(),
        deliveryDays: z.coerce.number().int().min(1).max(365).optional(),
      })
      .strict()
      .parse(args);
    const proposal = await getProposal(context.userId, input.proposalId);
    if (proposal === null) {
      return {
        data: { ok: false, error: `Proposal ${input.proposalId} was not found.` },
      };
    }
    if (proposal.status !== "draft") {
      return {
        data: {
          ok: false,
          error: `Proposal ${proposal.id} has status "${proposal.status}". Only draft proposals can be regenerated.`,
        },
      };
    }

    const row = storedJob(proposal.projectId);
    const raw = row === undefined ? null : parseObject(row.rawData);
    const project = raw as Partial<FreelancerProject> | null;
    const bidAmount = input.bidAmount ?? proposal.bidAmount ?? row?.bidAmount ?? null;
    const deliveryDays = input.deliveryDays ?? row?.deliveryDays ?? null;

    const { content, competitorNote } = await regenerateProposal(
      context.userId,
      proposal.id,
      project?.type ?? null,
      project?.bidperiod ?? null,
      undefined,
      null,
      row?.budgetLabel ?? null,
      bidAmount,
      deliveryDays
    );
    await saveProposal(context.userId, proposal.id, content, bidAmount ?? undefined);
    if (input.deliveryDays !== undefined && row !== undefined) {
      const now = new Date().toISOString();
      getDb()
        .update(jobsTable)
        .set({ deliveryDays: input.deliveryDays, updatedAt: now })
        .where(eq(jobsTable.projectId, proposal.projectId))
        .run();
    }

    return {
      data: {
        ok: true,
        proposal: {
          id: proposal.id,
          jobTitle: proposal.jobTitle,
          status: proposal.status,
          content,
          competitorNote,
          bidAmount,
          deliveryDays,
        },
        note: "Draft regenerated. Nothing was approved and no bid was placed.",
      },
      action: {
        tool: "regenerate_proposal_draft",
        detail: `Regenerated draft for "${proposal.jobTitle}"`,
      },
    };
  },
};

const updateProposalTermsTool: AgentTool = {
  name: "update_proposal_terms",
  description:
    "Update a draft proposal's bid amount, the job's delivery days, and optionally its text. Refuses approved or submitted proposals, so terms cannot change after approval.",
  parameters: {
    type: "object",
    properties: {
      proposalId: { type: "string", description: "Draft proposal id to update." },
      bidAmount: {
        type: "integer",
        minimum: 1,
        description: "New bid amount.",
      },
      deliveryDays: {
        type: "integer",
        minimum: 1,
        maximum: 365,
        description: "New delivery time in days.",
      },
      content: {
        type: "string",
        description: "Optional complete replacement proposal text.",
      },
    },
    required: ["proposalId"],
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const input = z
      .object({
        proposalId: z.string().min(1).max(100),
        bidAmount: z.coerce.number().int().min(1).optional(),
        deliveryDays: z.coerce.number().int().min(1).max(365).optional(),
        content: z.string().min(50).max(20_000).optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.bidAmount !== undefined ||
          value.deliveryDays !== undefined ||
          value.content !== undefined,
        { message: "Provide a bid amount, delivery days, or replacement content" }
      )
      .parse(args);
    const proposal = await getProposal(context.userId, input.proposalId);
    if (proposal === null) {
      return {
        data: { ok: false, error: `Proposal ${input.proposalId} was not found.` },
      };
    }
    if (proposal.status !== "draft") {
      return {
        data: {
          ok: false,
          error: `Proposal ${proposal.id} has status "${proposal.status}". Only draft proposals can change terms.`,
        },
      };
    }
    const row = storedJob(proposal.projectId);
    if (input.deliveryDays !== undefined && row === undefined) {
      return {
        data: {
          ok: false,
          error: `No stored job for project ${proposal.projectId}, so delivery days cannot be saved.`,
        },
      };
    }

    await saveProposal(
      context.userId,
      proposal.id,
      input.content ?? proposal.content,
      input.bidAmount
    );
    if (input.deliveryDays !== undefined && row !== undefined) {
      getDb()
        .update(jobsTable)
        .set({ deliveryDays: input.deliveryDays, updatedAt: new Date().toISOString() })
        .where(eq(jobsTable.projectId, proposal.projectId))
        .run();
    }

    return {
      data: {
        ok: true,
        proposalId: proposal.id,
        bidAmount: input.bidAmount ?? proposal.bidAmount,
        deliveryDays: input.deliveryDays ?? row?.deliveryDays ?? null,
        contentChanged: input.content !== undefined,
        note: "Draft terms saved. The proposal is still a draft; no bid was placed.",
      },
      action: {
        tool: "update_proposal_terms",
        detail: `Updated terms for "${proposal.jobTitle}"`,
      },
    };
  },
};

const approveProposalTool: AgentTool = {
  name: "approve_proposal",
  description:
    "Approve a draft proposal so it becomes eligible for a bid. Requires confirm=true and an explicit user request to approve. Never submits to Freelancer.com or places a bid by itself.",
  parameters: {
    type: "object",
    properties: {
      proposalId: { type: "string", description: "Draft proposal id to approve." },
      confirm: {
        type: "boolean",
        description:
          "Must be true. Set only when the user explicitly asked to approve this proposal.",
      },
    },
    required: ["proposalId", "confirm"],
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const input = z
      .object({
        proposalId: z.string().min(1).max(100),
        confirm: z.boolean(),
      })
      .strict()
      .parse(args);
    if (input.confirm !== true) {
      return {
        data: {
          ok: false,
          error:
            "Approval needs confirm=true after the user explicitly asks to approve the proposal.",
        },
      };
    }
    const proposal = await getProposal(context.userId, input.proposalId);
    if (proposal === null) {
      return {
        data: { ok: false, error: `Proposal ${input.proposalId} was not found.` },
      };
    }
    if (proposal.status === "approved") {
      return {
        data: {
          ok: true,
          proposalId: proposal.id,
          status: "approved",
          note: "The proposal was already approved. No change was made.",
        },
      };
    }
    if (proposal.status !== "draft") {
      return {
        data: {
          ok: false,
          error: `Proposal ${proposal.id} has status "${proposal.status}"; only drafts can be approved.`,
        },
      };
    }
    await updateProposalStatus(context.userId, proposal.id, "approved");
    return {
      data: {
        ok: true,
        proposalId: proposal.id,
        status: "approved",
        note: "Proposal approved. It can now be bid on with place_bid. No bid was placed yet.",
      },
      action: {
        tool: "approve_proposal",
        detail: `Approved proposal for "${proposal.jobTitle}"`,
      },
    };
  },
};

const placeBidTool: AgentTool = {
  name: "place_bid",
  description:
    "Place a real bid on Freelancer.com from an approved proposal. Requires confirm=true only after the user explicitly asks to place the bid and agrees to the amount and delivery days. Enforces bid bounds, the daily cap, and duplicate-bid prevention.",
  parameters: {
    type: "object",
    properties: {
      proposalId: { type: "string", description: "Approved proposal id to bid from." },
      amount: {
        type: "integer",
        minimum: 1,
        description:
          "Bid amount. Defaults to the proposal's saved bid amount when omitted.",
      },
      period: {
        type: "integer",
        minimum: 1,
        maximum: 365,
        description:
          "Delivery time in days. Defaults to the job's saved delivery days when omitted.",
      },
      milestonePercentage: {
        type: "number",
        minimum: 20,
        maximum: 100,
        description: "Milestone percentage. Defaults to 50.",
      },
      confirm: {
        type: "boolean",
        description:
          "Must be true. Set only after the user explicitly asks to place this bid.",
      },
    },
    required: ["proposalId", "confirm"],
    additionalProperties: false,
  },
  write: true,
  async execute(args, context) {
    const input = z
      .object({
        proposalId: z.string().min(1).max(100),
        amount: z.coerce.number().int().min(1).optional(),
        period: z.coerce.number().int().min(1).max(365).optional(),
        milestonePercentage: z.coerce.number().min(20).max(100).optional(),
        confirm: z.boolean(),
      })
      .strict()
      .parse(args);
    if (input.confirm !== true) {
      return {
        data: {
          ok: false,
          error:
            "Placing a bid needs confirm=true after the user explicitly asks to place it.",
        },
      };
    }

    const proposal = await getProposal(context.userId, input.proposalId);
    if (proposal === null) {
      return {
        data: { ok: false, error: `Proposal ${input.proposalId} was not found.` },
      };
    }
    if (proposal.status !== "approved") {
      return {
        data: {
          ok: false,
          error: `Proposal ${proposal.id} has status "${proposal.status}". Approve it first with approve_proposal.`,
        },
      };
    }

    const row = storedJob(proposal.projectId);
    const amount = input.amount ?? proposal.bidAmount ?? null;
    if (amount === null || amount <= 0) {
      return {
        data: {
          ok: false,
          error:
            "No bid amount is saved on this proposal. Set one with update_proposal_terms or pass amount.",
        },
      };
    }
    const period = input.period ?? row?.deliveryDays ?? null;
    if (period === null) {
      return {
        data: {
          ok: false,
          error:
            "No delivery days are saved for this job. Set them with update_proposal_terms or pass period.",
        },
      };
    }

    const settings = await getOrCreateSettings(context.userId);
    if (settings.minBid > 0 && amount < settings.minBid) {
      return {
        data: {
          ok: false,
          error: `Bid amount $${amount} is below the configured minimum $${settings.minBid}.`,
        },
      };
    }
    if (settings.maxBid > 0 && amount > settings.maxBid) {
      return {
        data: {
          ok: false,
          error: `Bid amount $${amount} is above the configured maximum $${settings.maxBid}.`,
        },
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    const bidsToday = settings.capDate === today ? settings.bidsToday : 0;
    if (bidsToday >= settings.dailyCap) {
      return {
        data: {
          ok: false,
          error: `Daily bid cap reached (${bidsToday}/${settings.dailyCap}). Try again tomorrow.`,
        },
      };
    }

    const existing = getDb()
      .select({ id: userBids.id })
      .from(userBids)
      .where(
        and(
          eq(userBids.userId, context.userId),
          eq(userBids.projectId, proposal.projectId)
        )
      )
      .get();
    if (existing !== undefined) {
      return {
        data: {
          ok: false,
          error: `A bid already exists for project ${proposal.projectId} (${existing.id}).`,
        },
      };
    }

    const bid = await placeBid(
      context.userId,
      proposal.id,
      amount,
      period,
      input.milestonePercentage ?? 50
    );

    getDb()
      .update(automationSettings)
      .set({
        bidsToday: bidsToday + 1,
        capDate: today,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(automationSettings.userId, context.userId))
      .run();

    return {
      data: {
        ok: true,
        bid,
        terms: { amount, period, milestonePercentage: input.milestonePercentage ?? 50 },
        note: "Bid placed on Freelancer.com and recorded locally.",
      },
      action: {
        tool: "place_bid",
        detail: `Placed a $${amount} bid on "${proposal.jobTitle}" (${period} days)`,
      },
    };
  },
};

const ALL_TOOLS: AgentTool[] = [
  getProfileTool,
  getAutomationSettingsTool,
  getAiSettingsTool,
  updateAiSettingsTool,
  testAiSettingsTool,
  getDashboardTool,
  listJobsTool,
  listMatchesTool,
  listBidsTool,
  getBidTool,
  searchJobsTool,
  runScanTool,
  analyzeJobTool,
  refreshJobTool,
  getJobTool,
  listProposalsTool,
  getProposalTool,
  getProposalForJobTool,
  checkProposalQualityTool,
  createProposalDraftTool,
  regenerateProposalDraftTool,
  updateProposalTermsTool,
  approveProposalTool,
  placeBidTool,
  updateProfileTool,
  updateProfileSkillsTool,
  updateProposalTool,
  getRecentLogsTool,
];

export function getAgentTools(allowWrites: boolean): AgentTool[] {
  return allowWrites ? ALL_TOOLS : ALL_TOOLS.filter((tool) => !tool.write);
}

export function getAgentToolDefinitions(allowWrites: boolean) {
  return getAgentTools(allowWrites).map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export async function executeAgentTool(
  name: string,
  args: unknown,
  context: AgentToolContext
): Promise<AgentToolResult> {
  const tool = ALL_TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    return { data: { ok: false, error: `Unknown tool: ${name}` } };
  }
  if (tool.write && !context.allowWrites) {
    return {
      data: {
        ok: false,
        error:
          "Writes are disabled. Ask the user to turn on Allow changes before making updates.",
      },
    };
  }
  try {
    return await tool.execute(args, context);
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Tool failed";
    log.warn(`Agent tool ${name} failed: ${message}`);
    return {
      data: {
        ok: false,
        error:
          error instanceof z.ZodError
            ? "Tool arguments failed validation. Correct the arguments and try again."
            : message,
      },
    };
  }
}
