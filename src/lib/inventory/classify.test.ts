import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CLASSIFIER_RULES_VERSION,
  classifyArticle,
  type ArticleDisposition,
  type ClassifiableArticle,
} from "./classify";
import type { IndexArticleEntry } from "./types";

// Fixture articles: real (KA, title, description) triples from the committed
// 2026-10-30 inventory snapshot, one per disposition and per service subtype,
// so every rule fires against corpus-verified text.
function entry(ka: string, title: string, description: string): IndexArticleEntry {
  return { id: `nyc311-${ka}`, ka: ka as IndexArticleEntry["ka"], title, description };
}

const FIXTURES: readonly ClassifiableArticle[] = [
  // service / report — description leads with the report verb.
  {
    entry: entry(
      "KA-01036",
      "Heat or Hot Water Complaint in a Residential Building",
      "Report a problem with heat or hot water in a residential building.",
    ),
  },
  // service / apply — apply/renew verbs.
  {
    entry: entry(
      "KA-01808",
      "Home Improvement Contractor License",
      "Apply for or renew a license to do construction or repair work at residences.",
    ),
  },
  // service / order — action noun in the title.
  {
    entry: entry("KA-01012", "Birth Certificate Order", "Get a copy of a birth certificate."),
  },
  // service / order — "Get" as an obtain-something description lead.
  {
    entry: entry("KA-01016", "Mediation", "Get free and confidential help to resolve a dispute."),
  },
  // service / informational-with-action — Learn lead with embedded action.
  {
    entry: entry("KA-02125", "Noise Complaints", "Learn how to report noise in New York City."),
  },
  // informational — no actionability signal in title or description.
  {
    entry: entry(
      "KA-01336",
      "NYC311 Content API",
      "Learn about the 311 Application Programming Interface (API).",
    ),
  },
  // hub — the research-verified cross-link container (curated rule).
  {
    entry: entry(
      "KA-01026",
      "Parking Signs and Rules",
      "Learn about parking regulations and find out the rules for a specific location.",
    ),
  },
  // dead-page — only detectable in page-facts mode: dead pages return HTTP
  // 200 with no ka-content div (art_TMXzOIRU §2) and never appear in the
  // index, so this entry is constructed to exercise the page-facts rule.
  {
    entry: entry("KA-01044", "Vacated Article", ""),
    pageFacts: {
      kaContentPresent: false,
      accordionSectionTitles: [],
      hasTransactionalPortalLink: false,
      hasPdfFormLink: false,
      hasFeeText: false,
    },
  },
  // out-of-scope / emergency-dispatch — description leads with "Call 911".
  {
    entry: entry(
      "KA-02608",
      "Carbon Monoxide",
      "Call 911 to report carbon monoxide emission or poisoning. Learn about carbon monoxide detector requirements.",
    ),
  },
  // out-of-scope / discontinued — a retired license.
  {
    entry: entry(
      "KA-01812",
      "Cabaret License",
      "The City no longer requires a cabaret license for bars, clubs, taverns, and discos.",
    ),
  },
  // out-of-scope / not-offered-by-city — the City declines the request class.
  {
    entry: entry(
      "KA-01332",
      "Neighbor Odor",
      "The City does not accept complaints about body or cooking odor from a residence.",
    ),
  },
];

// The committed 2026-10-30 snapshot — the real corpus the rules were seeded
// against; the corpus-level assertions below pin the verified seed counts.
const SNAPSHOT_PATH = "../../../data/snapshots/nyc311-index/2026-10-30.json";
const snapshot = JSON.parse(
  readFileSync(new URL(SNAPSHOT_PATH, import.meta.url), "utf8"),
) as { articles: IndexArticleEntry[] };

function classifyAll(articles: readonly ClassifiableArticle[]) {
  return articles.map((article) => classifyArticle(article));
}

