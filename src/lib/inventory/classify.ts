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
// Every result records the rule that fired (`ruleId`), a reason code, and
// kinded first-match evidence (quoted index text, a captured page accordion
// title, or a labeled page-signal assertion), so a classification report can
// be audited line by line.

import { tagCoverageDomain, type DomainTag } from "./domain";
import type { IndexArticleEntry, KaNumber } from "./types";

/** Version of these classification rules — bump when a rule changes. */
export const CLASSIFIER_RULES_VERSION = "2.0.0";

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

/**
 * Runtime guard for page facts crossing a JSON boundary (the Check A capture
 * mapper is not built yet — the contract is set blind, so drift arrives as
 * plain objects). Unknown shapes fail loud here, naming the KA (panel H3):
 * a mis-keyed facts object used to read as `kaContentPresent: undefined`,
 * which R001 turned into a verified-dead page.
 */
export function validateArticlePageFacts(ka: KaNumber, value: unknown): ArticlePageFacts {
  const label = `page facts for ${ka}`;
  if (typeof value !== "object" || value === null) {
    throw new Error(`Invalid ${label}: expected an object`);
  }
  const record = value as Record<string, unknown>;
  for (const field of [
    "kaContentPresent",
    "hasTransactionalPortalLink",
    "hasPdfFormLink",
    "hasFeeText",
  ] as const) {
    if (typeof record[field] !== "boolean") {
      throw new Error(`Invalid ${label}: "${field}" must be a boolean`);
    }
  }
  const titles = record.accordionSectionTitles;
  if (!Array.isArray(titles) || titles.some((title) => typeof title !== "string")) {
    throw new Error(
      `Invalid ${label}: "accordionSectionTitles" must be an array of strings`,
    );
  }
  return value as ArticlePageFacts;
}

export interface ClassifiableArticle {
  entry: IndexArticleEntry;
  /** Facts from the captured article page; absent in index-only mode. */
  pageFacts?: ArticlePageFacts | null;
}

/**
 * Provenance of a fired rule's evidence (panel H4). Kinds are machine-
 * distinguishable so an audit never mistakes an assertion for a quote:
 *  - "index-text" — `span` is quoted from the inventory title/description.
 *  - "page-accordion" — `span` is a section title from the captured body.
 *  - "page-signal" — a boolean page fact was true; `span` is that signal's
 *    label ("fee-text"), not a source span (a boolean has none).
 */
export type EvidenceKind = "index-text" | "page-accordion" | "page-signal";

export interface Evidence {
  kind: EvidenceKind;
  span: string;
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
  /** First-matched evidence that fired the rule, when one exists. */
  evidence?: Evidence;
  rulesVersion: string;
}

export interface ClassificationResult {
  classification: ArticleClassification;
  /** Coverage-domain tag (locked decision #12) for the same article. */
  domain: DomainTag;
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
  evidence?: Evidence;
}

