/**
 * Cheap, deterministic relevancy filter run BEFORE any OpenRouter call.
 *
 * Goals:
 * - Never call the model for jobs that match the user's `notWants` (deal-breakers).
 * - Prefer to skip the model when the job doesn't speak to the user's `wants`
 *   or any of their `profileSkills` keywords. We do this so OpenRouter isn't
 *   spent on jobs the user already filtered out conceptually.
 * - The AI service still gets called when this filter passes — the AI does
 *   the nuanced matching. This module only does keyword-level screening.
 *
 * Rules (case-insensitive substring matching throughout):
 * - Hard-fail if any `notWants` term appears in title + description + skills.
 * - If `wants` is non-empty, hard-fail if none of them appear anywhere in the
 *   job text.
 * - If `profileSkills` is non-empty, hard-fail if none of them appear in the
 *   job's skills or title.
 *
 * The function is pure and synchronous so it's trivial to test and so the
 * service can log the decision without doing any I/O.
 */

export interface RelevancyInput {
  jobTitle: string;
  jobDescription: string[];
  jobSkills: string[];
  /** Profile "wants" — explicit must-haves the user wants to see. */
  wants: string[];
  /** Profile "not-wants" — deal-breakers. Hard filter. */
  notWants: string[];
  /** Profile skills used as keywords. */
  profileSkills: string[];
}

export type RelevancyDecision =
  | { relevant: true; matchedWants: string[]; matchedKeywords: string[] }
  | { relevant: false; reasons: string[] };

/** A country reference from the Freelancer API — name and/or ISO code. */
export interface CountryRef {
  name?: string;
  code?: string;
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Whether a job's country is on the profile's ignore list. Matches the
 * country's name or ISO code, case-insensitively, including partial
 * containment ("Pakistan" in "Pakistan, Islamic Republic of"). An empty
 * ignore list or a missing country always returns false.
 */
export function isCountryIgnored(
  country: CountryRef | undefined,
  ignoredCountries: string[]
): boolean {
  if (country === undefined || ignoredCountries.length === 0) return false;

  const haystack = [country.name, country.code]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map(norm);
  if (haystack.length === 0) return false;

  const needles = ignoredCountries.map(norm).filter((c) => c.length > 0);
  if (needles.length === 0) return false;

  return needles.some((needle) =>
    haystack.some(
      (value) => value === needle || value.includes(needle) || needle.includes(value)
    )
  );
}

/**
 * Apply the relevancy filter. Returns a decision describing either the
 * positive signals that matched or the list of human-readable reasons the
 * job was filtered out.
 */
export function applyRelevancyFilter(input: RelevancyInput): RelevancyDecision {
  const title = norm(input.jobTitle);
  const description = input.jobDescription.map(norm).join("\n");
  const skills = input.jobSkills.map(norm);
  const jobText = `${title}\n${description}\n${skills.join(" ")}`;

  // 1. Not-wants: hard fail.
  const notWantsHit = input.notWants
    .map(norm)
    .filter((n) => n.length > 0)
    .filter((n) => jobText.includes(n));
  if (notWantsHit.length > 0) {
    return {
      relevant: false,
      reasons: notWantsHit.map(
        (n) => `Job matches a "not-wants" filter: "${n}"`
      ),
    };
  }

  // 2. Wants: hard fail if at least one must be present and none matched.
  const wants = input.wants.map(norm).filter((n) => n.length > 0);
  if (wants.length > 0) {
    const matched = wants.filter((w) => jobText.includes(w));
    if (matched.length === 0) {
      return {
        relevant: false,
        reasons: [
          "Job does not mention any of the wanted keywords: " +
            input.wants.join(", "),
        ],
      };
    }
  }

  // 3. Profile skills used as keywords against the job's skills and title.
  const skillsText = `${title} ${skills.join(" ")}`;
  const profileKeywords = input.profileSkills.map(norm).filter((s) => s.length > 0);
  let matchedKeywords: string[] = [];
  if (profileKeywords.length > 0) {
    matchedKeywords = profileKeywords.filter((k) => skillsText.includes(k));
    if (matchedKeywords.length === 0) {
      return {
        relevant: false,
        reasons: [
          "Job does not mention any of your profile skills: " +
            input.profileSkills.join(", "),
        ],
      };
    }
  }

  return {
    relevant: true,
    matchedWants: wants.filter((w) => jobText.includes(w)),
    matchedKeywords,
  };
}
