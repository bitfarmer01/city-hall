import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseSnapshotJson } from "./build-snapshot";
import {
  CLASSIFIER_RULES_VERSION,
  classifyArticle,
  validateArticlePageFacts,
  type ArticleDisposition,
  type ArticlePageFacts,
  type ClassifiableArticle,
  type ClassificationResult,
} from "./classify";
import {
  SNAPSHOT_SCHEMA_VERSION,
  type IndexArticleEntry,
  type InventorySnapshot,
} from "./types";

// Fixture articles: real (KA, title, description) triples from the committed
// 2026-10-30 inventory snapshot — except the constructed cases, marked
// inline — one per disposition and per service subtype, so every rule fires
// against corpus-verified text.
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
  // service / apply — title-noun promotion (panel H1): the description leads
  // with "Learn", but the title carries the action noun.
  {
    entry: entry(
      "KA-02085",
      "Boiler Permits and Registration",
      "Learn about required boiler permits and registration.",
    ),
  },
  {
    entry: entry(
      "KA-01977",
      "Sales Tax Vendor Registration",
      "Learn about registration for businesses that sell taxable tangible personal property or taxable services.",
    ),
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
// Loaded through the D2a shape guard with a strict schemaVersion pin (panel
// H2): a renamed field once flowed through the raw JSON.parse cast as
// undefined, coerced every pattern to "undefined", and silently reclassified
// the whole corpus as informational.
const SNAPSHOT_PATH = "../../../data/snapshots/nyc311-index/2026-10-30.json";

function parsePinnedSnapshot(text: string): InventorySnapshot {
  const parsed = parseSnapshotJson(text);
  if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `snapshot schemaVersion drift: expected ${SNAPSHOT_SCHEMA_VERSION}, got ${parsed.schemaVersion} — re-pin or regenerate the corpus`,
    );
  }
  return parsed;
}

const snapshot = parsePinnedSnapshot(
  readFileSync(new URL(SNAPSHOT_PATH, import.meta.url), "utf8"),
);

function classifyAll(articles: readonly ClassifiableArticle[]) {
  return articles.map((article) => classifyArticle(article));
}

/** Zero-seeded tally — pins catch both gains and silent key losses. */
function distribution(
  results: readonly ClassificationResult[],
  zeroSeededKeys: readonly string[],
  keyOf: (result: ClassificationResult) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of zeroSeededKeys) {
    counts[key] = 0;
  }
  for (const result of results) {
    const key = keyOf(result);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const DISPOSITION_KEYS: readonly string[] = [
  "service",
  "informational",
  "hub",
  "dead-page",
  "out-of-scope",
];

const RULE_ID_KEYS: readonly string[] = [
  "R001-dead-page",
  "R002-emergency-dispatch",
  "R003-discontinued",
  "R004-not-offered",
  "R005-curated-hub",
  "R006-service-action",
  "R007-informational-fallback",
];

const SUBTYPE_KEYS: readonly string[] = [
  "report",
  "apply",
  "order",
  "informational-with-action",
];

describe("classifyArticle — corpus snapshot loading (panel H2)", () => {
  it("loads the committed snapshot through the D2a shape guard at the pinned schema version", () => {
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.articleCount).toBe(snapshot.articles.length);
  });

  it("rejects shape drift instead of coercing renamed fields to undefined", () => {
    // Constructed case: a renamed description field — the exact drift that
    // used to slip through the raw cast and reclassify everything.
    const drifted = JSON.stringify({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      capturedAt: "2026-10-30T00:00:00.000Z",
      sourceUrl: "https://portal.311.nyc.gov/articles/",
      sourceSha256: "0".repeat(64),
      articleCount: 1,
      articles: [
        { id: "nyc311-KA-00001", ka: "KA-00001", title: "Drift Probe", summary: "renamed field" },
      ],
      verification: { searchProbe: { query: "permit", totalResults: 1 } },
    });
    expect(() => parseSnapshotJson(drifted)).toThrow(/schema mismatch/);
  });

  it("rejects a snapshot stamped with a foreign schemaVersion", () => {
    const drifted = JSON.stringify({ ...snapshot, schemaVersion: "9.9.9" });
    expect(() => parsePinnedSnapshot(drifted)).toThrow(/schemaVersion drift/);
  });
});

