// Deterministic disposition classifier for NYC311 A-to-Z articles — build spec
// D2 (art_RVpFZFo1) and inventory research art_TMXzOIRU §5. Same pinned rules
// version plus the same article always yields the same disposition, so Check A
// resolution is mechanical, never impressionistic.
//
// Two input modes, both deterministic:
//  - Index-only: the (KA, title, description) triple from the inventory
//    snapshot. Description-verb and title-noun signals drive classification.
//  - Page-facts: when the article page has been captured (Check A sampling),
//    the captured signals join the verdict — a missing ka-content div means a
//    dead page, and accordion/portal/form/fee signals are actionability
//    evidence the index cannot show.
//
// Every result records the rule that fired (`ruleId`), a reason code, and the
// first-matched evidence phrase, so a classification report can be audited
// line by line.

import type { IndexArticleEntry, KaNumber } from "./types";

/** Version of these classification rules — bump when a rule changes. */
export const CLASSIFIER_RULES_VERSION = "1.0.0";

/**
 * Disposition of one article. Convention chosen (and documented) per the D2b
 * task: the build spec's nested buckets are flattened to five first-class
 * dispositions — spec `service(container)` → `hub`, spec
 * `out-of-scope(informational)` → `informational`, spec
 * `out-of-scope(unavailable)` → `dead-page`.
 */
export type ArticleDisposition =
  | "service"
  | "informational"
  | "hub"
  | "dead-page"
  | "out-of-scope";

/**
 * Coarse fulfillment shape of a `service` article (spec D2 subtypes minus
 * `container`, which is the `hub` disposition). The firing verb is carried by
 * `evidence`; the subtype is deliberately coarse.
 */
export type ServiceSubtype =
  | "report"
  | "apply"
  | "order"
  | "informational-with-action";

/** Signals extracted from the fetched article page, when captured. */
export interface ArticlePageFacts {
  /** Dead pages return HTTP 200 with no ka-content div (art_TMXzOIRU §2). */
  kaContentPresent: boolean;
  /** Accordion section titles inside the article body. */
  accordionSectionTitles: readonly string[];
  /** At least one outbound link to a transactional portal. */
  hasTransactionalPortalLink: boolean;
  /** At least one outbound link to a PDF form under nyc.gov/assets. */
  hasPdfFormLink: boolean;
  /** A fee subheading or fee text was seen. */
  hasFeeText: boolean;
}

export interface ClassifiableArticle {
  entry: IndexArticleEntry;
  /** Facts from the captured article page; absent in index-only mode. */
  pageFacts?: ArticlePageFacts | null;
}

export interface ArticleClassification {
  id: string;
  ka: KaNumber;
  title: string;
  disposition: ArticleDisposition;
  /** Only when disposition is "service". */
  serviceSubtype?: ServiceSubtype;
  /** Machine-readable reason code, e.g. "emergency-dispatch", "action:report". */
  reason: string;
  /** The rule that fired — the layer Check A reports. */
  ruleId: string;
  /** First-matched text that fired the rule, when one exists. */
  evidence?: string;
  rulesVersion: string;
}

export interface ClassificationResult {
  classification: ArticleClassification;
}

// ---------------------------------------------------------------------------
// Rules, in fixed evaluation order (first match wins).
// ---------------------------------------------------------------------------

/** Articles whose page is a cross-link container, not a single service. */
const CURATED_HUB_KAS: ReadonlySet<string> = new Set(["KA-01026"]);

// Emergency-redirect articles open with the dispatch instruction; the 40
// corpus occurrences all lead with it (verified against the 2026-10-30
// snapshot). Mentions of 911 mid-prose do not fire.
const EMERGENCY_PATTERN = /^Call 911\b/;

// Retired licenses and withdrawn request types: all 15 corpus occurrences
// read "no longer requires/accepts/needed" (verified against the snapshot).
const DISCONTINUED_PATTERN =
  /\bno longer (?:requires?|accepts?|needs?|needed|issued?)\b/i;

