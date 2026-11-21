import { describe, expect, it } from "vitest";

import {
  allowedEvidenceUrls,
  rankPortfolioEvidence,
  selectEvidence,
  splitPortfolio,
} from "../src/lib/proposal-evidence.js";

const portfolio = `### Sales Dashboard
React + PostgreSQL sales dashboard with live chart updates and per-account filtering.
https://example.com/sales

### Logo Design
Brand identity and logo concepts for a local bakery.

### Node API Rescue
Debugged an Express and PostgreSQL API, added Redis caching, and reduced response times.`;

describe("proposal evidence selection", () => {
  it("splits markdown portfolio sections", () => {
    expect(splitPortfolio(portfolio).map((item) => item.title)).toEqual([
      "Sales Dashboard",
      "Logo Design",
      "Node API Rescue",
    ]);
  });

  it("ranks relevant projects even when skills include dotted names", () => {
    const ranked = rankPortfolioEvidence(portfolio, {
      jobTitle: "Build a React dashboard",
      jobDescription: ["The dashboard needs live chart updates and PostgreSQL."],
      jobSkills: ["React.js", "PostgreSQL"],
    });

    expect(ranked[0]?.item.title).toBe("Sales Dashboard");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("selects only relevant evidence and strips links when disallowed", () => {
    const result = selectEvidence(
      portfolio,
      {
        jobTitle: "React dashboard",
        jobDescription: ["Live chart updates backed by PostgreSQL."],
        jobSkills: ["React.js"],
      },
      2,
      false
    );

    expect(result.items.map((item) => item.title)).toContain("Sales Dashboard");
    expect(result.text).not.toContain("Logo Design");
    expect(result.text).not.toContain("https://example.com/sales");
  });

  it("omits weak matches instead of padding the prompt", () => {
    const result = selectEvidence(
      portfolio,
      {
        jobTitle: "Bookkeeping help",
        jobDescription: ["Reconcile monthly invoices."],
        jobSkills: ["Accounting"],
      },
      2,
      true
    );

    expect(result.items).toEqual([]);
    expect(result.text).toContain("No portfolio evidence selected");
  });

  it("exposes only URLs present in the portfolio", () => {
    expect(allowedEvidenceUrls(portfolio)).toEqual(["https://example.com/sales"]);
    expect(allowedEvidenceUrls(null)).toEqual([]);
  });

  it("ignores guide sections and URL words when selecting evidence", () => {
    const withGuide = `### Purpose
This portfolio is used to choose relevant proof.

### Project Matching Guide
Use only the project descriptions below when matching a job.

### Skorm
Description: Mobile app published on the Play Store.
Live URL: https://play.google.com/store/apps/details?id=com.skorm

### ZyroMart
Description: Shopify ecommerce store with product setup and supplier checks.
Live URL: https://zyromart.example.com

### WiseDealing
Description: Trading dashboard built with React and PostgreSQL.`;

    const result = selectEvidence(
      withGuide,
      {
        jobTitle: "Shopify store setup",
        jobDescription: ["I need a Shopify store with products and supplier checks."],
        jobSkills: ["Shopify", "Ecommerce"],
      },
      2,
      false
    );

    expect(result.items[0]?.title).toBe("ZyroMart");
    expect(result.items.map((item) => item.title)).not.toContain("Project Matching Guide");
    expect(result.items.map((item) => item.title)).not.toContain("Skorm");
  });
});
