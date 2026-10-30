// Estimate display rendering — build spec D6. The renderer is where the
// two display guarantees live:
//
//  1. Every tier-1 fee line carries its source citation and as-of — the
//     extractor refuses unsourced fees upstream, and the line template
//     makes citation + capture date part of the fee's own text.
//  2. A tier-3 item can never render without its "Estimate (heuristic)"
//     label — the template is the single render path and the label is
//     hard-wired into it.
//
// Surcharges are not renderable here at all: they flow to step feeNotes
// (renderStepFeeNotes), never into a headline line.

import type { BlueprintStepRecord } from "@/lib/catalog/types";
import type { EstimateBlock, EstimateTier } from "./types";

/** One display line for one tier item. */
export function renderEstimateLine(item: EstimateTier): string {
  switch (item.tier) {
    case 1:
      return `${item.label}: ${item.amountText} — source: ${item.sourceCitation}`;
    case 2:
      return `${item.label}: ${item.durationText} — dataset: ${item.dataset}; query: ${item.query}`;
    case 3:
      // The estimate label is part of the template — a tier-3 range can
      // never reach a user unlabeled.
      return `Estimate (heuristic) — ${item.label}: ${item.rangeText} (basis: ${item.basis})`;
  }
  item satisfies never;
  throw new Error(`unreachable: unknown estimate tier`);
}

/** Headline lines, in tier order (1 → 2 → 3, input order within a tier). */
export function renderEstimateHeadline(block: EstimateBlock): string[] {
  return block.tiers.map(renderEstimateLine);
}

/** True when the block carries at least one tier — else the surface shows its honest no-data state. */
export function hasEstimates(block: EstimateBlock): boolean {
  return block.tiers.length > 0;
}

/**
 * Fee notes for one blueprint step: the curated surcharge rows keyed to
 * that step's ID. The step's own feeRef fee is a headline (tier-1) item —
 * only contingent fees and surcharges appear as notes.
 */
export function renderStepFeeNotes(
  step: BlueprintStepRecord,
  notesByStepId: ReadonlyMap<string, string[]>,
): string[] {
  return notesByStepId.get(step.id) ?? [];
}
