// Canonicalization unit tests: the layer every other layer consumes, so a
// normalization bug here poisons the whole pipeline.

import { describe, expect, it } from "vitest";

import { canonicalize } from "./canonicalize";

describe("canonicalize", () => {
  it("lowercases, trims, and strips punctuation", () => {
    expect(canonicalize("  Dog License! ").text).toBe("dog license");
  });

  it("splits hyphenated tokens and possessives", () => {
    expect(canonicalize("dog-license").tokens).toEqual(["dog", "license"]);
    expect(canonicalize("my building's elevator").tokens).toEqual(["building", "elevator"]);
  });

  it("maps ampersands to 'and' then drops the stopword", () => {
    expect(canonicalize("elevator & escalator inspection").tokens).toEqual([
      "elevator",
      "escalator",
      "inspection",
    ]);
  });

  it("collapses whitespace and strips punctuation inside tokens", () => {
    expect(canonicalize("noise   from    neighbor!!!").tokens).toEqual(["noise", "from", "neighbor"]);
  });

  it("applies plural stemming", () => {
    expect(canonicalize("renew the dog licenses").tokens).toEqual(["renew", "dog", "license"]);
  });

  it("preserves words ending in double-s", () => {
    expect(canonicalize("process the application").tokens).toEqual(["process", "application"]);
  });

  it("applies the synonym map", () => {
    expect(canonicalize("canine license").tokens).toEqual(["dog", "license"]);
    expect(canonicalize("a noisy neighbor").tokens).toEqual(["noise", "neighbor"]);
  });

  it("drops filler and question words", () => {
    expect(canonicalize("I want to get a dog license").tokens).toEqual(["dog", "license"]);
    expect(canonicalize("what is the meaning of life").tokens).toEqual(["meaning", "life"]);
  });

  it("returns an empty result for empty and punctuation-only input", () => {
    expect(canonicalize("")).toEqual({ text: "", tokens: [] });
    expect(canonicalize("!?  ")).toEqual({ text: "", tokens: [] });
  });

  it("keeps the text form with stopwords intact (display), tokens without (matching)", () => {
    const result = canonicalize("I need a copy of my birth certificate");
    expect(result.text).toBe("i need a copy of my birth certificate");
    expect(result.tokens).toEqual(["copy", "birth", "certificate"]);
  });
});
