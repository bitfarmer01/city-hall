import { describe, expect, it } from "vitest";

import { normalizeSignalLabel } from "./inperson";
import { parseGoldenExpectation } from "./expectation";
import { assertDomainSpread, parseGoldenSet, verifyArticleGrounding } from "./manifest";
import { diffInPerson } from "./stepdiff";
import { GOLDEN_DOMAINS, GOLDEN_SET_SIZE } from "./types";
import type { IndexArticleEntry } from "../inventory/types";

/**
 * Unit tests for the golden-set harness's pure logic: manifest parsing
 * strictness, the domain-spread assertion, article grounding, and the
 * in-person phrase diff. The committed-set gate and the injected-defect
 * property are covered by injected-defect.test.ts.
 */

function validService(i: number, domain: (typeof GOLDEN_DOMAINS)[number]) {
  return {
    serviceId: `svc:test:service-${i}`,
    title: `Test Service ${i}`,
    nyc311ArticleId: `KA-${String(1000 + i).padStart(5, "0")}`,
    domain,
    agencyHint: "TEST",
    inCatalog: false,
    targets: [
      {
        id: "article",
        kind: "article_page",
        url: `https://portal.311.nyc.gov/article/?kanumber=KA-${String(1000 + i).padStart(5, "0")}`,
        captureMode: "public_reachable",
        boundary: "none",
        snapshotId: "snap:0123456789ab",
        expectationFile: `data/golden/expectations/test-service-${i}.json`,
      },
    ],
  };
}

function validManifest(): Record<string, unknown> {
  const services = GOLDEN_DOMAINS.flatMap((domain, di) =>
    Array.from({ length: GOLDEN_SET_SIZE / GOLDEN_DOMAINS.length }, (_, i) => validService(di * 4 + i, domain)),
  );
  return {
    schemaVersion: "1.0.0",
    seededAt: "2026-10-30T00:00:00.000Z",
    inventorySnapshot: {
      path: "data/snapshots/nyc311-index/2026-10-30.json",
      sha256: "a".repeat(64),
      articleCount: 2093,
    },
    selectionRules: ["test fixture"],
    services,
  };
}

describe("parseGoldenSet", () => {
  it("accepts a valid 20-service manifest spanning all five domains", () => {
    const set = parseGoldenSet(validManifest());
    expect(set.services).toHaveLength(GOLDEN_SET_SIZE);
    expect(set.schemaVersion).toBe("1.0.0");
  });

  it("rejects a manifest with fewer than the spec's service count", () => {
    const raw = validManifest();
    (raw.services as unknown[]).pop();
    expect(() => parseGoldenSet(raw)).toThrow(/exactly 20/);
  });

  it("rejects a wrong schema version", () => {
    const raw = validManifest();
    raw.schemaVersion = "9.9.9";
    expect(() => parseGoldenSet(raw)).toThrow(/schema/);
  });

  it("rejects duplicate service ids", () => {
    const raw = validManifest();
    const services = raw.services as Array<Record<string, unknown>>;
    services[1].serviceId = services[0].serviceId;
    expect(() => parseGoldenSet(raw)).toThrow(/duplicate serviceId/);
  });

  it("rejects duplicate article ids", () => {
    const raw = validManifest();
    const services = raw.services as Array<Record<string, unknown>>;
    services[1].nyc311ArticleId = services[0].nyc311ArticleId;
    expect(() => parseGoldenSet(raw)).toThrow(/duplicate nyc311ArticleId/);
  });

  it("rejects malformed article ids", () => {
    const raw = validManifest();
    const services = raw.services as Array<Record<string, unknown>>;
    services[0].nyc311ArticleId = "ka-1234";
    expect(() => parseGoldenSet(raw)).toThrow(/KA-/);
  });

  it("rejects snapshot ids that are not snap:{12 hex}", () => {
    const raw = validManifest();
    const target = (raw.services as Array<Record<string, unknown>>)[0].targets as Array<Record<string, unknown>>;
    target[0].snapshotId = "snap:SHORT";
    expect(() => parseGoldenSet(raw)).toThrow(/snap:/);
  });

  it("rejects expectation files outside data/golden/expectations/", () => {
    const raw = validManifest();
    const target = (raw.services as Array<Record<string, unknown>>)[0].targets as Array<Record<string, unknown>>;
    target[0].expectationFile = "src/lib/golden/expectations/evil.json";
    expect(() => parseGoldenSet(raw)).toThrow(/expectationFile/);
  });

  it("rejects path traversal in pdf paths", () => {
    const raw = validManifest();
    const target = (raw.services as Array<Record<string, unknown>>)[0].targets as Array<Record<string, unknown>>;
    target[0].kind = "pdf_checklist";
    target[0].captureMode = "public_reachable";
    delete target[0].snapshotId;
    target[0].pdfPath = "../outside/pw1.pdf";
    target[0].extractionPath = "data/catalog/forms/pw1.catalog.json";
    expect(() => parseGoldenSet(raw)).toThrow(/traverse/);
  });

  it("rejects absolute paths in pdf targets", () => {
    const raw = validManifest();
    const target = (raw.services as Array<Record<string, unknown>>)[0].targets as Array<Record<string, unknown>>;
    target[0].kind = "pdf_checklist";
    target[0].captureMode = "public_reachable";
    delete target[0].snapshotId;
    target[0].pdfPath = "/etc/passwd.pdf";
    target[0].extractionPath = "data/catalog/forms/pw1.catalog.json";
    expect(() => parseGoldenSet(raw)).toThrow(/absolute/);
  });

  it("rejects an http (non-https) target url", () => {
    const raw = validManifest();
    const target = (raw.services as Array<Record<string, unknown>>)[0].targets as Array<Record<string, unknown>>;
    target[0].url = "http://portal.311.nyc.gov/article/";
    expect(() => parseGoldenSet(raw)).toThrow(/https/);
  });
});

