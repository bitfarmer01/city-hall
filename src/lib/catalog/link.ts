// Sidecar linker — build spec D4. Assembles the versioned CatalogBundle and
// enforces referential integrity: no dangling sidecar links, ever. Every
// violation is collected (not fail-fast) so a broken seed reports all of its
// problems in one CI run, and the output arrays are sorted so the bundle is
// diff-stable.

import { sha256Hex } from "@/lib/capture/hash";

import {
  AGENCY_ID_PATTERN,
  CROSSWALK_ID_PATTERN,
  FIELD_ID_PATTERN,
  FORM_ID_PATTERN,
  NYC311_ARTICLE_ID_PATTERN,
  PORTAL_ID_PATTERN,
  SERVICE_ID_PATTERN,
  SNAPSHOT_ID_PATTERN,
  STEP_ID_PATTERN,
  FEE_ID_PATTERN,
} from "./ids";
import type {
  AgencyLevel,
  AgencyRecord,
  BlueprintStepRecord,
  CatalogBundle,
  FormFieldRecord,
  FormRecord,
  GoalCrosswalkRecord,
  PortalRecord,
  ServiceRecord,
  SourceSnapshotRecord,
} from "./types";

export class LinkError extends Error {
  constructor(readonly violations: string[]) {
    super(`catalog link rejected (${violations.length} violation(s)):\n  - ${violations.join("\n  - ")}`);
    this.name = "LinkError";
  }
}

export interface LinkInput {
  catalogVersion: string;
  generatedAt: string;
  sourceInventory: CatalogBundle["sourceInventory"];
  agencies: AgencyRecord[];
  services: ServiceRecord[];
  portals: PortalRecord[];
  forms: FormRecord[];
  formFields: FormFieldRecord[];
  snapshots: SourceSnapshotRecord[];
  crosswalks: GoalCrosswalkRecord[];
}

const AGENCY_LEVELS: readonly AgencyLevel[] = ["nyc", "nys", "federal", "utility"];

const FULFILLMENT_METHODS: readonly string[] = [
  "site_visit",
  "in_person_appearance",
  "notarized_wet_signature",
  "document_upload",
  "online_submission",
  "mail_in",
];

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function assertPattern(
  violations: string[],
  value: string,
  pattern: RegExp,
  what: string,
): void {
  if (!pattern.test(value)) {
    violations.push(`${what} "${value}" does not match the required ID pattern`);
  }
}

function collectDuplicates<T>(records: readonly T[], idOf: (record: T) => string, what: string, violations: string[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    const id = idOf(record);
    if (seen.has(id)) {
      violations.push(`duplicate ${what} id "${id}"`);
    }
    seen.add(id);
  }
}

/**
 * Assemble and check the bundle. Throws LinkError listing every violation
 * when any referential-integrity or ID-shape rule fails; returns the bundle
 * with all arrays sorted by id (steps by sequence within a service).
 */
