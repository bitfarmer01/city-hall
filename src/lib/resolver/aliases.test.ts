// Alias-table tests over the real committed bundle: token-key matching,
// filler immunity, source priority, and multi-service ordering.

import { describe, expect, it } from "vitest";

import { loadCatalogBundle } from "./catalog-source";
import { buildAliasIndex, lookupAlias } from "./aliases";
import { canonicalize } from "./canonicalize";

const bundle = loadCatalogBundle();

describe("buildAliasIndex", () => {
  it("indexes crosswalk utterances with their ordered service IDs", () => {
    const index = buildAliasIndex(bundle);
    const entry = lookupAlias(canonicalize("renovate my apartment").tokens, index);
    expect(entry?.source).toBe("crosswalk-utterance");
    expect(entry?.serviceIds).toEqual([
      "svc:dcwp:home-improvement-contractor-license",
      "svc:buildings:building-construction-alteration-permit",
    ]);
  });

  it("indexes service names as single-service entries", () => {
    const index = buildAliasIndex(bundle);
    const entry = lookupAlias(canonicalize("dog license").tokens, index);
    expect(entry?.serviceIds).toEqual(["svc:dohmh:dog-license"]);
  });

  it("gives crosswalk utterances priority over service names", () => {
    // "open a restaurant" is both a crosswalk utterance and a subset of the
    // food service's description; the crosswalk entry must win.
    const index = buildAliasIndex(bundle);
    const entry = lookupAlias(canonicalize("open a restaurant").tokens, index);
    expect(entry?.source).toBe("crosswalk-utterance");
  });
});

describe("lookupAlias", () => {
  const index = buildAliasIndex(bundle);

  it("matches through filler words the utterance does not carry", () => {
    // The utterance is "hic license"; the query carries polite wrapper.
    expect(lookupAlias(canonicalize("I want to get a HIC license").tokens, index)?.serviceIds).toEqual([
      "svc:dcwp:home-improvement-contractor-license",
    ]);
  });

  it("matches paraphrases that canonicalize identically", () => {
    expect(lookupAlias(canonicalize("I want to license my dog").tokens, index)?.serviceIds).toEqual([
      "svc:dohmh:dog-license",
    ]);
  });

  it("returns null for phrases that are not aliases", () => {
    expect(lookupAlias(canonicalize("purple elephant").tokens, index)).toBeNull();
  });

  it("returns null for empty token lists", () => {
    expect(lookupAlias([], index)).toBeNull();
  });

  it("is deterministic — same key, same entry, every call", () => {
    const tokens = canonicalize("noise from neighbor").tokens;
    const first = lookupAlias(tokens, index);
    const second = lookupAlias(tokens, index);
    expect(first).toEqual(second);
  });
});
