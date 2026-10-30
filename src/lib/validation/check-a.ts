// Check A — catalog coverage sample harness (build spec D10, art_RVpFZFo1;
// harness design art_wJiwwN0o §4a). The committed script draws a fixed-seed
// 100-article sample from the stored index snapshot, fetches each live page
// (the CLI script's job — this module is pure), classifies each article with
// the deterministic rules, and resolves it through the crosswalk.
//
// Outcome taxonomy (art_wJiwwN0o §4a): every article ends as
//   - `service_record` — classified service, resolved through the crosswalk
//     (matched catalog IDs and the layer that fired are recorded — possibly
//     empty while the catalog is young; the article's own nyc311-KA-#####
//     service entry is the record, per locked decision #1);
//   - `out_of_scope` — the classifier's explicit non-service entry with a
//     machine reason (informational, dead page, emergency, discontinued, hub);
//   - `fail` — no explicit entry was produced: a fetch error, or a machinery
//     breach.
//
// Two distinct failure surfaces, with deliberately different tolerances:
//   - Coverage gate: >=95% of the sample non-fail. Tolerant — the live
//     portal is entitled to a transient hiccup, and 5% is the spec's slack.
//   - Validity: zero breaches. Zero-tolerance — corrupt classifier output,
//     a resolver that misses a cataloged article, or a mass dead-page
//     response (an anti-bot stop condition) fail the check outright.
// A gate that tolerated invalid records would let a broken pipeline ship;
// a validity rule that failed on one dropped packet would fail weekly on
// network noise. Hence the split.
//
// The catalog-coverage GAP (service-classified articles with no cataloged
// record yet) is intentionally a reported measure, not a gate: the seeded
// catalog holds 8 of 1,243 service-classified corpus articles, so gating on
// catalog coverage today would pin CI red until full-catalog milestone
// completion. The per-domain rollup keeps that gap visible per locked
// decision #12; flipping it into a gate is an owner decision once the
// catalog matures.

import type { CatalogBundle } from "../catalog/types";
import { classifyArticle, CLASSIFIER_RULES_VERSION, type ArticleClassification, type ArticleDisposition, type ClassifiableArticle, type ClassificationResult, type ServiceSubtype } from "../inventory/classify";
import { DOMAIN_TAXONOMY_VERSION, tagCoverageDomain, type CoverageDomain } from "../inventory/domain";
import { articleUrlFor } from "../inventory/ka";
import type { InventorySnapshot } from "../inventory/types";
import { RESOLUTION_LAYERS, type ResolutionLayer } from "../resolver/types";
import { createResolver } from "../resolver/resolver";
import { extractArticlePageFacts } from "./article-facts";
import { sampleArticles } from "./sample";

/** Fraction of the sample that may fail and still pass the >=95% gate. */
export const CHECK_A_GATE_THRESHOLD = 0.95;

/**
 * Share of sampled pages without a ka-content div above which the run is
 * treated as an anti-bot/WAF stop condition rather than genuine corpus dead
 * pages (locked decision #10: stop conditions are honored, never retried
 * past). Corpus dead pages exist but are rare; a mass of them means the
 * fetches are not seeing real article pages.
 */
export const DEAD_PAGE_STOP_FRACTION = 0.2;

export type CheckAOutcome = "service_record" | "out_of_scope" | "fail";

/** What a caller supplies per sampled article: fetched HTML or an error. */
export interface PageSource {
  html?: string;
  error?: string;
}

export type CatalogMatch = "self" | "sibling" | "none" | null;

export interface CheckAArticleResult {
  id: string;
  ka: string;
  title: string;
  url: string;
  domain: CoverageDomain;
  domainPatternId: string;
  outcome: CheckAOutcome;
  /** Classification fields — absent when the page never classified. */
  disposition?: ArticleDisposition;
  serviceSubtype?: ServiceSubtype;
  reason?: string;
  ruleId?: string;
  /** Crosswalk fields — populated for service_record outcomes. */
  matchedServiceIds: string[];
  resolutionLayer: ResolutionLayer | null;
  /** self = the article's own cataloged service matched; sibling = another catalog service; none = empty resolution. */
  catalogMatch: CatalogMatch;
  /** Failure diagnostics — why the row is `fail`. */
  problem?: string;
  /** True when this row is a machinery breach (invalid output), not an environmental failure. */
  breach: boolean;
}

