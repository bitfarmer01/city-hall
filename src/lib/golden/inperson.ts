/**
 * Pure in-person signal scanner for Check B (art_wJiwwN0o §4b: the golden-diff
 * gate covers "required fields, documents, or in-person steps"). Article pages
 * state in-person requirements in prose — "in-person appointments only for
 * hardship", "must appear in person at a borough office" — so the captured
 * page text is the live evidence, and a live signal the catalog baseline does
 * not claim is a miss.
 *
 * Deliberate trade-off, same shape as boundary.ts: scanning prose is
 * heuristic, so the scanner is conservative in BOTH directions that matter —
 * only clear positive phrases count as signals, and sentence-level negation
 * ("no in-person", "not available in person") suppresses a match. At seed time
 * the baseline is generated from the same scanner, so the seed is consistent
 * by construction; later drift flips exactly one side, which is the diff a
 * human reviews. False positives/negatives cost a review, never a wrong gate.
 */

export interface InPersonSignal {
  /** Normalized signal label recorded in expectations (the matched phrase kind). */
  phrase: string;
  /** The surrounding sentence, for the human reviewing the diff. */
  excerpt: string;
}

/** Sentence-boundary split — prose requirements are sentence-scoped. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

/**
 * Positive in-person phrases. Ordered; the first match in a sentence wins so
 * one sentence yields one signal. Keep this list small and citable — every
 * entry must be a phrase NYC pages actually use (KA-01808 uses the first two).
 */
const POSITIVE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/in-person (?:appointments?|visits?|services?)/i, "in-person appointment"],
  [/(?:appear|apply|file|renew|pick\s*up|request)\s+in\s+person/i, "must act in person"],
  [/\bin\s+person\b\s+(?:at|only|by)\b/i, "in person at/only"],
  [/hardship\s+appointments?/i, "hardship appointment"],
  [/(?:walk[- ]?in|over[- ]the[- ]counter)\s+service/i, "walk-in service"],
  [/visit\s+(?:a|an|the|our)\s+(?:borough\s+)?(?:office|center|facility)/i, "office visit"],
];

/** A sentence carrying any of these is treated as NOT claiming in-person. */
const NEGATION_PATTERNS: readonly RegExp[] = [
  /\bno\s+in[- ]person\b/i,
  /\bnot\s+(?:available|offered|required)\b[^.!?]*\bin[- ]person\b/i,
  /\bin[- ]person\b[^.!?]*\b(?:is\s+not|are\s+not|not)\s+(?:available|offered|required)\b/i,
];

export function scanInPersonSignals(pageText: string): InPersonSignal[] {
  const signals: InPersonSignal[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences(pageText)) {
    if (NEGATION_PATTERNS.some((n) => n.test(sentence))) continue;
    for (const [pattern, phrase] of POSITIVE_PATTERNS) {
      if (pattern.test(sentence)) {
        if (!seen.has(phrase)) {
          seen.add(phrase);
          signals.push({ phrase, excerpt: sentence.slice(0, 300) });
        }
        break;
      }
    }
  }
  return signals;
}

/**
 * Catalog-side claim label for a step: in-person steps enter expectations as
 * their signal label so live and catalog compare in the same vocabulary.
 */
export function normalizeSignalLabel(phrase: string): string {
  return phrase.toLowerCase().replace(/\s+/g, " ").trim();
}
