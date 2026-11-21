import { z } from "zod";

/** Editable seed data for the profile auditor. */

export const profileAuditRuleSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  severity: z.enum(["blocker", "warning", "info"]),
  enabled: z.boolean(),
  instruction: z.string().min(1).max(4000),
});

export const profileAuditSettingsSchema = z.object({
  version: z.literal(1),
  runOnSave: z.boolean(),
  rules: z.array(profileAuditRuleSchema).max(100),
  prompt: z.object({
    system: z.string().min(1).max(40_000),
    user: z.string().min(1).max(80_000),
  }),
  model: z.string().max(200).nullable(),
});

export type ProfileAuditSettings = z.infer<typeof profileAuditSettingsSchema>;
export type ProfileAuditRule = z.infer<typeof profileAuditRuleSchema>;

export const DEFAULT_PROFILE_AUDIT_SETTINGS: ProfileAuditSettings = {
  version: 1,
  runOnSave: false,
  rules: [
    {
      id: "missing-core-fields",
      label: "Core profile fields are present",
      severity: "warning",
      enabled: true,
      instruction:
        "Flag missing or very short name, title, about, skills, or portfolio summary. These are the minimum facts the proposal writer needs.",
    },
    {
      id: "wants-conflict",
      label: "Wants and not-wants do not overlap",
      severity: "blocker",
      enabled: true,
      instruction:
        "Flag any term that appears in both wants and not-wants, including close variants such as 'wordpress' and 'WordPress sites'.",
    },
    {
      id: "ignored-country-conflict",
      label: "Ignored countries do not contain a wanted market",
      severity: "warning",
      enabled: true,
      instruction:
        "Flag an ignored country that is also a target market described in wants, preferred project types, or instructions.",
    },
    {
      id: "duplicate-skills",
      label: "Skills contain no duplicates",
      severity: "info",
      enabled: true,
      instruction:
        "Flag case-insensitive duplicates and near-duplicates in the skills list.",
    },
    {
      id: "conflicting-instructions",
      label: "Instructions do not contradict each other",
      severity: "blocker",
      enabled: true,
      instruction:
        "Flag rules that fight on the same topic: price, delivery time, portfolio links, greeting, sign-off, headings, bullets, length, emojis, or questions. One rule says always/must and another says never/avoid.",
    },
    {
      id: "legacy-format-conflict",
      label: "Legacy proposal instructions match the active policy",
      severity: "warning",
      enabled: true,
      instruction:
        "Flag old proposal system/writing instructions or proposal templates that force a fixed structure, mandatory greeting, mandatory commercial terms, or a fixed number of paragraphs while the active proposal policy says natural format or fields-only commercials.",
    },
    {
      id: "template-is-not-voice",
      label: "Proposal templates are not being mistaken for voice samples",
      severity: "warning",
      enabled: true,
      instruction:
        "Flag proposalTemplates that contain only headings, placeholders, or format rules instead of real prose written by the owner. Voice samples belong in the Proposal System page.",
    },
    {
      id: "vague-portfolio",
      label: "Portfolio items state a concrete outcome",
      severity: "info",
      enabled: true,
      instruction:
        "Flag portfolio items that list a project name but no concrete result, scope, or verifiable detail. Do not invent results.",
    },
    {
      id: "rate-format",
      label: "Hourly rate is usable",
      severity: "info",
      enabled: true,
      instruction:
        "Flag an hourly rate that is not a recognizable amount or currency, because the relevance and proposal prompts may quote it badly.",
    },
    {
      id: "wall-of-rules",
      label: "Instruction blocks are not bloated",
      severity: "warning",
      enabled: true,
      instruction:
        "Flag instruction or template fields over 4,000 characters that repeat the same rules. Long free-form blocks cause the model to follow a template instead of the job.",
    },
  ],
  prompt: {
    system:
      "You are a meticulous profile auditor for a freelance proposal system. You receive the saved profile, the active proposal policy, and deterministic findings. Your job is to find contradictions, ambiguous rules, missing facts, and data that will make proposals generic or factually risky. Do not rewrite the whole profile. Return ONLY valid JSON.",
    user: `SAVED PROFILE:
{{profileJson}}

ACTIVE PROPOSAL POLICY:
{{policyJson}}

AUDIT RULES:
{{auditRules}}

DETERMINISTIC FINDINGS:
{{deterministicFindings}}

Return JSON:
{
  "score": 0,
  "summary": "one or two sentences on profile health",
  "findings": [
    {
      "ruleId": "one of the audit rule ids",
      "severity": "blocker|warning|info",
      "category": "missing|conflict|ambiguity|redundancy|unsupported-claim|format|retrieval",
      "field": "profile field name",
      "title": "short finding",
      "evidence": "exact quote or specific missing field",
      "why": "why this hurts proposal quality",
      "recommendation": "a concrete change the owner can make",
      "suggestedText": "optional replacement text, only when it is clearly safer"
    }
  ]
}

Rules:
- Do not invent profile facts or portfolio results.
- Do not treat a deliberate preference as an error. Flag only genuine contradictions, ambiguity, redundancy, or missing facts.
- The score is 0–100 for how safely the profile can ground a proposal. A blocker caps it below 60.
- Prefer a short, actionable finding over a long essay.
- If there are no genuine findings, return an empty findings array and a high score.`,
  },
  model: null,
};
