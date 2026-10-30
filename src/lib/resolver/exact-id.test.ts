// Exact-ID layer tests: catalog IDs and NYC311 KA numbers resolve straight
// to a service; unknown identifiers fall through (null), never guess.

import { describe, expect, it } from "vitest";

import { matchExactId } from "./exact-id";

function indexWith(overrides: Partial<Parameters<typeof matchExactId>[1]> = {}) {
  return {
    byCatalogId: new Map([["svc:dohmh:dog-license", "svc:dohmh:dog-license"]]),
    byArticleId: new Map([["nyc311-KA-01890", "svc:dohmh:dog-license"]]),
    ...overrides,
  };
}

describe("matchExactId", () => {
  it("resolves a bare catalog ID", () => {
    expect(matchExactId("svc:dohmh:dog-license", indexWith())).toEqual(["svc:dohmh:dog-license"]);
  });

  it("resolves a catalog ID with surrounding whitespace and any case", () => {
    expect(matchExactId("  SVC:DOHMH:Dog-License  ", indexWith())).toEqual(["svc:dohmh:dog-license"]);
  });

  it("resolves a bare KA number", () => {
    expect(matchExactId("KA-01890", indexWith())).toEqual(["svc:dohmh:dog-license"]);
  });

  it("resolves a lowercase KA number", () => {
    expect(matchExactId("ka-01890", indexWith())).toEqual(["svc:dohmh:dog-license"]);
  });

  it("resolves the NYC311-prefixed article form", () => {
    expect(matchExactId("nyc311-KA-01890", indexWith())).toEqual(["svc:dohmh:dog-license"]);
  });

  it("extracts a KA number embedded in a sentence", () => {
    expect(matchExactId("how do I do nyc311-KA-01890?", indexWith())).toEqual(["svc:dohmh:dog-license"]);
  });

  it("returns null for unknown catalog IDs", () => {
    expect(matchExactId("svc:nope:missing", indexWith())).toBeNull();
  });

  it("returns null for unknown KA numbers", () => {
    expect(matchExactId("KA-99999", indexWith())).toBeNull();
  });

  it("returns null for plain goal text", () => {
    expect(matchExactId("license my dog", indexWith())).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchExactId("", indexWith())).toBeNull();
  });
});
