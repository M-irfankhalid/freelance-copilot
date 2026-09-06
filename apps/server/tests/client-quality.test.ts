import { describe, expect, it } from "vitest";

import {
  accountAgeDays,
  accountAgeLabel,
  clientTrustConcerns,
  extractClientQuality,
  isAutoBidEligible,
  isBidBlocked,
  parseClientQuality,
  presentUpgradeLabels,
  qualityFromRawData,
  reputationLabel,
  serializeClientQuality,
  type ClientQuality,
} from "../src/modules/jobs/client-quality.js";
import type { FreelancerProject } from "../src/modules/jobs/jobs.client.js";

const NOW_SECONDS = Math.floor(Date.now() / 1000);

/** Minimal Freelancer.com project with full client-trust wire fields. */
function projectWith(overrides: Partial<FreelancerProject> = {}): FreelancerProject {
  const base = {
    id: 1,
    type: "fixed",
    owner_info: {
      country: { name: "Germany", code: "de" },
      status: {},
      reputation: { entire_history: {} },
    },
    upgrades: {},
  } as unknown as FreelancerProject;
  return { ...base, ...overrides };
}

function qualityFor(project: FreelancerProject): ClientQuality {
  return extractClientQuality(project);
}

describe("extractClientQuality", () => {
  it("maps verification flags, registration date, and upgrades", () => {
    const q = qualityFor(
      projectWith({
        owner_info: {
          country: { name: "India", code: "in" },
          status: {
            payment_verified: true,
            email_verified: true,
            deposit_made: true,
            phone_verified: false,
          },
          registration_date: NOW_SECONDS - 200 * 86400,
          reputation: {
            entire_history: { overall: 4.9, all: 42, positive: 0.97 },
          },
        },
        upgrades: { NDA: true, recruiter: true },
      } as unknown as FreelancerProject)
    );

    expect(q.country).toBe("India");
    expect(q.paymentVerified).toBe(true);
    expect(q.emailVerified).toBe(true);
    expect(q.depositMade).toBe(true);
    expect(q.phoneVerified).toBe(false);
    expect(q.registeredAt).toBe(NOW_SECONDS - 200 * 86400);
    expect(q.reputationOverall).toBe(4.9);
    expect(q.reputationCount).toBe(42);
    expect(q.positiveRate).toBe(0.97);
    expect(q.upgrades.nda).toBe(true);
    expect(q.upgrades.ipContract).toBe(false);
    expect(q.upgrades.recruiter).toBe(true);
    expect(q.upgrades.featured).toBe(false);
  });

  it("defaults missing signals to null/false rather than guessing", () => {
    const q = qualityFor(projectWith({}));
    expect(q.paymentVerified).toBeNull();
    expect(q.depositMade).toBeNull();
    expect(q.registeredAt).toBeNull();
    expect(q.reputationOverall).toBeNull();
    expect(q.upgrades.nda).toBe(false);
    expect(q.upgrades.ipContract).toBe(false);
  });
});

describe("parse/serialize round-trip", () => {
  it("round-trips a snapshot through JSON", () => {
    const q = qualityFor(
      projectWith({
        owner_info: {
          status: { payment_verified: true },
          reputation: { entire_history: { overall: 5, all: 3 } },
        },
      } as unknown as FreelancerProject)
    );
    const parsed = parseClientQuality(serializeClientQuality(q));
    expect(parsed).toEqual(q);
  });

  it("returns null for empty or malformed snapshots", () => {
    expect(parseClientQuality(null)).toBeNull();
    expect(parseClientQuality("")).toBeNull();
    expect(parseClientQuality("not json")).toBeNull();
  });

  it("derives a snapshot from a raw project blob (legacy-row fallback)", () => {
    const raw = JSON.stringify(
      projectWith({
        owner_info: {
          status: { payment_verified: true, deposit_made: true },
        },
        upgrades: { ip_contract: true },
      } as unknown as FreelancerProject)
    );
    const q = qualityFromRawData(raw);
    expect(q?.paymentVerified).toBe(true);
    expect(q?.depositMade).toBe(true);
    expect(q?.upgrades.ipContract).toBe(true);
  });

  it("returns null when the raw blob is unusable", () => {
    expect(qualityFromRawData(null)).toBeNull();
    expect(qualityFromRawData("{oops")).toBeNull();
  });
});

describe("isBidBlocked", () => {
  it("flags NDA and IP-contract projects", () => {
    const nda = qualityFor(
      projectWith({ upgrades: { NDA: true } } as unknown as FreelancerProject)
    );
    const ip = qualityFor(
      projectWith({ upgrades: { ip_contract: true } } as unknown as FreelancerProject)
    );
    const fine = qualityFor(projectWith({}));
    expect(isBidBlocked(nda)).toBe(true);
    expect(isBidBlocked(ip)).toBe(true);
    expect(isBidBlocked(fine)).toBe(false);
  });
});

