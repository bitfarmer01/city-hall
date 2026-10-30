// The inventory snapshot is the pinned catalog input: a versioned record of
// every NYC311 A-to-Z article enumerated from the All Articles index. Later
// stages (classifier, crosswalk, Check A sampling) read this record, never
// the live index, so the population is reproducible.

/** Snapshot record format version — bump on breaking shape changes. */
export const SNAPSHOT_SCHEMA_VERSION = "0.1.0";

/** A NYC311 knowledge-article number, e.g. "KA-01808" (zero-padded, 5 digits). */
export type KaNumber = `KA-${string}`;

/** One (KA, title, description) triple from the All Articles index. */
export interface IndexArticleEntry {
  /** Service ID per locked decision #1: `nyc311-{KA}`. */
  id: string;
  ka: KaNumber;
  title: string;
  description: string;
}

/** Independent verification channel recorded alongside the enumeration. */
export interface SearchProbeFacts {
  query: string;
  totalResults: number;
}

/**
 * Versioned inventory snapshot. `sourceSha256` is the hash of the exact HTML
 * bytes the enumeration was parsed from, so any consumer can re-verify the
 * capture against the committed fixture.
 */
export interface InventorySnapshot {
  schemaVersion: string;
  capturedAt: string;
  sourceUrl: string;
  sourceSha256: string;
  articleCount: number;
  /** Sorted by KA ascending — stable across runs, so diffs are line-stable. */
  articles: IndexArticleEntry[];
  verification: {
    searchProbe: SearchProbeFacts;
  };
}