// Present-tense sibling of discontinued: the City declines the request class
// outright ("does not accept complaints about...", "does not retrieve...").
const NOT_OFFERED_PATTERN =
  /\bthe city (?:does not|will not) (?:accept|provide|retrieve|offer|handle|take|issue)\b/i;

// Accordion sections that evidence actionability (art_TMXzOIRU §5 rule 2a).
const ACTION_SECTION_PATTERN =
  /\b(?:apply|renew|order|report|request|pay|status|fee)\b/i;

/** Description leads that mark a primarily informational article. */
const INFORMATIONAL_LEAD_PATTERN = /^(?:Learn|Find)\b/;

/** "Get" as a description lead is an obtain-something action, not prose. */
const GET_LEAD_PATTERN = /^Get (?!information\b|more information\b)/;

/** Report-side actions: complaints, compliments, feedback channels. */
const REPORT_FAMILY_PATTERN =
  /\b(?:complaint|compliment|feedback)\b|\breport (?:a|an|the|that|it|missing|damaged|illegal|excessive|unsafe)\b/i;

/** Description leading with the report verb ("Report waste that was not..."). */
const REPORT_LEAD_PATTERN = /^Report\b/;

/** Application-side actions: filings, renewals, payments, participation. */
const APPLY_FAMILY_PATTERN =
  /\b(?:apply|renew|register|registration|application|submit|correct|update|pay|payment|donate|volunteer|give|appeal)\b/i;

/** Obtain-side actions: orders, requests, scheduling, document copies. */
const ORDER_FAMILY_PATTERN =
  /\b(?:order|request|requests|schedule|replace|appointment|reservation|cop(?:y|ies)|pass|card|report)\b/i;

/**
 * Tighter embedded-action scan for Learn/Find leads — verbs only. Nouns like
 * "application"/"registration" are excluded here so "Learn about the 311
 * Application Programming Interface" stays informational.
 */
const EMBEDDED_ACTION_PATTERN =
  /\b(?:complaint|compliment|feedback)\b|\breport (?:a|an|the|that|it|missing|damaged|illegal|excessive|unsafe)\b|\b(?:report|apply|renew|register|submit|correct|update|pay|donate|volunteer|order|request|schedule|replace|file)\b/i;

interface RuleMatch {
  ruleId: string;
  disposition: ArticleDisposition;
  reason: string;
  serviceSubtype?: ServiceSubtype;
  evidence?: string;
}

function matchRule(article: ClassifiableArticle): RuleMatch {
  const { pageFacts } = article;
  const { description } = article.entry;

  // R001 — a captured page without ka-content is a dead page, whatever the
  // index fields say. Dead pages never appear in the index, so this rule only
  // fires in page-facts mode (Check A fetches; the index is the live filter).
  if (pageFacts && !pageFacts.kaContentPresent) {
    return {
      ruleId: "R001-dead-page",
      disposition: "dead-page",
      reason: "ka-content-absent",
    };
  }

  // R002 — emergency dispatch is outside the catalog by design.
  const emergency = EMERGENCY_PATTERN.exec(description);
  if (emergency) {
    return {
      ruleId: "R002-emergency-dispatch",
      disposition: "out-of-scope",
      reason: "emergency-dispatch",
      evidence: emergency[0],
    };
  }

  // R003 — retired licenses and withdrawn request types.
  const discontinued = DISCONTINUED_PATTERN.exec(description);
  if (discontinued) {
    return {
      ruleId: "R003-discontinued",
      disposition: "out-of-scope",
      reason: "discontinued",
      evidence: discontinued[0],
    };
  }

  // R004 — request classes the City declines outright.
  const notOffered = NOT_OFFERED_PATTERN.exec(description);
  if (notOffered) {
    return {
      ruleId: "R004-not-offered",
      disposition: "out-of-scope",
      reason: "not-offered-by-city",
      evidence: notOffered[0],
    };
  }

  // R005 — curated cross-link containers (research-verified hub article).
  if (CURATED_HUB_KAS.has(article.entry.ka)) {
    return {
      ruleId: "R005-curated-hub",
      disposition: "hub",
      reason: "curated-hub-article",
    };
  }

  // R006 — actionability signals make the article a service record.
  const subtype = classifyServiceSubtype(article);
  if (subtype) {
    return {
      ruleId: "R006-service-action",
      disposition: "service",
      reason: subtype.reason,
      serviceSubtype: subtype.name,
      evidence: subtype.evidence,
    };
  }

  // R007 — nothing actionable: pure information.
  return {
    ruleId: "R007-informational-fallback",
    disposition: "informational",
    reason: "no-actionability-signal",
  };
}