/** Per-coverage-domain rollup (locked decision #12) — zeros included, so a gap in any domain is visible. */
export interface CheckADomainRollup {
  domain: CoverageDomain;
  sampled: number;
  serviceRecords: number;
  /** service records whose own cataloged service matched (crosswalk correctness). */
  catalogedSelf: number;
  /** service records that matched a different catalog service. */
  siblingMatch: number;
  /** service records whose crosswalk resolution was empty — the visible catalog gap. */
  noMatch: number;
  outOfScope: number;
  failures: number;
}

export interface CheckASummary {
  total: number;
  serviceRecords: number;
  outOfScope: number;
  failures: number;
  breaches: number;
  deadPages: number;
  resolvedCount: number;
  resolvedFraction: number;
  gateThreshold: number;
  gatePassed: boolean;
  validityPassed: boolean;
  passed: boolean;
}

export interface CheckARun {
  ranAt: string;
  seed: number;
  sampleSize: number;
  snapshot: {
    path: string;
    sha256: string;
    capturedAt: string;
    articleCount: number;
  };
  versions: {
    catalog: string;
    crosswalkRules: string;
    classifierRules: string;
    domainTaxonomy: string;
    embeddingModel: string;
  };
  /** Machinery breaches — empty when validity passed. */
  breaches: string[];
  results: CheckAArticleResult[];
  domains: CheckADomainRollup[];
  summary: CheckASummary;
}

export interface RunCheckAInput {
  snapshotPath: string;
  snapshot: InventorySnapshot;
  bundle: CatalogBundle;
  /** Fetched page source per sampled KA. */
  pages: ReadonlyMap<string, PageSource>;
  seed?: number;
  sampleSize?: number;
  ranAt?: string;
  /** Injection seam for the injected-defect suite; defaults to the real classifier. */
  classify?: (article: ClassifiableArticle) => ClassificationResult;
}

/** The committed sample record — deterministic from (snapshot, seed, size). */
export interface CheckASampleRecord {
  seed: number;
  sampleSize: number;
  snapshotPath: string;
  snapshotSha256: string;
  articles: { id: string; ka: string; title: string }[];
}

export function deriveSampleRecord(
  snapshotPath: string,
  snapshot: InventorySnapshot,
  seed: number,
  sampleSize: number,
): CheckASampleRecord {
  const drawn = sampleArticles(snapshot.articles, seed, sampleSize);
  return {
    seed,
    sampleSize,
    snapshotPath,
    snapshotSha256: snapshot.sourceSha256,
    articles: [...drawn]
      .sort((a, b) => (a.ka < b.ka ? -1 : a.ka > b.ka ? 1 : 0))
      .map((entry) => ({ id: entry.id, ka: entry.ka, title: entry.title })),
  };
}

/**
 * Compare the committed sample record against a fresh derivation. Mismatch
 * means the sample is stale (snapshot refreshed without re-committing) — a
 * validity breach, because runs would silently stop being comparable.
 */
export function diffSampleRecord(committed: CheckASampleRecord, fresh: CheckASampleRecord): string[] {
  const violations: string[] = [];
  if (committed.seed !== fresh.seed) {
    violations.push(`seed drift: committed ${committed.seed}, fresh ${fresh.seed}`);
  }
  if (committed.sampleSize !== fresh.sampleSize) {
    violations.push(`sample size drift: committed ${committed.sampleSize}, fresh ${fresh.sampleSize}`);
  }
  if (committed.snapshotSha256 !== fresh.snapshotSha256) {
    violations.push(
      `snapshot drift: committed ${committed.snapshotSha256.slice(0, 12)}, fresh ${fresh.snapshotSha256.slice(0, 12)} — re-commit the sample`,
    );
  }
  const committedKey = committed.articles.map((a) => `${a.ka}:${a.title}`).join("|");
  const freshKey = fresh.articles.map((a) => `${a.ka}:${a.title}`).join("|");
  if (committedKey !== freshKey) {
    violations.push("committed sample articles differ from a fresh fixed-seed draw — re-commit the sample");
  }
  return violations;
}

