// Check B — zero-miss golden set (build spec D10b, art_RVpFZFo1; harness
// design art_wJiwwN0o §4b). A golden set is a committed, human-reviewed
// baseline of 20 real services spanning all five coverage domains. Each
// service names committed evidence (hashed capture bundles, extracted PDF
// checklists) and a baseline expectation; the check re-verifies the evidence
// offline and diffs it live-minus-catalog. Zero missed required fields,
// documents, or in-person steps is the gate; extras warn.

import type { GoldenDiff } from "../capture/golden";

/** The five owner-required coverage domains (locked decision #12). */
export type GoldenDomain =
  | "permits"
  | "service-requests"
  | "public-records"
  | "licensing"
  | "inspections";

export const GOLDEN_DOMAINS: readonly GoldenDomain[] = [
  "permits",
  "service-requests",
  "public-records",
  "licensing",
  "inspections",
];

/** Exactly 20 golden services, per Check B. */
export const GOLDEN_SET_SIZE = 20;

/**
 * What kind of evidence backs a target — and therefore what the diff compares.
 * article_page / portal_form diff a capture bundle's DOM dump; pdf_checklist
 * diffs the extracted field records of a committed PDF checklist (the spec's
 * comparison target for auth-gated services).
 */
export type GoldenEvidenceKind = "article_page" | "portal_form" | "pdf_checklist";

/**
 * One capture target of a golden service. Offline replay reads committed
 * evidence (snapshotId, or pdfPath + extractionPath for PDF checklists); the
 * weekly live job re-captures public targets and flags upstream PDF drift.
 */
export interface GoldenTarget {
  /** Stable slug unique within the service, e.g. "article", "portal-dob-now". */
  id: string;
  kind: GoldenEvidenceKind;
  /** URL the evidence was captured (or the PDF fetched) from. */
  url: string;
  /**
   * recorded capture mode. authenticated_unreachable targets are the spec's
   * auth-gated case: no live form diff — the public boundary plus the PDF
   * checklist is the comparison target.
   */
  captureMode: "public_reachable" | "authenticated_unreachable";
  /** Boundary that stopped the capture ("none" when publicly reachable). */
  boundary: string;
  /** Committed capture bundle for article/portal targets. */
  snapshotId?: string;
  /** Repo-relative committed PDF bytes for pdf_checklist targets. */
  pdfPath?: string;
  /** Repo-relative extraction record (python pipeline output) for the PDF. */
  extractionPath?: string;
  /** Repo-relative baseline expectation file (data/golden/expectations/). */
  expectationFile: string;
}

export interface GoldenService {
  /** Catalog ID when the service is in the catalog bundle, else its seed ID. */
  serviceId: string;
  /** NYC311 article anchor (locked decision #1). */
  nyc311ArticleId: string;
  /** Article title verbatim from the pinned inventory snapshot. */
  title: string;
  domain: GoldenDomain;
  /** Agency named by the article title or body; "311" when citywide. */
  agencyHint: string;
  /** True when serviceId exists in the committed catalog bundle. */
  inCatalog: boolean;
  targets: GoldenTarget[];
}

export interface GoldenSet {
  schemaVersion: string;
  seededAt: string;
  inventorySnapshot: {
    path: string;
    sha256: string;
    articleCount: number;
  };
  /** How the 20 services were chosen — auditable, not procedural flavor. */
  selectionRules: string[];
  services: GoldenService[];
}

export const GOLDEN_SET_SCHEMA_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Check B report
// ---------------------------------------------------------------------------

export type CheckBStatus = "ok" | "fail" | "skipped_boundary" | "unverifiable";

export interface InPersonDiff {
  /** Live page-text in-person signals (normalized phrases). */
  live: string[];
  /** Live signals the catalog baseline does not claim — gate-relevant. */
  missing: string[];
  /** Baseline claims with no live signal — drift warnings. */
  stale: string[];
}

export interface CheckBRow {
  serviceId: string;
  nyc311ArticleId: string;
  domain: GoldenDomain;
  targetId: string;
  kind: GoldenEvidenceKind;
  url: string;
  status: CheckBStatus;
  /** Field/document findings from the diff (empty for skipped targets). */
  findings: GoldenDiff;
  /** In-person step comparison (article_page targets only). */
  inPerson: InPersonDiff | null;
  /** Set when the row could not be evaluated (live mode only). */
  note: string | null;
}

export interface DomainCoverage {
  domain: GoldenDomain;
  services: number;
  ok: number;
  failed: number;
  skippedBoundary: number;
  unverifiable: number;
}

export interface CheckBReport {
  /** Domain-spread assertion result — all five domains present. */
  domainSpread: { ok: boolean; missing: GoldenDomain[] };
  rows: CheckBRow[];
  perDomain: DomainCoverage[];
  totals: {
    services: number;
    targets: number;
    failed: number;
    ok: number;
    skippedBoundary: number;
    unverifiable: number;
  };
  /** The zero-miss gate: no missed required fields, documents, or in-person steps. */
  gate: { passed: boolean; failureCount: number };
  versions: {
    goldenSetSchema: string;
    captureSchema: string;
    catalog: string | null;
  };
}
