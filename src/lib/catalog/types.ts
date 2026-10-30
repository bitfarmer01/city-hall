// Catalog record types — build spec D4 (art_RVpFZFo1) and data-model
// research art_mcM1Ssao §6. Eight records hold the whole system: Agency,
// Service (the schema.org envelope), Portal, Form, FormField, BlueprintStep,
// SourceSnapshot, GoalCrosswalk.
//
// Two boundaries matter:
//  - The Service record is a PURE schema.org GovernmentService JSON-LD
//    envelope. `additionalProperty` is NOT used — it is not a legal property
//    of Service (art_mcM1Ssao §1.2). The few catalog facts the envelope must
//    carry that schema.org has no term for live in a documented `x:` extension
//    namespace (research §1.3 recommendation C "with a thin layer of B").
//  - Everything else — steps, fields, uploads, provenance — is a sidecar
//    record keyed by stable IDs. Every externally sourced fact carries
//    `sourceRefs` into a SourceSnapshot record with capturedAt + hash.

/** Catalog record schema version — bump on breaking shape changes. */
export const CATALOG_SCHEMA_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Agencies
// ---------------------------------------------------------------------------

export type AgencyLevel = "nyc" | "nys" | "federal" | "utility";

export interface AgencySchemaOrgMirror {
  "@type": "GovernmentOrganization";
  name: string;
  identifier: string;
}

export interface AgencyRecord {
  /** `nyc-dohmh`, `nys-sla`, … — prefix + slug, see ids.ts. */
  id: string;
  name: string;
  abbreviation: string;
  level: AgencyLevel;
  /** Only URLs verified from a committed source; empty when none. */
  urls: string[];
  schemaOrg: AgencySchemaOrgMirror;
}

