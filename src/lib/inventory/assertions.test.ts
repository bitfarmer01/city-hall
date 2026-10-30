import { describe, expect, it } from "vitest";

import {
  assertArticlePageHasContent,
  assertIndexStructure,
  assertSearchTotal,
  isWithinTolerance,
  parseSearchTotal,
  sampleIndices,
  StructureAssertionError,
} from "./assertions";
import { parseIndexPage } from "./parse-index";
import {
  ARTICLE_DEAD_KA_01044_FIXTURE,
  ARTICLE_KA_01808_FIXTURE,
  INDEX_FIXTURE,
  readFixture,
  SEARCH_PERMIT_FIXTURE,
} from "./read-fixture";

const fixtureEntries = () => parseIndexPage(readFixture(INDEX_FIXTURE));

describe("assertIndexStructure", () => {
  it("passes the pinned fixture against its own baseline", () => {
    expect(() =>
      assertIndexStructure(fixtureEntries(), { articleCount: 2093, searchTotal: 345 }),
    ).not.toThrow();
  });

  it("passes without a baseline", () => {
    expect(() => assertIndexStructure(fixtureEntries())).not.toThrow();
  });

  it("accepts drift within 5% of baseline", () => {
    // 2050/2093 = 2.05% drift — inside the gate.
    expect(() => assertIndexStructure(fixtureEntries(), { articleCount: 2050 })).not.toThrow();
  });

  it("fails when the count deviates more than 5% from baseline", () => {
    expect(() => assertIndexStructure(fixtureEntries(), { articleCount: 1800 })).toThrow(
      /deviates more than 5% from baseline 1800/,
    );
    expect(() => assertIndexStructure(fixtureEntries(), { articleCount: 2400 })).toThrow(
      StructureAssertionError,
    );
  });

  it("fails on duplicate articles", () => {
    const entries = fixtureEntries();
    const duplicate = { ...entries[0] };
    // Baseline +1 keeps the count gate quiet so the duplicate is what fires.
    expect(() => assertIndexStructure([...entries, duplicate], { articleCount: 2094 })).toThrow(
      /KA-01011: duplicate article/,
    );
  });

  it("fails on empty title or description", () => {
    const emptyTitle = { ...fixtureEntries()[0], title: "" };
    expect(() => assertIndexStructure([emptyTitle])).toThrow(/empty title/);
    const emptyDescription = { ...fixtureEntries()[0], description: "" };
    expect(() => assertIndexStructure([emptyDescription])).toThrow(/empty description/);
  });
});

describe("isWithinTolerance", () => {
  it("bounds drift at ±5%", () => {
    expect(isWithinTolerance(2093, 2093)).toBe(true);
    // 5% of 2093 is 104.65 — 104 off is inside, 105 off is outside.
    expect(isWithinTolerance(1989, 2093)).toBe(true);
    expect(isWithinTolerance(1988, 2093)).toBe(false);
    expect(isWithinTolerance(2197, 2093)).toBe(true);
    expect(isWithinTolerance(2198, 2093)).toBe(false);
  });
});

describe("assertArticlePageHasContent", () => {
  it("accepts a live article page carrying ka-content", () => {
    expect(() =>
      assertArticlePageHasContent("KA-01808", readFixture(ARTICLE_KA_01808_FIXTURE)),
    ).not.toThrow();
  });

  it("fails loudly on a dead article page (HTTP 200, no ka-content)", () => {
    expect(() =>
      assertArticlePageHasContent("KA-01044", readFixture(ARTICLE_DEAD_KA_01044_FIXTURE)),
    ).toThrow(/KA-01044: no ka-content div/);
  });
});

describe("search-endpoint cross-check", () => {
  it("parses the exact total from the pinned search fixture", () => {
    expect(parseSearchTotal(readFixture(SEARCH_PERMIT_FIXTURE), "permit")).toBe(345);
  });

  it("throws when the result-count block is gone", () => {
    expect(() => parseSearchTotal("<html>redesigned</html>", "permit")).toThrow(
      StructureAssertionError,
    );
  });

  it("accepts drift within 5% and rejects beyond it", () => {
    expect(() => assertSearchTotal(345, 350)).not.toThrow();
    expect(() => assertSearchTotal(345, 420)).toThrow(/search total 345 deviates/);
  });
});

describe("sampleIndices", () => {
  it("spreads samples first, middle, last", () => {
    expect(sampleIndices(2093, 3)).toEqual([0, 1046, 2092]);
  });

  it("handles degenerate cases", () => {
    expect(sampleIndices(10, 1)).toEqual([0]);
    expect(sampleIndices(10, 0)).toEqual([]);
    expect(sampleIndices(0, 3)).toEqual([]);
    expect(sampleIndices(2, 5)).toEqual([0, 1]);
  });
});
