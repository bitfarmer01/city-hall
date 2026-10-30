import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import type { BlueprintStepRecord, CatalogBundle } from "@/lib/catalog/types";

import { parseHeuristicRows, type HeuristicRow } from "./heuristics";
import { hasEstimates, renderEstimateHeadline, renderEstimateLine, renderStepFeeNotes } from "./render";
import { parseSurchargeRows, surchargeNotesByStepId } from "./surcharges";
import { parseOpenDataTimelineRows } from "./timelines";
import { buildEstimateBlock, type EstimateBlock, type EstimateContext } from "./index";

const CATALOG_FILE = "data/catalog/catalog.json";
const SURCHARGE_REGISTRY = "data/estimates/surcharges.json";
const TIMELINE_REGISTRY = "data/estimates/timelines.json";
const HEURISTIC_REGISTRY = "data/estimates/heuristics.json";

let bundle: CatalogBundle;
let context: EstimateContext;

beforeAll(() => {
  bundle = JSON.parse(readFileSync(CATALOG_FILE, "utf8")) as CatalogBundle;
  // The committed registries are the production context — empty today, and
  // this assertion run doubles as their validation gate.
  context = {
    snapshots: bundle.snapshots,
    openDataTimelineRows: parseOpenDataTimelineRows(JSON.parse(readFileSync(TIMELINE_REGISTRY, "utf8"))),
    heuristicRows: parseHeuristicRows(JSON.parse(readFileSync(HEURISTIC_REGISTRY, "utf8")), surchargelessSnapshots()),
  };
});

function surchargelessSnapshots() {
  return new Map(bundle.snapshots.map((s) => [s.id, s]));
}

/** Fixture surcharge rows use real catalog step/snapshot IDs so refs resolve. */
function surchargeFixtureRows() {
  return [
    {
      stepId: "stp:svc:dcwp:home-improvement-contractor-license:010",
      note: "Card payments carry a 2% convenience fee; eCheck is free.",
      // Derived from the loaded bundle, not hardcoded — snapshot IDs re-hash
      // on every catalog re-capture and a pinned ref re-breaks this suite
      // (shakedown S2-M2). The note rides on HIC step 010, so its ref is
      // that step's own committed evidence.
      sourceRefs: [hicStep010().sourceRefs[0]],
    },
  ];
}

function hicStep010(): BlueprintStepRecord {
  return bundle.services
    .find((s) => s.meta.catalogId === "svc:dcwp:home-improvement-contractor-license")!
    .steps.find((step) => step.id === "stp:svc:dcwp:home-improvement-contractor-license:010")!;
}

function blockForAllServices(): EstimateBlock[] {
  return bundle.services.map((record) => buildEstimateBlock(record, context));
}

