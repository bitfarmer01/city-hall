// EstimateBlock — the tiered estimate for one service (deliverable 3, spec
// D6). Three tiers, each item explicitly labeled by its tier:
//   tier 1 — fees, verbatim, with source citation + capture date
//   tier 2 — timelines, empirical, with the dataset + query recorded
//   tier 3 — heuristic ranges, labeled as heuristics, with the basis named
//
// SURCHARGE RULE (spec D6): surcharges are deliberately NOT representable in
// this headline block — they render inside StepInstruction.feeNotes. A tier-1
// fee here must be a flat published fee with its source.

import { z } from "zod";

import { ServiceIdSchema } from "./primitives";

/** Tier 1 — a published fee, verbatim. `amountText` is the source's words. */
export const FeeEstimateSchema = z.strictObject({
  tier: z.literal(1),
  label: z.string().min(1),
  amountText: z.string().min(1),
  amountValue: z.number().positive().optional(),
  currency: z.string().length(3),
  sourceCitation: z.string().min(1),
  sourceUrl: z.url(),
  /** Capture date, ISO yyyy-mm-dd — the as-of the D6 check requires. */
  capturedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "capturedAt must be an ISO date (yyyy-mm-dd)"),
});
export type FeeEstimate = z.infer<typeof FeeEstimateSchema>;

/** Tier 2 — an empirical timeline; the dataset and query are the provenance. */
export const TimelineEstimateSchema = z.strictObject({
  tier: z.literal(2),
  label: z.string().min(1),
  durationText: z.string().min(1),
  dataset: z.string().min(1),
  query: z.string().min(1),
  sourceUrl: z.url().optional(),
});
export type TimelineEstimate = z.infer<typeof TimelineEstimateSchema>;

/** Tier 3 — a labeled heuristic; `basis` states why it is only a range. */
export const HeuristicEstimateSchema = z.strictObject({
  tier: z.literal(3),
  label: z.string().min(1),
  rangeText: z.string().min(1),
  basis: z.string().min(1),
});
export type HeuristicEstimate = z.infer<typeof HeuristicEstimateSchema>;

export const EstimateTierSchema = z.discriminatedUnion("tier", [
  FeeEstimateSchema,
  TimelineEstimateSchema,
  HeuristicEstimateSchema,
]);
export type EstimateTier = z.infer<typeof EstimateTierSchema>;

export const EstimateBlockSchema = z.strictObject({
  serviceId: ServiceIdSchema,
  /** Ordered tiers; a service may carry any subset (no data = honest gap). */
  tiers: z.array(EstimateTierSchema),
});
export type EstimateBlock = z.infer<typeof EstimateBlockSchema>;
