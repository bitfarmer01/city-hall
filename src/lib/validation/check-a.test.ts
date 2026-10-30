import { describe, expect, it } from "vitest";

import type { CatalogBundle } from "../catalog/types";
import { loadCatalogBundle } from "../resolver/catalog-source";
import { CLASSIFIER_RULES_VERSION, classifyArticle, type ClassifiableArticle, type ClassificationResult } from "../inventory/classify";
import { DOMAIN_TAXONOMY_VERSION } from "../inventory/domain";
import type { IndexArticleEntry, InventorySnapshot, KaNumber } from "../inventory/types";
import { CROSSWALK_RULES_VERSION } from "../resolver/rules";
import { EMBEDDING_MODEL_VERSION } from "../resolver/retrieval";
import {
  DEAD_PAGE_STOP_FRACTION,
  deriveSampleRecord,
  diffSampleRecord,
  runCheckA,
  type PageSource,
} from "./check-a";
import { CHECK_A_SEED } from "./sample";

const bundle = loadCatalogBundle();

// ---------------------------------------------------------------------------
// Fixtures — a synthetic 30-article corpus that mirrors the real portal's
// verified anatomy (accordion cards, transactional subdomains, PDFs, fees,
// dead pages) without touching the network.
// ---------------------------------------------------------------------------

function entry(ka: KaNumber, title: string, description: string): IndexArticleEntry {
  return { id: `nyc311-${ka}`, ka, title, description };
}

function snapshotFixture(articles: IndexArticleEntry[]): InventorySnapshot {
  return {
    schemaVersion: "0.3.0",
    capturedAt: "2026-10-30T00:00:00.000Z",
    sourceUrl: "https://portal.311.nyc.gov/all-articles/",
    sourceSha256: "ab".repeat(32),
    articleCount: articles.length,
    articles,
    verification: { searchProbe: { query: "article", totalResults: articles.length } },
  };
}

function servicePage(agencyHost = "a866-dcwpbp.nyc.gov"): string {
  return [
    `<div class="ka-content"><h2>Title</h2><p>There is a $200 fee for a two-year license.</p>`,
    `<div class="card"><div class="card-header"><div class="col-md-11">How to Apply</div><div class="col-md-1"></div></div>`,
    `<div class="card-body"><a href="https://${agencyHost}/account/services">Apply online</a></div></div>`,
    `<div class="card"><div class="card-header"><div class="col-md-11">Required Documents</div><div class="col-md-1"></div></div>`,
    `<div class="card-body"><a href="https://www.nyc.gov/assets/dcwp/downloads/pdf/forms/hic-application.pdf">Application (PDF)</a></div></div>`,
    `</div>`,
  ].join("");
}

function informationalPage(): string {
  return `<div class="ka-content"><h2>Information</h2><p>Learn about this City program and how it works.</p></div>`;
}

function deadPage(): string {
  return `<html><body><div class="page-header">NYC311</div><p>Article not found.</p></body></html>`;
}

function pagesFixture(articles: IndexArticleEntry[], pageFor: (article: IndexArticleEntry) => PageSource): Map<string, PageSource> {
  const pages = new Map<string, PageSource>();
  for (const article of articles) {
    pages.set(article.ka, pageFor(article));
  }
  return pages;
}

/** The eight cataloged services, as snapshot entries whose titles are the envelope names. */
function catalogedEntries(): IndexArticleEntry[] {
  return bundle.services.map((service, index) => {
    // meta IDs are `nyc311-KA-#####` by construction (catalog build);
    // the cast recovers the KA-##### template type.
    const ka = service.meta.nyc311ArticleId.replace(/^nyc311-/, "") as KaNumber;
    return entry(
      ka,
      service.envelope.name as string,
      `Apply for or renew this service online. There is a fee. Reference item ${index}.`,
    );
  });
}