export function linkCatalog(input: LinkInput): CatalogBundle {
  const violations: string[] = [];

  // ---- ID shapes -----------------------------------------------------------
  for (const agency of input.agencies) {
    assertPattern(violations, agency.id, AGENCY_ID_PATTERN, "agency id");
    if (!AGENCY_LEVELS.includes(agency.level)) {
      violations.push(`agency ${agency.id} has unknown level "${agency.level}"`);
    }
    if (agency.schemaOrg.identifier !== agency.id) {
      violations.push(`agency ${agency.id} schemaOrg.identifier mismatch: "${agency.schemaOrg.identifier}"`);
    }
  }
  for (const portal of input.portals) {
    assertPattern(violations, portal.id, PORTAL_ID_PATTERN, "portal id");
  }
  for (const form of input.forms) {
    assertPattern(violations, form.id, FORM_ID_PATTERN, "form id");
  }
  for (const field of input.formFields) {
    assertPattern(violations, field.id, FIELD_ID_PATTERN, "field id");
  }
  for (const snapshot of input.snapshots) {
    assertPattern(violations, snapshot.id, SNAPSHOT_ID_PATTERN, "snapshot id");
    if (snapshot.id !== `snap:${snapshot.sha256.slice(0, 12)}`) {
      violations.push(`snapshot ${snapshot.id} id is not the 12-char prefix of its sha256`);
    }
  }
  for (const crosswalk of input.crosswalks) {
    assertPattern(violations, crosswalk.id, CROSSWALK_ID_PATTERN, "crosswalk id");
  }

  // ---- Uniqueness ----------------------------------------------------------
  collectDuplicates(input.agencies, (a) => a.id, "agency", violations);
  collectDuplicates(input.portals, (p) => p.id, "portal", violations);
  collectDuplicates(input.forms, (f) => f.id, "form", violations);
  collectDuplicates(input.formFields, (f) => f.id, "field", violations);
  collectDuplicates(input.snapshots, (s) => s.id, "snapshot", violations);
  collectDuplicates(input.crosswalks, (c) => c.id, "crosswalk", violations);

  // ---- Lookup tables -------------------------------------------------------
  const agencyIds = new Set(input.agencies.map((a) => a.id));
  const agencyById = new Map(input.agencies.map((a) => [a.id, a]));
  const portalIds = new Set(input.portals.map((p) => p.id));
  const formIds = new Set(input.forms.map((f) => f.id));
  const snapshotIds = new Set(input.snapshots.map((s) => s.id));

  // ---- Services ------------------------------------------------------------
  collectDuplicates(input.services, (s) => s.meta.catalogId, "service", violations);
  const serviceIds = new Set(input.services.map((s) => s.meta.catalogId));

  for (const service of input.services) {
    const { envelope, meta, steps } = service;
    const where = `service ${meta.catalogId}`;

    if (!SERVICE_ID_PATTERN.test(meta.catalogId)) {
      violations.push(`${where}: catalogId does not match the service ID pattern`);
    }
    if (!NYC311_ARTICLE_ID_PATTERN.test(meta.nyc311ArticleId)) {
      violations.push(`${where}: nyc311ArticleId does not match the nyc311-KA-##### pattern`);
    }
    if (envelope.identifier[0] !== meta.catalogId) {
      violations.push(`${where}: envelope identifier[0] does not match the catalog id`);
    }
    if (envelope.identifier[1] !== meta.nyc311ArticleId) {
      violations.push(`${where}: envelope identifier[1] does not match the nyc311 article id`);
    }
    if (envelope["x:coverageDomain"] !== meta.domain) {
      violations.push(`${where}: envelope x:coverageDomain does not match the meta domain`);
    }
    if (!agencyIds.has(envelope.provider.identifier)) {
      violations.push(`${where}: provider "${envelope.provider.identifier}" is not a known agency`);
    }
    if (envelope.subjectOf.length === 0) {
      violations.push(`${where}: envelope has no subjectOf link to its NYC311 article`);
    }
    if (meta.classifiedDisposition !== "service") {
      violations.push(
        `${where}: only disposition "service" articles may enter the catalog (coverage-domain tags are not coverage-meaningful for other dispositions)`,
      );
    }
    if (meta.domain.length === 0 || meta.domain === "other") {
      violations.push(`${where}: catalog services must carry a real coverage domain, got "${meta.domain}"`);
    }
    if (meta.classifierRulesVersion.length === 0 || meta.domainTaxonomyVersion.length === 0) {
      violations.push(`${where}: classifier provenance (versions) is required`);
    }

    for (const offer of envelope.offers) {
      if (!FEE_ID_PATTERN.test(offer.identifier)) {
        violations.push(`${where}: fee id "${offer.identifier}" does not match the fee ID pattern`);
      }
      if (offer["x:sourceRefs"].length === 0) {
        violations.push(`${where}: fee ${offer.identifier} has no sourceRefs`);
      }
      for (const ref of offer["x:sourceRefs"]) {
        if (!snapshotIds.has(ref)) {
          violations.push(`${where}: fee ${offer.identifier} references unknown snapshot "${ref}"`);
        }
      }
    }

    linkSteps(violations, where, service, steps, {
      agencyIds,
      agencyById,
      portalIds,
      snapshotIds,
      offerIds: new Set(envelope.offers.map((offer) => offer.identifier)),
      catalogId: meta.catalogId,
    });
  }

  // ---- Portals, forms, fields ----------------------------------------------
  for (const portal of input.portals) {
    if (!agencyIds.has(portal.agencyId)) {
      violations.push(`portal ${portal.id}: agencyId "${portal.agencyId}" is not a known agency`);
    }
  }
  for (const form of input.forms) {
    const nycId = `nyc-${form.agency}`;
    if (!agencyIds.has(nycId)) {
      violations.push(`form ${form.id}: agency slug "${form.agency}" does not resolve to agency "${nycId}"`);
    }
    if (form.snapshotId !== undefined && !snapshotIds.has(form.snapshotId)) {
      violations.push(`form ${form.id}: snapshotId "${form.snapshotId}" is not a known snapshot`);
    }
  }
  for (const field of input.formFields) {
    if (!formIds.has(field.formId)) {
      violations.push(`field ${field.id}: formId "${field.formId}" is not a known form`);
    }
  }
  for (const crosswalk of input.crosswalks) {
    for (const serviceId of crosswalk.serviceIds) {
      if (!serviceIds.has(serviceId)) {
        violations.push(`crosswalk ${crosswalk.id}: serviceId "${serviceId}" is not a known service`);
      }
    }
  }
  for (const service of input.services) {
    for (const formId of service.formIds) {
      if (!formIds.has(formId)) {
        violations.push(`service ${service.meta.catalogId}: formId "${formId}" is not a known form`);
      }
    }
  }

  if (violations.length > 0) {
    throw new LinkError(violations);
  }

  return {
    schemaVersion: "0.1.0",
    catalogVersion: input.catalogVersion,
    generatedAt: input.generatedAt,
    sourceInventory: input.sourceInventory,
    agencies: [...input.agencies].sort(byId),
    services: [...input.services].sort((a, b) => (a.meta.catalogId < b.meta.catalogId ? -1 : 1)),
    portals: [...input.portals].sort(byId),
    forms: [...input.forms].sort(byId),
    formFields: [...input.formFields].sort(byId),
    snapshots: [...input.snapshots].sort(byId),
    crosswalks: [...input.crosswalks].sort(byId),
  };
}

