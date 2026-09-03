import { profileSchema } from "./src/modules/profile/profile.service.js";

const base: Record<string, unknown> = {
  freelancerUsername: null, name: null, title: null, hourlyRate: null, about: null,
  skills: ["React.js", "Node.js"], skillIds: [759, 500], experience: [], portfolio: [],
  certifications: [], preferredProjectTypes: [], wants: [], notWants: [], ignoredCountries: [],
  customInstructions: null, userSummary: null, relevancyInstructions: null,
  portfolioSummary: null, proposalTemplates: null,
};

const show = (label: string, r: { success: boolean; data?: unknown; error?: unknown }) => {
  console.log(`${label} ok:`, r.success);
  if (!r.success) console.log(JSON.stringify((r.error as { flatten: () => unknown }).flatten(), null, 1));
};

show("R1 all-null", profileSchema.safeParse(base));

show("R2 filled",
  profileSchema.safeParse({ ...base, relevancyInstructions: "no web3 projects", proposalTemplates: "## Template\nHello world", portfolioSummary: "# P\nreal work", userSummary: "Senior dev", customInstructions: "Be concise" }));

show("R3 overlong-skill",
  profileSchema.safeParse({ ...base, skills: ["A skill name that is definitely way longer than sixty characters in total length here"] }));

show("R4 unknown-key", profileSchema.safeParse({ ...base, bogusField: "x", ALSO_UNKNOWN: 3 }));

show("R5 realistic-complete",
  profileSchema.safeParse({
    freelancerUsername: "irfan_dev", name: "Irfan", title: "React Developer",
    hourlyRate: "$35/hr", about: "Full-stack developer.",
    skills: ["React.js", "Node.js"], skillIds: [9, 759],
    experience: [{ role: "Dev", company: "Self", periodLabel: "2021 - now", summary: null }],
    portfolio: [], certifications: [], preferredProjectTypes: ["Fixed price"], wants: ["React"],
    notWants: ["crypto"], ignoredCountries: ["Nigeria", "India"], customInstructions: "Be concise.",
    userSummary: "I am a developer", relevancyInstructions: "No web3, no crypto gambling",
    portfolioSummary: "# Portfolio\n* AroundU.Social\n* Figma landing",
    proposalTemplates: "## Intro\nHi {client},\n\n## Body\nI can help...",
  }));
