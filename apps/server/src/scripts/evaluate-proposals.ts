/**
 * Generate proposals for the fixed eval jobs and score them with the
 * deterministic quality checks.
 *
 * This uses the saved profile, saved OpenRouter key/model, and real credits.
 * It does NOT write proposals to the database.
 *
 * Run from apps/server:
 *   pnpm proposals:eval
 *   pnpm proposals:eval --model=openai/gpt-4o-mini
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";
import {
  generateProposalWithAI,
  type ProposalPromptData,
} from "../modules/ai/ai.service.js";
import { getProfile } from "../modules/profile/profile.service.js";
import { buildProfileBrief } from "../modules/profile/profile-brief.js";
import { evaluateProposalQuality, extractUrls } from "../lib/proposal-quality.js";

interface Fixture {
  name: string;
  data: Omit<ProposalPromptData, "profile">;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../../tests/fixtures/proposal-eval-jobs.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture[];

const modelArg = process.argv.find((arg) => arg.startsWith("--model="));
const model = modelArg?.slice("--model=".length) || undefined;
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const only = onlyArg?.slice("--only=".length).toLowerCase();

const selectedFixtures =
  only === undefined
    ? fixtures
    : fixtures.filter((fixture) => fixture.name.toLowerCase().includes(only));
if (selectedFixtures.length === 0) {
  throw new Error(`No fixture matched --only=${only}`);
}

const user = getDb().select({ id: users.id }).from(users).limit(1).get();
if (user === undefined) {
  throw new Error("No user found. Register in the app first.");
}

const profile = getProfile(user.id);
if (profile === null) {
  throw new Error("No profile found. Save the profile page before evaluating.");
}

const evalProfile: ProposalPromptData["profile"] = {
  name: profile.name,
  title: profile.title,
  hourlyRate: profile.hourlyRate,
  about: profile.about,
  skills: profile.skills,
  wants: profile.wants,
  notWants: profile.notWants,
  customInstructions: profile.customInstructions,
  profileBrief: buildProfileBrief(profile),
  portfolioSummary: profile.portfolioSummary,
  proposalTemplates: profile.proposalTemplates,
  proposalSystemInstructions: profile.proposalSystemInstructions,
  proposalWritingInstructions: profile.proposalWritingInstructions,
};
const allowedUrls = extractUrls(
  [profile.portfolioSummary ?? "", profile.about ?? ""].join("\n")
);

console.log(`Evaluating ${selectedFixtures.length} jobs with model: ${model ?? "saved selection"}`);
console.log(`Profile skills available: ${profile.skills.length}`);
console.log("");

for (const fixture of selectedFixtures) {
  console.log("=".repeat(78));
  console.log(fixture.name);
  console.log("=".repeat(78));

  const { content, competitorNote } = await generateProposalWithAI(
    { ...fixture.data, profile: evalProfile },
    model,
    user.id
  );

  const result = evaluateProposalQuality(content, {
    jobTitle: fixture.data.jobTitle,
    jobDescription: fixture.data.jobDescription,
    jobSkills: fixture.data.skills,
    profileSkills: profile.skills,
    bidAmount: fixture.data.bidAmount,
    deliveryDays: fixture.data.deliveryDays,
    allowedUrls,
  });

  console.log(content);
  console.log("");
  console.log(`Score: ${result.score}/100 (${result.wordCount} words)`);
  for (const check of result.checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"}  ${check.label} — ${check.detail}`);
  }
  for (const warning of result.warnings) {
    console.log(`WARN  ${warning.message}`);
  }
  console.log(`Competitor note: ${competitorNote}`);
  console.log("");
}