describe("isAutoBidEligible", () => {
  it("never bids when the snapshot is missing", () => {
    expect(isAutoBidEligible(null, "fixed")).toBe(false);
  });

  it("never bids an NDA/IP job, even a verified client", () => {
    const q = qualityFor(
      projectWith({
        owner_info: { status: { payment_verified: true } },
        upgrades: { NDA: true },
      } as unknown as FreelancerProject)
    );
    expect(isAutoBidEligible(q, "fixed")).toBe(false);
  });

  it("never bids an unverified client, regardless of deposit or upgrades", () => {
    const q = qualityFor(
      projectWith({
        owner_info: {
          status: { payment_verified: false, deposit_made: true },
          reputation: { entire_history: { overall: 4.8, all: 20 } },
        },
      } as unknown as FreelancerProject)
    );
    expect(isAutoBidEligible(q, "fixed")).toBe(false);
  });

  it("bids a payment-verified client even without deposit history (escrow protects)", () => {
    const q = qualityFor(
      projectWith({
        owner_info: { status: { payment_verified: true } },
      } as unknown as FreelancerProject)
    );
    expect(isAutoBidEligible(q, "fixed")).toBe(true);
  });

  it("bids a verified brand-new account — account age is not a hard gate", () => {
    const q = qualityFor(
      projectWith({
        owner_info: {
          status: { payment_verified: true },
          registration_date: NOW_SECONDS - 3 * 86400,
        },
      } as unknown as FreelancerProject)
    );
    expect(isAutoBidEligible(q, "fixed")).toBe(true);
  });
});

describe("account age + reputation labels", () => {
  it("labels accounts by age buckets", () => {
    const brandNew = qualityFor(
      projectWith({
        owner_info: { registration_date: NOW_SECONDS - 5 * 86400 },
      } as unknown as FreelancerProject)
    );
    const months = qualityFor(
      projectWith({
        owner_info: { registration_date: NOW_SECONDS - 90 * 86400 },
      } as unknown as FreelancerProject)
    );
    const years = qualityFor(
      projectWith({
        owner_info: { registration_date: NOW_SECONDS - 2 * 365 * 86400 },
      } as unknown as FreelancerProject)
    );
    const unknown = qualityFor(projectWith({}));

    expect(accountAgeDays(brandNew)).toBe(5);
    expect(accountAgeLabel(brandNew)).toContain("brand new");
    expect(accountAgeLabel(months)).toContain("~3 months ago");
    expect(accountAgeLabel(years)).toContain("established");
    expect(accountAgeLabel(unknown)).toBe("account age unknown");
  });

  it("describes reputation from the overall score and rating count", () => {
    const rated = qualityFor(
      projectWith({
        owner_info: { reputation: { entire_history: { overall: 4.6, all: 8 } } },
      } as unknown as FreelancerProject)
    );
    const none = qualityFor(projectWith({}));
    expect(reputationLabel(rated)).toBe("4.6/5 from 8 ratings");
    expect(reputationLabel(none)).toBe("no public rating history");
  });
});

describe("presentUpgradeLabels", () => {
  it("lists only the upgrades that are set", () => {
    const q = qualityFor(
      projectWith({
        upgrades: { NDA: true, recruiter: true, featured: false },
      } as unknown as FreelancerProject)
    );
    expect(presentUpgradeLabels(q)).toEqual(["NDA", "Recruiter"]);
  });

  it("returns an empty list when nothing is set", () => {
    expect(presentUpgradeLabels(qualityFor(projectWith({})))).toEqual([]);
  });
});

describe("clientTrustConcerns", () => {
  it("flags unverified payment, brand-new accounts, and signature requirements", () => {
    const q = qualityFor(
      projectWith({
        owner_info: {
          status: { payment_verified: false },
          registration_date: NOW_SECONDS - 2 * 86400,
        },
        upgrades: { NDA: true },
      } as unknown as FreelancerProject)
    );
    const concerns = clientTrustConcerns(q, "fixed");
    expect(concerns).toContain("Client payment method is not verified");
    expect(concerns.join("\n")).toContain("brand new");
    expect(concerns.join("\n")).toContain("NDA / IP contract");
  });

  it("flags an explicitly-absent escrow deposit on fixed-price work", () => {
    const q = qualityFor(
      projectWith({
        owner_info: {
          status: { payment_verified: true, deposit_made: false },
        },
      } as unknown as FreelancerProject)
    );
    expect(clientTrustConcerns(q, "fixed")).toContain(
      "Client has never funded an escrow milestone (fixed-price project)"
    );
    // Unknown deposit (field missing) is not a loud warning — escrow protects.
    const missing = qualityFor(
      projectWith({
        owner_info: { status: { payment_verified: true } },
      } as unknown as FreelancerProject)
    );
    expect(clientTrustConcerns(missing, "fixed")).toEqual([]);
  });

  it("flags a thin, low reputation", () => {
    const q = qualityFor(
      projectWith({
        owner_info: {
          reputation: { entire_history: { overall: 4.0, all: 3 } },
        },
      } as unknown as FreelancerProject)
    );
    expect(clientTrustConcerns(q, "hourly")).toContain(
      "Client has a thin or low reputation history"
    );
  });

  it("returns no concerns for a clean, verified client", () => {
    const q = qualityFor(
      projectWith({
        owner_info: {
          status: { payment_verified: true },
          registration_date: NOW_SECONDS - 3 * 365 * 86400,
          reputation: { entire_history: { overall: 4.9, all: 50 } },
        },
      } as unknown as FreelancerProject)
    );
    expect(clientTrustConcerns(q, "fixed")).toEqual([]);
  });
});
