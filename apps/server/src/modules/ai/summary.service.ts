import { getProfile } from "../profile/profile.service.js";
import { getDb } from "../../db/index.js";
import { userProfile, platformCredentials } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { AppError } from "../../lib/errors.js";
import { decrypt } from "../../lib/crypto.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("ai");

export async function generateUserSummary(
  userId: string,
  preferredModel?: string
): Promise<string> {
  const profile = getProfile(userId);
  if (!profile) {
    throw new AppError(404, "NOT_FOUND", "Profile not found");
  }

  const profileRow = getDb()
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .get();

  // Build real reputation info from profile import data (if reputation stats exist in DB)
  // The userSummary field is stored as plain text, so we defensively parse it
  // as JSON only if it was previously stored as a structured object. If it's
  // plain text (the normal case after a profile save), we get no reputation
  // data and fall back to the "not imported" message.
  let reputationRaw: { overall?: number; reviews?: number; completion_rate?: number } | null = null;
  if (profileRow?.userSummary) {
    try {
      const parsed = JSON.parse(profileRow.userSummary);
      if (parsed && typeof parsed === "object" && "reputation" in parsed) {
        reputationRaw = parsed.reputation as { overall?: number; reviews?: number; completion_rate?: number } | null;
      }
    } catch {
      // userSummary is plain text, not JSON — no structured reputation data.
      reputationRaw = null;
    }
  }

  const skillsText = profile.skills.length
    ? profile.skills.join(", ")
    : "No skills listed";

  const reputationLine = reputationRaw
    ? `Reputation: ${reputationRaw.overall || "Unknown"}/5.0, ${reputationRaw.reviews || 0} reviews, ${Math.round((reputationRaw.completion_rate || 0) * 100)}% completion rate.`
    : "Reputation data not yet imported from Freelancer.com.";

  const experienceText = profile.experience.length
    ? profile.experience.map(e => `${e.role} at ${e.company} (${e.periodLabel})`).join("; ")
    : "Experience details available in profile.";

  const portfolioText = profile.portfolio.length
    ? profile.portfolio.map(p => `"${p.title}"`).join(", ")
    : "No portfolio items listed.";

  const prompt = `Generate a professional user summary for AI analysis using ONLY these verified profile facts:

=== VERIFIED PROFILE FACTS ===
Name: ${profile.name || "Not set"}
Title: ${profile.title || "Not set"}
Hourly rate: ${profile.hourlyRate || "Not set"}
About: ${profile.about || "No description provided"}
Skills: ${skillsText}
Experience: ${experienceText}
Portfolio: ${portfolioText}
Wants: ${profile.wants.join("; ") || "None specified"}
Not-wants: ${profile.notWants.join("; ") || "None specified"}
Custom instructions: ${profile.customInstructions || "None"}
${reputationLine}
===
Write a concise 3-4 paragraph professional summary that captures:
- Who the user is (name, title, skills)
- What they've done (experience highlights, portfolio)
- Their strengths (reputation, ratings)
- What they prefer / avoid (wants/not-wants)
- Their rate and custom instructions

Use ONLY the facts above. Never invent skills, experience, portfolio items, certifications, previous work, or client history.`;

  const systemPrompt = "You are a senior freelancing consultant writing a user profile summary for AI analysis. Use ONLY verified profile facts provided. Never invent information.";

  const credRow = getDb()
    .select()
    .from(platformCredentials)
    .where(eq(platformCredentials.id, "openrouter"))
    .get();

  if (credRow === undefined) {
    throw new AppError(400, "NO_OPENROUTER_KEY", "Save an OpenRouter API key first (Platforms page)");
  }

  const plaintextKey = decrypt(credRow);
  const model = preferredModel || "openai/gpt-4o-mini";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${plaintextKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://freelancer-agent.local",
      "X-Title": "Freelancer Agent",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    }),
    // Generous budget: LLM generation on a full job description regularly
    // exceeds the 30s used for plain API fetches.
    signal: AbortSignal.timeout(120_000),
  });

  if (response.status === 401) {
    throw new AppError(401, "AUTH_ERROR", "OpenRouter key was rejected");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AppError(502, "UPSTREAM_ERROR", `OpenRouter responded with status ${response.status}: ${text.slice(0, 200)}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = body?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new AppError(502, "UPSTREAM_ERROR", "OpenRouter returned empty or invalid response");
  }

  const summaryText = content.trim();

  // Save the generated summary back to the profile
  getDb()
    .update(userProfile)
    .set({ userSummary: summaryText, updatedAt: new Date().toISOString() })
    .where(eq(userProfile.userId, userId))
    .run();

  log.info(`Generated user summary for ${userId}`);

  return summaryText;
}
