import type { KaNumber } from "./types";

// The index links every article as ../article/?kanumber=KA-##### — verified
// as the single URL variant across all 2,093 entries (art_TMXzOIRU §2).
const KA_PATTERN = /^KA-\d{5}$/;

export function isKaNumber(raw: string): raw is KaNumber {
  return KA_PATTERN.test(raw);
}

/** Canonical absolute article URL for a KA number. */
export function articleUrlFor(ka: KaNumber): string {
  return `https://portal.311.nyc.gov/article/?kanumber=${ka}`;
}

/** Service ID scheme per locked decision #1: `nyc311-{KA}`. */
export function articleServiceId(ka: KaNumber): string {
  return `nyc311-${ka}`;
}