interface SubtypeMatch {
  name: ServiceSubtype;
  reason: string;
  evidence?: string;
}

/**
 * Service subtype resolution, in priority order. `null` when no actionability
 * signal exists at all (neither index text nor page facts).
 */
function classifyServiceSubtype(article: ClassifiableArticle): SubtypeMatch | null {
  const { title, description } = article.entry;
  const text = `${title}. ${description}`;
  const pageFacts = article.pageFacts;

  // Informational lead with an embedded action stays a service record (spec
  // subtype "informational-with-action"; e.g. "Learn how to report noise").
  if (INFORMATIONAL_LEAD_PATTERN.test(description)) {
    const pageAction = matchPageAction(pageFacts);
    const verb = firstMatch([EMBEDDED_ACTION_PATTERN], text) ?? pageAction;
    if (verb) {
      return { name: "informational-with-action", reason: "embedded-action", evidence: verb };
    }
    return null;
  }

  const report =
    firstMatch([REPORT_FAMILY_PATTERN], text) ??
    matchLead(REPORT_LEAD_PATTERN, description);
  if (report) {
    return { name: "report", reason: "action:report", evidence: report };
  }

  const apply = firstMatch([APPLY_FAMILY_PATTERN], text);
  if (apply) {
    return { name: "apply", reason: "action:apply", evidence: apply };
  }

  const order = firstMatch([ORDER_FAMILY_PATTERN], text);
  if (order) {
    return { name: "order", reason: "action:order", evidence: order };
  }

  // "Get a free crib", "Get a lawyer referral" — obtain-something leads the
  // corpus treats as fulfillment (231 verified entries), not as prose.
  const get = GET_LEAD_PATTERN.exec(description);
  if (get) {
    return { name: "order", reason: "action:order", evidence: get[0] };
  }

  const pageAction = matchPageAction(pageFacts);
  if (pageAction) {
    // Page evidence without an index-text verb: some application channel.
    return { name: "apply", reason: "action:page-signals", evidence: pageAction };
  }

  return null;
}

/** First page-facts actionability signal, or undefined. */
function matchPageAction(pageFacts: ArticlePageFacts | null | undefined): string | undefined {
  if (!pageFacts) {
    return undefined;
  }
  if (pageFacts.hasTransactionalPortalLink) {
    return "transactional-portal-link";
  }
  if (pageFacts.hasPdfFormLink) {
    return "pdf-form-link";
  }
  if (pageFacts.hasFeeText) {
    return "fee-text";
  }
  return pageFacts.accordionSectionTitles.find((sectionTitle) =>
    ACTION_SECTION_PATTERN.test(sectionTitle),
  );
}

function firstMatch(patterns: readonly RegExp[], text: string): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return match[0];
    }
  }
  return undefined;
}

function matchLead(pattern: RegExp, text: string): string | undefined {
  return pattern.exec(text)?.[0];
}

/** Classify one article into a disposition with its recorded reason. */
export function classifyArticle(article: ClassifiableArticle): ClassificationResult {
  const match = matchRule(article);
  const classification: ArticleClassification = {
    id: article.entry.id,
    ka: article.entry.ka,
    title: article.entry.title,
    disposition: match.disposition,
    reason: match.reason,
    ruleId: match.ruleId,
    rulesVersion: CLASSIFIER_RULES_VERSION,
    ...(match.serviceSubtype ? { serviceSubtype: match.serviceSubtype } : {}),
    ...(match.evidence !== undefined ? { evidence: match.evidence } : {}),
  };
  return { classification };
}
