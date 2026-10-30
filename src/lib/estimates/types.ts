// Tiered estimate types — build spec D6 (art_RVpFZFo1). Three tiers, each
// item explicitly labeled by its tier:
//   tier 1 — fees, verbatim, with source citation + capture date
//   tier 2 — timelines, with the dataset + query recorded as provenance
//   tier 3 — heuristic ranges, gap-filler only, always rendered as estimates
//
// The tier shapes ARE the canonical D4.5 contracts — re-exported from
// src/lib/contracts (which owns the zod schemas) so the producer and its
// surfaces share one definition and drift fails here, not at the API
// boundary (shakedown S1-F3). This module's logic stays pure and zod-free:
// the re-exports are type-only and erase at runtime.
//
// SURCHARGE RULE (spec D6): surcharges are deliberately NOT representable
// here — they render inside step instructions (see surcharges.ts and the
// step feeNotes). A tier-1 fee is a flat published fee with its source.
//
// Every tier constructor refuses dishonest input and collects ALL
// violations into one EstimatesError (the envelope-builder pattern).

export type {
  EstimateBlock,
  EstimateTier,
  FeeEstimate,
  HeuristicEstimate,
  TimelineEstimate,
} from "@/lib/contracts";

/** Construction refused — the message names every violated honesty rule. */
export class EstimatesError extends Error {
  constructor(readonly violations: string[]) {
    super(`estimate build rejected (${violations.length} violation(s)):\n  - ${violations.join("\n  - ")}`);
    this.name = "EstimatesError";
  }
}

/** ISO yyyy-mm-dd date shape shared by every as-of field. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