function mixedCorpus(): { snapshot: InventorySnapshot; articles: IndexArticleEntry[] } {
  const articles = [
    ...catalogedEntries(),
    // Non-cataloged service-classified articles across the locked domains.
    entry("KA-21001", "Report a Blocked Bike Lane", "File a complaint about a blocked bike lane."),
    entry("KA-21002", "Replace a Lost Birth Certificate", "Order a replacement birth certificate online."),
    entry("KA-21003", "Apply for a Film Permit", "Apply for a permit to film on a City street."),
    entry("KA-21004", "Renew a Handyman Registration", "Renew your handyman registration before it expires."),
    entry("KA-21005", "Schedule a Boiler Inspection", "Schedule the annual boiler inspection with the Department."),
    entry("KA-21006", "Order a Window Guard", "Order and arrange installation of a window guard."),
    entry("KA-21007", "Report an Idle Bus", "File a complaint about a bus idling at the curb."),
    entry("KA-21008", "Apply for a Street Fair Permit", "Apply for a permit to hold a street fair."),
    entry("KA-21009", "Apply for a Tobacco Retail Dealer License", "Apply for a license to sell tobacco products."),
    entry("KA-21010", "Order an Energy Audit", "Order a free energy audit for your home."),
    entry("KA-21011", "Report a Leaking Fire Hydrant", "Report a leaking fire hydrant to the City."),
    entry("KA-21012", "Renew a Sidewalk Cafe License", "Renew your sidewalk cafe license for the season."),
    // Informational articles.
    entry("KA-22001", "Learn About Snow Removal", "Learn how the City clears snow from streets and sidewalks."),
    entry("KA-22002", "Understand Your Water Meter", "Information about how your water meter is read."),
    entry("KA-22003", "About Property Taxes", "Learn how property taxes are assessed."),
    entry("KA-22004", "Learn About the Right to Shelter", "Information about the City's right to shelter."),
    entry("KA-22005", "About Recycling in NYC", "Learn what materials the City recycles."),
    entry("KA-22006", "Learn About Free Tax Preparation", "Information about free tax preparation sites."),
    // Emergency instructions (rule-detectable out-of-scope).
    entry("KA-23001", "Call 911 for a Fire Emergency", "If you see a fire, call 911 immediately."),
    entry("KA-23002", "Report a Gas Emergency by Calling 911", "If you smell gas, leave and call 911."),
    // Dead pages — a small tail, under the stop-condition fraction.
    entry("KA-24001", "Archived Spray Ground Program", "Archived page for a program that has ended."),
    entry("KA-24002", "Old Flu Season Update", "Archived page for a past flu season."),
  ];
  return { snapshot: snapshotFixture(articles), articles };
}

const RAN_AT = "2026-10-30T12:00:00.000Z";