describe("classifyArticle — dispositions", () => {
  it("classifies each fixture article as intended, covering every disposition", () => {
    const expected: ReadonlyArray<readonly [string, ArticleDisposition, string]> = [
      ["KA-01036", "service", "action:report"],
      ["KA-01808", "service", "action:apply"],
      ["KA-01012", "service", "action:order"],
      ["KA-01016", "service", "action:order"],
      ["KA-02125", "service", "embedded-action"],
      ["KA-02085", "service", "action:title-noun"],
      ["KA-01977", "service", "action:title-noun"],
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
    expect(byKa.get("KA-01036")?.evidence?.kind).toBe("index-text");
    expect(byKa.get("KA-01036")?.evidence?.span).toMatch(/[Cc]omplaint/);
    expect(byKa.get("KA-01808")?.serviceSubtype).toBe("apply");
    expect(byKa.get("KA-01808")?.evidence?.span).toMatch(/[Aa]pply/);
    expect(byKa.get("KA-01012")?.serviceSubtype).toBe("order");
    expect(byKa.get("KA-01012")?.evidence?.span).toMatch(/[Oo]rder/);
    expect(byKa.get("KA-02125")?.serviceSubtype).toBe("informational-with-action");
    // Title-noun promotions carry the matched family's subtype (panel H1).
    expect(byKa.get("KA-02085")?.serviceSubtype).toBe("apply");
    expect(byKa.get("KA-02085")?.reason).toBe("action:title-noun");
    expect(byKa.get("KA-01977")?.serviceSubtype).toBe("apply");
    expect(byKa.get("KA-01977")?.reason).toBe("action:title-noun");
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
    // The accordion title that fired the rule is quoted as page-accordion.
    expect(classification.evidence).toEqual({
      kind: "page-accordion",
      span: "Apply for Noise Code Guidance",
    });
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
    expect(classification.evidence).toEqual({
      kind: "page-signal",
      span: "transactional-portal-link",
    });
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
    expect(classification.evidence).toEqual({
      kind: "page-signal",
      span: "transactional-portal-link",
    });
  });

  it("keeps emergency mentions that do not lead the description informational", () => {
    // Constructed case (panel M9): KA-03700 "Test Article" is invented — no
    // corpus article pairs a mid-description 911 mention with a non-dispatch
    // lead — exercising that only a leading "Call 911" fires R002.
    const { classification } = classifyArticle({
      entry: entry("KA-03700", "Test Article", "Learn when to call 911 for an emergency."),
    });
    expect(classification.disposition).toBe("informational");
  });
});

describe("classifyArticle — page-facts boundary (panel H3)", () => {
  const learnLead = entry(
    "KA-03641",
    "Noise Code",
    "Learn about the noise code and current noise reduction projects.",
  );

  it("fails open on an empty facts object — unknown is not verified-absent", () => {
    const { classification } = classifyArticle({
      entry: learnLead,
      // Boundary-drift simulation: what a mis-keyed JSON payload delivers.
      pageFacts: {} as ArticlePageFacts,
    });
    expect(classification.disposition).not.toBe("dead-page");
  });

  it("neither dead-pages nor crashes on a facts object with one field", () => {
    const { classification } = classifyArticle({
      entry: learnLead,
      pageFacts: { hasFeeText: true } as ArticlePageFacts,
    });
    expect(classification.disposition).not.toBe("dead-page");
  });

  it("does not crash when accordionSectionTitles is missing", () => {
    const { classification } = classifyArticle({
      entry: learnLead,
      pageFacts: { kaContentPresent: true } as ArticlePageFacts,
    });
    expect(classification.disposition).not.toBe("dead-page");
  });

  it("rejects malformed page facts loudly, naming the KA", () => {
    for (const malformed of [{}, { hasFeeText: true }, { kaContentPresent: true }]) {
      expect(() => validateArticlePageFacts("KA-03641", malformed)).toThrow(/KA-03641/);
    }
  });

  it("accepts well-formed page facts", () => {
    const facts: ArticlePageFacts = {
      kaContentPresent: true,
      accordionSectionTitles: ["Apply in Person"],
      hasTransactionalPortalLink: false,
      hasPdfFormLink: false,
      hasFeeText: true,
    };
    expect(validateArticlePageFacts("KA-03641", facts)).toEqual(facts);
  });
});

describe("classifyArticle — evidence provenance (panel H4)", () => {
  it("quotes index text for family matches", () => {
    const { classification } = classifyArticle({
      entry: entry(
        "KA-01036",
        "Heat or Hot Water Complaint in a Residential Building",
        "Report a problem with heat or hot water in a residential building.",
      ),
    });
    expect(classification.evidence).toEqual({ kind: "index-text", span: "Complaint" });
  });

  it("labels boolean page facts as page-signal, never as a quote", () => {
    const { classification } = classifyArticle({
      entry: entry("KA-03641", "Noise Code", "Current noise code and noise reduction projects."),
      pageFacts: {
        kaContentPresent: true,
        accordionSectionTitles: [],
        hasTransactionalPortalLink: true,
        hasPdfFormLink: false,
        hasFeeText: false,
      },
    });
    expect(classification.evidence).toEqual({
      kind: "page-signal",
      span: "transactional-portal-link",
    });
  });

  it("quotes page accordion titles as page-accordion", () => {
    const { classification } = classifyArticle({
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
    });
    expect(classification.evidence).toEqual({
      kind: "page-accordion",
      span: "Apply for Noise Code Guidance",
    });
  });
});

describe("classifyArticle — rule precedence conflicts (panel M14)", () => {
  it("R001 beats R002: a dead page with an emergency-lead description", () => {
    // Real triple; the page facts are constructed — dead pages never appear
    // in the index (see the KA-01044 fixture).
    const { classification } = classifyArticle({
      entry: entry(
        "KA-02608",
        "Carbon Monoxide",
        "Call 911 to report carbon monoxide emission or poisoning. Learn about carbon monoxide detector requirements.",
      ),
      pageFacts: {
        kaContentPresent: false,
        accordionSectionTitles: [],
        hasTransactionalPortalLink: false,
        hasPdfFormLink: false,
        hasFeeText: false,
      },
    });
    expect(classification.ruleId).toBe("R001-dead-page");
    expect(classification.disposition).toBe("dead-page");
  });

  it("R003 beats R006: a discontinued description with an order-family match", () => {
    // Real triple: "Request" in the title matches the order family, but the
    // discontinued rule fires first.
    const { classification } = classifyArticle({
      entry: entry(
        "KA-01288",
        "Sanitation Sign Request",
        "The City no longer accepts requests for No Dumping, Clean Up After Dog, and No Littering signs.",
      ),
    });
    expect(classification.ruleId).toBe("R003-discontinued");
    expect(classification.disposition).toBe("out-of-scope");
  });

  it("R004 beats R006: a not-offered description that also reports", () => {
    // Real triple: the description leads with the report verb (an R006
    // report match), but the not-offered rule fires first.
    const { classification } = classifyArticle({
      entry: entry(
        "KA-02259",
        "Light from Parking Lot Complaint",
        "Report bright lights from a parking lot shining into an apartment or building. The City does not accept complaints about bright lights from residences.",
      ),
    });
    expect(classification.ruleId).toBe("R004-not-offered");
    expect(classification.disposition).toBe("out-of-scope");
  });

  it("R005 beats R006: the curated hub article even with an action description", () => {
    // Constructed case: the real KA-01026 description matches no service
    // family, so this invented description makes R006 compete and pins that
    // the curated-hub rule wins.
    const { classification } = classifyArticle({
      entry: entry("KA-01026", "Parking Signs and Rules", "Report a parking violation and request a sign review."),
    });
    expect(classification.ruleId).toBe("R005-curated-hub");
    expect(classification.disposition).toBe("hub");
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
    // Title-noun promotions recovered by the H1 fix (were R007 informational).
    expect(count((r) => r.classification.reason === "action:title-noun")).toBe(19);
  });

  // Panels M8/M11: the corpus pins previously covered only the out-of-scope
  // reasons — a mass reclassification (service↔informational churn, subtype
  // drift, rule drift) passed green. Measured over the committed 2026-10-30
  // snapshot after the title-noun promotion (panel H1); re-pin when the rules
  // change, with the delta documented in the PR.
  it("pins the full disposition distribution", () => {
    const results = classifyAll(snapshot.articles.map((entry) => ({ entry })));
    expect(
      distribution(results, DISPOSITION_KEYS, (r) => r.classification.disposition),
    ).toEqual({
      service: 1262,
      informational: 770,
      hub: 1,
      "dead-page": 0,
      "out-of-scope": 60,
    });
  });

  it("pins the service subtype distribution", () => {
    const results = classifyAll(snapshot.articles.map((entry) => ({ entry })));
    const services = results.filter((r) => r.classification.disposition === "service");
    expect(services).toHaveLength(1262);
    expect(
      distribution(services, SUBTYPE_KEYS, (r) => r.classification.serviceSubtype ?? ""),
    ).toEqual({
      report: 512,
      apply: 290,
      order: 346,
      "informational-with-action": 114,
    });
  });

  it("pins the ruleId distribution", () => {
    const results = classifyAll(snapshot.articles.map((entry) => ({ entry })));
    expect(distribution(results, RULE_ID_KEYS, (r) => r.classification.ruleId)).toEqual({
      "R001-dead-page": 0,
      "R002-emergency-dispatch": 40,
      "R003-discontinued": 15,
      "R004-not-offered": 5,
      "R005-curated-hub": 1,
      "R006-service-action": 1262,
      "R007-informational-fallback": 770,
    });
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
