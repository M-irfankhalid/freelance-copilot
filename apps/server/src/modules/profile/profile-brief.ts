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