/** Minimal agency reference carried on steps — denormalized name + ID. */
export interface AgencyRef {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Services — the schema.org envelope
// ---------------------------------------------------------------------------

/** The x: extension namespace — the ONLY custom terms allowed on an envelope. */
export interface EnvelopeExtension {
  /** Coverage domain from the D2b taxonomy (locked decision #12). */
  "x:coverageDomain": string;
  "x:domainTaxonomyVersion": string;
}

export interface ServiceIdentifierParts {
  "@type": "GovernmentOrganization";
  name: string;
  identifier: string;
}

export interface ServiceJurisdiction {
  "@type": "AdministrativeArea";
  name: string;
}

export interface ServiceOutput {
  "@type": "Permit" | "Thing";
  name: string;
}

export interface ServiceChannel {
  "@type": "ServiceChannel";
  name?: string;
  serviceUrl?: string;
  servicePhone?: string;
  servicePostalAddress?: string;
  /** ISO-8601 duration, e.g. "P21D". Only when a source states one. */
  processingTime?: string;
}

export interface ServiceOffer {
  "@type": "Offer";
  /** `fee:{agency}:{slug}:{part}` — steps reference this as `feeRef`. */
  identifier: string;
  price: number;
  priceCurrency: "USD";
  description: string;
  /** Source provenance: snapshot IDs the fee was read from. */
  "x:sourceRefs": string[];
  /** When the fee was captured (ISO date or datetime). */
  "x:capturedAt": string;
}

export interface ServiceSubject {
  "@type": "CreativeWork";
  url: string;
}

/**
 * The GovernmentService JSON-LD envelope. `identifier` is the two-element
 * pair [catalogId, nyc311ArticleId] — locked decision #1 keeps the NYC311
 * article ID alongside the catalog ID.
 */
export type ServiceEnvelope = {
  "@context": "https://schema.org";
  "@type": "GovernmentService";
  identifier: [string, string];
  name: string;
  description: string;
  alternateName?: string[];
  serviceType: string;
  provider: ServiceIdentifierParts;
  jurisdiction: ServiceJurisdiction;
  serviceOutput?: ServiceOutput;
  availableChannel: ServiceChannel[];
  offers: ServiceOffer[];
  subjectOf: ServiceSubject[];
} & EnvelopeExtension;

// ---------------------------------------------------------------------------
// Blueprint steps
// ---------------------------------------------------------------------------

/**
 * How a step's requirement is fulfilled. Four values come from the build
 * spec / data-model research (art_mcM1Ssao §4.2): site_visit,
 * in_person_appearance, notarized_wet_signature, document_upload. Two more
 * are a documented extension (same move as the D2b disposition flattening):
 * the real corpus fulfills steps through online submissions (311 requests,
 * DOB NOW appointment requests) and mailed paper forms (vital-records mail
 * service), which none of the four values can express without lying.
 * Flagged for owner ratification in the PR.
 */
export type FulfillmentMethod =
  | "site_visit"
  | "in_person_appearance"
  | "notarized_wet_signature"
  | "document_upload"
  | "online_submission"
  | "mail_in";

/**
 * Upload constraints, honest by construction: maxSizeBytes stays null and
 * sizeLimitVerified stays false unless a source states a limit (locked
 * decision #6 — no invented limits, ever).
 */
export interface UploadConstraint {
  portalId?: string;
  portalUrl?: string;
  acceptedFormats?: string[];
  maxSizeBytes: number | null;
  sizeLimitVerified: boolean;
  multipleAllowed?: boolean;
}

/**
 * A dependency of a step — step IDs for NYC steps, or agency-labeled
 * external dependencies for state/federal/utility requirements (locked
 * decision #3: non-NYC steps render as labeled dependencies, distinct from
 * NYC-run steps).
 */
export interface StepDependency {
  /** Agency ID when the dependency belongs to a known agency. */
  agencyId?: string;
  /** Human-readable dependency label. */
  label: string;
  note?: string;
}

export interface BlueprintStepRecord {
  /** `stp:{serviceId}:{seq3}` — see ids.ts. */
  id: string;
  /** The owning service's catalog ID (referential anchor for the DB load). */
  serviceId: string;
  /** 1-based display order; IDs zero-pad by tens (010, 020, …). */
  sequence: number;
  phase?: string;
  requirement: string;
  fulfillmentMethod: FulfillmentMethod;
  /** Per-step agency — never a service-level attribute (art_mcM1Ssao §5.4). */
  responsibleAgency: AgencyRef;
  /** Administering agency when different from the responsible one. */
  administeredBy?: AgencyRef;
  /** Issuing agency when different from the responsible one. */
  issuedBy?: AgencyRef;
  /** Only on document_upload steps. */
  upload?: UploadConstraint;
  /** Offer identifier on the owning service's envelope. */
  feeRef?: string;
  dependencies?: StepDependency[];
  notes?: string;
  /** Snapshot IDs backing every factual claim in the step. */
  sourceRefs: string[];
}

// ---------------------------------------------------------------------------
// Portals, forms, fields
// ---------------------------------------------------------------------------

export type PortalAuth = "none" | "nyc_id" | "agency_account" | "unknown";
export type PortalCapturePolicy = "html_snapshot" | "headless" | "manual" | "forbidden";

export interface PortalRecord {
  /** `portal:{agency}:{system}`. */
  id: string;
  agencyId: string;
  name: string;
  url: string;
  /**
   * "unknown" is the honest default until a source states the auth
   * boundary; only verified boundaries claim none/nyc_id/agency_account.
   */
  auth: PortalAuth;
  capturePolicy: PortalCapturePolicy;
  notes?: string;
}

export type FillableClass = "acroform" | "xfa" | "hybrid" | "flattened" | "scanned";

export type RequiredStatus =
  | "author_declared_required"
  | "not_marked_required"
  | "inferred_required"
  | "unknown";

export type RequirementLevel = "required" | "conditionally_required" | "optional" | "unknown";

export type SourceLayer = "acroform" | "xfa" | "ocr" | "layout_geometry";

export interface ProvenanceRecord {
  sourceLayer: SourceLayer;
  tool: string;
  confidence: number;
  note?: string;
}

/** Mirrors python/pdf_extraction/model.py Form.to_dict(). */
export interface FormRecord {
  id: string;
  /** Agency slug from the extraction pipeline (e.g. "dohmh"); ID form: `nyc-${slug}`. */
  agency: string;
  formNumber: string | null;
  title: string;
  sourceUrl: string;
  sha256: string;
  pages: number;
  fillableClass: FillableClass;
  revisionDate?: string;
  snapshotId?: string;
  notes?: string;
}

/** Mirrors python/pdf_extraction/model.py FormField.to_dict(). */
export interface FormFieldRecord {
  id: string;
  formId: string;
  nativeName: string | null;
  visibleLabel: string | null;
  fieldType: string;
  requiredStatus: RequiredStatus;
  requirementLevel: RequirementLevel;
  provenance: ProvenanceRecord;
  labelProvenance?: ProvenanceRecord;
  bbox?: Record<string, unknown>;
  options?: string[];
  semanticType?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Source snapshots
// ---------------------------------------------------------------------------

export type SnapshotMethod = "http_fetch" | "headless" | "manual";

export interface SnapshotArtifact {
  name: string;
  sha256: string;
  bytes: number;
}

/**
 * Unified SourceSnapshot record. Producers:
 *  - the capture harness (src/lib/capture) — headless bundles with artifacts;
 *  - the PDF extraction pipeline — http_fetch of form files;
 *  - the inventory snapshot — the pinned index page;
 *  - committed evidence records (data/catalog/seed/evidence) — research-
 *    session captures quoted verbatim; method "manual", hashed from the
 *    evidence record's own bytes, never re-fetched live.
 */
export interface SourceSnapshotRecord {
  /** `snap:{sha256-12}`. */
  id: string;
  url: string;
  capturedAt: string;
  method: SnapshotMethod;
  sha256: string;
  httpStatus?: number;
  /** Repo-relative path when the bytes are committed. */
  storagePath?: string;
  resolvedUrl?: string;
  captureMode?: "public_reachable" | "authenticated_unreachable";
  stoppedAt?: string;
  notes?: string;
  artifacts?: SnapshotArtifact[];
}

// ---------------------------------------------------------------------------
// Goal crosswalk (table created at D4; seeded by the D5 resolver work)
// ---------------------------------------------------------------------------

export interface CrosswalkTestCase {
  utterance: string;
  expectedServiceIds: string[];
}

export interface GoalCrosswalkRecord {
  /** `xw:{goalSlug}`. */
  id: string;
  utterances: string[];
  serviceIds: string[];
  excludedServiceIds: { serviceId: string; reason: string }[];
  testCases: CrosswalkTestCase[];
}

// ---------------------------------------------------------------------------
// The versioned bundle
// ---------------------------------------------------------------------------

/**
 * Classification provenance merged into every service record.
 *
 * Per the PR #6 panel review: NO classifier ruleIds or evidence spans are
 * persisted here — the evidence field shape ({kind, span}) will change in
 * the classifier-fidelity PR, and rule IDs churn with rule edits. What is
 * persisted: the disposition assertion (a coverage-domain tag is only
 * coverage-meaningful for disposition === "service" — the tagger stamps
 * domains on out-of-scope articles too) and the pinned versions that
 * produced it.
 */
export interface ServiceCatalogMeta {
  catalogId: string;
  nyc311ArticleId: string;
  nyc311ArticleUrl: string;
  domain: string;
  serviceSubtype: string;
  /** Always "service" — out-of-scope articles never enter the catalog. */
  classifiedDisposition: "service";
  classifierRulesVersion: string;
  domainTaxonomyVersion: string;
}

export interface ServiceRecord {
  envelope: ServiceEnvelope;
  meta: ServiceCatalogMeta;
  steps: BlueprintStepRecord[];
  /** Forms required by this service — linked by stable Form IDs. */
  formIds: string[];
}

export interface CatalogBundle {
  schemaVersion: string;
  catalogVersion: string;
  generatedAt: string;
  sourceInventory: {
    snapshotId: string;
    capturedAt: string;
    sha256: string;
    articleCount: number;
  };
  agencies: AgencyRecord[];
  services: ServiceRecord[];
  portals: PortalRecord[];
  forms: FormRecord[];
  formFields: FormFieldRecord[];
  snapshots: SourceSnapshotRecord[];
  crosswalks: GoalCrosswalkRecord[];
}
