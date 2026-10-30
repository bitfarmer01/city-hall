import type { GoldenDiff } from "../capture/golden";
import { diffLiveMinusCatalog } from "../capture/golden";
import { CAPTURE_SCHEMA_VERSION } from "../capture/types";
import type { CatalogBundle } from "../catalog/types";
import { loadSnapshotEvidence, loadPdfEvidence } from "./evidence";
import type { GoldenExpectation } from "./expectation";
import { diffInPerson, mergeFindings } from "./stepdiff";
import { GOLDEN_DOMAINS } from "./types";
import type {
  CheckBReport,
  CheckBRow,
  DomainCoverage,
  GoldenService,
  GoldenSet,
  GoldenTarget,
} from "./types";

/**
 * Check B runner — zero-miss golden set (art_wJiwwN0o §4b). Reads committed
 * evidence only (capture bundles via the integrity-verifying store; PDF
 * checklists via hash-verified extraction records), diffs each target
 * live-minus-catalog, and applies the spec's gate: zero missed required
 * fields, documents, or in-person steps. Extras warn.
 *
 * All I/O happens in loadGoldenSet and the evidence loaders, so the gate
 * logic itself is unit-testable offline.
 */

export interface GoldenCatalogIndex {
  /** catalogVersion of the committed bundle. */
  version: string;
  /** serviceId → coverage domain. */
  domains: Map<string, string>;
  /** serviceIds whose catalog steps claim in-person fulfillment. */
  inPersonClaimed: Set<string>;
}

/** Indexes the catalog bundle for the cross-checks the gate needs. */
export function indexCatalog(bundle: CatalogBundle): GoldenCatalogIndex {
  const domains = new Map<string, string>();
  const inPersonClaimed = new Set<string>();
  for (const service of bundle.services) {
    domains.set(service.meta.catalogId, service.meta.domain);
    if (
      service.steps.some(
        (s) => s.fulfillmentMethod === "in_person_appearance" || s.fulfillmentMethod === "site_visit",
      )
    ) {
      inPersonClaimed.add(service.meta.catalogId);
    }
  }
  return { version: bundle.catalogVersion, domains, inPersonClaimed };
}

export async function evaluateTarget(
  service: GoldenService,
  target: GoldenTarget,
  expectation: GoldenExpectation,
  snapshotsRoot: string,
  repoRoot: string,
): Promise<CheckBRow> {
  const base = {
    serviceId: service.serviceId,
    nyc311ArticleId: service.nyc311ArticleId,
    domain: service.domain,
    targetId: target.id,
    kind: target.kind,
    url: target.url,
  };

  if (target.kind === "pdf_checklist") {
    const { dump } = await loadPdfEvidence(repoRoot, target.pdfPath!, target.extractionPath!);
    const findings: GoldenDiff = diffLiveMinusCatalog(dump, expectation);
    return {
      ...base,
      status: findings.failures.length > 0 ? "fail" : "ok",
      findings,
      inPerson: null,
      note: null,
    };
  }

  const evidence = await loadSnapshotEvidence(snapshotsRoot, target.snapshotId!);
  if (evidence.captureMode !== "public_reachable") {
    // Spec: auth-gated targets record the boundary; the public boundary plus
    // PDF checklist is their comparison target — no live form diff exists.
    return {
      ...base,
      status: "skipped_boundary",
      findings: { failures: [], warnings: [] },
      inPerson: null,
      note: `capture stopped at ${evidence.boundary}; comparison target is the public boundary plus PDF checklist`,
    };
  }

  const diff = diffLiveMinusCatalog(evidence.dump, expectation);
  const inPerson =
    target.kind === "article_page" ? diffInPerson(evidence.pageText, expectation) : null;
  const findings = mergeFindings(diff, inPerson);
  return {
    ...base,
    status: findings.failures.length > 0 ? "fail" : "ok",
    findings,
    inPerson,
    note: null,
  };
}

