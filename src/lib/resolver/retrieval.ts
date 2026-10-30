// Layer 3 — domain-tagged semantic retrieval. Pinned retriever: a
// deterministic feature-hashing vectorizer (EMBEDDING_MODEL_VERSION
// "lexical-hash-v1", EMBEDDING_DIMS 256): token counts hashed into fixed
// buckets, L2-normalized, scored by cosine. It is NOT a neural embedding —
// the embedding-model choice is deliberately deferred (project decision;
// schema.sql note) — but it pins the interface, the pgvector column, and
// the exact-nearest-neighbor semantics NOW, so a model swap later is a
// version bump + reindex, not a redesign.
//
// A hit needs TWO things (retrieval.test.ts pins both):
//   1. cosine >= RETRIEVAL_MIN_COSINE — the vectors are actually close; and
//   2. at least one canonical query token present in the service's own
//      document tokens — the closeness is anchored in shared vocabulary,
//      not a hash-bucket coincidence. Measured on the seeded catalog:
//      unrelated short queries ("meaning of life") score 0.31–0.38 purely
//      from bucket collisions, interleaved with weak true matches, so a
//      cosine-only gate cannot separate them; shared-vocabulary overlap
//      can. (Same spirit as Check B: no claim without evidence.)
//
// Determinism: FNV-1a hashing is integer math; L2 normalization and cosine
// are fixed-order float ops over the same inputs — same bundle, same query,
// same vector, same neighbors, every run.
//
// Every service document carries its coverage-domain tag (locked decision
// #12): the tag rides the vector row (filterable in pgvector) and the doc
// text, which is what makes this layer "domain-tagged retrieval".

import { canonicalize } from "./canonicalize";
import type { ServiceRecord } from "../catalog/types";

export const EMBEDDING_MODEL_VERSION = "lexical-hash-v1";
export const EMBEDDING_DIMS = 256;

/**
 * Cosine below which a retrieval hit is not a hit. Tuned against the
 * golden set + no-match negatives; a paraphrase of the right service
 * clears it comfortably, unrelated text does not (see retrieval.test.ts).
 */
export const RETRIEVAL_MIN_COSINE = 0.3;

/** Deterministic 32-bit FNV-1a over UTF-16 code units. */
function fnv1a(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function vectorizeTokens(tokens: string[]): number[] {
  const vector = new Array<number>(EMBEDDING_DIMS).fill(0);
  for (const token of tokens) {
    vector[fnv1a(token) % EMBEDDING_DIMS] += 1;
  }
  let sumSquares = 0;
  for (const value of vector) {
    sumSquares += value * value;
  }
  if (sumSquares === 0) {
    return vector;
  }
  const norm = Math.sqrt(sumSquares);
  return vector.map((value) => value / norm);
}

/**
 * The retrieval document for a service: name (weighted by repetition),
 * alternate names, description, agency abbreviation, and the domain tag.
 * Weighted name first: the name is the strongest lexical signal.
 */
export function serviceDocument(service: ServiceRecord): string[] {
  const { envelope, meta } = service;
  const agencyToken = meta.catalogId.split(":")[1] ?? "";
  return canonicalize(
    [
      envelope.name,
      envelope.name,
      ...(envelope.alternateName ?? []),
      envelope.description,
      `domain ${meta.domain}`,
      agencyToken,
    ].join(" "),
  ).tokens;
}

export interface DocumentVector {
  serviceId: string;
  domain: string;
  vector: number[];
  /** Canonical doc tokens — the overlap gate's ground truth. */
  tokens: Set<string>;
}

/** Vectors for every service, ordered by service ID (deterministic). */
export function buildDocumentVectors(services: readonly ServiceRecord[]): DocumentVector[] {
  return services
    .map((service) => {
      const tokens = serviceDocument(service);
      return {
        serviceId: service.meta.catalogId,
        domain: service.meta.domain,
        vector: vectorizeTokens(tokens),
        tokens: new Set(tokens),
      };
    })
    .sort((a, b) => (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0));
}

/** Cosine similarity of two L2-normalized vectors (dot product). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

export interface RetrievalHit {
  serviceId: string;
  domain: string;
  similarity: number;
}

/**
 * Exact nearest neighbors (no ANN index — perfect recall, per the pinned
 * research on pgvector): a candidate must clear the cosine floor AND share
 * at least one canonical token with the query (see header). Order by
 * similarity desc then service ID asc, take k.
 */
export function exactNearestNeighbors(
  queryTokens: string[],
  documents: readonly DocumentVector[],
  options: { k?: number; minCosine?: number; domain?: string } = {},
): RetrievalHit[] {
  const k = options.k ?? 5;
  const minCosine = options.minCosine ?? RETRIEVAL_MIN_COSINE;
  const queryVector = vectorizeTokens(queryTokens);
  const queryTokenSet = new Set(queryTokens);

  const hits: RetrievalHit[] = [];
  for (const doc of documents) {
    if (options.domain && doc.domain !== options.domain) {
      continue;
    }
    const similarity = cosine(queryVector, doc.vector);
    if (similarity < minCosine) {
      continue;
    }
    const sharesToken = [...queryTokenSet].some((token) => doc.tokens.has(token));
    if (sharesToken) {
      hits.push({ serviceId: doc.serviceId, domain: doc.domain, similarity });
    }
  }
  hits.sort((a, b) =>
    b.similarity !== a.similarity ? b.similarity - a.similarity : a.serviceId < b.serviceId ? -1 : 1,
  );
  return hits.slice(0, k);
}
