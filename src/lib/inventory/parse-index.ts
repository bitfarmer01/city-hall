import { collapseWhitespace, decodeHtmlEntities } from "./html-text";
import { articleServiceId } from "./ka";
import type { IndexArticleEntry, KaNumber } from "./types";

// The whole enumeration lives in one unpaginated page containing a single
// <ul class="all-az-kas"> whose <li> entries are:
//   <a href="../article/?kanumber=KA-#####">{title}</a><br><span>{description}</span>
// A portal redesign must fail loudly here rather than parse partially
// (build spec D2; structure verified in art_TMXzOIRU §2–§3).

const ALL_AZ_LIST_PATTERN = /<ul class="all-az-kas">([\s\S]*?)<\/ul>/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const ENTRY_PATTERN =
  /^\s*<a href="([^"]+)">\s*([^<]*?)\s*<\/a>\s*<br>\s*<span>([^<]*)<\/span>\s*<\/li>/;
// href forms accepted and canonicalized (the relative form is the verified
// single variant — art_TMXzOIRU §2; the others are defensive).
const HREF_PATTERN =
  /^(?:(?:\.\.|https:\/\/portal\.311\.nyc\.gov)?\/)?article\/\?kanumber=(KA-\d{5})$/;

export class IndexParseError extends Error {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(
      `NYC311 All Articles index does not match the expected structure ` +
        `(${violations.length} violation(s)):\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
    this.name = "IndexParseError";
    this.violations = violations;
  }
}

/**
 * Parse the All Articles index into (KA, title, description) triples,
 * sorted by KA. Throws IndexParseError with every violation listed when the
 * page structure deviates — never returns a partial enumeration.
 */
export function parseIndexPage(html: string): IndexArticleEntry[] {
  const violations: string[] = [];
  const listBlocks = [...html.matchAll(ALL_AZ_LIST_PATTERN)];
  if (listBlocks.length !== 1) {
    throw new IndexParseError([
      `expected exactly one <ul class="all-az-kas"> list, found ${listBlocks.length}`,
    ]);
  }

  const listBody = listBlocks[0][1].replace(HTML_COMMENT, "");
  const items = listBody.split("<li>").slice(1);
  const entriesByKa = new Map<string, IndexArticleEntry>();
  let itemPosition = 0;

  for (const item of items) {
    itemPosition += 1;
    const match = ENTRY_PATTERN.exec(item);
    if (!match) {
      violations.push(
        `entry ${itemPosition}: does not match <a href>…</a><br><span>…</span></li> shape`,
      );
      continue;
    }
    const href = match[1];
    const rawTitle = match[2];
    const rawDescription = match[3];
    const kaMatch = HREF_PATTERN.exec(href);
    if (!kaMatch) {
      violations.push(`entry ${itemPosition}: unrecognized article href "${href}"`);
      continue;
    }
    const ka = kaMatch[1] as KaNumber;
    const title = collapseWhitespace(decodeHtmlEntities(rawTitle));
    const description = collapseWhitespace(decodeHtmlEntities(rawDescription));
    if (!title) {
      violations.push(`entry ${itemPosition} (${ka}): empty title`);
    }
    if (!description) {
      violations.push(`entry ${itemPosition} (${ka}): empty description`);
    }
    if (entriesByKa.has(ka)) {
      violations.push(`entry ${itemPosition}: duplicate article ${ka}`);
      continue;
    }
    entriesByKa.set(ka, { id: articleServiceId(ka), ka, title, description });
  }

  if (items.length === 0) {
    violations.push("the all-az-kas list contains no entries");
  }
  if (violations.length > 0) {
    throw new IndexParseError(violations);
  }

  return [...entriesByKa.values()].sort((a, b) => (a.ka < b.ka ? -1 : a.ka > b.ka ? 1 : 0));
}