function runMixed(overrides: Partial<Parameters<typeof runCheckA>[0]> = {}) {
  const { snapshot, articles } = mixedCorpus();
  return runCheckA({
    snapshotPath: "data/snapshots/nyc311-index/test.json",
    snapshot,
    bundle,
    pages: pagesFixture(articles, (article) =>
      article.ka.startsWith("KA-24")
        ? { html: deadPage() }
        : article.ka.startsWith("KA-22")
          ? { html: informationalPage() }
          : { html: servicePage() },
    ),
    seed: CHECK_A_SEED,
    // The fixture corpus is small — sample all of it (production uses 100).
    sampleSize: articles.length,
    ranAt: RAN_AT,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------

describe("runCheckA on the seeded corpus", () => {
  it("resolves the full mixed corpus with zero breaches and a passing gate", async () => {
    const run = await runMixed();
    expect(run.breaches).toEqual([]);
    expect(run.summary.validityPassed).toBe(true);
    expect(run.summary.gatePassed).toBe(true);
    expect(run.summary.passed).toBe(true);
    expect(run.summary.total).toBe(30); // 8 cataloged + 12 service + 6 informational + 2 emergency + 2 dead
    expect(run.summary.resolvedFraction).toBe(1);
    expect(run.summary.failures).toBe(0);
    // Every row carries an explicit entry: a service record or an out-of-scope
    // classification — never a bare "service" without a matching record path.
    for (const result of run.results) {
      expect(["service_record", "out_of_scope"]).toContain(result.outcome);
    }
  });

  it("classifies dead pages as explicit out-of-scope entries", async () => {
    const run = await runMixed();
    const dead = run.results.filter((r) => r.ka.startsWith("KA-24"));
    expect(dead).toHaveLength(2);
    for (const row of dead) {
      expect(row.outcome).toBe("out_of_scope");
      expect(row.disposition).toBe("dead-page");
      expect(row.reason).toBeTruthy();
      expect(row.ruleId).toBeTruthy();
    }
    expect(run.summary.deadPages).toBe(2);
  });

  it("matches every cataloged article to its own service record", async () => {
    const run = await runMixed();
    // Stronger: every one of the eight cataloged article IDs must resolve self.
    for (const service of bundle.services) {
      const ka = service.meta.nyc311ArticleId.replace(/^nyc311-/, "");
      const row = run.results.find((r) => r.ka === ka);
      expect(row, `cataloged article ${ka} (${service.meta.catalogId}) must appear in the sample`).toBeDefined();
      expect(row?.outcome).toBe("service_record");
      expect(row?.catalogMatch).toBe("self");
      expect(row?.matchedServiceIds).toContain(service.meta.catalogId);
      // The self-match rides the deterministic core — never the LLM fallback.
      expect(["exact-id", "alias-rules"]).toContain(row?.resolutionLayer);
    }
  });

  it("reports service-classified articles outside the catalog as the visible gap", async () => {
    const run = await runMixed();
    const nonCatalogServiceRows = run.results.filter(
      (r) => r.outcome === "service_record" && r.catalogMatch !== "self",
    );
    expect(nonCatalogServiceRows.length).toBeGreaterThan(0);
    for (const row of nonCatalogServiceRows) {
      expect(["sibling", "none"]).toContain(row.catalogMatch ?? "");
    }
    const gap = run.domains.reduce((sum, d) => sum + d.noMatch + d.siblingMatch, 0);
    expect(gap).toBe(nonCatalogServiceRows.length);
  });

  it("rolls up per-domain counts in fixed domain order with a zeroed catch-all", async () => {
    const run = await runMixed();
    expect(run.domains.map((d) => d.domain)).toEqual([
      "permits",
      "service-requests",
      "public-records",
      "licensing",
      "inspections",
      "other",
    ]);
    const sampledSum = run.domains.reduce((sum, d) => sum + d.sampled, 0);
    expect(sampledSum).toBe(run.summary.total);
    const outcomeSum = run.domains.reduce(
      (sum, d) => sum + d.serviceRecords + d.outOfScope + d.failures,
      0,
    );
    expect(outcomeSum).toBe(run.summary.total);
  });

  it("sorts per-article results by KA", async () => {
    const run = await runMixed();
    const kas = run.results.map((r) => r.ka);
    const sorted = [...kas].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(kas).toEqual(sorted);
  });

  it("stamps the pinned versions onto the run", async () => {
    const run = await runMixed();
    expect(run.versions.catalog).toBe(bundle.catalogVersion);
    expect(run.versions.crosswalkRules).toBe(CROSSWALK_RULES_VERSION);
    expect(run.versions.classifierRules).toBe(CLASSIFIER_RULES_VERSION);
    expect(run.versions.domainTaxonomy).toBe(DOMAIN_TAXONOMY_VERSION);
    expect(run.versions.embeddingModel).toBe(EMBEDDING_MODEL_VERSION);
  });
});

describe("runCheckA gate and failures", () => {
  it("fails the coverage gate on environmental errors without a validity breach", async () => {
    const { snapshot, articles } = mixedCorpus();
    const pages = pagesFixture(articles, (article) =>
      article.ka.startsWith("KA-24")
        ? { html: deadPage() }
        : article.ka.startsWith("KA-22")
          ? { html: informationalPage() }
          : { html: servicePage() },
    );
    // Six of thirty pages lost to the environment: >5% failure, no breach.
    for (const ka of ["KA-21001", "KA-21002", "KA-21003", "KA-21004", "KA-21005", "KA-21006"]) {
      pages.set(ka, { error: "HTTP 503 from portal" });
    }
    const run = await runCheckA({
      snapshotPath: "data/snapshots/nyc311-index/test.json",
      snapshot,
      bundle,
      pages,
      seed: CHECK_A_SEED,
      sampleSize: articles.length,
      ranAt: RAN_AT,
    });
    expect(run.summary.failures).toBe(6);
    expect(run.summary.gatePassed).toBe(false);
    expect(run.summary.validityPassed).toBe(true);
    expect(run.summary.passed).toBe(false);
    for (const failure of run.results.filter((r) => r.outcome === "fail")) {
      expect(failure.breach).toBe(false);
      expect(failure.problem).toContain("503");
    }
  });

  it("keeps the gate green when a single page source is missing (3.3% < 5% slack)", async () => {
    const { snapshot, articles } = mixedCorpus();
    const pages = pagesFixture(articles, () => ({ html: servicePage() }));
    pages.delete("KA-21001");
    const run = await runCheckA({
      snapshotPath: "data/snapshots/nyc311-index/test.json",
      snapshot,
      bundle,
      pages,
      seed: CHECK_A_SEED,
      sampleSize: articles.length,
      ranAt: RAN_AT,
    });
    const row = run.results.find((r) => r.ka === "KA-21001");
    expect(row?.outcome).toBe("fail");
    expect(row?.breach).toBe(false);
    expect(row?.problem).toContain("no page source supplied");
    expect(run.summary.failures).toBe(1);
    expect(run.summary.gatePassed).toBe(true); // 29/30 = 96.7%, inside the slack
    expect(run.summary.validityPassed).toBe(true);
    expect(run.summary.passed).toBe(true);
  });
});

describe("injected defects — the machinery must fail loudly", () => {
  it("fails when the classifier emits a record outside the disposition enum", async () => {
    const corruptSeam = (article: ClassifiableArticle): ClassificationResult => {
      const real = classifyArticle(article);
      if (article.entry.ka === "KA-21001") {
        return {
          ...real,
          classification: {
            ...real.classification,
            disposition: "banana" as typeof real.classification.disposition,
          },
        };
      }
      return real;
    };
    const run = await runMixed({ classify: corruptSeam });
    const row = run.results.find((r) => r.ka === "KA-21001");
    expect(row?.outcome).toBe("fail");
    expect(row?.breach).toBe(true);
    expect(run.summary.validityPassed).toBe(false);
    expect(run.summary.passed).toBe(false);
    expect(run.breaches.some((b) => b.startsWith("KA-21001: invalid classifier output"))).toBe(true);
    // The breach is isolated: the other articles still classify cleanly.
    expect(run.summary.failures).toBe(1);
  });

  it("fails when the classifier throws", async () => {
    const throwingSeam = (article: ClassifiableArticle): ClassificationResult => {
      if (article.entry.ka === "KA-21002") {
        throw new Error("classifier exploded");
      }
      return classifyArticle(article);
    };
    const run = await runMixed({ classify: throwingSeam });
    const row = run.results.find((r) => r.ka === "KA-21002");
    expect(row?.outcome).toBe("fail");
    expect(row?.breach).toBe(true);
    expect(run.breaches.some((b) => b.startsWith("KA-21002: classifier threw"))).toBe(true);
    expect(run.summary.passed).toBe(false);
  });

  it("fails when the resolver misses a cataloged article", async () => {
    // Forge a bundle whose catalog claims an article the crosswalk cannot
    // resolve — the resolver must be caught, not waved through.
    const forged: CatalogBundle = {
      ...bundle,
      crosswalks: [],
      services: [
        ...bundle.services,
        {
          ...bundle.services[0],
          meta: {
            ...bundle.services[0].meta,
            catalogId: "svc:test:forged-only",
            nyc311ArticleId: "nyc311-KA-99999",
          },
        },
      ],
    };
    const articles = [
      entry("KA-99999", "Renew your yodeling clipboard annually", "Renew your yodeling clipboard online each year."),
      entry("KA-22001", "Learn About Snow Removal", "Learn how the City clears snow from streets and sidewalks."),
    ];
    const run = await runCheckA({
      snapshotPath: "data/snapshots/nyc311-index/test.json",
      snapshot: snapshotFixture(articles),
      bundle: forged,
      pages: pagesFixture(articles, (article) =>
        article.ka === "KA-99999" ? { html: servicePage() } : { html: informationalPage() },
      ),
      seed: CHECK_A_SEED,
      sampleSize: articles.length,
      ranAt: RAN_AT,
    });
    const row = run.results.find((r) => r.ka === "KA-99999");
    expect(row?.outcome).toBe("fail");
    expect(row?.breach).toBe(true);
    expect(row?.problem).toContain("resolver missed cataloged article");
    expect(run.breaches.some((b) => b.startsWith("KA-99999: invalid crosswalk resolution"))).toBe(true);
    expect(run.summary.validityPassed).toBe(false);
    expect(run.summary.passed).toBe(false);
  });

  it(`stops when more than ${DEAD_PAGE_STOP_FRACTION * 100}% of pages lack ka-content (anti-bot stop condition)`, async () => {
    const articles: IndexArticleEntry[] = [];
    for (let i = 0; i < 100; i += 1) {
      const ka: KaNumber = `KA-2${String(5000 + i).padStart(4, "0")}`;
      articles.push(
        entry(ka, `Renew Registration Item ${i}`, `Renew registration item ${i} online.`),
      );
    }
    const pages = pagesFixture(articles, (article) =>
      // 25 of 100 dead — past the stop fraction, so the run must refuse.
      Number.parseInt(article.ka.slice(4), 10) < 5025 ? { html: deadPage() } : { html: servicePage() },
    );
    const run = await runCheckA({
      snapshotPath: "data/snapshots/nyc311-index/test.json",
      snapshot: snapshotFixture(articles),
      bundle,
      pages,
      seed: CHECK_A_SEED,
      sampleSize: articles.length,
      ranAt: RAN_AT,
    });
    expect(run.summary.deadPages).toBe(25);
    expect(run.breaches.some((b) => b.startsWith("mass dead pages"))).toBe(true);
    expect(run.summary.validityPassed).toBe(false);
    expect(run.summary.passed).toBe(false);
  });
});

describe("committed sample record", () => {
  it("derives the same record twice", () => {
    const { snapshot, articles } = mixedCorpus();
    const first = deriveSampleRecord("snap.json", snapshot, CHECK_A_SEED, articles.length);
    const second = deriveSampleRecord("snap.json", snapshot, CHECK_A_SEED, articles.length);
    expect(second).toEqual(first);
  });

  it("flags seed, size, snapshot, and article drift as staleness", () => {
    const { snapshot, articles } = mixedCorpus();
    const fresh = deriveSampleRecord("snap.json", snapshot, CHECK_A_SEED, articles.length);

    expect(diffSampleRecord(fresh, fresh)).toEqual([]);

    const driftedSeed = { ...fresh, seed: 42 };
    expect(diffSampleRecord(driftedSeed, fresh).some((v) => v.includes("seed drift"))).toBe(true);

    const driftedSize = { ...fresh, sampleSize: 50 };
    expect(diffSampleRecord(driftedSize, fresh).some((v) => v.includes("sample size drift"))).toBe(true);

    const driftedSha = { ...fresh, snapshotSha256: "cd".repeat(32) };
    expect(diffSampleRecord(driftedSha, fresh).some((v) => v.includes("snapshot drift"))).toBe(true);

    const driftedArticles = { ...fresh, articles: fresh.articles.slice(1) };
    expect(diffSampleRecord(driftedArticles, fresh).some((v) => v.includes("re-commit the sample"))).toBe(true);
  });
});
