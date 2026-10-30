// Canonicalization — the resolver's layer-0 normalization (spec D5's
// canonicalize step). Pure and deterministic: identical bytes in, identical
// output out. Two products, because the layers need different views:
//
//  - `text`  — lowercased, punctuation stripped (colons preserved so a
//    pasted service ID stays greppable), filler words KEPT. The rules layer
//    runs regexes over this string; regex stems like /licens/ need the
//    plain text, and stopword removal could break phrase adjacency.
//  - `tokens` — filler words dropped, light stemming and a small audited
//    synonym map applied. The retrieval/search layers embed these.
//
// The abbreviation and synonym maps are curated, versioned with the
// ruleset (CROSSWALK_RULES_VERSION), and every entry is exercised by a
// unit test here or by a golden case.

const ABBREVIATIONS: Readonly<Record<string, string>> = {
  // The DCWP license's established short name (KA-01808 alternateName
  // "HIC license"); expanded so rules and vectors see the full phrase.
  hic: "home improvement contractor",
};

/** Audited synonyms — one canonical token per family, applied after stemming. */
const SYNONYMS: Readonly<Record<string, string>> = {
  licensing: "license",
  noisy: "noise",
  canine: "dog",
};

// Filler that carries no resolution signal. Audited: dropping any of these
// never flips a golden outcome (golden.test.ts pins the outcome side).
// Question words and the possessive fragment "s" ("building's" splits into
// building + s) are noise in goal utterances.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for",
  "with", "my", "i", "want", "need", "get", "do", "can", "you", "me",
  "is", "are", "it", "be", "how", "what", "when", "where", "which",
  "who", "should", "their", "there", "our", "s",
]);

/** Light stem: strip a trailing plural "s" from tokens longer than 3 chars. */
export function stemToken(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export interface CanonicalInput {
  /** Normalized text — punctuation stripped, case folded, filler KEPT. */
  text: string;
  /** Retrieval tokens — filler dropped, stemmed, synonym-expanded. */
  tokens: string[];
}

export function canonicalize(raw: string): CanonicalInput {
  const folded = raw.toLowerCase().replace(/[^a-z0-9:]+/g, " ").trim();
  if (folded.length === 0) {
    return { text: "", tokens: [] };
  }

  // Abbreviations expand before tokenizing so multi-word expansions tokenize.
  const expanded = folded
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => ABBREVIATIONS[word] ?? word)
    .join(" ");

  const tokens = expanded
    .split(" ")
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
    .map((word) => {
      const stemmed = stemToken(word);
      return SYNONYMS[stemmed] ?? stemmed;
    });

  return { text: expanded, tokens };
}