const DISPOSITIONS: ReadonlySet<string> = new Set<ArticleDisposition>([
  "service",
  "informational",
  "hub",
  "dead-page",
  "out-of-scope",
]);

const SERVICE_SUBTYPES: ReadonlySet<string> = new Set<ServiceSubtype>([
  "report",
  "apply",
  "order",
  "informational-with-action",
]);

/** Well-formedness of one classification record — the injected-defect tripwire. */
export function validateClassification(classification: ArticleClassification): string[] {
  const violations: string[] = [];
  if (!DISPOSITIONS.has(classification.disposition)) {
    violations.push(`disposition "${String(classification.disposition)}" is not in the enum`);
  }
  if (!classification.reason) {
    violations.push("reason is empty — every disposition carries a machine reason");
  }
  if (!classification.ruleId) {
    violations.push("ruleId is empty — every disposition records the rule that fired");
  }
  if (classification.rulesVersion !== CLASSIFIER_RULES_VERSION) {
    violations.push(
      `rulesVersion ${classification.rulesVersion} does not match the pinned ${CLASSIFIER_RULES_VERSION}`,
    );
  }
  if (classification.disposition === "service") {
    if (!classification.serviceSubtype || !SERVICE_SUBTYPES.has(classification.serviceSubtype)) {
      violations.push(`serviceSubtype "${String(classification.serviceSubtype)}" missing or not in the enum`);
    }
  } else if (classification.serviceSubtype !== undefined) {
    violations.push(`serviceSubtype set on a non-service disposition (${classification.disposition})`);
  }
  if (classification.ka !== classification.id.replace(/^nyc311-/, "")) {
    violations.push(`id ${classification.id} does not carry the KA number ${classification.ka}`);
  }
  return violations;
}

function validateResolution(
  serviceIds: readonly string[],
  layer: ResolutionLayer,
  knownCatalogIds: ReadonlySet<string>,
): string[] {
  const violations: string[] = [];
  if (!RESOLUTION_LAYERS.includes(layer)) {
    violations.push(`resolution layer "${String(layer)}" is not in the layer enum`);
  }
  for (const serviceId of serviceIds) {
    if (!knownCatalogIds.has(serviceId)) {
      violations.push(`resolved service ID ${serviceId} is not in the catalog`);
    }
  }
  return violations;
}

/** Rollup order: the five locked domains, then the catch-all. */
const DOMAIN_ORDER: readonly CoverageDomain[] = [
  "permits",
  "service-requests",
  "public-records",
  "licensing",
  "inspections",
  "other",
];

function emptyRollup(domain: CoverageDomain): CheckADomainRollup {
  return {
    domain,
    sampled: 0,
    serviceRecords: 0,
    catalogedSelf: 0,
    siblingMatch: 0,
    noMatch: 0,
    outOfScope: 0,
    failures: 0,
  };
}

/**
 * Run Check A over the sampled corpus. Pure apart from the resolver's own
 * deterministic derivation over the committed bundle — no network, no
 * filesystem, no wall clock beyond `ranAt`.
 */
