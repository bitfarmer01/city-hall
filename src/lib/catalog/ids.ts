// Stable ID schemes for the catalog (art_RVpFZFo1 record table, art_mcM1Ssao
// §6). Natural keys, not surrogates: readable, diff-stable, and deterministic
// crosswalk targets. Every pattern here is enforced by the schema lint, so a
// malformed ID fails CI instead of drifting through the system.

import type { AgencyLevel } from "./types";

/** Agency ID prefix per level — `nyc-dohmh`, `nys-sla`. */
const LEVEL_PREFIX: Record<AgencyLevel, string> = {
  nyc: "nyc",
  nys: "nys",
  federal: "federal",
  utility: "utility",
};

/** Agency slug for the extraction pipeline's form records: `nyc-${slug}`. */
export function nycAgencyId(slug: string): string {
  return `nyc-${slug}`;
}

export function agencyId(level: AgencyLevel, slug: string): string {
  return `${LEVEL_PREFIX[level]}-${slug}`;
}

export function serviceId(agencySlug: string, slug: string): string {
  return `svc:${agencySlug}:${slug}`;
}

/** Step IDs zero-pad by tens (010, 020, …) — room to insert between steps. */
export function stepId(catalogId: string, sequence: number): string {
  return `stp:${catalogId}:${String(sequence * 10).padStart(3, "0")}`;
}

export function portalId(agencySlug: string, system: string): string {
  return `portal:${agencySlug}:${system}`;
}

export function crosswalkId(goalSlug: string): string {
  return `xw:${goalSlug}`;
}

export function feeId(agencySlug: string, slug: string, part: string): string {
  return `fee:${agencySlug}:${slug}:${part}`;
}

// ---------------------------------------------------------------------------
// Patterns (lint-enforced)
// ---------------------------------------------------------------------------

export const SERVICE_ID_PATTERN = /^svc:[a-z0-9-]+:[a-z0-9-]+$/;
/** Locked decision #1: `nyc311-KA-#####` rides alongside the catalog ID. */
export const NYC311_ARTICLE_ID_PATTERN = /^nyc311-KA-\d{5}$/;
export const STEP_ID_PATTERN = /^stp:(svc:[a-z0-9-]+:[a-z0-9-]+):\d{3}$/;
export const PORTAL_ID_PATTERN = /^portal:[a-z0-9-]+:[a-z0-9-]+$/;
export const CROSSWALK_ID_PATTERN = /^xw:[a-z0-9-]+$/;
export const FEE_ID_PATTERN = /^fee:[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/;
/** `form:{agency}:{formNumber}v{revision}` — or without the revision. */
export const FORM_ID_PATTERN = /^form:[a-z0-9-]+:[a-z0-9-]+(v[a-z0-9.-]+)?$/;
/** `fld:{formId}:{hash8}` — the Python pipeline's digest suffix. */
export const FIELD_ID_PATTERN = /^fld:form:[a-z0-9-]+:[a-z0-9-]+(v[a-z0-9.-]+)?:[0-9a-f]{8}$/;
export const SNAPSHOT_ID_PATTERN = /^snap:[0-9a-f]{12}$/;
export const AGENCY_ID_PATTERN = /^(nyc|nys|federal|utility)-[a-z0-9-]+$/;