describe("fee-source assertion (spec D6) — whole catalog", () => {
  it("renders every displayed fee with a source URL and an as-of date", () => {
    let feeLines = 0;
    for (const block of blockForAllServices()) {
      const lines = renderEstimateHeadline(block);
      block.tiers.forEach((tier, index) => {
        if (tier.tier !== 1) return;
        feeLines += 1;
        // The line template itself must carry source + as-of…
        expect(lines[index]).toMatch(/^.* — source: https:\/\/\S+ \(captured \d{4}-\d{2}-\d{2}\)$/);
        // …and the item must carry them structurally.
        expect(tier.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(tier.sourceUrl).toMatch(/^https:\/\//);
        expect(tier.sourceCitation.length).toBeGreaterThan(0);
      });
    }
    // Both catalog fees (HIC $200, FSE $280) are present — the assertion
    // exercised real data, not an empty loop.
    expect(feeLines).toBe(2);
  });

  it("renders each fee with its amount", () => {
    const blocks = blockForAllServices();
    const amounts = blocks.flatMap((block) =>
      renderEstimateHeadline(block).filter((line) => line.includes("$")),
    );
    expect(amounts).toEqual([
      "Two-year license term.: $200.00 — source: https://portal.311.nyc.gov/article/?kanumber=KA-01808 (captured 2026-10-30)",
      "Annual fee; renewal $280/yr; permit expires after 1 year on staggered dates.: $280.00 — source: https://portal.311.nyc.gov/article/?kanumber=KA-01878 (captured 2026-10-30)",
    ]);
  });
});

describe("tier-3 labeling guarantee (spec D6)", () => {
  it("never renders a tier-3 item without the estimate label — catalog and fixtures alike", () => {
    const blocks = blockForAllServices();
    // Fixture block exercising all three tiers at once.
    const heuristicRows: HeuristicRow[] = parseHeuristicRows(
      [
        {
          serviceId: "svc:dohmh:birth-certificate-order",
          label: "Typical mail-order turnaround",
          rangeText: "2–4 weeks",
          basis: "test fixture demonstrating the gap-filler shape; no production heuristic exists",
        },
      ],
      surchargelessSnapshots(),
    );
    blocks.push(
      buildEstimateBlock(
        bundle.services.find((s) => s.meta.catalogId === "svc:dohmh:birth-certificate-order")!,
        { ...context, heuristicRows },
      ),
    );

    for (const block of blocks) {
      const lines = renderEstimateHeadline(block);
      block.tiers.forEach((tier, index) => {
        if (tier.tier === 3) {
          expect(lines[index]).toMatch(/^Estimate \(heuristic\) — /);
        } else {
          expect(lines[index]).not.toMatch(/^Estimate \(heuristic\)/);
        }
      });
    }
  });

  it("carries the basis on every rendered tier-3 line", () => {
    const line = renderEstimateLine({
      tier: 3,
      label: "Typical mail-order turnaround",
      rangeText: "2–4 weeks",
      basis: "no published or empirical data on file",
    });
    expect(line).toBe(
      "Estimate (heuristic) — Typical mail-order turnaround: 2–4 weeks (basis: no published or empirical data on file)",
    );
  });
});

describe("surcharges render in step feeNotes, never the headline", () => {
  it("attaches a curated surcharge note to its step only", () => {
    const rows = parseSurchargeRows(surchargeFixtureRows(), surchargelessSnapshots());
    const notesByStepId = surchargeNotesByStepId(rows);
    const step = hicStep010();

    expect(renderStepFeeNotes(step, notesByStepId)).toEqual([
      "Card payments carry a 2% convenience fee; eCheck is free.",
    ]);
  });

  it("keeps the headline block free of surcharge text", () => {
    const rows = parseSurchargeRows(surchargeFixtureRows(), surchargelessSnapshots());
    const notesByStepId = surchargeNotesByStepId(rows);
    const step = hicStep010();
    expect(renderStepFeeNotes(step, notesByStepId).length).toBeGreaterThan(0);

    const hic = bundle.services.find(
      (s) => s.meta.catalogId === "svc:dcwp:home-improvement-contractor-license",
    )!;
    const block = buildEstimateBlock(hic, context);
    // The feeNote text exists in the step render path but is structurally
    // absent from the headline tiers.
    expect(JSON.stringify(block)).not.toContain("2% convenience fee");
  });

  it("renders no notes for steps without curated rows", () => {
    const rows = parseSurchargeRows(surchargeFixtureRows(), surchargelessSnapshots());
    const notesByStepId = surchargeNotesByStepId(rows);
    const step020 = bundle.services
      .find((s) => s.meta.catalogId === "svc:dcwp:home-improvement-contractor-license")!
      .steps.find((step) => step.id === "stp:svc:dcwp:home-improvement-contractor-license:020")!;
    expect(renderStepFeeNotes(step020, notesByStepId)).toEqual([]);
  });

  it("validates the committed registry is empty and clean", () => {
    const raw = JSON.parse(readFileSync(SURCHARGE_REGISTRY, "utf8"));
    expect(parseSurchargeRows(raw, surchargelessSnapshots())).toEqual([]);
  });
});

describe("tier-2 render-line provenance (shakedown S3-H1)", () => {
  it("renders tier-2 lines with their dataset + query provenance", () => {
    // The HIC block is the catalog's one tier-2 carrier (online P21D) —
    // the assertion exercised a real tier-2 item, not an empty loop.
    const hic = bundle.services.find(
      (s) => s.meta.catalogId === "svc:dcwp:home-improvement-contractor-license",
    )!;
    const block = buildEstimateBlock(hic, context);
    expect(block.tiers.some((tier) => tier.tier === 2)).toBe(true);

    const lines = renderEstimateHeadline(block);
    block.tiers.forEach((tier, index) => {
      if (tier.tier !== 2) return;
      // The line template must carry the provenance pair, mirroring the
      // tier-1 source regex — a template regression that strips it must
      // fail here, not silently (revert gap R11).
      expect(lines[index]).toMatch(/— dataset: .+; query: .+/);
    });
  });
});

describe("estimate block over the catalog", () => {
  it("orders tiers 1 → 2 for the HIC service", () => {
    const hic = bundle.services.find(
      (s) => s.meta.catalogId === "svc:dcwp:home-improvement-contractor-license",
    )!;
    const block = buildEstimateBlock(hic, context);
    expect(block.tiers.map((tier) => tier.tier)).toEqual([1, 2]);
  });

  it("leaves services with no data on file honestly empty", () => {
    const birth = bundle.services.find((s) => s.meta.catalogId === "svc:dohmh:birth-certificate-order")!;
    const block = buildEstimateBlock(birth, context);
    expect(block.tiers).toEqual([]);
    expect(hasEstimates(block)).toBe(false);
  });

  it("is deterministic for a pinned catalog — same input, identical block", () => {
    for (const record of bundle.services) {
      expect(buildEstimateBlock(record, context)).toEqual(buildEstimateBlock(record, context));
    }
  });
});
