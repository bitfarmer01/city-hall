// Fixed-seed sampling for Check A (build spec D10, art_RVpFZFo1; harness
// design art_wJiwwN0o §4a): the same seed over the same stored snapshot must
// draw the same 100 articles forever, so runs are comparable over time and a
// committed sample doubles as the CI's expected input. The draw is seeded
// pseudo-random WITHOUT replacement — evenly-spaced sampling was rejected
// because the index sorts alphabetically and periodicity would bias the
// frame (every Nth title). mulberry32 is integer math: deterministic across
// platforms, no float-order caveats.

import type { IndexArticleEntry } from "../inventory/types";

/** The pinned Check A seed — bumping it re-draws the sample and must ship as a reviewed diff. */
export const CHECK_A_SEED = 20261030;

/** Sample size fixed by the build spec's Check A definition. */
export const CHECK_A_SAMPLE_SIZE = 100;

/**
 * mulberry32 — 32-bit seeded PRNG. Seed 0 works (state 0 produces a valid
 * stream after the first multiply); the derivation never returns NaN.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw `count` articles from the snapshot's KA-sorted list, seeded. Throws
 * when count exceeds the population — a silent clamp would quietly shrink
 * the sample and blur the gate's denominator. The input array is not
 * mutated; the drawn subset preserves draw order (irrelevant to results,
 * but deterministic).
 */
export function sampleArticles(
  articles: readonly IndexArticleEntry[],
  seed: number,
  count: number,
): IndexArticleEntry[] {
  // A non-positive count is a misconfiguration, not a valid draw — an empty
  // sample would make the gate vacuous (0/0) instead of loud.
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`sample size must be a positive integer, got ${count}`);
  }
  if (count > articles.length) {
    throw new Error(`cannot sample ${count} articles from a population of ${articles.length}`);
  }
  const rand = mulberry32(seed);
  const pool = [...articles];
  const drawn: IndexArticleEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(rand() * pool.length);
    drawn.push(pool[index]);
    pool.splice(index, 1);
  }
  return drawn;
}
