// Server-side API context — the single loader for the committed catalog
// bundle and estimate registries, memoized per process. Route handlers call
// getApiContext(); tests build contexts explicitly via buildApiContext so
// they never depend on module state.
//
// Parse-strict like the resolver's catalog-source: a malformed registry
// throws instead of silently serving a partial catalog.

import { readFileSync } from "node:fs";

import { parseHeuristicRows } from "@/lib/estimates/heuristics";
import { parseOpenDataTimelineRows } from "@/lib/estimates/timelines";
import { parseSurchargeRows } from "@/lib/estimates/surcharges";
import { loadCatalogBundle } from "@/lib/resolver/catalog-source";

import { buildApiContext, type ApiContext } from "./core";

const CATALOG_FILE = "data/catalog/catalog.json";
const TIMELINE_REGISTRY = "data/estimates/timelines.json";
const HEURISTIC_REGISTRY = "data/estimates/heuristics.json";
const SURCHARGE_REGISTRY = "data/estimates/surcharges.json";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

let cached: ApiContext | null = null;

/** Memoized production context for route handlers. Build once per process — the bundle is versioned data. */
export function getApiContext(): ApiContext {
  if (!cached) {
    const bundle = loadCatalogBundle(CATALOG_FILE);
    const snapshotsById = new Map(bundle.snapshots.map((s) => [s.id, s]));
    const timelineRows = parseOpenDataTimelineRows(readJson(TIMELINE_REGISTRY));
    const heuristicRows = parseHeuristicRows(readJson(HEURISTIC_REGISTRY), snapshotsById);
    const surchargeRows = parseSurchargeRows(readJson(SURCHARGE_REGISTRY), snapshotsById);
    cached = buildApiContext(
      bundle,
      { snapshots: bundle.snapshots, openDataTimelineRows: timelineRows, heuristicRows },
      surchargeRows,
    );
  }
  return cached;
}