describe("assertDomainSpread", () => {
  it("accepts the five-domain committed set", () => {
    const set = parseGoldenSet(validManifest());
    expect(() => assertDomainSpread(set.services)).not.toThrow();
  });

  it("names the missing domain", () => {
    const set = parseGoldenSet(validManifest());
    const withoutInspections = set.services.filter((s) => s.domain !== "inspections");
    expect(() => assertDomainSpread(withoutInspections)).toThrow(/inspections/);
  });
});

describe("verifyArticleGrounding (real classifier, real snapshot titles)", () => {
  const entries: IndexArticleEntry[] = [
    { id: "nyc311-KA-01808", ka: "KA-01808", title: "Home Improvement Contractor License", description: "How to get a HIC license from DCWP." },
  ];

  it("accepts a manifest service whose title and domain match the snapshot + classifier", () => {
    const set = parseGoldenSet(validManifest());
    set.services[0] = {
      ...set.services[0],
      nyc311ArticleId: "KA-01808",
      title: "Home Improvement Contractor License",
      domain: "licensing",
    };
    expect(() => verifyArticleGrounding([set.services[0]], entries)).not.toThrow();
  });

  it("rejects a title drift", () => {
    const set = parseGoldenSet(validManifest());
    set.services[0] = { ...set.services[0], nyc311ArticleId: "KA-01808", title: "Some Other Title", domain: "licensing" };
    expect(() => verifyArticleGrounding([set.services[0]], entries)).toThrow(/title/);
  });

  it("rejects an article the pinned snapshot does not contain", () => {
    const set = parseGoldenSet(validManifest());
    set.services[0] = { ...set.services[0], nyc311ArticleId: "KA-99999", title: "X", domain: "licensing" };
    expect(() => verifyArticleGrounding([set.services[0]], entries)).toThrow(/not in the pinned inventory/);
  });

  it("rejects a domain the classifier does not assign to the title", () => {
    const set = parseGoldenSet(validManifest());
    set.services[0] = {
      ...set.services[0],
      nyc311ArticleId: "KA-01808",
      title: "Home Improvement Contractor License",
      domain: "permits",
    };
    expect(() => verifyArticleGrounding([set.services[0]], entries)).toThrow(/disagrees with classifier/);
  });
});

describe("parseGoldenExpectation", () => {
  it("parses fields, documents, and normalizes in-person phrases", () => {
    const e = parseGoldenExpectation({
      serviceId: "svc:test:x",
      label: "X — article",
      sourceUrl: "https://portal.311.nyc.gov/article/?kanumber=KA-01012",
      expectedFields: [{ label: "First Name", type: "text", required: true }],
      expectedDocuments: ["Proof of identity"],
      inPersonSteps: ["  In-person appointment  "],
    });
    expect(e.expectedFields).toHaveLength(1);
    expect(e.inPersonSteps).toEqual([normalizeSignalLabel("in-person appointment")]);
  });

  it("throws on a non-array expectedFields", () => {
    expect(() =>
      parseGoldenExpectation({
        serviceId: "svc:test:x",
        label: "X",
        sourceUrl: "https://example.com",
        expectedFields: "nope",
        expectedDocuments: [],
      }),
    ).toThrow(/expectedFields/);
  });

  it("throws on non-string in-person steps", () => {
    expect(() =>
      parseGoldenExpectation({
        serviceId: "svc:test:x",
        label: "X",
        sourceUrl: "https://example.com",
        expectedFields: [],
        expectedDocuments: [],
        inPersonSteps: [42],
      }),
    ).toThrow(/inPersonSteps/);
  });
});

describe("diffInPerson", () => {
  const base = { serviceId: "svc:test:x", label: "X", sourceUrl: "https://example.com", expectedFields: [], expectedDocuments: [] };

  it("fails when the live page shows an in-person requirement the baseline does not claim", () => {
    const diff = diffInPerson(
      "You must apply in person at a borough office. Other text.",
      { ...base, inPersonSteps: [] },
    );
    expect(diff.live).toContain("must act in person");
    expect(diff.missing).toEqual(["must act in person"]);
    expect(diff.stale).toEqual([]);
  });

  it("warns when the baseline claims an in-person step the page no longer shows", () => {
    const diff = diffInPerson(
      "No in-person language here at all.",
      { ...base, inPersonSteps: ["in-person appointment"] },
    );
    expect(diff.missing).toEqual([]);
    expect(diff.stale).toEqual(["in-person appointment"]);
  });

  it("suppresses negated sentences entirely", () => {
    const diff = diffInPerson(
      "In-person services are not available for this service.",
      { ...base, inPersonSteps: [] },
    );
    expect(diff.live).toEqual([]);
  });
});