function rollUpDomain(rows: CheckBRow[]): DomainCoverage[] {
  return GOLDEN_DOMAINS.map((domain) => {
    const domainRows = rows.filter((r) => r.domain === domain);
    return {
      domain,
      services: new Set(domainRows.map((r) => r.serviceId)).size,
      ok: domainRows.filter((r) => r.status === "ok").length,
      failed: domainRows.filter((r) => r.status === "fail").length,
      skippedBoundary: domainRows.filter((r) => r.status === "skipped_boundary").length,
      unverifiable: domainRows.filter((r) => r.status === "unverifiable").length,
    };
  });
}

export interface CheckBResult {
  report: CheckBReport;
}

export async function runCheckB(
  set: GoldenSet,
  expectations: Map<string, GoldenExpectation>,
  paths: { repoRoot: string; snapshotsRoot: string },
  catalog: GoldenCatalogIndex | null,
): Promise<CheckBResult> {
  // Catalog cross-checks fail loudly rather than narrowing the gate: a
  // service the manifest claims for the catalog must exist there with the
  // same coverage domain.
  for (const service of set.services) {
    if (!service.inCatalog) continue;
    if (!catalog) {
      throw new Error(
        `golden service ${service.serviceId} is marked inCatalog but no catalog bundle was provided`,
      );
    }
    const domain = catalog.domains.get(service.serviceId);
    if (domain === undefined) {
      throw new Error(
        `golden service ${service.serviceId} is marked inCatalog but is absent from catalog ${catalog.version}`,
      );
    }
    if (domain !== service.domain) {
      throw new Error(
        `golden service ${service.serviceId}: domain "${service.domain}" disagrees with catalog domain "${domain}"`,
      );
    }
  }

  const rows: CheckBRow[] = [];
  for (const service of set.services) {
    for (const target of service.targets) {
      const expectation = expectations.get(target.expectationFile);
      if (!expectation) {
        throw new Error(
          `missing expectation file for ${service.serviceId}/${target.id}: ${target.expectationFile}`,
        );
      }
      rows.push(await evaluateTarget(service, target, expectation, paths.snapshotsRoot, paths.repoRoot));
    }
  }

  // Catalog completeness (row level — needs the page evidence): when a
  // catalog service's article baseline records page-evidenced in-person
  // requirements, the catalog's steps must claim in-person fulfillment too.
  // The reverse (catalog claims, page silent) is not provable from the page
  // and is left to the step records' own sourceRefs.
  if (catalog) {
    for (const row of rows) {
      if (row.inPerson === null || row.inPerson.live.length === 0) continue;
      const service = set.services.find((s) => s.serviceId === row.serviceId);
      if (!service?.inCatalog || catalog.inPersonClaimed.has(row.serviceId)) continue;
      const articleTarget = service.targets.find((t) => t.kind === "article_page");
      const exp = articleTarget ? expectations.get(articleTarget.expectationFile) : undefined;
      if (exp && exp.inPersonSteps.length > 0) {
        row.status = "fail";
        row.findings.failures.push({
          kind: "field",
          reason: "live_only_required",
          key: `in-person:catalog-linkage:${row.serviceId}`,
          detail: `golden baseline records in-person requirements (${exp.inPersonSteps.join("; ")}) but no catalog step of ${row.serviceId} claims in-person fulfillment`,
        });
      }
    }
  }

  const failed = rows.filter((r) => r.status === "fail").length;
  const ok = rows.filter((r) => r.status === "ok").length;
  const skippedBoundary = rows.filter((r) => r.status === "skipped_boundary").length;
  const unverifiable = rows.filter((r) => r.status === "unverifiable").length;

  const present = new Set(set.services.map((s) => s.domain));
  const missingDomains = GOLDEN_DOMAINS.filter((d) => !present.has(d));

  return {
    report: {
      domainSpread: { ok: missingDomains.length === 0, missing: missingDomains },
      rows,
      perDomain: rollUpDomain(rows),
      totals: {
        services: set.services.length,
        targets: rows.length,
        failed,
        ok,
        skippedBoundary,
        unverifiable,
      },
      gate: { passed: failed === 0 && missingDomains.length === 0, failureCount: failed },
      versions: {
        goldenSetSchema: set.schemaVersion,
        captureSchema: CAPTURE_SCHEMA_VERSION,
        catalog: catalog?.version ?? null,
      },
    },
  };
}