function matchRule(article: ClassifiableArticle): RuleMatch {
  const { pageFacts } = article;
  const { description } = article.entry;

  // R001 — a captured page without ka-content is a dead page, whatever the
  // index fields say. Dead pages never appear in the index, so this rule only
  // fires in page-facts mode (Check A fetches; the index is the live filter).
  // Strict `=== false` on purpose (panel H3): a partial facts object is
  // unmeasured, not verified-absent — fail open to the index rules instead of
  // mass dead-paging on shape drift.
  if (pageFacts?.kaContentPresent === false) {
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
      evidence: { kind: "index-text", span: emergency[0] },
    };
  }

  // R003 — retired licenses and withdrawn request types.
  const discontinued = DISCONTINUED_PATTERN.exec(description);
  if (discontinued) {
    return {
      ruleId: "R003-discontinued",
      disposition: "out-of-scope",
      reason: "discontinued",
      evidence: { kind: "index-text", span: discontinued[0] },
    };
  }

  // R004 — request classes the City declines outright.
  const notOffered = NOT_OFFERED_PATTERN.exec(description);
  if (notOffered) {
    return {
      ruleId: "R004-not-offered",
      disposition: "out-of-scope",
      reason: "not-offered-by-city",
      evidence: { kind: "index-text", span: notOffered[0] },
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
  evidence?: Evidence;
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
    const verbSpan = firstMatch([EMBEDDED_ACTION_PATTERN], text);
    const verbEvidence: Evidence | undefined = verbSpan
      ? { kind: "index-text", span: verbSpan }
      : pageAction;
    if (verbEvidence) {
      return {
        name: "informational-with-action",
        reason: "embedded-action",
        evidence: verbEvidence,
      };
    }
    // Title-noun promotion (panel H1): an informational lead hid articles
    // whose titles carry the action keyword in noun form — "Boiler Permits
    // and Registration" behind "Learn about required boiler permits...".
    // Scan the title alone with the family patterns and promote to the
    // matched family's subtype. Titles without a family keyword (the
    // protected "NYC311 Content API" case) stay informational.
    const titleNoun = matchTitleNoun(title);
    if (titleNoun) {
      return { name: titleNoun.name, reason: "action:title-noun", evidence: titleNoun.evidence };
    }
    return null;
  }

  const report =
    firstMatch([REPORT_FAMILY_PATTERN], text) ??
    matchLead(REPORT_LEAD_PATTERN, description);
  if (report) {
    return { name: "report", reason: "action:report", evidence: { kind: "index-text", span: report } };
  }

  const apply = firstMatch([APPLY_FAMILY_PATTERN], text);
  if (apply) {
    return { name: "apply", reason: "action:apply", evidence: { kind: "index-text", span: apply } };
  }

  const order = firstMatch([ORDER_FAMILY_PATTERN], text);
  if (order) {
    return { name: "order", reason: "action:order", evidence: { kind: "index-text", span: order } };
  }

  // "Get a free crib", "Get a lawyer referral" — obtain-something leads the
  // corpus treats as fulfillment, not as prose (208 Get-lead articles reach
  // this branch on the 2026-10-30 snapshot).
  const get = GET_LEAD_PATTERN.exec(description);
  if (get) {
    return { name: "order", reason: "action:order", evidence: { kind: "index-text", span: get[0] } };
  }

  const pageAction = matchPageAction(pageFacts);
  if (pageAction) {
    // Page evidence without an index-text verb: some application channel.
    return { name: "apply", reason: "action:page-signals", evidence: pageAction };
  }

  return null;
}

/**
 * Title-only family scan for the informational-lead branch (panel H1). Same
 * family priority as the main scan (report → apply → order); returns the
 * family's subtype with the matched title span as index-text evidence.
 */
function matchTitleNoun(title: string): { name: ServiceSubtype; evidence: Evidence } | null {
  const report = REPORT_FAMILY_PATTERN.exec(title);
  if (report) {
    return { name: "report", evidence: { kind: "index-text", span: report[0] } };
  }
  const apply = APPLY_FAMILY_PATTERN.exec(title);
  if (apply) {
    return { name: "apply", evidence: { kind: "index-text", span: apply[0] } };
  }
  const order = ORDER_FAMILY_PATTERN.exec(title);
  if (order) {
    return { name: "order", evidence: { kind: "index-text", span: order[0] } };
  }
  return null;
}

/**
 * First page-facts actionability signal, or undefined. Boolean signals carry
 * `page-signal` labels (a boolean has no source span to quote); a matched
 * accordion title is quoted as `page-accordion`. The accordion access is
 * guarded so a partial facts object cannot crash the run (panel H3).
 */
function matchPageAction(pageFacts: ArticlePageFacts | null | undefined): Evidence | undefined {
  if (!pageFacts) {
    return undefined;
  }
  if (pageFacts.hasTransactionalPortalLink) {
    return { kind: "page-signal", span: "transactional-portal-link" };
  }
  if (pageFacts.hasPdfFormLink) {
    return { kind: "page-signal", span: "pdf-form-link" };
  }
  if (pageFacts.hasFeeText) {
    return { kind: "page-signal", span: "fee-text" };
  }
  // Defensive by design: facts crossing the JSON boundary may be partial
  // (classifyArticle itself never throws on them — validateArticlePageFacts
  // is the loud gate for producers).
  const titles: unknown = pageFacts.accordionSectionTitles;
  if (!Array.isArray(titles)) {
    return undefined;
  }
  for (const sectionTitle of titles) {
    if (typeof sectionTitle === "string" && ACTION_SECTION_PATTERN.test(sectionTitle)) {
      return { kind: "page-accordion", span: sectionTitle };
    }
  }
  return undefined;
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

/** Classify one article into a disposition and coverage domain. */
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
  return { classification, domain: tagCoverageDomain(article.entry) };
}