interface StepLookup {
  agencyIds: Set<string>;
  agencyById: Map<string, AgencyRecord>;
  portalIds: Set<string>;
  snapshotIds: Set<string>;
  offerIds: Set<string>;
  catalogId: string;
}

function linkSteps(
  violations: string[],
  where: string,
  service: ServiceRecord,
  steps: BlueprintStepRecord[],
  lookup: StepLookup,
): void {
  const seenSequences = new Set<number>();
  const seenStepIds = new Set<string>();

  for (const step of steps) {
    const stepWhere = `${where} step ${step.id}`;

    if (!STEP_ID_PATTERN.test(step.id)) {
      violations.push(`${stepWhere}: id does not match the step ID pattern`);
    }
    if (step.serviceId !== lookup.catalogId) {
      violations.push(`${stepWhere}: serviceId "${step.serviceId}" does not match the owning service`);
    }
    if (seenStepIds.has(step.id)) {
      violations.push(`${stepWhere}: duplicate step id`);
    }
    seenStepIds.add(step.id);
    if (seenSequences.has(step.sequence)) {
      violations.push(`${stepWhere}: duplicate sequence ${step.sequence}`);
    }
    seenSequences.add(step.sequence);

    if (!FULFILLMENT_METHODS.includes(step.fulfillmentMethod)) {
      violations.push(`${stepWhere}: unknown fulfillmentMethod "${step.fulfillmentMethod}"`);
    }
    if (step.requirement.length === 0) {
      violations.push(`${stepWhere}: requirement must not be empty`);
    }
    if (step.sourceRefs.length === 0) {
      violations.push(`${stepWhere}: every step needs at least one sourceRef`);
    }
    for (const ref of step.sourceRefs) {
      if (!lookup.snapshotIds.has(ref)) {
        violations.push(`${stepWhere}: sourceRef "${ref}" is not a known snapshot`);
      }
    }

    checkAgencyRef(violations, stepWhere, "responsibleAgency", step.responsibleAgency, lookup);
    if (step.administeredBy) {
      checkAgencyRef(violations, stepWhere, "administeredBy", step.administeredBy, lookup);
    }
    if (step.issuedBy) {
      checkAgencyRef(violations, stepWhere, "issuedBy", step.issuedBy, lookup);
    }

    if (step.fulfillmentMethod === "document_upload" && !step.upload) {
      violations.push(`${stepWhere}: document_upload steps must carry upload constraints`);
    }
    if (step.upload) {
      if (step.fulfillmentMethod !== "document_upload") {
        violations.push(`${stepWhere}: upload constraints are only valid on document_upload steps`);
      }
      if (typeof step.upload.sizeLimitVerified !== "boolean") {
        violations.push(`${stepWhere}: upload.sizeLimitVerified must be a boolean`);
      }
      if (step.upload.maxSizeBytes !== null && step.upload.sizeLimitVerified === false) {
        violations.push(
          `${stepWhere}: upload.maxSizeBytes is set but sizeLimitVerified is false — no invented limits`,
        );
      }
      if (step.upload.portalId !== undefined && !lookup.portalIds.has(step.upload.portalId)) {
        violations.push(`${stepWhere}: upload.portalId "${step.upload.portalId}" is not a known portal`);
      }
      if (step.upload.portalUrl !== undefined && !step.upload.portalUrl.startsWith("https://")) {
        violations.push(`${stepWhere}: upload.portalUrl must be an https:// URL`);
      }
    }

    if (step.feeRef !== undefined && !lookup.offerIds.has(step.feeRef)) {
      violations.push(`${stepWhere}: feeRef "${step.feeRef}" does not match an offer on the owning service`);
    }

    for (const dependency of step.dependencies ?? []) {
      if (dependency.label.length === 0) {
        violations.push(`${stepWhere}: dependency labels must not be empty`);
      }
      if (dependency.agencyId !== undefined && !lookup.agencyIds.has(dependency.agencyId)) {
        violations.push(`${stepWhere}: dependency agencyId "${dependency.agencyId}" is not a known agency`);
      }
    }
  }

  // Sequences must run 1..n without gaps — ordered steps, not sparse lists.
  const ordered = [...steps].map((step) => step.sequence).sort((a, b) => a - b);
  ordered.forEach((sequence, index) => {
    if (sequence !== index + 1) {
      violations.push(`${where}: step sequences must be 1..n; found ${ordered.join(", ")}`);
    }
  });
}

