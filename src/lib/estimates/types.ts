// Tiered estimate types — build spec D6 (art_RVpFZFo1). Three tiers, each
// item explicitly labeled by its tier:
//   tier 1 — fees, verbatim, with source citation + capture date
//   tier 2 — timelines, with the dataset + query recorded as provenance
//   tier 3 — heuristic ranges, gap-filler only, always rendered as estimates
//
// Field names and tier literals intentionally mirror the shared contracts
// PR (D4.5, src/lib/contracts/estimate.ts) so the eventual mapping is
// mechanical; this module stays zod-free until that PR merges because zod
// is not (yet) a direct dependency on main.
//
// SURCHARGE RULE (spec D6): surcharges are deliberately NOT representable
// here — they render inside step instructions (see surcharges.ts and the
// step feeNotes). A tier-1 fee is a flat published fee with its source.
//
// Every tier constructor refuses dishonest input and collects ALL
// violations into one EstimatesError (the envelope-builder pattern).

/** Tier 1 — a published fee, verbatim. `amountText` is the rendered amount. */
export interface FeeEstimate {
  tier: 1;
  label: string;
  amountText: string;
  /** The parsed price when it is positive; a $0 fee stays text-only. */
  amountValue?: number;
  currency: string;
  sourceCitation: string;
  sourceUrl: string;
  /** Capture date, ISO yyyy-mm-dd — the as-of the D6 check requires. */
  capturedAt: string;
}

/** Tier 2 — a timeline; `dataset` and `query` are the provenance. */
export interface TimelineEstimate {
  tier: 2;
  label: string;
  durationText: string;
  dataset: string;
  query: string;
  sourceUrl?: string;
}

/** Tier 3 — a labeled heuristic; `basis` states why it is only a range. */
export interface HeuristicEstimate {
  tier: 3;
  label: string;
  rangeText: string;
  basis: string;
}

export type EstimateTier = FeeEstimate | TimelineEstimate | HeuristicEstimate;

export interface EstimateBlock {
  serviceId: string;
  /** Ordered tiers; a service may carry any subset (no data = honest gap). */
  tiers: EstimateTier[];
}

/** Construction refused — the message names every violated honesty rule. */
export class EstimatesError extends Error {
  constructor(readonly violations: string[]) {
    super(`estimate build rejected (${violations.length} violation(s)):\n  - ${violations.join("\n  - ")}`);
    this.name = "EstimatesError";
  }
}

/** ISO yyyy-mm-dd date shape shared by every as-of field. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
