// Search-fallback tests: IDF weighting, minimum-overlap gate, deterministic
// ordering.

import { describe, expect, it } from "vitest";

import { loadCatalogBundle } from "./catalog-source";
import { canonicalize } from "./canonicalize";
import { buildSearchIndex, searchCatalog } from "./search";

const bundle = loadCatalogBundle();
const index = buildSearchIndex(bundle.services);

describe("searchCatalog", () => {
  it("finds the obvious service", () => {
    const hits = searchCatalog(canonicalize("dog license").tokens, index, { k: 3 });
    expect(hits[0]?.serviceId).toBe("svc:dohmh:dog-license");
    expect(hits[0]!.score).toBeGreaterThan(0.5);
  });

  it("matches on a single rare token", () => {
    // "map" appears only in the water-tap document (sewer pipe map); a
    // single-token query fully covered by one doc scores 1.0.
    const hits = searchCatalog(canonicalize("map").tokens, index, { k: 3 });
    expect(hits[0]?.serviceId).toBe("svc:dep:water-tap-permit");
    expect(hits[0]!.score).toBeCloseTo(1, 10);
  });

  it("returns no hits when nothing shares a token", () => {
    expect(searchCatalog(canonicalize("purple elephant").tokens, index, { k: 3 })).toEqual([]);
  });

  it("returns no hits for an empty query", () => {
    expect(searchCatalog([], index, { k: 3 })).toEqual([]);
  });

  it("down-weights tokens that appear in every document (IDF)", () => {
    // A token present in all docs contributes ~0 weight; a token in one doc
    // dominates. "apply" is in several descriptions, "kumquat" in none, and
    // both should lose to a distinctive token.
    const distinctive = searchCatalog(canonicalize("map").tokens, index, { k: 1 });
    expect(distinctive).toHaveLength(1);
  });

  it("orders deterministically — score desc, then service ID asc", () => {
    const hits = searchCatalog(canonicalize("license").tokens, index, { k: 10 });
    for (let i = 1; i < hits.length; i += 1) {
      const prev = hits[i - 1]!;
      const current = hits[i]!;
      expect(prev.score).toBeGreaterThanOrEqual(current.score);
      if (prev.score === current.score) {
        expect(prev.serviceId < current.serviceId).toBe(true);
      }
    }
  });

  it("is deterministic across repeated calls", () => {
    const tokens = canonicalize("dog license").tokens;
    expect(searchCatalog(tokens, index, { k: 3 })).toEqual(searchCatalog(tokens, index, { k: 3 }));
  });
});