function checkAgencyRef(
  violations: string[],
  where: string,
  what: string,
  ref: { id: string; name: string },
  lookup: StepLookup,
): void {
  const agency = lookup.agencyById.get(ref.id);
  if (!agency) {
    violations.push(`${where}: ${what} "${ref.id}" is not a known agency`);
    return;
  }
  if (agency.name !== ref.name) {
    violations.push(`${where}: ${what} name "${ref.name}" does not match agency record "${agency.name}"`);
  }
}

/**
 * Map a capture-harness SourceSnapshot (src/lib/capture/types) onto the
 * catalog's unified record. `sha256` is the FULL bundle content hash,
 * recomputed from the artifacts — the build script asserts it matches the
 * id before calling this.
 */
export function snapshotFromCapture(
  capture: {
    id: string;
    url: string;
    resolvedUrl: string;
    capturedAt: string;
    method: string;
    httpStatus: number;
    captureMode: string;
    stoppedAt: string;
    notes: string | null;
    artifacts: { name: string; sha256: string; bytes: number }[];
  },
  sha256: string,
): SourceSnapshotRecord {
  return {
    id: capture.id,
    url: capture.url,
    resolvedUrl: capture.resolvedUrl,
    capturedAt: capture.capturedAt,
    method: "headless",
    sha256,
    httpStatus: capture.httpStatus,
    captureMode: capture.captureMode as "public_reachable" | "authenticated_unreachable",
    stoppedAt: capture.stoppedAt,
    notes: capture.notes ?? undefined,
    artifacts: capture.artifacts,
  };
}

/** Canonical JSON: sorted keys, stable separators — the bundle's wire form. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Content hash of a bundle in its canonical form. */
export function bundleSha256(bundle: CatalogBundle): string {
  return sha256Hex(stableStringify(bundle));
}
