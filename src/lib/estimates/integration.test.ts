// Producer-side conformance binding (shakedown S1-F1 / S3-M2): every real
// catalog service goes through buildEstimateBlock, and every block must
// parse against the canonical D4.5 EstimateBlockSchema — the payload the
// D9 MCP/OpenAPI surface ships. contracts.test.ts binds hand-written
// fixtures; this file binds the real producer, so a builder change that
// violates the canonical strictness fails here instead of at the API
// parse boundary.

import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import type { CatalogBundle } from "@/lib/catalog/types";
import { EstimateBlockSchema } from "@/lib/contracts";

import { snapshotsById } from "./fees";
import { parseHeuristicRows } from "./heuristics";
import { buildEstimateBlock, type EstimateContext } from "./index";
import { parseOpenDataTimelineRows } from "./timelines";

const CATALOG_FILE = "data/catalog/catalog.json";
const TIMELINE_REGISTRY = "data/estimates/timelines.json";
const HEURISTIC_REGISTRY = "data/estimates/heuristics.json";

let bundle: CatalogBundle;
let context: EstimateContext;

beforeAll(() => {
  bundle = JSON.parse(readFileSync(CATALOG_FILE, "utf8")) as CatalogBundle;
  context = {
    snapshots: bundle.snapshots,
    openDataTimelineRows: parseOpenDataTimelineRows(JSON.parse(readFileSync(TIMELINE_REGISTRY, "utf8"))),
    heuristicRows: parseHeuristicRows(
      JSON.parse(readFileSync(HEURISTIC_REGISTRY, "utf8")),
      snapshotsById(bundle.snapshots),
    ),
  };
});

describe("producer-side conformance — real catalog through the canonical schema", () => {
  it("parses every service's block against EstimateBlockSchema", () => {
    let feeCount = 0;
    let tier2Count = 0;

    for (const record of bundle.services) {
      const block = buildEstimateBlock(record, context);
      const parsed = EstimateBlockSchema.safeParse(block);
      const issues = parsed.success ? [] : parsed.error.issues;
      expect(issues, `${record.meta.catalogId} does not conform to the canonical contract`).toEqual([]);

      feeCount += block.tiers.filter((tier) => tier.tier === 1).length;
      tier2Count += block.tiers.filter((tier) => tier.tier === 2).length;
    }

    // Non-vacuity: the loop exercised the catalog's populated tiers — the
    // two fees (HIC $200, FSE $280) and the HIC online P21D channel — not
    // an empty catalog silently passing.
    expect(feeCount).toBe(2);
    expect(tier2Count).toBe(1);
  });
});
