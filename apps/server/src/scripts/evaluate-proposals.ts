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
import type { ProposalPromptData } from "../modules/ai/ai.service.js";
import { getProfile } from "../modules/profile/profile.service.js";
import { generateProposalWithPipeline } from "../modules/proposals/proposal-pipeline.service.js";

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

console.log(`Evaluating ${selectedFixtures.length} jobs with model: ${model ?? "saved selection"}`);
console.log(`Profile skills available: ${profile.skills.length}`);
console.log("");

for (const fixture of selectedFixtures) {
  console.log("=".repeat(78));
  console.log(fixture.name);
  console.log("=".repeat(78));

  try {
    const result = await generateProposalWithPipeline(fixture.data, user.id, { model });

    console.log(result.content);
    console.log("");
    console.log(
      `Score: ${result.quality.score}/100 (${result.quality.wordCount} words), review ${result.reviewStatus}`
    );
    for (const check of result.quality.checks) {
      console.log(`${check.passed ? "PASS" : "FAIL"}  ${check.label} — ${check.detail}`);
    }
    for (const warning of result.quality.warnings) {
      console.log(`WARN  ${warning.message}`);
    }
    console.log(
      `Coverage: ${result.coverage.coveredCount}/${result.coverage.total}${
        result.coverage.missing.length > 0
          ? ` — missing: ${result.coverage.missing.join("; ")}`
          : ""
      }`
    );
    console.log(`Competitor note: ${result.competitorNote}`);
  } catch (error) {
    console.log(`FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  console.log("");
}
