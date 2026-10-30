// Layer 4 — deterministic text-search fallback. IDF-weighted token overlap
// over the SAME stemmed/synonym-expanded tokens the vectorizer consumes —
// a plain lexical match for inputs the hashed vectors under-rank. The
// distinction from layer 3 is mechanical, not magical: retrieval scores
// hashed bags (the pgvector path), search scores exact token presence.
// When a neural embedder lands, retrieval generalizes beyond literal
// tokens while search keeps literal matching as the floor.

import { canonicalize } from "./canonicalize";
import type { ServiceRecord } from "../catalog/types";

/**
 * Share of the query's IDF mass a document must cover to count as a
 * search hit. Tuned against the golden set + no-match negatives.
 */
export const SEARCH_MIN_SCORE = 0.34;

export interface SearchDocument {
  serviceId: string;
  domain: string;
  tokens: Set<string>;
}

export type SearchIndex = SearchDocument[];

export function buildSearchIndex(services: readonly ServiceRecord[]): SearchIndex {
  return services
    .map((service) => ({
      serviceId: service.meta.catalogId,
      domain: service.meta.domain,
      tokens: new Set(
        canonicalize(
          [
            service.envelope.name,
            ...(service.envelope.alternateName ?? []),
            service.envelope.description,
            `domain ${service.meta.domain}`,
          ].join(" "),
        ).tokens,
      ),
    }))
    .sort((a, b) => (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0));
}

export interface SearchHit {
  serviceId: string;
  domain: string;
  /** Fraction of the query's IDF mass this document covers. */
  score: number;
}

/**
 * Score every document by the share of the query's IDF mass its tokens
 * cover; return hits ordered score desc, then service ID asc.
 */
export function searchCatalog(
  queryTokens: string[],
  index: SearchIndex,
  options: { k?: number; minScore?: number } = {},
): SearchHit[] {
  const k = options.k ?? 5;
  const minScore = options.minScore ?? SEARCH_MIN_SCORE;
  if (queryTokens.length === 0) {
    return [];
  }

  // Corpus-wide document frequency over the index's token sets.
  const df = new Map<string, number>();
  for (const doc of index) {
    for (const token of doc.tokens) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  // Corpus-absent tokens (df = 0) carry no idf mass: no document can ever
  // cover them, and an unbounded weight — log(N/0 + 1) = Infinity — would
  // zero every coverage share, letting one junk token no-match an
  // otherwise-resolvable query (S4 finding F2/H3). Weight 0 keeps the
  // scores identical to the same query without the junk token.
  const idf = (token: string): number => {
    const documentFrequency = df.get(token) ?? 0;
    return documentFrequency === 0 ? 0 : Math.log(index.length / documentFrequency + 1);
  };

  const queryWeights = new Map<string, number>();
  let totalWeight = 0;
  for (const token of queryTokens) {
    const weight = idf(token);
    queryWeights.set(token, weight);
    totalWeight += weight;
  }

  const hits: SearchHit[] = [];
  if (totalWeight > 0) {
    for (const doc of index) {
      let covered = 0;
      for (const [token, weight] of queryWeights) {
        if (doc.tokens.has(token)) {
          covered += weight;
        }
      }
      const score = covered / totalWeight;
      if (score >= minScore) {
        hits.push({ serviceId: doc.serviceId, domain: doc.domain, score });
      }
    }
    hits.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.serviceId < b.serviceId ? -1 : 1,
    );
  }

  return hits.slice(0, k);
}
