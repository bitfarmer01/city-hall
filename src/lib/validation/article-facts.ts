// Article-page fact extraction for Check A — the first producer of the
// classifier's ArticlePageFacts (D2b's page-facts mode; build spec D10,
// art_RVpFZFo1). Check A fetches each sampled article live, and these facts
// are what let the classifier see past the index's (KA, title, description)
// triple: dead pages, accordion sections, transactional portals, PDF forms,
// and fee text are visible only on the page itself.
//
// Parsing is regex-based and scoped to the article's own ka-content block —
// never the portal's global header/footer, whose links would fabricate
// actionability signals. Every pattern below is anchored in the verified
// page anatomy (art_TMXzOIRU §2): dead pages return HTTP 200 with no
// ka-content div; accordion sections render as card-header > col-*-11 divs;
// forms live under nyc.gov/assets as PDFs; fees appear as text in the body.

import type { ArticlePageFacts } from "../inventory/classify";
import { collapseWhitespace, decodeHtmlEntities } from "../inventory/html-text";

/** A live article URL, for the report's per-article rows. */
export { articleUrlFor } from "../inventory/ka";

const KA_CONTENT_DIV_PATTERN = /<div\b[^>]*\bclass="[^"]*\bka-content\b[^"]*"[^>]*>/i;
const ANCHOR_HREF_PATTERN = /<a\b[^>]*\bhref="([^"]*)"/gi;
const ACCORDION_TITLE_PATTERN = /<div class="col-md-11[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
const PDF_LINK_PATTERN = /^https?:\/\/[a-z0-9.-]*nyc\.gov\/[^\s"]*\.pdf(?:\?[^\s"]*)?$/i;
const FEE_WORD_PATTERN = /\bfee\b/i;

/**
 * Hosts that are NYC.gov pages but not transactional portals. The ka-content
 * block links these for prose ("read more on nyc.gov"), never as a filing
 * channel; any other nyc.gov-family subdomain (a866-dcwpbp, a858-nycnotify,
 * cityjobs, …) is an agency system a goal can be fulfilled through.
 */
const NON_TRANSACTIONAL_HOSTS: ReadonlySet<string> = new Set([
  "nyc.gov",
  "www.nyc.gov",
  "www1.nyc.gov",
  "portal.311.nyc.gov",
  "api.nyc.gov",
]);

/**
 * Extract the article's ka-content block by tag balancing. The block is the
 * single div whose class carries ka-content; everything the facts extractor
 * reads lives inside it. Returns null when the page has no ka-content div —
 * the dead-page signature. An unbalanced document returns the rest of the
 * page rather than pretending the article is empty.
 */
export function extractKaContentBlock(html: string): string | null {
  const open = KA_CONTENT_DIV_PATTERN.exec(html);
  if (!open) {
    return null;
  }
  const start = open.index;
  const tokenPattern = /<div\b[^>]*>|<\/div>/gi;
  tokenPattern.lastIndex = start + open[0].length;
  let depth = 1; // the ka-content div itself is open
  let token: RegExpExecArray | null;
  while ((token = tokenPattern.exec(html)) !== null) {
    if (token[0].toLowerCase() === "</div>") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, token.index + token[0].length);
      }
    } else {
      depth += 1;
    }
  }
  return html.slice(start);
}

function stripTags(fragment: string): string {
  return collapseWhitespace(decodeHtmlEntities(fragment.replace(/<[^>]*>/g, " ")));
}

function isTransactionalHost(rawHref: string): boolean {
  try {
    const url = new URL(rawHref, "https://portal.311.nyc.gov/");
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false;
    }
    const host = url.hostname.toLowerCase();
    const isNycFamily = host === "nyc.gov" || host.endsWith(".nyc.gov");
    return isNycFamily && !NON_TRANSACTIONAL_HOSTS.has(host);
  } catch {
    return false;
  }
}

const ALL_FACTS_FALSE = {
  accordionSectionTitles: [],
  hasTransactionalPortalLink: false,
  hasPdfFormLink: false,
  hasFeeText: false,
} as const;

/**
 * Extract the classifier's page facts from fetched article HTML. A page with
 * no ka-content div yields `kaContentPresent: false` with every other fact
 * false — the dead-page shape rule R001 consumes.
 */
export function extractArticlePageFacts(html: string): ArticlePageFacts {
  const block = extractKaContentBlock(html);
  if (!block) {
    return { kaContentPresent: false, ...ALL_FACTS_FALSE };
  }

  const accordionSectionTitles: string[] = [];
  for (const match of block.matchAll(ACCORDION_TITLE_PATTERN)) {
    const title = stripTags(match[1]);
    if (title) {
      accordionSectionTitles.push(title);
    }
  }

  let hasTransactionalPortalLink = false;
  let hasPdfFormLink = false;
  for (const match of block.matchAll(ANCHOR_HREF_PATTERN)) {
    const href = match[1].trim();
    if (!hasPdfFormLink && PDF_LINK_PATTERN.test(href)) {
      hasPdfFormLink = true;
    }
    if (!hasTransactionalPortalLink && isTransactionalHost(href)) {
      hasTransactionalPortalLink = true;
    }
    if (hasPdfFormLink && hasTransactionalPortalLink) {
      break;
    }
  }

  return {
    kaContentPresent: true,
    accordionSectionTitles,
    hasTransactionalPortalLink,
    hasPdfFormLink,
    hasFeeText: FEE_WORD_PATTERN.test(stripTags(block)),
  };
}
