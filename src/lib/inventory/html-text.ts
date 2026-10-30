const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

const ENTITY_PATTERN = /&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-z]+));/g;

/**
 * Decode the HTML entities the index uses in titles and descriptions.
 * Unknown entities are left verbatim — silently dropping them would corrupt
 * titles. Single pass, so "&amp;#39;" decodes to the literal "&#39;".
 */
export function decodeHtmlEntities(input: string): string {
  return input.replace(ENTITY_PATTERN, (match, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (hex !== undefined) {
      return safeCodePoint(Number.parseInt(hex, 16)) ?? match;
    }
    if (dec !== undefined) {
      return safeCodePoint(Number.parseInt(dec, 10)) ?? match;
    }
    return NAMED_ENTITIES[name ?? ""] ?? match;
  });
}

function safeCodePoint(code: number): string | null {
  if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) {
    return null;
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    // Lone surrogates are not representable — keep the entity verbatim.
    return null;
  }
}

/** Collapse whitespace runs (the index serves \r\n soup) to single spaces. */
export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