describe("classifyArticle — dispositions", () => {
  it("classifies each fixture article as intended, covering every disposition", () => {
    const expected: ReadonlyArray<readonly [string, ArticleDisposition, string]> = [
      ["KA-01036", "service", "action:report"],
      ["KA-01808", "service", "action:apply"],
      ["KA-01012", "service", "action:order"],
      ["KA-01016", "service", "action:order"],
      ["KA-02125", "service", "embedded-action"],
      ["KA-01336", "informational", "no-actionability-signal"],
      ["KA-01026", "hub", "curated-hub-article"],
      ["KA-01044", "dead-page", "ka-content-absent"],
      ["KA-02608", "out-of-scope", "emergency-dispatch"],
      ["KA-01812", "out-of-scope", "discontinued"],
      ["KA-01332", "out-of-scope", "not-offered-by-city"],
    ];
    expect(expected.map(([ka]) => ka)).toEqual(FIXTURES.map((f) => f.entry.ka));
    const results = classifyAll(FIXTURES);
    expected.forEach(([ka, disposition, reason], i) => {
      const { classification } = results[i];
      expect(classification.ka).toBe(ka);
      expect(classification.disposition).toBe(disposition);
      expect(classification.reason).toBe(reason);
    });
  });

  it("stamps the rules version and the firing rule on every result", () => {
    for (const { classification } of classifyAll(FIXTURES)) {
      expect(classification.rulesVersion).toBe(CLASSIFIER_RULES_VERSION);
      expect(classification.ruleId).toMatch(/^R00[1-7]-[a-z-]+$/);
    }
  });

  it("resolves all four service subtypes with the firing evidence", () => {
    const byKa = new Map(classifyAll(FIXTURES).map((r) => [r.classification.ka, r.classification]));
    expect(byKa.get("KA-01036")?.serviceSubtype).toBe("report");
    // Evidence is the first-matched phrase: the title scan runs before the
    // description, so the complaint noun fires before the report verb.
    expect(byKa.get("KA-01036")?.evidence).toMatch(/[Cc]omplaint/);
    expect(byKa.get("KA-01808")?.serviceSubtype).toBe("apply");
    expect(byKa.get("KA-01808")?.evidence).toMatch(/[Aa]pply/);
    expect(byKa.get("KA-01012")?.serviceSubtype).toBe("order");
    expect(byKa.get("KA-01012")?.evidence).toMatch(/[Oo]rder/);
    expect(byKa.get("KA-02125")?.serviceSubtype).toBe("informational-with-action");
    // Non-service dispositions never carry a subtype.
    for (const ka of [
      "KA-01336",
      "KA-01026",
      "KA-01044",
      "KA-02608",
      "KA-01812",
      "KA-01332",
    ] as const) {
      expect(byKa.get(ka)?.serviceSubtype).toBeUndefined();
    }
  });

  it("promotes an index-informational article when page facts show actionability", () => {
    const article: ClassifiableArticle = {
      entry: entry(
        "KA-03641",
        "Noise Code",
        "Learn about the noise code and current noise reduction projects.",
      ),
      pageFacts: {
        kaContentPresent: true,
        accordionSectionTitles: ["Apply for Noise Code Guidance"],
        hasTransactionalPortalLink: false,
        hasPdfFormLink: false,
        hasFeeText: false,
      },
    };
    const { classification } = classifyArticle(article);
    expect(classification.disposition).toBe("service");
    expect(classification.reason).toBe("embedded-action");
  });

  it("promotes a non-informational article with page-signal-only actionability to apply", () => {
    // Constructed case: no Learn/Find lead and no index-text action verb, so
    // the only actionability signal is the page fact itself (Check A mode).
    const article: ClassifiableArticle = {
      entry: entry("KA-03641", "Noise Code", "Current noise code and noise reduction projects."),
      pageFacts: {
        kaContentPresent: true,
        accordionSectionTitles: [],
        hasTransactionalPortalLink: true,
        hasPdfFormLink: false,
        hasFeeText: false,
      },
    };
    const { classification } = classifyArticle(article);
    expect(classification.disposition).toBe("service");
    expect(classification.serviceSubtype).toBe("apply");
    expect(classification.reason).toBe("action:page-signals");
    expect(classification.evidence).toBe("transactional-portal-link");
  });

  it("treats page-fact actionability on a Learn-lead article as informational-with-action", () => {
    const article: ClassifiableArticle = {
      entry: entry(
        "KA-03641",
        "Noise Code",
        "Learn about the noise code and current noise reduction projects.",
      ),
      pageFacts: {
        kaContentPresent: true,
        accordionSectionTitles: [],
        hasTransactionalPortalLink: true,
        hasPdfFormLink: false,
        hasFeeText: false,
      },
    };
    const { classification } = classifyArticle(article);
    expect(classification.disposition).toBe("service");
    expect(classification.serviceSubtype).toBe("informational-with-action");
    expect(classification.reason).toBe("embedded-action");
    expect(classification.evidence).toBe("transactional-portal-link");
  });

  it("keeps emergency mentions that do not lead the description informational", () => {
    const { classification } = classifyArticle({
      entry: entry("KA-03700", "Test Article", "Learn when to call 911 for an emergency."),
    });
    expect(classification.disposition).toBe("informational");
  });
});

describe("classifyArticle — corpus seeds", () => {
  it("classifies every article in the committed snapshot", () => {
    const results = classifyAll(snapshot.articles.map((entry) => ({ entry })));
    expect(results).toHaveLength(2093);
    const dispositions = new Set(results.map((r) => r.classification.disposition));
    for (const disposition of dispositions) {
      expect(["service", "informational", "hub", "dead-page", "out-of-scope"]).toContain(disposition);
    }
  });

  it("pins the verified seed counts for out-of-scope reasons and hubs", () => {
    const results = classifyAll(snapshot.articles.map((entry) => ({ entry })));
    const count = (predicate: (r: ReturnType<typeof classifyArticle>) => boolean) =>
      results.filter(predicate).length;
    expect(count((r) => r.classification.reason === "emergency-dispatch")).toBe(40);
    expect(count((r) => r.classification.reason === "discontinued")).toBe(15);
    expect(count((r) => r.classification.reason === "not-offered-by-city")).toBe(5);
    expect(count((r) => r.classification.disposition === "hub")).toBe(1);
  });

  it("gives every service a subtype and no other disposition one", () => {
    for (const { classification } of classifyAll(snapshot.articles.map((entry) => ({ entry })))) {
      if (classification.disposition === "service") {
        expect(classification.serviceSubtype).toBeDefined();
      } else {
        expect(classification.serviceSubtype).toBeUndefined();
      }
    }
  });
});

describe("classifyArticle — determinism", () => {
  it("returns identical results for the same fixture articles × 10", () => {
    const first = JSON.stringify(classifyAll(FIXTURES));
    for (let run = 0; run < 10; run += 1) {
      expect(JSON.stringify(classifyAll(FIXTURES))).toBe(first);
    }
  });

  it("returns identical results across the full corpus × 10", () => {
    const articles = snapshot.articles.map((entry) => ({ entry }));
    const first = JSON.stringify(classifyAll(articles));
    for (let run = 0; run < 10; run += 1) {
      expect(JSON.stringify(classifyAll(articles))).toBe(first);
    }
  });
});
