// Retrieval tests: vectorizer determinism, the cosine floor, the
// shared-vocabulary overlap gate (the false-positive regression), domain
// filtering, and deterministic ordering.

import { describe, expect, it } from "vitest";

import { loadCatalogBundle } from "./catalog-source";
import { canonicalize } from "./canonicalize";
import {
  buildDocumentVectors,
  cosine,
  exactNearestNeighbors,
  EMBEDDING_DIMS,
  RETRIEVAL_MIN_COSINE,
  vectorizeTokens,
} from "./retrieval";

const bundle = loadCatalogBundle();
const docs = buildDocumentVectors(bundle.services);

describe("vectorizeTokens", () => {
  it("is deterministic — same tokens, same vector", () => {
    const a = vectorizeTokens(["dog", "license"]);
    const b = vectorizeTokens(["dog", "license"]);
    expect(a).toEqual(b);
  });

  it("produces L2-normalized vectors", () => {
    const vector = vectorizeTokens(["dog", "license", "renewal"]);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it("has the pinned dimensionality", () => {
    expect(vectorizeTokens(["dog"])).toHaveLength(EMBEDDING_DIMS);
  });

  it("maps the zero case to the zero vector", () => {
    expect(vectorizeTokens([]).every((value) => value === 0)).toBe(true);
  });
});

describe("cosine", () => {
  it("is 1 for identical vectors and 0 for disjoint buckets", () => {
    const a = vectorizeTokens(["dog"]);
    expect(cosine(a, a)).toBeCloseTo(1, 10);
    // Both all-zero vectors → dot 0.
    expect(cosine(vectorizeTokens([]), vectorizeTokens([]))).toBe(0);
  });
});

describe("buildDocumentVectors", () => {
  it("orders documents by service ID", () => {
    const ids = docs.map((d) => d.serviceId);
    expect([...ids].sort()).toEqual(ids);
  });

  it("carries the domain tag and the doc token set", () => {
    const dog = docs.find((d) => d.serviceId === "svc:dohmh:dog-license");
    expect(dog?.domain).toBe("licensing");
    expect(dog?.tokens.has("dog")).toBe(true);
    expect(dog?.tokens.has("license")).toBe(true);
  });
});

describe("exactNearestNeighbors", () => {
  it("ranks a true match first with high similarity", () => {
    const tokens = canonicalize("dog license").tokens;
    const hits = exactNearestNeighbors(tokens, docs, { k: 3 });
    expect(hits[0]?.serviceId).toBe("svc:dohmh:dog-license");
    expect(hits[0]!.similarity).toBeGreaterThan(0.7);
  });

  it("rejects hash-collision-only queries — no shared vocabulary, no hit", () => {
    // Regression: "meaning of life" cleared the cosine floor purely by
    // bucket collisions (measured 0.31–0.38) and resolved to real services.
    const tokens = canonicalize("what is the meaning of life").tokens;
    expect(exactNearestNeighbors(tokens, docs, { k: 5 })).toEqual([]);
  });

  it("still surfaces weak-but-anchored matches", () => {
    // Low cosine but shares real tokens with the water-tap document.
    const tokens = canonicalize("I want to tap into the city water main").tokens;
    const hits = exactNearestNeighbors(tokens, docs, { k: 3 });
    expect(hits[0]?.serviceId).toBe("svc:dep:water-tap-permit");
  });

  it("honors a stricter minimum cosine when asked", () => {
    const tokens = canonicalize("dog license").tokens;
    const hits = exactNearestNeighbors(tokens, docs, { k: 3, minCosine: 0.99 });
    expect(hits).toEqual([]);
  });

  it("filters by domain when given one", () => {
    const tokens = canonicalize("dog license").tokens;
    const hits = exactNearestNeighbors(tokens, docs, { k: 10, domain: "permits" });
    expect(hits.every((hit) => hit.domain === "permits")).toBe(true);
  });

  it("orders by similarity desc then service ID asc", () => {
    const tokens = canonicalize("license").tokens;
    const hits = exactNearestNeighbors(tokens, docs, { k: 10 });
    for (let i = 1; i < hits.length; i += 1) {
      const prev = hits[i - 1]!;
      const current = hits[i]!;
      expect(prev.similarity).toBeGreaterThanOrEqual(current.similarity);
      if (prev.similarity === current.similarity) {
        expect(prev.serviceId < current.serviceId).toBe(true);
      }
    }
  });

  it("returns no hits for empty queries", () => {
    expect(exactNearestNeighbors([], docs, { k: 5 })).toEqual([]);
  });
});

describe("RETRIEVAL_MIN_COSINE", () => {
  it("is pinned in (0, 1]", () => {
    expect(RETRIEVAL_MIN_COSINE).toBeGreaterThan(0);
    expect(RETRIEVAL_MIN_COSINE).toBeLessThanOrEqual(1);
  });
});
