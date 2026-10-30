// Shared primitives for the service contracts — build spec D4.5
// (todo_O2keBBqw). Every downstream build (D5 resolver, D6 estimates, D7 web
// app, D9 adapters) imports these; nothing here imports runtime logic.
//
// Vocabulary reuses the inventory classifier's enums via type-only imports so
// there is exactly one source of truth; the lockstep asserts below make
// drift between the two fail the build.

import { z } from "zod";

import type {
  ArticleDisposition,
  ServiceSubtype,
} from "../inventory/classify";
import type { CoverageDomain } from "../inventory/domain";

/** Compile-time: assert literal array `A` covers every value of `T`. */
type AssertCovers<T, A extends readonly T[]> = Exclude<T, A[number]> extends never
  ? true
  : never;

/** `{ id, name }` reference to an agency record (`nyc-dcwp`, Department of …). */
export const AgencyRefSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type AgencyRef = z.infer<typeof AgencyRefSchema>;

/** Catalog service ID: `svc:{agency}:{slug}` (build spec data-model table). */
export const ServiceIdSchema = z
  .string()
  .regex(/^svc:[a-z0-9-]+:[a-z0-9-]+$/, "service id must match svc:{agency}:{slug}");
export type ServiceId = z.infer<typeof ServiceIdSchema>;

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
export const COVERAGE_DOMAINS_COVER_ALL = _domainsCoversAll;

export const CoverageDomainSchema = z.enum(COVERAGE_DOMAINS);
export type ContractsCoverageDomain = z.infer<typeof CoverageDomainSchema>;

/**
 * How a service's domain tag was assigned (PR #6 panel follow-up):
 * `keyword` — a domain rule matched the article text; `fallback` — no
 * pattern matched and the tag is the `other` catch-all. Without the source,
 * "no pattern matched" is indistinguishable from "genuinely outside the five
 * domains". Defined locally until the classifier's own field lands on main
 * (fix/classifier-fidelity, PR #8) — then swap to a type-import lockstep.
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
export const DISPOSITIONS_COVER_ALL = _dispositionsCoversAll;

export const DispositionSchema = z.enum(DISPOSITIONS);
export const ServiceSubtypeSchema = z.enum([
  "report",
  "apply",
  "order",
  "informational-with-action",
] as const satisfies readonly ServiceSubtype[]);

/**
 * The three data-version stamps every deterministic answer carries (spec D5:
 * `catalog_version`, `crosswalk_version`, `embedding_model_version`) — catalog
 * snapshot, ruleset, and model/retriever versions.
 */
export const VersionStampsSchema = z.strictObject({
  catalogVersion: z.string().min(1),
  crosswalkVersion: z.string().min(1),
  embeddingModelVersion: z.string().min(1),
});
export type VersionStamps = z.infer<typeof VersionStampsSchema>;
