// Tiered estimates — build spec D6 (art_RVpFZFo1). Attaches a labeled
// three-tier estimate to a catalog service: tier-1 fees verbatim with
// source + captured_at, tier-2 timelines with recorded provenance, tier-3
// heuristics only from the curated registry, always labeled. Pure and
// deterministic for a pinned catalog — no clocks, no randomness.
//
// Consumers: the D7 view layer and the D9 adapters stamp their own version
// pins around the block (the D4.5 contract's EstimateBlock is exactly
// { serviceId, tiers }). The D5 resolver stays estimates-free by design —
// GoalResolution carries serviceIds only (shakedown S1-F7).

import type { ServiceRecord, SourceSnapshotRecord } from "@/lib/catalog/types";

import { buildFeeEstimates, snapshotsById } from "./fees";
import { buildHeuristicEstimates, type HeuristicRow } from "./heuristics";
import { buildTimelineEstimates, type OpenDataTimelineRow } from "./timelines";
import type { EstimateBlock, EstimateTier } from "./types";

export * from "./types";
export * from "./fees";
export * from "./timelines";
export * from "./heuristics";
export * from "./render";
export * from "./surcharges";

/** Everything the block builder needs, all of it versioned data. */
export interface EstimateContext {
  /** The catalog bundle's SourceSnapshot records, for fee citations. */
  snapshots: readonly SourceSnapshotRecord[];
  /** Validated rows from data/estimates/timelines.json (may be empty). */
  openDataTimelineRows: readonly OpenDataTimelineRow[];
  /** Validated rows from data/estimates/heuristics.json (may be empty). */
  heuristicRows: readonly HeuristicRow[];
}

/**
 * Build the estimate block for one service — tiers in order 1 → 2 → 3.
 * Throws EstimatesError when any tier would display without its required
 * provenance; a service with no data on file gets an empty tiers array
 * (an honest gap the surface renders as such).
 */
export function buildEstimateBlock(record: ServiceRecord, context: EstimateContext): EstimateBlock {
  const tiers: EstimateTier[] = [
    ...buildFeeEstimates(record.envelope, snapshotsById(context.snapshots)),
    ...buildTimelineEstimates(record, context.openDataTimelineRows),
    ...buildHeuristicEstimates(record.meta.catalogId, context.heuristicRows),
  ];
  return { serviceId: record.meta.catalogId, tiers };
}
