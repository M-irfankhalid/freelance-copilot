import { z } from "zod";

import {
  MAX_DELIVERY_DAYS,
  MIN_DELIVERY_DAYS,
  isValidBidAmountFraction,
} from "../../lib/delivery-timeline.js";

/**
 * Shared write contract for automation settings. The HTTP route and MCP tool
 * use the same schema so a setting cannot be writable in one surface only.
 */
export const automationSettingsPatchSchema = z
  .object({
    scanIntervalSeconds: z.number().int().positive().max(3600).optional(),
    autoAnalyze: z.boolean().optional(),
    autoMatch: z.boolean().optional(),
    autobidEnabled: z.boolean().optional(),
    paused: z.boolean().optional(),
    minMatchScore: z.number().int().min(0).max(100).optional(),
    minBid: z.number().int().positive().optional(),
    maxBid: z.number().int().positive().optional(),
    dailyCap: z.number().int().positive().max(100).optional(),
    rejectStaleJobs: z.boolean().optional(),
    skipStaleBids: z.boolean().optional(),
    maxBidAgeHours: z.number().int().min(1).max(168).optional(),
    cheapScreeningEnabled: z.boolean().optional(),
    rejectIgnoredCountries: z.boolean().optional(),
    rejectNotWants: z.boolean().optional(),
    rejectMissingWants: z.boolean().optional(),
    rejectMissingSkills: z.boolean().optional(),
    rejectBadReputation: z.boolean().optional(),
    aiDeliveryTimeline: z.boolean().optional(),
    preferredDeliveryDays: z
      .number()
      .int()
      .min(MIN_DELIVERY_DAYS)
      .max(MAX_DELIVERY_DAYS)
      .optional(),
    deliveryTimelineOptions: z
      .array(z.number().int().min(MIN_DELIVERY_DAYS).max(MAX_DELIVERY_DAYS))
      .min(1)
      .max(12)
      .optional(),
    deliveryTimelineInstructions: z.string().max(2000).optional(),
    aiBidAmount: z.boolean().optional(),
    bidAmountFractions: z
      .array(z.string().max(20))
      .min(1)
      .max(50)
      .refine((values) => values.every(isValidBidAmountFraction), {
        message:
          "Each option must be a fraction (1/2), a positive multiplier (0.5, 2), or full",
      })
      .optional(),
    bidAmountInstructions: z.string().max(2000).optional(),
    defaultBidMarkupPct: z.number().int().min(0).max(100).optional(),
    bidAmountMarkupInstructions: z.string().max(2000).optional(),
    roundBidUpTo: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one automation setting",
  });

export type AutomationSettingsPatch = z.infer<typeof automationSettingsPatchSchema>;
