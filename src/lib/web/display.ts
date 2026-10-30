// Display vocabulary and pure formatters for the web surfaces (D7).
// React-free and I/O-free: presentational components and unit tests both
// consume these, so the wording of every honesty-critical label lives in
// exactly one place.

import type { AgencyLevel, FulfillmentMethod, RequiredStatus } from "@/lib/catalog/types";
import type { CoverageDomain } from "@/lib/inventory/domain";

/** Ordered coverage domains for filter UIs — the five required domains, then the catch-all. */
export const DOMAIN_ORDER = [
  "permits",
  "service-requests",
  "public-records",
  "licensing",
  "inspections",
  "other",
] as const satisfies readonly CoverageDomain[];

export type DisplayDomain = (typeof DOMAIN_ORDER)[number];

export const DOMAIN_LABELS: Record<DisplayDomain, string> = {
  permits: "Permits",
  "service-requests": "311 service requests",
  "public-records": "Public records",
  licensing: "Licensing",
  inspections: "Inspections",
  other: "Other",
};

export function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain as DisplayDomain] ?? domain;
}

/** How a step's requirement is fulfilled, in display language. */
export const FULFILLMENT_LABELS: Record<FulfillmentMethod, string> = {
  site_visit: "Site visit",
  in_person_appearance: "In-person appearance",
  notarized_wet_signature: "Notarized signature",
  document_upload: "Document upload",
  online_submission: "Online submission",
  mail_in: "Mail-in",
};

export function fulfillmentLabel(method: FulfillmentMethod): string {
  return FULFILLMENT_LABELS[method];
}

export const AGENCY_LEVEL_LABELS: Record<AgencyLevel, string> = {
  nyc: "NYC",
  nys: "New York State",
  federal: "Federal",
  utility: "Utility",
};

/**
 * requiredStatus stays a 4-value enum on screen — never collapsed to a
 * boolean (locked decision #6).
 */
export const REQUIRED_STATUS_LABELS: Record<RequiredStatus, string> = {
  author_declared_required: "required by the form",
  not_marked_required: "not marked required",
  inferred_required: "likely required (inferred)",
  unknown: "requirement not stated",
};

/** Human byte size: whole numbers at or above 10 of a unit, one decimal below. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${round1(kb)} KB`;
  return `${round1(kb / 1024)} MB`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The honest two-axis upload limit text: what the source states, and
 * whether D3 verified that statement. maxSizeBytes is null unless a
 * source stated a limit (locked decision #6 — no invented limits, ever),
 * so null renders as "no size limit stated", never as a guessed number.
 */
export function uploadLimitText(upload: { maxSizeBytes: number | null; sizeLimitVerified: boolean }): string {
  const limit = upload.maxSizeBytes === null ? "no size limit stated" : `up to ${formatBytes(upload.maxSizeBytes)}`;
  return `${limit} (${upload.sizeLimitVerified ? "verified" : "not verified"})`;
}
