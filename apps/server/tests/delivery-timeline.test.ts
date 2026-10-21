import { describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.ENCRYPTION_KEY ??= "test-master-key-at-least-32-chars-long!!";

const {
  DEFAULT_DELIVERY_TIMELINE_OPTIONS,
  DEFAULT_PREFERRED_DELIVERY_DAYS,
  sanitizeDeliveryDaysList,
  resolveDeliveryDays,
  DEFAULT_BID_AMOUNT_FRACTIONS,
  DEFAULT_BID_AMOUNT_SETTINGS,
  sanitizeBidAmountFractions,
  parseBidAmountFraction,
  resolveBidAmountOptions,
  resolveDefaultBidAmount,
  resolveBidAmount,
  extractClientMentionedBudget,
  roundToNearestStep,
  roundFixedBidAmount,
  isValidBidAmountFraction,
} = await import("../src/lib/delivery-timeline.js");
// ^ DEFAULT_BID_AMOUNT_INSTRUCTORS intentionally omitted: not asserted here

describe("sanitizeDeliveryDaysList", () => {
  it("keeps whole days in range, sorted and deduplicated", () => {
    expect(sanitizeDeliveryDaysList([10, 1, 3, 3, 5, 7])).toEqual([1, 3, 5, 7, 10]);
  });

  it("drops anything that is not a whole day in range", () => {
    expect(sanitizeDeliveryDaysList([0, -3, 1.5, 366, "7", null, 5])).toEqual([5]);
  });

  it("falls back to the default when nothing survives", () => {
    // The list becomes a JSON-schema enum and the Decisions API's criteria, so
    // an empty one is not a state the rest of the app can handle.
    expect(sanitizeDeliveryDaysList([])).toEqual([...DEFAULT_DELIVERY_TIMELINE_OPTIONS]);
    expect(sanitizeDeliveryDaysList(null)).toEqual([...DEFAULT_DELIVERY_TIMELINE_OPTIONS]);
    expect(sanitizeDeliveryDaysList(["nope"])).toEqual([...DEFAULT_DELIVERY_TIMELINE_OPTIONS]);
  });

  it("returns a copy, so a caller cannot mutate the shared default", () => {
    const first = sanitizeDeliveryDaysList(null);
    first.push(99);
    expect(sanitizeDeliveryDaysList(null)).toEqual([...DEFAULT_DELIVERY_TIMELINE_OPTIONS]);
  });
});

describe("resolveDeliveryDays", () => {
  const on = { aiDeliveryTimeline: true, preferredDeliveryDays: 4 };
  const off = { aiDeliveryTimeline: false, preferredDeliveryDays: 4 };

  it("uses the gate's pick when AI selection is on and it produced one", () => {
    expect(resolveDeliveryDays(on, 1)).toBe(1);
  });

  it("falls back to the preferred time when AI selection is off", () => {
    // Turning the switch off must revert every job immediately, including ones
    // that already carry a pick from a previous screening.
    expect(resolveDeliveryDays(off, 1)).toBe(4);
  });

  it("falls back when the job has no pick", () => {
    expect(resolveDeliveryDays(on, null)).toBe(4);
    expect(resolveDeliveryDays(on, undefined)).toBe(4);
  });

  it("falls back for a stored value outside the range Freelancer accepts", () => {
    expect(resolveDeliveryDays(on, 0)).toBe(4);
    expect(resolveDeliveryDays(on, 2.5)).toBe(4);
    expect(resolveDeliveryDays(on, 400)).toBe(4);
  });

  it("honours a non-default preferred time", () => {
    expect(resolveDeliveryDays({ ...off, preferredDeliveryDays: 30 }, null)).toBe(30);
    expect(resolveDeliveryDays({ ...off, preferredDeliveryDays: 30 }, 1)).toBe(30);
  });

  it("ships with 4 days preferred by default", () => {
    // Same number auto-bid hardcoded before this setting existed.
    expect(DEFAULT_PREFERRED_DELIVERY_DAYS).toBe(4);
  });
});

describe("sanitizeBidAmountFractions", () => {
  it("keeps valid fractions and full, deduplicated and trimmed", () => {
    expect(
      sanitizeBidAmountFractions([" 1/2 ", "1/3", "1/2", "full", "FULL", "2/3"])
    ).toEqual(["1/2", "1/3", "full", "2/3"]);
  });

  it("drops invalid fractions", () => {
    expect(
      sanitizeBidAmountFractions(["foo", "3/2", "1/0", "0/2", "-1/2", 123, null, "", "3/4"])
    ).toEqual(["3/4"]);
  });

  it("falls back to default when nothing survives", () => {
    expect(sanitizeBidAmountFractions([])).toEqual([...DEFAULT_BID_AMOUNT_FRACTIONS]);
    expect(sanitizeBidAmountFractions(null)).toEqual([...DEFAULT_BID_AMOUNT_FRACTIONS]);
    expect(sanitizeBidAmountFractions(["invalid", "bad"])).toEqual([
      ...DEFAULT_BID_AMOUNT_FRACTIONS,
    ]);
  });

  it("returns a copy so caller cannot mutate shared default", () => {
    const copy = sanitizeBidAmountFractions(null);
    copy.push("9/10");
    expect(sanitizeBidAmountFractions(null)).toEqual([...DEFAULT_BID_AMOUNT_FRACTIONS]);
  });
});

describe("isValidBidAmountFraction", () => {
  it("accepts fractions, full, and positive multipliers", () => {
    expect(isValidBidAmountFraction("1/2")).toBe(true);
    expect(isValidBidAmountFraction("full")).toBe(true);
    expect(isValidBidAmountFraction("0.5")).toBe(true);
    expect(isValidBidAmountFraction("2")).toBe(true);
  });

  it("rejects zero, inverted fractions, and junk", () => {
    expect(isValidBidAmountFraction("0/2")).toBe(false);
    expect(isValidBidAmountFraction("2/1")).toBe(false);
    expect(isValidBidAmountFraction("0")).toBe(false);
    expect(isValidBidAmountFraction("0.0")).toBe(false);
    expect(isValidBidAmountFraction("1/0")).toBe(false);
    expect(isValidBidAmountFraction("foo")).toBe(false);
  });
});

describe("parseBidAmountFraction", () => {
  it("parses fractions against maximum budget", () => {
    expect(parseBidAmountFraction("1/2", 1000)).toBe(500);
    expect(parseBidAmountFraction("1/3", 750)).toBe(250);
    expect(parseBidAmountFraction("2/3", 750)).toBe(500);
    expect(parseBidAmountFraction("full", 750)).toBe(750);
    expect(parseBidAmountFraction("FULL", 750)).toBe(750);
  });

  it("rounds to nearest integer", () => {
    expect(parseBidAmountFraction("1/3", 1000)).toBe(333);
  });

  it("returns null for non-positive or non-finite budget maximum", () => {
    expect(parseBidAmountFraction("1/2", 0)).toBeNull();
    expect(parseBidAmountFraction("1/2", -500)).toBeNull();
    expect(parseBidAmountFraction("1/2", null)).toBeNull();
    expect(parseBidAmountFraction("1/2", undefined)).toBeNull();
    expect(parseBidAmountFraction("1/2", Number.NaN)).toBeNull();
  });

  it("returns null for invalid fraction expressions", () => {
    expect(parseBidAmountFraction("foo", 1000)).toBeNull();
    expect(parseBidAmountFraction("1/0", 1000)).toBeNull();
    expect(parseBidAmountFraction("0/2", 1000)).toBeNull();
    expect(parseBidAmountFraction("-1/2", 1000)).toBeNull();
    expect(parseBidAmountFraction("3/2", 1000)).toBeNull(); // numerator > denominator
  });

  it("parses decimal multipliers of maximum budget", () => {
    expect(parseBidAmountFraction("0.5", 1000)).toBe(500);
    expect(parseBidAmountFraction("0.25", 800)).toBe(200);
    expect(parseBidAmountFraction("0.8", 500)).toBe(400);
    expect(parseBidAmountFraction("0.125", 1000)).toBe(125);
  });

  it("parses integer multipliers of maximum budget", () => {
    expect(parseBidAmountFraction("2", 500)).toBe(1000);
    expect(parseBidAmountFraction("3", 200)).toBe(600);
  });

  it("returns null for non-positive numeric strings", () => {
    expect(parseBidAmountFraction("0", 1000)).toBeNull();
    expect(parseBidAmountFraction("-0.5", 1000)).toBeNull();
    expect(parseBidAmountFraction("0.0", 1000)).toBeNull();
  });

  it("rounds decimal multiplier results to nearest integer", () => {
    expect(parseBidAmountFraction("0.333", 1000)).toBe(333);
  });
});

describe("resolveBidAmountOptions", () => {
  it("returns concrete dollar amounts from fractions and budget maximum", () => {
    expect(resolveBidAmountOptions(["1/2", "1/3", "2/3", "full"], 750)).toEqual([
      375, 250, 500, 750,
    ]);
  });

  it("supports decimal and integer multipliers", () => {
    expect(resolveBidAmountOptions(["0.5", "0.25", "2", "full"], 1000)).toEqual([
      500, 250, 2000, 1000,
    ]);
  });

  it("returns null when budget maximum is missing or non-positive", () => {
    expect(resolveBidAmountOptions(["1/2", "full"], null)).toBeNull();
    expect(resolveBidAmountOptions(["1/2", "full"], 0)).toBeNull();
    expect(resolveBidAmountOptions(["1/2", "full"], -100)).toBeNull();
  });

  it("returns null when no fractions parse successfully", () => {
    expect(resolveBidAmountOptions(["bad", "invalid"], 500)).toBeNull();
  });

  it("appends a client-mentioned budget as an explicit option", () => {
    // Project max is 250, client mentioned $50 in the description → $50 added
    expect(resolveBidAmountOptions(["1/2", "full"], 250, 50)).toEqual([125, 250, 50]);
  });

  it("does not duplicate an option already produced by a fraction", () => {
    // 1/2 of 200 = 100; client also mentioned 100 → no duplicate
    expect(resolveBidAmountOptions(["1/2", "full"], 200, 100)).toEqual([100, 200]);
  });

  it("dedupes amounts that different fraction spellings resolve to", () => {
    // JSON-schema enums require unique values, and "1/2" + "0.5" both give 500.
    expect(resolveBidAmountOptions(["1/2", "0.5", "full"], 1000)).toEqual([500, 1000]);
  });

  it("drops options that resolve to zero on a tiny budget", () => {
    expect(resolveBidAmountOptions(["1/4", "full"], 1)).toEqual([1]);
  });
});

describe("extractClientMentionedBudget", () => {
  it("extracts a dollar amount mentioned in the description", () => {
    const desc = "I need a website. My max budget is $50 USD.";
    expect(extractClientMentionedBudget(desc, 30, 250)).toBe(50);
  });

  it("returns null when no budget is mentioned", () => {
    expect(extractClientMentionedBudget("I need a website built", 30, 250)).toBeNull();
  });

  it("returns null when the mentioned budget is outside the project range", () => {
    const desc = "My budget is $500";
    expect(extractClientMentionedBudget(desc, 30, 250)).toBeNull();
    expect(extractClientMentionedBudget(desc, 600, 1000)).toBeNull();
  });

  it("handles plain numbers without $", () => {
    const desc = "budget: 750 dollars";
    expect(extractClientMentionedBudget(desc, 500, 1000)).toBe(750);
  });

  it("picks the first candidate within range", () => {
    const desc = "I can pay $100 or maybe $200 for this";
    expect(extractClientMentionedBudget(desc, 30, 250)).toBe(100);
  });

  it("parses thousands separators and decimals correctly", () => {
    expect(extractClientMentionedBudget("My budget is $12,500", 10000, 20000)).toBe(12500);
    expect(extractClientMentionedBudget("I can pay $50.50", 30, 100)).toBe(51);
  });

  it("ignores numbers that are not attached to money words", () => {
    const desc = "I need 3 pages built in 5 days for React 19";
    expect(extractClientMentionedBudget(desc, 1, 100)).toBeNull();
  });

  it("accepts a budget keyword followed by a plain amount", () => {
    expect(extractClientMentionedBudget("budget: 750", 500, 1000)).toBe(750);
  });
});

describe("roundToNearestStep", () => {
  it("rounds to the nearest multiple", () => {
    expect(roundToNearestStep(187, 10)).toBe(190); // 187 → 190
    expect(roundToNearestStep(183, 10)).toBe(180); // 183 → 180
    expect(roundToNearestStep(500, 100)).toBe(500);
    expect(roundToNearestStep(550, 100)).toBe(600);
  });

  it("returns the value unchanged when step is 0 or 1", () => {
    expect(roundToNearestStep(187, 0)).toBe(187);
    expect(roundToNearestStep(187, 1)).toBe(187);
  });
});

describe("roundFixedBidAmount", () => {
  it("bumps a rounded-down result back above the project minimum", () => {
    // Nearest rounding would give 90, below the $100 minimum Freelancer requires.
    expect(roundFixedBidAmount(100, 30, 100)).toBe(120);
  });

  it("keeps a rounded result that is still above the minimum", () => {
    expect(roundFixedBidAmount(187, 10, 100)).toBe(190);
  });

  it("still applies the minimum when rounding is off", () => {
    expect(roundFixedBidAmount(50, 0, 100)).toBe(100);
  });
});

describe("resolveDefaultBidAmount", () => {
  it("returns just the minimum when markup is 0%", () => {
    expect(resolveDefaultBidAmount(250, 750, 0)).toBe(250);
  });

  it("adds markup pct of maximum budget to the minimum", () => {
    expect(resolveDefaultBidAmount(250, 750, 50)).toBe(625); // 250 + 750*0.5
    expect(resolveDefaultBidAmount(200, 800, 25)).toBe(400); // 200 + 800*0.25
    expect(resolveDefaultBidAmount(100, 400, 100)).toBe(500); // full max
  });

  it("treats null or non-positive maximum as 0 (bare minimum)", () => {
    expect(resolveDefaultBidAmount(250, null, 50)).toBe(250);
    expect(resolveDefaultBidAmount(250, 0, 50)).toBe(250);
    expect(resolveDefaultBidAmount(250, -100, 50)).toBe(250);
    expect(resolveDefaultBidAmount(250, undefined, 50)).toBe(250);
  });

  it("clamps markup pct to [0, 100]", () => {
    expect(resolveDefaultBidAmount(250, 750, -10)).toBe(250); // clamped to 0%
    expect(resolveDefaultBidAmount(250, 750, 200)).toBe(1000); // clamped to 100%
  });

  it("rounds to nearest dollar", () => {
    expect(resolveDefaultBidAmount(100, 301, 50)).toBe(251); // 100 + 150.5 → 251
  });

  it("defaults to 0% in DEFAULT_BID_AMOUNT_SETTINGS (backward compat)", () => {
    expect(DEFAULT_BID_AMOUNT_SETTINGS.defaultBidMarkupPct).toBe(0);
  });
});

describe("resolveBidAmount", () => {
  const on = { aiBidAmount: true, minBid: 100, maxBid: 1000, defaultBidMarkupPct: 0, roundBidUpTo: 0 };
  const off = { aiBidAmount: false, minBid: 100, maxBid: 1000, defaultBidMarkupPct: 0, roundBidUpTo: 0 };

  it("uses the gate's pick when AI selection is on and it produced one", () => {
    expect(resolveBidAmount(on, 500, 250, 750)).toBe(500);
  });

  it("clamps the AI pick up to the project minimum budget", () => {
    // AI picks below minimum → bumped up to minimum (250)
    expect(resolveBidAmount(on, 100, 250, 750)).toBe(250);
    // AI picks below minimum but above minBid → still bumped to minimum
    expect(resolveBidAmount(on, 150, 250, 750)).toBe(250);
  });

  it("still clamps the AI pick to [minBid, maxBid] after the minimum guard", () => {
    // AI picks 50, min budget is 100, minBid is 100 → 100
    expect(resolveBidAmount(on, 50, 100, 750)).toBe(100);
    // AI picks 2000, min budget is 250, maxBid is 1000 → 1000
    expect(resolveBidAmount(on, 2000, 250, 750)).toBe(1000);
  });

  it("falls back to clamped minimum budget when AI selection is off", () => {
    // 0% markup → minimum, no maximum needed
    expect(resolveBidAmount(off, 500, 250, undefined)).toBe(250);
  });

  it("clamps markup-based amount between minBid and maxBid when AI selection is off", () => {
    expect(resolveBidAmount(off, null, 50, undefined)).toBe(100); // clamped up to minBid
    expect(resolveBidAmount(off, null, 1500, undefined)).toBe(1000); // clamped down to maxBid
  });

  it("applies markup on the project maximum when AI selection is off", () => {
    const offWithMarkup = { ...off, defaultBidMarkupPct: 50 };
    // 250 + 750 * 0.5 = 625, within [100, 1000]
    expect(resolveBidAmount(offWithMarkup, 500, 250, 750)).toBe(625);
    // 100 + 400 * 0.5 = 300, within bounds
    expect(resolveBidAmount(offWithMarkup, null, 100, 400)).toBe(300);
  });

  it("clamps markup-based amount to [minBid, maxBid]", () => {
    const offWithMarkup = { ...off, defaultBidMarkupPct: 80 };
    // 250 + 750 * 0.8 = 850, within [100, 1000]
    expect(resolveBidAmount(offWithMarkup, 500, 250, 750)).toBe(850);
    // 250 + 1000 * 1.0 = 1250 → clamped down to 1000
    const fullMarkup = { ...off, defaultBidMarkupPct: 100 };
    expect(resolveBidAmount(fullMarkup, null, 250, 1000)).toBe(1000);
    // 0% markup with a tiny minimum still falls back and clamps up to minBid
    // resolveDefaultBidAmount(50, 200, 0) = 50 → clamped up to minBid 100
    expect(resolveBidAmount(off, null, 50, 200)).toBe(100);
  });

  it("falls back when jobBidAmount is null, undefined, or non-positive", () => {
    expect(resolveBidAmount(on, null, 300, 800)).toBe(300);
    expect(resolveBidAmount(on, undefined, 300, 800)).toBe(300);
    expect(resolveBidAmount(on, 0, 300, 800)).toBe(300);
    expect(resolveBidAmount(on, -50, 300, 800)).toBe(300);
  });

  it("rounds fractional jobBidAmount to integer", () => {
    expect(resolveBidAmount(on, 499.6, 250, 750)).toBe(500);
  });

  it("rounds to nearest step when roundBidUpTo is set and project is fixed-price", () => {
    const withRound = { ...off, roundBidUpTo: 10 };
    // 250 + 0 = 250 → round to 250 (already a multiple)
    expect(resolveBidAmount(withRound, null, 250, undefined, "fixed")).toBe(250);
    // With markup: 100 + 400*0.5 = 300 → round to 300 (already multiple)
    const withMarkup = { ...off, roundBidUpTo: 10, defaultBidMarkupPct: 50 };
    expect(resolveBidAmount(withMarkup, null, 100, 400, "fixed")).toBe(300);
    // 187 → 190
    const onRound = { ...on, roundBidUpTo: 10 };
    expect(resolveBidAmount(onRound, 187, 100, 750, "fixed")).toBe(190);
    // 183 → 180 (nearest, not always up)
    expect(resolveBidAmount(onRound, 183, 100, 750, "fixed")).toBe(180);
  });

  it("does not round for hourly projects even when roundBidUpTo is set", () => {
    const onRound = { ...on, roundBidUpTo: 10 };
    expect(resolveBidAmount(onRound, 187, 100, 750, "hourly")).toBe(187);
  });

  it("does not round when roundBidUpTo is 0 or 1", () => {
    const noRound0 = { ...on, roundBidUpTo: 0 };
    expect(resolveBidAmount(noRound0, 187, 100, 750, "fixed")).toBe(187);
    const noRound1 = { ...on, roundBidUpTo: 1 };
    expect(resolveBidAmount(noRound1, 187, 100, 750, "fixed")).toBe(187);
  });

  it("keeps the final amount within [minBid, maxBid] after rounding", () => {
    // 250 rounds to 300 with a $100 step, but maxBid is 250.
    const capped = { ...off, maxBid: 250, roundBidUpTo: 100 };
    expect(resolveBidAmount(capped, null, 250, undefined, "fixed")).toBe(250);

    // Nearest rounding would give 90, below the $100 minimum budget.
    const minGuard = { ...on, minBid: 1, maxBid: 1000, roundBidUpTo: 30 };
    expect(resolveBidAmount(minGuard, 100, 100, 750, "fixed")).toBe(120);
  });
});

