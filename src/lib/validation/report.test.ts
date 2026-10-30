import { describe, expect, it } from "vitest";

import { CHECK_A_SEED } from "./sample";
import { renderCheckAJson, renderCheckAMarkdown } from "./report";
import type { CheckARun } from "./check-a";

function runFixture(overrides: Partial<CheckARun> = {}): CheckARun {
  return {
    ranAt: "2026-10-30T12:00:00.000Z",
    seed: CHECK_A_SEED,
    sampleSize: 100,
    snapshot: {
      path: "data/snapshots/nyc311-index/2026-10-30.json",
      sha256: "ab".repeat(32),
      capturedAt: "2026-10-30T00:00:00.000Z",
      articleCount: 2093,
    },
    versions: {
      catalog: "2026-10-30.1",
      crosswalkRules: "1.0.0",
      classifierRules: "1.0.0",
      domainTaxonomy: "1.0.0",
      embeddingModel: "lexical-hash-v1",
    },
    breaches: [],
    results: [
      {
        id: "nyc311-KA-01808",
        ka: "KA-01808",
        title: "Home Improvement Contractor License",
        url: "https://portal.311.nyc.gov/article/?kanumber=KA-01808",
        domain: "licensing",
        domainPatternId: "licensing.license-terms",
        outcome: "service_record",
        disposition: "service",
        serviceSubtype: "apply",
        reason: "actionability in title",
        ruleId: "R003",
        matchedServiceIds: ["svc:dcwp:home-improvement-contractor-license"],
        resolutionLayer: "alias-rules",
        catalogMatch: "self",
        breach: false,
      },
      {
        id: "nyc311-KA-02000",
        ka: "KA-02000",
        title: "Learn About Snow Removal",
        url: "https://portal.311.nyc.gov/article/?kanumber=KA-02000",
        domain: "other",
        domainPatternId: "other.fallback",
        outcome: "out_of_scope",
        disposition: "informational",
        reason: "no actionability signals",
        ruleId: "R010",
        matchedServiceIds: [],
        resolutionLayer: null,
        catalogMatch: null,
        breach: false,
      },
    ],
    domains: [
      { domain: "permits", sampled: 5, serviceRecords: 3, catalogedSelf: 2, siblingMatch: 0, noMatch: 1, outOfScope: 0, failures: 1 },
      { domain: "service-requests", sampled: 2, serviceRecords: 1, catalogedSelf: 0, siblingMatch: 1, noMatch: 0, outOfScope: 1, failures: 0 },
      { domain: "public-records", sampled: 0, serviceRecords: 0, catalogedSelf: 0, siblingMatch: 0, noMatch: 0, outOfScope: 0, failures: 0 },
      { domain: "licensing", sampled: 1, serviceRecords: 1, catalogedSelf: 1, siblingMatch: 0, noMatch: 0, outOfScope: 0, failures: 0 },
      { domain: "inspections", sampled: 0, serviceRecords: 0, catalogedSelf: 0, siblingMatch: 0, noMatch: 0, outOfScope: 0, failures: 0 },
      { domain: "other", sampled: 1, serviceRecords: 0, catalogedSelf: 0, siblingMatch: 0, noMatch: 0, outOfScope: 1, failures: 0 },
    ],
    summary: {
      total: 9,
      serviceRecords: 5,
      outOfScope: 3,
      failures: 1,
      breaches: 0,
      deadPages: 0,
      resolvedCount: 8,
      resolvedFraction: 8 / 9,
      gateThreshold: 0.95,
      gatePassed: false,
      validityPassed: true,
      passed: false,
    },
    ...overrides,
  };
}

describe("renderCheckAJson", () => {
  it("round-trips the run through JSON.parse", () => {
    const run = runFixture();
    const parsed = JSON.parse(renderCheckAJson(run)) as CheckARun;
    expect(parsed.summary.total).toBe(9);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.domains).toHaveLength(6);
    expect(parsed.versions.catalog).toBe("2026-10-30.1");
  });

  it("is stable under re-rendering (byte-identical)", () => {
    const run = runFixture();
    expect(renderCheckAJson(run)).toBe(renderCheckAJson(run));
  });
});

describe("renderCheckAMarkdown", () => {
  it("renders the header, versions, and gate verdict", () => {
    const md = renderCheckAMarkdown(runFixture());
    expect(md).toContain("# Check A — catalog coverage sample report");
    expect(md).toContain("fixed seed `20261030`");
    expect(md).toContain("2,093 articles");
    expect(md).toContain("**Gate FAIL (coverage gate)**");
    expect(md).toContain("8/9 (89%) resolved");
  });

  it("renders the PASS verdict for a passing run", () => {
    const run = runFixture();
    run.summary.gatePassed = true;
    run.summary.passed = true;
    run.summary.resolvedFraction = 1;
    run.summary.resolvedCount = 9;
    expect(renderCheckAMarkdown(run)).toContain("**Gate PASS**");
  });

  it("renders a row for every coverage domain, zeros included", () => {
    const md = renderCheckAMarkdown(runFixture());
    // The per-domain report assertion: the permits row carries the fixture's
    // exact rollup — 5 sampled, 3 service records, 2 self, 0 sibling, 1 gap,
    // 0 out-of-scope, 1 failure — so a gap in any domain is visible.
    expect(md).toContain("| Permits | 5 | 3 | 2 | 0 | 1 | 0 | 1 |");
    expect(md).toContain("| 311 service requests | 2 | 1 | 0 | 1 | 0 | 1 | 0 |");
    expect(md).toContain("| Public records | 0 | 0 | 0 | 0 | 0 | 0 | 0 |");
    expect(md).toContain("| Licensing | 1 | 1 | 1 | 0 | 0 | 0 | 0 |");
    expect(md).toContain("| Inspections | 0 | 0 | 0 | 0 | 0 | 0 | 0 |");
    expect(md).toContain("| Other (untagged) | 1 | 0 | 0 | 0 | 0 | 1 | 0 |");
  });

  it("renders per-article rows with disposition, matched IDs, and layer", () => {
    const md = renderCheckAMarkdown(runFixture());
    expect(md).toContain(
      "| KA-01808 | Home Improvement Contractor License | licensing | service | service_record | svc:dcwp:home-improvement-contractor-license | alias-rules |",
    );
    expect(md).toContain("| KA-02000 | Learn About Snow Removal | other | informational | out_of_scope | — | — |");
  });

  it("lists validity breaches when present", () => {
    const run = runFixture({
      breaches: ["KA-01808: invalid classifier output — disposition \"banana\" is not in the enum"],
    });
    run.summary.breaches = 1;
    run.summary.validityPassed = false;
    const md = renderCheckAMarkdown(run);
    expect(md).toContain("## Validity breaches");
    expect(md).toContain('KA-01808: invalid classifier output — disposition "banana" is not in the enum');
    expect(md).toContain("**Gate FAIL (validity)**");
  });

  it("omits the breach section for a clean run", () => {
    expect(renderCheckAMarkdown(runFixture())).not.toContain("## Validity breaches");
  });
});
