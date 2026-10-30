// Resolver result types (D5). Mirrors the shared contract layer's
// GoalResolution (src/lib/contracts/resolution.ts on feat/service-contracts,
// PR #7): same layer vocabulary, same field names, so switching to the
// contract imports when that PR merges is mechanical. zod lives with the
// contracts package; the resolver core stays dependency-free.
//
// Determinism contract (spec D5): the same pinned versions plus the same
// input yield the same output — every field below is a pure function of
// (input, catalog, ruleset, retriever). No timestamps, no randomness. The
// llm_assist layer is excluded from that guarantee until its outputs are
// promoted into alias/rules rows by review (locked decision #7).

/** The five layers, in evaluation order (build spec D5). */
export const RESOLUTION_LAYERS = [
  "exact-id",
  "alias-rules",
  "semantic-retrieval",
  "search-fallback",
  "llm_assist",
] as const;

export type ResolutionLayer = (typeof RESOLUTION_LAYERS)[number];

/** Lower rank resolves first. */
export function layerRank(layer: ResolutionLayer): number {
  return RESOLUTION_LAYERS.indexOf(layer);
}

/**
 * The three version stamps every answer carries (spec D5):
 * `catalog_version` (snapshot), `crosswalk_version` (ruleset),
 * `embedding_model_version` (model/retriever).
 */
export interface VersionStamps {
  /** Catalog snapshot version, from the bundle (e.g. "2026-10-30.1"). */
  catalogVersion: string;
  /** Alias/rules ruleset version — seeds and rules ship in the same PR. */
  crosswalkVersion: string;
  /** Pinned retriever version backing the semantic-retrieval layer. */
  embeddingModelVersion: string;
}

export interface GoalResolution {
  /** Ordered resolved service IDs; highest-confidence first. Empty = no-match. */
  serviceIds: string[];
  /**
   * The layer that resolved the goal. For an empty result: the last
   * deterministic layer attempted ("search-fallback"), or "llm_assist"
   * when a configured fallback ran and returned nothing.
   */
  resolutionLayer: ResolutionLayer;
  versions: VersionStamps;
}

// ---------------------------------------------------------------------------
// LLM fallback — the injected, non-authoritative layer
// ---------------------------------------------------------------------------

export interface LlmAssistRequest {
  /** Raw input, verbatim. */
  utterance: string;
  /** Canonicalized text (see canonicalize.ts). */
  canonicalText: string;
  /** Canonical tokens (stopwords dropped, stemmed/synonym-expanded). */
  tokens: string[];
  /**
   * Candidate service IDs the fallback may choose from — every catalog
   * ID. An honest fallback selects among catalog records; it cannot
   * invent services (locked decision #6).
   */
  candidateServiceIds: string[];
}

export interface LlmAssistResult {
  /** Ordered service IDs the fallback proposes. Unknown IDs are dropped. */
  serviceIds: string[];
  note?: string;
}

export type LlmAssistFn = (request: LlmAssistRequest) => Promise<LlmAssistResult | null>;

/**
 * One logged llm_assist attempt. Carries no timestamp — the log must stay
 * comparable across replays; sinks that want wall-clock times add them at
 * their own boundary. `error` is set when the injected fallback threw: the
 * attempt degraded to a logged no-match, visibly, never silently.
 */
export interface LlmAssistLogEntry {
  request: LlmAssistRequest;
  /** Exactly what the model returned ([] when null or thrown). */
  rawServiceIds: string[];
  /** IDs validated against the catalog — all that can reach a result. */
  acceptedServiceIds: string[];
  /** Returned IDs not in the catalog — dropped before a result exists. */
  rejectedServiceIds: string[];
  note?: string;
  error?: string;
}
