// GoalResolution — what the resolver returns for one goal utterance
// (deliverable 1, spec D5). The layer that fired is part of the result;
// the same pinned versions plus the same input must always yield the same
// output, so no timestamp lives here.

import { z } from "zod";

import { ServiceIdSchema, VersionStampsSchema } from "./primitives";

/**
 * The layer that fired, per spec D5's five-layer resolver. Task vocabulary
 * maps to the spec's layers: `exact-id` = canonicalized ID hit;
 * `alias-rules` = curated alias table or versioned rules;
 * `semantic-retrieval` = pgvector exact nearest-neighbor;
 * `search-fallback` = deterministic text-search fallback;
 * `llm_assist` = the spec's logged, non-authoritative LLM layer — excluded
 * from the determinism guarantee until promoted into alias/rules rows.
 */
export const RESOLUTION_LAYERS = [
  "exact-id",
  "alias-rules",
  "semantic-retrieval",
  "search-fallback",
  "llm_assist",
] as const;
export const ResolutionLayerSchema = z.enum(RESOLUTION_LAYERS);
export type ResolutionLayer = z.infer<typeof ResolutionLayerSchema>;

export const GoalResolutionSchema = z.strictObject({
  /** Ordered resolved service IDs; highest-confidence first. */
  serviceIds: z.array(ServiceIdSchema),
  /** Empty array is the explicit no-match state (spec D7) — not an error. */
  resolutionLayer: ResolutionLayerSchema,
  versions: VersionStampsSchema,
});
export type GoalResolution = z.infer<typeof GoalResolutionSchema>;