export async function runCheckA(input: RunCheckAInput): Promise<CheckARun> {
  const seed = input.seed ?? 20261030;
  const sampleSize = input.sampleSize ?? 100;
  const ranAt = input.ranAt ?? new Date().toISOString();
  const classify = input.classify ?? classifyArticle;

  const resolver = createResolver(input.bundle);
  const knownCatalogIds = new Set(input.bundle.services.map((service) => service.meta.catalogId));
  const catalogedByArticleId = new Map(
    input.bundle.services.map((service) => [service.meta.nyc311ArticleId, service.meta.catalogId]),
  );

  const breaches: string[] = [];
  const results: CheckAArticleResult[] = [];
  const rollups = new Map(DOMAIN_ORDER.map((domain) => [domain, emptyRollup(domain)]));

  const drawn = sampleArticles(input.snapshot.articles, seed, sampleSize);
  let deadPages = 0;

  for (const entry of drawn) {
    const domainTag = tagCoverageDomain(entry);
    const rollup = rollups.get(domainTag.domain) ?? emptyRollup(domainTag.domain);
    rollup.sampled += 1;

    const base = {
      id: entry.id,
      ka: entry.ka,
      title: entry.title,
      url: articleUrlFor(entry.ka),
      domain: domainTag.domain,
      domainPatternId: domainTag.patternId,
    };

    const page = input.pages.get(entry.ka);
    if (!page) {
      rollup.failures += 1;
      results.push({
        ...base,
        outcome: "fail",
        matchedServiceIds: [],
        resolutionLayer: null,
        catalogMatch: null,
        problem: "no page source supplied for sampled article",
        breach: false,
      });
      continue;
    }
    if (page.error !== undefined || page.html === undefined) {
      rollup.failures += 1;
      results.push({
        ...base,
        outcome: "fail",
        matchedServiceIds: [],
        resolutionLayer: null,
        catalogMatch: null,
        problem: page.error ?? "empty page source",
        breach: false,
      });
      continue;
    }

    // Classify — a classifier that throws or emits a malformed record is a
    // machinery breach, counted once per offending article. The extracted
    // page facts ride along: a ka-content-less page is the dead-page
    // signature, and accordion/portal/PDF/fee signals are the actionability
    // evidence the index cannot show.
    let classification: ArticleClassification;
    try {
      ({ classification } = classify({ entry, pageFacts: extractArticlePageFacts(page.html) }));
    } catch (error) {
      breaches.push(`${entry.ka}: classifier threw: ${error instanceof Error ? error.message : String(error)}`);
      rollup.failures += 1;
      results.push({
        ...base,
        outcome: "fail",
        matchedServiceIds: [],
        resolutionLayer: null,
        catalogMatch: null,
        problem: "classifier threw",
        breach: true,
      });
      continue;
    }
    const classificationViolations = validateClassification(classification);
    if (classificationViolations.length > 0) {
      for (const violation of classificationViolations) {
        breaches.push(`${entry.ka}: invalid classifier output — ${violation}`);
      }
      rollup.failures += 1;
      results.push({
        ...base,
        outcome: "fail",
        matchedServiceIds: [],
        resolutionLayer: null,
        catalogMatch: null,
        problem: `invalid classifier output: ${classificationViolations[0]}`,
        breach: true,
      });
      continue;
    }

    if (classification.disposition !== "service") {
      // Explicit out-of-scope entry: disposition + machine reason + rule.
      rollup.outOfScope += 1;
      if (classification.disposition === "dead-page") {
        deadPages += 1;
      }
      results.push({
        ...base,
        outcome: "out_of_scope",
        disposition: classification.disposition,
        reason: classification.reason,
        ruleId: classification.ruleId,
        matchedServiceIds: [],
        resolutionLayer: null,
        catalogMatch: null,
        breach: false,
      });
      continue;
    }

    // Service disposition — resolve the article's title through the crosswalk.
    let resolutionLayer: ResolutionLayer;
    let serviceIds: string[];
    try {
      const resolution = await resolver.resolve(entry.title);
      resolutionLayer = resolution.resolutionLayer;
      serviceIds = resolution.serviceIds;
    } catch (error) {
      breaches.push(`${entry.ka}: crosswalk resolution threw: ${error instanceof Error ? error.message : String(error)}`);
      rollup.failures += 1;
      results.push({
        ...base,
        outcome: "fail",
        disposition: classification.disposition,
        serviceSubtype: classification.serviceSubtype,
        reason: classification.reason,
        ruleId: classification.ruleId,
        matchedServiceIds: [],
        resolutionLayer: null,
        catalogMatch: null,
        problem: "crosswalk resolution threw",
        breach: true,
      });
      continue;
    }

    const resolutionViolations = validateResolution(serviceIds, resolutionLayer, knownCatalogIds);
    const catalogedId = catalogedByArticleId.get(entry.id);
    if (catalogedId !== undefined && !serviceIds.includes(catalogedId)) {
      resolutionViolations.push(
        `resolver missed cataloged article — ${entry.id} maps to ${catalogedId}, title resolved [${resolutionLayer}] [${serviceIds.join(", ")}]`,
      );
    }
    if (resolutionViolations.length > 0) {
      for (const violation of resolutionViolations) {
        breaches.push(`${entry.ka}: invalid crosswalk resolution — ${violation}`);
      }
      rollup.failures += 1;
      results.push({
        ...base,
        outcome: "fail",
        disposition: classification.disposition,
        serviceSubtype: classification.serviceSubtype,
        reason: classification.reason,
        ruleId: classification.ruleId,
        matchedServiceIds: serviceIds,
        resolutionLayer,
        catalogMatch: null,
        problem: `invalid crosswalk resolution: ${resolutionViolations[0]}`,
        breach: true,
      });
      continue;
    }

    const catalogMatch: CatalogMatch =
      catalogedId !== undefined
        ? "self"
        : serviceIds.length > 0
          ? "sibling"
          : "none";
    rollup.serviceRecords += 1;
    if (catalogMatch === "self") {
      rollup.catalogedSelf += 1;
    } else if (catalogMatch === "sibling") {
      rollup.siblingMatch += 1;
    } else {
      rollup.noMatch += 1;
    }
    results.push({
      ...base,
      outcome: "service_record",
      disposition: classification.disposition,
      serviceSubtype: classification.serviceSubtype,
      reason: classification.reason,
      ruleId: classification.ruleId,
      matchedServiceIds: serviceIds,
      resolutionLayer,
      catalogMatch,
      breach: false,
    });
  }

  // Anti-bot stop condition: a mass of ka-content-less pages is not corpus
  // dead pages, it is the portal refusing the fetch. Stop loudly.
  if (drawn.length > 0 && deadPages / drawn.length > DEAD_PAGE_STOP_FRACTION) {
    breaches.push(
      `mass dead pages: ${deadPages}/${drawn.length} sampled pages lack ka-content ` +
        `(> ${DEAD_PAGE_STOP_FRACTION * 100}%) — likely anti-bot interference; honoring the stop condition`,
    );
  }

  // Committed-sample staleness is checked by the caller (it owns the
  // committed file); runCheckA exposes deriveSampleRecord for the diff.

  const sorted = [...results].sort((a, b) => (a.ka < b.ka ? -1 : a.ka > b.ka ? 1 : 0));
  const domains = DOMAIN_ORDER.map((domain) => rollups.get(domain) ?? emptyRollup(domain));
  const serviceRecords = results.filter((r) => r.outcome === "service_record").length;
  const outOfScope = results.filter((r) => r.outcome === "out_of_scope").length;
  const failures = results.filter((r) => r.outcome === "fail").length;
  const resolvedCount = serviceRecords + outOfScope;
  const resolvedFraction = results.length === 0 ? 0 : resolvedCount / results.length;
  const gatePassed = resolvedFraction >= CHECK_A_GATE_THRESHOLD;
  const validityPassed = breaches.length === 0;

  return {
    ranAt,
    seed,
    sampleSize,
    snapshot: {
      path: input.snapshotPath,
      sha256: input.snapshot.sourceSha256,
      capturedAt: input.snapshot.capturedAt,
      articleCount: input.snapshot.articleCount,
    },
    versions: {
      catalog: resolver.versions.catalogVersion,
      crosswalkRules: resolver.versions.crosswalkVersion,
      classifierRules: CLASSIFIER_RULES_VERSION,
      domainTaxonomy: DOMAIN_TAXONOMY_VERSION,
      embeddingModel: resolver.versions.embeddingModelVersion,
    },
    breaches,
    results: sorted,
    domains,
    summary: {
      total: results.length,
      serviceRecords,
      outOfScope,
      failures,
      breaches: breaches.length,
      deadPages,
      resolvedCount,
      resolvedFraction,
      gateThreshold: CHECK_A_GATE_THRESHOLD,
      gatePassed,
      validityPassed,
      passed: gatePassed && validityPassed,
    },
  };
}
