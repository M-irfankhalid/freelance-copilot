import type { ProfileData } from "./profile.service.js";

function text(value: string | null | undefined): string {
  return value?.trim() || "Not provided";
}

function list(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "None specified";
}

export function buildProfileBrief(profile: ProfileData): string {
  return [
    "Verified profile facts. Use only these facts. Never invent skills, projects, clients, or work history.",
    "",
    "IDENTITY",
    `Name: ${text(profile.name)}`,
    `Title: ${text(profile.title)}`,
    `Hourly rate: ${text(profile.hourlyRate)}`,
    "",
    "ABOUT",
    text(profile.about),
    "",
    "SKILLS",
    list(profile.skills),
    "",
    "PORTFOLIO",
    text(profile.portfolioSummary),
    "",
    "JOB FIT",
    `Wants: ${list(profile.wants)}`,
    `Not wants: ${list(profile.notWants)}`,
    `Ignored countries: ${list(profile.ignoredCountries)}`,
    `Screening instructions: ${text(profile.relevancyInstructions)}`,
  ].join("\n");
}

export interface ProposalFactSheetOptions {
  /** Include the full portfolio. The pipeline turns this off so only ranked evidence is visible. */
  includePortfolio?: boolean;
  /** Include the hourly rate. Omit when the active policy forbids commercials in the body. */
  includeCommercials?: boolean;
}

/**
 * Fact sheet for proposal writing. Deliberately excludes screening-only data
 * (wants, not-wants, ignored countries, relevancy instructions) which is noise
 * for a client-facing proposal.
 */
export function buildProposalFactSheet(
  profile: ProfileData,
  options: ProposalFactSheetOptions = {}
): string {
  const includePortfolio = options.includePortfolio ?? true;
  const includeCommercials = options.includeCommercials ?? true;
  const lines = [
    "Verified profile facts. Use only these facts. Never invent skills, projects, clients, results, or work history.",
    "",
    "IDENTITY",
    `Name: ${text(profile.name)}`,
    `Title: ${text(profile.title)}`,
  ];
  if (includeCommercials) {
    lines.push(`Hourly rate: ${text(profile.hourlyRate)}`);
  }
  lines.push("", "ABOUT", text(profile.about), "", "SKILLS", list(profile.skills));
  if (includePortfolio) {
    lines.push("", "PORTFOLIO", text(profile.portfolioSummary));
  } else {
    lines.push(
      "",
      "PORTFOLIO",
      "Use only the SELECTED EVIDENCE below. Do not claim or describe any other project."
    );
  }

  const instructions = profile.customInstructions?.trim();
  if (instructions) {
    lines.push("", "OWNER WRITING INSTRUCTIONS", instructions);
  }

  return lines.join("\n");
}
