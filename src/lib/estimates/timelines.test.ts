import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import type { CatalogBundle } from "@/lib/catalog/types";

import { parseHeuristicRows } from "./heuristics";
import {
  buildEmpiricalTimeline,
  buildPublishedTimelines,
  buildTimelineEstimates,
  formatDuration,
  parseIsoDuration,
  parseOpenDataTimelineRows,
  type OpenDataTimelineRow,
} from "./timelines";
import { EstimatesError } from "./types";

const CATALOG_FILE = "data/catalog/catalog.json";
const REGISTRY_FILE = "data/estimates/timelines.json";

let bundle: CatalogBundle;
let hic: CatalogBundle["services"][number];
let committedRegistry: unknown;

beforeAll(() => {
  bundle = JSON.parse(readFileSync(CATALOG_FILE, "utf8")) as CatalogBundle;
  hic = bundle.services.find((s) => s.meta.catalogId === "svc:dcwp:home-improvement-contractor-license")!;
  committedRegistry = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
});

// Fixture row: the dataset is real (verified to exist in art_wJiwwN0o §3);
// the statistic values are test inputs — no production row ships until a
// verified extract exists.
function fixtureRow(overrides: Partial<OpenDataTimelineRow> = {}): OpenDataTimelineRow {
  return {
    serviceId: "svc:buildings:building-construction-alteration-permit",
    label: "Permit issuance (per review)",
    datasetId: "ipu4-2q9a",
    datasetName: "DOB Permit Issuance",
    datasetUrl: "https://data.cityofnewyork.us/Housing-Development/DOB-Permit-Issuance/ipu4-2q9a",
    query: "SELECT median(datediff) WHERE jobtype='NB'",
    asOf: "2026-10-30",
    medianDays: 30,
    sampleSize: 1200,
    ...overrides,
  };
}

describe("parseIsoDuration", () => {
  it("parses the corpus's published durations", () => {
    expect(parseIsoDuration("P21D")).toEqual({
      years: 0,
      months: 0,
      weeks: 0,
      days: 21,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
    expect(parseIsoDuration("PT1H30M")).toMatchObject({ hours: 1, minutes: 30 });
    expect(parseIsoDuration("P1Y2M3D")).toMatchObject({ years: 1, months: 2, days: 3 });
    expect(parseIsoDuration("P2W")).toMatchObject({ weeks: 2 });
  });

  it("refuses non-durations and zero-component durations", () => {
    expect(() => parseIsoDuration("21 days")).toThrow(EstimatesError);
    expect(() => parseIsoDuration("P")).toThrow(EstimatesError);
    // Zero-component durations are refused at the parse layer itself, not
    // only by the downstream coupling in formatDuration (shakedown S3-M3,
    // revert gap R8).
    expect(() => parseIsoDuration("P0D")).toThrow(EstimatesError);
    expect(() => parseIsoDuration("PT0S")).toThrow(EstimatesError);
  });
});

describe("formatDuration", () => {
  it("formats singular and plural units", () => {
    expect(formatDuration(parseIsoDuration("P21D"))).toBe("21 days");
    expect(formatDuration(parseIsoDuration("P1D"))).toBe("1 day");
    expect(formatDuration(parseIsoDuration("P1Y2M3D"))).toBe("1 year, 2 months, 3 days");
  });
});

describe("buildPublishedTimelines — real catalog", () => {
  it("renders the HIC online channel's published P21D with provenance", () => {
    const items = buildPublishedTimelines(hic);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      tier: 2,
      label: "Processing time — Online (published)",
      durationText: "21 days",
      dataset: "NYC311 article nyc311-KA-01808 (published processing time)",
      query: 'availableChannel[name="Online"].processingTime',
      sourceUrl: "https://portal.311.nyc.gov/article/?kanumber=KA-01808",
    });
  });

  it("emits nothing for services whose sources state no processing time", () => {
    for (const record of bundle.services) {
      if (record.meta.catalogId === "svc:dcwp:home-improvement-contractor-license") continue;
      expect(buildPublishedTimelines(record)).toEqual([]);
    }
  });

  it("refuses a published processing time with no owning NYC311 article (shakedown S3-H2)", () => {
    // The runtime catalog load is shallow — a service whose meta lacks the
    // owning article pair is type-invisible but runtime-real.
    const orphan = {
      ...hic,
      meta: { ...hic.meta, nyc311ArticleId: undefined, nyc311ArticleUrl: undefined },
    } as unknown as CatalogBundle["services"][number];
    const build = () => buildPublishedTimelines(orphan);
    expect(build).toThrow(EstimatesError);
    expect(build).toThrow(/has no owning NYC311 article id/);
  });
});

