// The five-layer pipeline (spec D5, art_RVpFZFo1). Layers run in order:
//
//   1. exact-id            — the input already IS an identifier
//   2. alias-rules         — curated alias table, then versioned rules
//   3. semantic-retrieval  — pinned vectorizer, exact nearest neighbors
//   4. search-fallback     — IDF-weighted token overlap
//   5. llm_assist          — injected, validated, logged, NON-authoritative
//
// Determinism: layers 1–4 are pure functions of (input, bundle, ruleset,
// retriever); the same pinned versions plus the same input always yield the
// same output. The fallback fires ONLY on an empty deterministic result,
// can only RETURN validated IDs, and structurally cannot touch a
// deterministic resolution — the isolation test pins this.

import type { CatalogBundle } from "../catalog/types";
import { canonicalize } from "./canonicalize";
import { buildAliasIndex, lookupAlias } from "./aliases";
import { matchExactId } from "./exact-id";
import { CROSSWALK_RULES_VERSION, matchRules } from "./rules";
import {
  EMBEDDING_MODEL_VERSION,
  buildDocumentVectors,
  exactNearestNeighbors,
  type DocumentVector,
} from "./retrieval";
import { buildSearchIndex, searchCatalog, type SearchIndex } from "./search";
import { InMemoryLlmAssistSink, runLlmAssist, type LlmAssistSink } from "./llm-assist";
import type { GoalResolution, LlmAssistFn, LlmAssistLogEntry, VersionStamps } from "./types";

export interface ResolverOptions {
  /**
   * The injected llm_assist fallback. Absent → a deterministic no-match
   * stands as the answer (the honest default: no model, no pretense).
   */
  llmAssist?: LlmAssistFn;
  /** Where llm_assist attempts are logged. Default: in-memory. */
  llmSink?: LlmAssistSink;
  /** Retrieval/search result size. Default 5. */
  maxResults?: number;
}

export interface Resolver {
  /** Resolve a goal utterance to ordered service IDs. */
  resolve(raw: string): Promise<GoalResolution>;
  /** The version stamps every resolution carries. */
  versions: VersionStamps;
  /** llm_assist attempt log — snapshot from the in-memory sink (empty for a custom sink). */
  llmLog(): readonly LlmAssistLogEntry[];
  /** The sink, for callers that persist log entries onward. */
  llmSink: LlmAssistSink;
}

/**
 * Build a resolver over a catalog bundle. All indexes are derived once,
 * deterministically, from the bundle.
 */
export function createResolver(bundle: CatalogBundle, options: ResolverOptions = {}): Resolver {
  const knownServiceIds = new Set(bundle.services.map((s) => s.meta.catalogId));
  const aliasIndex = buildAliasIndex(bundle);
  const documents: DocumentVector[] = buildDocumentVectors(bundle.services);
  const searchIndex: SearchIndex = buildSearchIndex(bundle.services);
  const maxResults = options.maxResults ?? 5;

  const versions: VersionStamps = {
    catalogVersion: bundle.catalogVersion,
    crosswalkVersion: CROSSWALK_RULES_VERSION,
    embeddingModelVersion: EMBEDDING_MODEL_VERSION,
  };

  const sink = options.llmSink ?? new InMemoryLlmAssistSink();
  const inMemorySink = sink instanceof InMemoryLlmAssistSink ? sink : null;

  const resolution = (serviceIds: string[], resolutionLayer: GoalResolution["resolutionLayer"]): GoalResolution => ({
    serviceIds,
    resolutionLayer,
    versions,
  });

  async function resolve(raw: string): Promise<GoalResolution> {
    const input = raw.trim();
    const canonical = canonicalize(input);

    // Layer 1 — the input is itself an identifier.
    const exact = matchExactId(input, {
      byCatalogId: new Map([...knownServiceIds].map((id) => [id, id])),
      byArticleId: new Map(bundle.services.map((s) => [s.meta.nyc311ArticleId, s.meta.catalogId])),
    });
    if (exact) {
      return resolution(exact, "exact-id");
    }

    // Layer 2a — curated alias table (crosswalk utterances, then names).
    const alias = lookupAlias(canonical.tokens, aliasIndex);
    if (alias) {
      return resolution(alias.serviceIds, "alias-rules");
    }

    // Layer 2b — declarative rules, specificity-ordered.
    const rules = matchRules(canonical.text);
    if (rules) {
      return resolution(rules, "alias-rules");
    }

    // Layer 3 — domain-tagged retrieval, exact NN over the pinned vectors.
    const retrievalHits = exactNearestNeighbors(canonical.tokens, documents, { k: maxResults });
    if (retrievalHits.length > 0) {
      return resolution(retrievalHits.map((hit) => hit.serviceId), "semantic-retrieval");
    }

    // Layer 4 — deterministic search fallback.
    const searchHits = searchCatalog(canonical.tokens, searchIndex, { k: maxResults });
    if (searchHits.length > 0) {
      return resolution(searchHits.map((hit) => hit.serviceId), "search-fallback");
    }

    // Layer 5 — only with an injected fallback; never on the deterministic path.
    if (options.llmAssist) {
      const outcome = await runLlmAssist(
        options.llmAssist,
        { utterance: input, canonicalText: canonical.text, tokens: canonical.tokens, candidateServiceIds: [...knownServiceIds] },
        knownServiceIds,
        sink,
      );
      return resolution(outcome.serviceIds, "llm_assist");
    }

    return resolution([], "search-fallback");
  }

  return {
    resolve,
    versions,
    llmLog: () => (inMemorySink ? inMemorySink.all() : []),
    llmSink: sink,
  };
}
