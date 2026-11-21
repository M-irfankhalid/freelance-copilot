import { extractUrls } from "./proposal-quality.js";

export interface PortfolioItem {
  title: string;
  body: string;
}

export interface EvidenceContext {
  jobTitle: string;
  jobDescription: string[];
  jobSkills: string[];
}

export interface RankedEvidence {
  item: PortfolioItem;
  score: number;
  matchedTerms: string[];
}

export interface EvidenceSelection {
  text: string;
  items: PortfolioItem[];
  ranked: RankedEvidence[];
  omittedWeak: number;
}

const STOPWORDS = new Set([
  "about", "after", "again", "also", "and", "any", "are", "because", "been",
  "before", "being", "between", "both", "but", "can", "could", "does", "each",
  "for", "from", "have", "here", "how", "into", "its", "just", "like", "more",
  "most", "need", "needs", "not", "now", "only", "other", "our", "out", "over",
  "should", "some", "such", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "those", "through", "too", "under", "use",
  "used", "using", "very", "want", "wants", "was", "were", "what", "when",
  "where", "which", "while", "who", "will", "with", "would", "you", "your",
  "project", "client", "work", "working", "help", "looking", "someone", "site",
  "website", "build", "built", "new", "existing", "using", "based", "into",
  "live", "url", "case", "study", "studies", "real", "result", "results", "key",
  "role", "outcome", "experience", "development", "developer", "developers",
  "application", "applications", "tech", "technology", "technologies",
  "stack", "description", "evidence", "relevant", "selected",
]);

function terms(value: string): string[] {
  const raw =
    value
      .toLowerCase()
      .match(/[a-z][a-z0-9+.#-]{2,}/g)
      ?.filter((word) => !STOPWORDS.has(word)) ?? [];
  const expanded = raw.flatMap((word) => {
    const parts = word.split(/[.+#-]+/).filter((part) => part.length >= 3);
    return [word, ...parts];
  });
  return [...new Set(expanded.filter((word) => !STOPWORDS.has(word)))];
}

function containsTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(haystack);
}

/** Split the markdown portfolio into individual projects. */
export function splitPortfolio(summary: string): PortfolioItem[] {
  const text = summary.trim();
  if (text.length === 0) return [];
  const sections = text.split(/\n(?=#{2,4}\s)/g);
  if (sections.length > 1) {
    const items = sections
      .map((section) => {
        const lines = section.split("\n");
        const title = (lines[0] ?? "").replace(/^#{2,4}\s*/, "").trim();
        return { title: title || "Portfolio item", body: lines.slice(1).join("\n").trim() };
      })
      .filter((item) => item.body.length > 0);
    // Portfolios often include guide sections such as "Project Matching Guide"
    // or "Portfolio Selection Rules". Those are instructions, not evidence.
    const projects = items.filter((item) =>
      /\b(?:Description|Technologies|Tech stack|Relevant evidence|Live URL|Case study|Key results|Role|Outcome|Stack):/i.test(
        item.body
      )
    );
    return projects.length > 0 ? projects : items;
  }
  return text
    .split(/\n{2,}/)
    .map((part, index) => ({ title: `Portfolio item ${index + 1}`, body: part.trim() }))
    .filter((item) => item.body.length > 20);
}

/**
 * Rank portfolio sections against the job's actual language. Title and skills
 * are weighted more than incidental description words, and a weak keyword-only
 * match is omitted instead of being forced into the prompt.
 */
export function rankPortfolioEvidence(
  portfolioSummary: string | null,
  context: EvidenceContext
): RankedEvidence[] {
  if (portfolioSummary === null || portfolioSummary.trim().length === 0) return [];

  const titleTerms = terms(context.jobTitle);
  const skillTerms = terms(context.jobSkills.join(" "));
  const descriptionTerms = terms(context.jobDescription.join(" "));
  const weighted = new Map<string, number>();
  for (const term of titleTerms) weighted.set(term, Math.max(weighted.get(term) ?? 0, 3));
  for (const term of skillTerms) weighted.set(term, Math.max(weighted.get(term) ?? 0, 3));
  for (const term of descriptionTerms) weighted.set(term, Math.max(weighted.get(term) ?? 0, 1));

  return splitPortfolio(portfolioSummary)
    .map((item) => {
      // URLs are not evidence. Without this, words such as "live" or "store"
      // inside a Play Store link can make an unrelated project look relevant.
      const haystack = `${item.title}\n${item.body.replace(/https?:\/\/\S+/gi, " ")}`;
      let score = 0;
      const matchedTerms: string[] = [];
      for (const [term, weight] of weighted) {
        if (containsTerm(haystack, term)) {
          score += weight;
          matchedTerms.push(term);
        }
      }
      return { item, score, matchedTerms };
    })
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
}

export function selectEvidence(
  portfolioSummary: string | null,
  context: EvidenceContext,
  maxItems: number,
  includeLinks: boolean
): EvidenceSelection {
  if (maxItems <= 0 || portfolioSummary === null || portfolioSummary.trim().length === 0) {
    return {
      text: "No portfolio evidence selected. Do not invent any.",
      items: [],
      ranked: [],
      omittedWeak: 0,
    };
  }

  const ranked = rankPortfolioEvidence(portfolioSummary, context);
  const strong = ranked.filter((entry) => entry.score >= 3 && entry.matchedTerms.length >= 2);
  const usable =
    strong.length > 0
      ? strong
      : ranked.filter((entry) => entry.score >= 2 && entry.matchedTerms.length >= 2);
  const topScore = usable[0]?.score ?? 0;
  const limit = topScore < 5 ? Math.min(1, maxItems) : maxItems;
  const selected = usable
    .filter((entry, index) => index === 0 || entry.score >= Math.max(2, topScore * 0.5))
    .slice(0, limit);

  if (selected.length === 0) {
    return {
      text: "No portfolio evidence selected. Do not invent any.",
      items: [],
      ranked,
      omittedWeak: ranked.length,
    };
  }

  const text = selected
    .map(({ item }) => {
      let body = item.body;
      if (!includeLinks) {
        body = body.replace(/https?:\/\/[^\s<>"']+/gi, "").replace(/[ \t]+\n/g, "\n");
      }
      return `--- ${item.title} ---\n${body.trim()}`;
    })
    .join("\n\n");

  return {
    text,
    items: selected.map((entry) => entry.item),
    ranked,
    omittedWeak: ranked.length - selected.length,
  };
}

export function allowedEvidenceUrls(portfolioSummary: string | null): string[] {
  return extractUrls(portfolioSummary ?? "");
}