describe("parseOpenDataTimelineRows", () => {
  it("accepts the committed registry (empty — honest gap until a verified extract)", () => {
    expect(parseOpenDataTimelineRows(committedRegistry)).toEqual([]);
  });

  it("accepts a valid row", () => {
    expect(parseOpenDataTimelineRows([fixtureRow()])).toHaveLength(1);
  });

  it("refuses a non-array registry", () => {
    expect(() => parseOpenDataTimelineRows({})).toThrow(EstimatesError);
  });

  it("collects every bad row's violations in one rejection", () => {
    try {
      parseOpenDataTimelineRows([
        fixtureRow({ query: "" }),
        fixtureRow({ asOf: "October 2026", medianDays: 0, sampleSize: 0 }),
        fixtureRow({ serviceId: "not-a-service-id", datasetUrl: "http://insecure.example" }),
      ]);
      expect.unreachable("expected EstimatesError");
    } catch (error) {
      const violations = (error as EstimatesError).violations;
      expect(violations.length).toBeGreaterThanOrEqual(4);
      expect(violations.join("\n")).toMatch(/query/);
      expect(violations.join("\n")).toMatch(/asOf/);
      expect(violations.join("\n")).toMatch(/medianDays/);
      expect(violations.join("\n")).toMatch(/sampleSize/);
      expect(violations.join("\n")).toMatch(/serviceId/);
      expect(violations.join("\n")).toMatch(/datasetUrl/);
    }
  });
});

describe("buildEmpiricalTimeline", () => {
  it("records dataset, query, sample size, and the as-of capturedAt with the duration", () => {
    const row = fixtureRow();
    expect(buildEmpiricalTimeline(row)).toEqual({
      tier: 2,
      label: "Permit issuance (per review)",
      durationText: "30 days (median of 1200 records, as of 2026-10-30)",
      dataset: "DOB Permit Issuance (ipu4-2q9a)",
      query: row.query,
      sourceUrl: row.datasetUrl,
      capturedAt: "2026-10-30",
    });
  });
});

describe("buildTimelineEstimates", () => {
  it("orders published before empirical for one service", () => {
    const hicRow = fixtureRow({ serviceId: "svc:dcwp:home-improvement-contractor-license" });
    const otherService = fixtureRow({ serviceId: "svc:buildings:elevator-escalator-inspection" });
    const items = buildTimelineEstimates(hic, [hicRow, otherService]);
    expect(items).toHaveLength(2);
    expect(items[0].label).toContain("(published)");
    expect(items[1].dataset).toContain("ipu4-2q9a");
  });

  it("keeps other services' rows out of this service's block", () => {
    const otherService = fixtureRow({ serviceId: "svc:buildings:elevator-escalator-inspection" });
    const permit = bundle.services.find(
      (s) => s.meta.catalogId === "svc:buildings:building-construction-alteration-permit",
    )!;
    expect(buildTimelineEstimates(permit, [otherService])).toEqual([]);
  });

  it("pairs with the heuristic parser without import cycles", () => {
    expect(parseHeuristicRows([], new Map())).toEqual([]);
  });
});
