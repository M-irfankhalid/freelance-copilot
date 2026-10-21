/**
 * Pre-analysis rejection toggles, read from the per-user automation settings
 * row. Kept here (in the jobs module) so `jobs.service.ts` can read them
 * without importing `automation.service` — which itself imports `searchJobs`
 * and `analyzeJob` from the jobs module, so a direct import would be circular.
 *
 * This is a pure DB read; it never creates the settings row. A missing row
 * (user has never opened Automation) means every toggle is treated as ON,
 * matching historical behavior.
 */
import { eq } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { automationSettings } from "../../db/schema.js";

export interface PreAnalysisGates {
  /** Reject jobs posted more than 12h ago before they are even stored. */
  rejectStaleJobs: boolean;
  /** Master switch for the free keyword/country screen run at poll time. */
  cheapScreeningEnabled: boolean;
  /** Reject jobs whose client country is on the profile ignore list. */
  rejectIgnoredCountries: boolean;
  /** Reject jobs whose text matches a profile not-wants term. */
  rejectNotWants: boolean;
  /** Reject jobs that don't mention any profile wants term (when any are set). */
  rejectMissingWants: boolean;
  /** Reject brand-new, unverified clients (no deposit/upgrades) before analysis. */
  rejectBadReputation: boolean;
}

export const DEFAULT_PREANALYSIS_GATES: PreAnalysisGates = {
  rejectStaleJobs: true,
  cheapScreeningEnabled: true,
  rejectIgnoredCountries: true,
  rejectNotWants: true,
  rejectMissingWants: true,
  rejectBadReputation: true,
};

/** Read the toggles for a user, defaulting to all-on when no row exists yet. */
export function getPreanalysisGates(userId: string): PreAnalysisGates {
  if (userId.length === 0) return DEFAULT_PREANALYSIS_GATES;

  const row = getDb()
    .select({
      rejectStaleJobs: automationSettings.rejectStaleJobs,
      cheapScreeningEnabled: automationSettings.cheapScreeningEnabled,
      rejectIgnoredCountries: automationSettings.rejectIgnoredCountries,
      rejectNotWants: automationSettings.rejectNotWants,
      rejectMissingWants: automationSettings.rejectMissingWants,
      rejectBadReputation: automationSettings.rejectBadReputation,
    })
    .from(automationSettings)
    .where(eq(automationSettings.userId, userId))
    .get();

  if (row === undefined) return DEFAULT_PREANALYSIS_GATES;
  return {
    rejectStaleJobs: row.rejectStaleJobs === 1,
    cheapScreeningEnabled: row.cheapScreeningEnabled === 1,
    rejectIgnoredCountries: row.rejectIgnoredCountries === 1,
    rejectNotWants: row.rejectNotWants === 1,
    rejectMissingWants: row.rejectMissingWants === 1,
    rejectBadReputation: row.rejectBadReputation === 1,
  };
}
