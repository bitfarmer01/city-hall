import { describe, expect, it } from "vitest";

import {
  CHECK_A_SAMPLE_SIZE,
  CHECK_A_SEED,
  sampleArticles,
} from "./sample";
import type { IndexArticleEntry, KaNumber } from "../inventory/types";

function entry(ka: KaNumber, index: number): IndexArticleEntry {
  return {
    id: `nyc311-${ka}`,
    ka,
    title: `Article ${index}`,
    description: `Description for article ${index}`,
  };
}

const POPULATION: IndexArticleEntry[] = Array.from({ length: 250 }, (_, i) =>
  entry(`KA-${String(1000 + i * 7).padStart(5, "0")}`, i),
);

describe("sample constants", () => {
  it("pins the committed seed and sample size", () => {
    // data/reports/check-a/sample.json is meaningful only under these exact
    // constants — if either changes, every committed sample must be redrawn
    // and re-reviewed. This test is the tripwire in front of that.
    expect(CHECK_A_SEED).toBe(20261030);
    expect(CHECK_A_SAMPLE_SIZE).toBe(100);
  });
});

describe("sampleArticles", () => {
  it("draws exactly the requested count of unique articles", () => {
    const drawn = sampleArticles(POPULATION, CHECK_A_SEED, CHECK_A_SAMPLE_SIZE);
    expect(drawn).toHaveLength(CHECK_A_SAMPLE_SIZE);
    expect(new Set(drawn.map((a) => a.ka)).size).toBe(CHECK_A_SAMPLE_SIZE);
  });

  it("is deterministic for a fixed seed", () => {
    const first = sampleArticles(POPULATION, CHECK_A_SEED, CHECK_A_SAMPLE_SIZE);
    const second = sampleArticles(POPULATION, CHECK_A_SEED, CHECK_A_SAMPLE_SIZE);
    expect(second).toEqual(first);
  });

  it("returns every article unchanged and in population order", () => {
    const drawn = sampleArticles(POPULATION, CHECK_A_SEED, 10);
    for (const item of drawn) {
      expect(POPULATION).toContainEqual(item);
    }
  });

  it("is a subset draw — the same seed narrows consistently", () => {
    const ten = sampleArticles(POPULATION, CHECK_A_SEED, 10);
    const fifty = sampleArticles(POPULATION, CHECK_A_SEED, 50);
    const tenSet = new Set(ten.map((a) => a.ka));
    const fiftySet = new Set(fifty.map((a) => a.ka));
    for (const ka of tenSet) {
      expect(fiftySet.has(ka)).toBe(true);
    }
  });

  it("throws when the sample size exceeds the population", () => {
    expect(() => sampleArticles(POPULATION, CHECK_A_SEED, POPULATION.length + 1)).toThrow(
      /cannot sample 251 articles from a population of 250/,
    );
  });

  it("throws on a non-positive or non-integer sample size", () => {
    expect(() => sampleArticles(POPULATION, CHECK_A_SEED, 0)).toThrow(/positive integer/);
    expect(() => sampleArticles(POPULATION, CHECK_A_SEED, -5)).toThrow(/positive integer/);
    expect(() => sampleArticles(POPULATION, CHECK_A_SEED, 10.5)).toThrow(/positive integer/);
  });

  it("allows sampling the entire population", () => {
    const drawn = sampleArticles(POPULATION, CHECK_A_SEED, POPULATION.length);
    expect(drawn).toHaveLength(POPULATION.length);
    expect(new Set(drawn.map((a) => a.ka)).size).toBe(POPULATION.length);
  });
});
