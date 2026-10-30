// Shared primitives for the service contracts — build spec D4.5
// (todo_O2keBBqw). Every downstream build (D5 resolver, D6 estimates, D7 web
// app, D9 adapters) imports these; nothing here imports runtime logic.
//
// Vocabulary reuses the inventory classifier's enums and the catalog's ID
// patterns via imports so there is exactly one source of truth; the lockstep
// asserts below make drift between the two fail the build.

import { z } from "zod";

import { SERVICE_ID_PATTERN } from "../catalog/ids";
import type { ArticleDisposition, ServiceSubtype } from "../inventory/classify";
import type { CoverageDomain } from "../inventory/domain";

/**
 * Compile-time: assert literal array `A` covers every value of `T`. `A` is a
 * `readonly unknown[]` (not `readonly T[]`) so the contracts may extend a
 * producer vocabulary with their own honest members (e.g. the fulfillment
 * "other" escape hatch) while still proving every producer value parses.
 */
export type AssertCovers<T, A extends readonly unknown[]> = Exclude<T, A[number]> extends never
  ? true
  : never;

/** `{ id, name }` reference to an agency record (`nyc-dcwp`, Department of …). */
export const AgencyRefSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type AgencyRef = z.infer<typeof AgencyRefSchema>;

/** Catalog service ID: `svc:{agency}:{slug}` — pattern owned by catalog/ids. */
export const ServiceIdSchema = z
  .string()
  .regex(SERVICE_ID_PATTERN, "service id must match svc:{agency}:{slug}");
export type ServiceId = z.infer<typeof ServiceIdSchema>;

/**
 * Consumer-facing http(s) URL. `javascript:`/`data:`/`file:` and friends are
 * rejected (panel S4-H1, empirically probed on zod 4.6.7 — the protocol
 * regex matches without the colon).
 */
export const HttpsUrlSchema = z.url({ protocol: /^https?$/ });

/**
 * SourceSnapshot reference. The catalog's `SNAPSHOT_ID_PATTERN` (`snap:` +
 * 12 hex) is the real-capture subset; the contracts also admit `snap:fixture-*`
 * mock refs so fixtures can never masquerade as real captures (panel S4-M5).
 */
export const SnapshotRefSchema = z
  .string()
  .regex(/^snap:[a-z0-9][a-z0-9-]*$/i, "snapshot ref must match snap:{id}");

/**
 * REAL-capture snapshot ref — the catalog's strict `snap:` + 12-hex form,
 * exported for conformance tests over real records (panel S4). Fixtures use
 * `SnapshotRefSchema` (which admits `snap:fixture-*`); a fixture ref must
 * never pass this one.
 */
export const RealSnapshotRefSchema = z
  .string()
  .regex(/^snap:[a-f0-9]{12}$/, "real snapshot ref must be snap: + 12 hex chars");

/** Semver version stamp (`0.1.0`, `1.0.0`, `0.0.0-fixture`). */
export const SemverVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "version must be semver (major.minor.patch[-prerelease])");

/**
 * Catalog snapshot version — the catalog bundle's own date-stamp format
 * (panel N1): `meta.json` emits `2026-10-30.1`, not semver. Mirrors the
 * producer instead of forcing one shape across all three stamps.
 */
export const CatalogSnapshotVersionSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/, "catalog version must match YYYY-MM-DD[.N] (the catalog bundle's date-stamp)");

/**
 * Embedding/retriever model version — the retrieval pipeline's lowercase
 * token format (panel N1): `EMBEDDING_MODEL_VERSION` emits `lexical-hash-v1`.
 */
export const EmbeddingModelVersionSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]*$/, "embedding model version must be a lowercase dot/hyphen token (e.g. lexical-hash-v1)");

/**
 * Coverage domains — locked decision #12: permits, 311 service requests,
 * public records, licensing, inspections (plus the `other` catch-all). The
 * array must stay in lockstep with `CoverageDomain` in the inventory
 * taxonomy; both directions are asserted at compile time.
 */
export const COVERAGE_DOMAINS = [
  "permits",
  "service-requests",
  "public-records",
  "licensing",
  "inspections",
  "other",
] as const satisfies readonly CoverageDomain[];

const _domainsCoversAll: AssertCovers<CoverageDomain, typeof COVERAGE_DOMAINS> = true;
void _domainsCoversAll;

export const CoverageDomainSchema = z.enum(COVERAGE_DOMAINS);
export type ContractsCoverageDomain = z.infer<typeof CoverageDomainSchema>;

/**
 * How a service's domain tag was assigned — the contract-side projection of
 * the classifier's `DomainTag` (panel High: PR #8 defines no `domainSource`
 * field, so the mapping is defined HERE and boundary-tested in
 * contracts.test.ts):
 *
 *     matchedBy 'title'       → 'keyword'
 *     matchedBy 'description' → 'keyword'   (a pattern matched — in the
 *                                            description text, not the title)
 *     matchedBy 'none'        → 'fallback'  (no pattern matched; the tag is
 *                                            the `other` catch-all)
 *
 * `DomainTag.patternId` is dropped: rule IDs churn with rule edits (the same
 * PR #6 panel reasoning that keeps ruleIds out of the persisted catalog
 * meta). `DomainTag.taxonomyVersion` is dropped here because it rides
 * separately as `domainTaxonomyVersion` on the summary and
 * `x:domainTaxonomyVersion` on the envelope.
 */
export const DOMAIN_SOURCES = ["keyword", "fallback"] as const;
export type DomainSource = (typeof DOMAIN_SOURCES)[number];
export const DomainSourceSchema = z.enum(DOMAIN_SOURCES);

/** Classifier dispositions (D2b) — same lockstep guarantee as domains. */
export const DISPOSITIONS = [
  "service",
  "informational",
  "hub",
  "dead-page",
  "out-of-scope",
] as const satisfies readonly ArticleDisposition[];

const _dispositionsCoversAll: AssertCovers<ArticleDisposition, typeof DISPOSITIONS> = true;
void _dispositionsCoversAll;

export const DispositionSchema = z.enum(DISPOSITIONS);

/** Service subtypes — lockstep with the classifier's ServiceSubtype (panel S1-M1). */
export const SERVICE_SUBTYPES = [
  "report",
  "apply",
  "order",
  "informational-with-action",
] as const satisfies readonly ServiceSubtype[];

const _subtypesCoversAll: AssertCovers<ServiceSubtype, typeof SERVICE_SUBTYPES> = true;
void _subtypesCoversAll;

export const ServiceSubtypeSchema = z.enum(SERVICE_SUBTYPES);

/**
 * The three data-version stamps every deterministic answer carries (spec D5:
 * `catalog_version`, `crosswalk_version`, `embedding_model_version`). Each
 * stamp validates against its OWN producer's format (panel N1 — one semver
 * shape rejected two of the three real producers):
 *
 * - `catalogVersion` — the bundle's date-stamp (`2026-10-30.1`, meta.json)
 * - `crosswalkVersion` — ruleset semver (`1.0.0`, CROSSWALK_RULES_VERSION)
 * - `embeddingModelVersion` — retriever token (`lexical-hash-v1`,
 *   EMBEDDING_MODEL_VERSION)
 */
export const VersionStampsSchema = z.strictObject({
  catalogVersion: CatalogSnapshotVersionSchema,
  crosswalkVersion: SemverVersionSchema,
  embeddingModelVersion: EmbeddingModelVersionSchema,
});
export type VersionStamps = z.infer<typeof VersionStampsSchema>;
