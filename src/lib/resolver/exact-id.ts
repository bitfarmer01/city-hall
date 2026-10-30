// Layer 1 — exact identifier hit. Handles inputs that already ARE an
// identifier: a catalog service ID (`svc:{agency}:{slug}`) or an NYC311
// article ID (`KA-#####` / `nyc311-KA-#####` — locked decision #1 keeps the
// article ID alongside the catalog ID). Matching runs on the raw input,
// case-insensitively: an ID typed verbatim needs no canonicalization, and
// canonicalization strips the very punctuation that makes it an ID.

export interface ExactIdIndex {
  /** catalog ID → service position (for ordered, deduped output). */
  byCatalogId: Map<string, string>;
  /** article ID (`nyc311-KA-#####`) → catalog ID. */
  byArticleId: Map<string, string>;
}

const SERVICE_ID_RE = /svc:[a-z0-9-]+:[a-z0-9-]+/i;
const ARTICLE_ID_RE = /\b(?:nyc311-)?ka-?(\d{5})\b/i;

/**
 * Return the resolved service IDs when the input is itself an identifier,
 * or null when the input is not an identifier shape. The first matching
 * identifier wins: a pasted `svc:` ID beats an embedded KA number.
 */
export function matchExactId(raw: string, index: ExactIdIndex): string[] | null {
  const serviceMatch = SERVICE_ID_RE.exec(raw);
  if (serviceMatch) {
    const id = serviceMatch[0].toLowerCase();
    const catalogId = index.byCatalogId.get(id);
    if (catalogId) {
      return [catalogId];
    }
    // An unknown service ID falls through to the later layers — the input
    // may still be resolvable by other means (e.g. "svc:311:noise-from-neighbor extra words").
    // No match here only means "this exact ID is not in the catalog".
  }

  const articleMatch = ARTICLE_ID_RE.exec(raw);
  if (articleMatch) {
    const catalogId = index.byArticleId.get(`nyc311-KA-${articleMatch[1]}`);
    if (catalogId) {
      return [catalogId];
    }
  }

  return null;
}
