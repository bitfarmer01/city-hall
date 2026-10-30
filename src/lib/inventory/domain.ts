// Coverage-domain taxonomy for NYC311 A-to-Z articles — locked decision #12
// (art_RVpFZFo1): the catalog and resolver must demonstrably cover five
// domains — permits, 311 service requests, public records, licensing, and
// inspections — and Check A reports per-domain coverage, so every article
// carries a domain tag. A sixth bucket, `other`, catches everything the
// keyword rules do not claim.
//
// Tagging is two-pass (title first, then description) over one ordered rule
// table; the first matching pattern wins. Priority order resolves the real
// multi-keyword titles observed in the 2026-10-30 snapshot, e.g.
// "Private Elevator or Escalator Inspector Complaint" → service request (a
// complaint about an inspector, not an inspection), "Motor Vehicle Inspection
// License" → licensing, "FDNY Permit or Inspection" → permits, "Food Cart
// Inspection Report" → inspections.

import type { IndexArticleEntry } from "./types";

/** Version of this taxonomy — bump when a pattern or priority changes. */
export const DOMAIN_TAXONOMY_VERSION = "1.0.0";

/** The five owner-required coverage domains, plus the catch-all. */
export type CoverageDomain =
  | "permits"
  | "service-requests"
  | "public-records"
  | "licensing"
  | "inspections"
  | "other";

export interface DomainTag {
  domain: CoverageDomain;
  /** Which pass matched: title beats description; `none` for `other`. */
  matchedBy: "title" | "description" | "none";
  /** Pattern that fired, `<domain>:<pattern>`, e.g. "public-records:foil". */
  patternId: string;
  taxonomyVersion: string;
}

interface DomainPattern {
  id: string;
  domain: Exclude<CoverageDomain, "other">;
  pattern: RegExp;
}

// Ordered rule table — first match wins within each pass.
const DOMAIN_PATTERNS: readonly DomainPattern[] = [
  // Public records first: the certificate/FOIL phrases are the most specific.
  {
    id: "public-records:vital-certificate",
    domain: "public-records",
    pattern: /birth certificate|death certificate|vital record|marriage certificate/i,
  },
  { id: "public-records:foil", domain: "public-records", pattern: /\bfoil\b|freedom of information/i },
  { id: "public-records:property-record", domain: "public-records", pattern: /property (?:deed|record)|\bacris\b/i },

  // A complaint is a 311 service request even when the title also names an
  // inspector, license, or permit (verified multi-keyword titles above).
  { id: "service-requests:complaint", domain: "service-requests", pattern: /\bcomplaint/i },

  { id: "licensing:license", domain: "licensing", pattern: /licen[cs]e/i },
  { id: "permits:permit", domain: "permits", pattern: /\bpermit/i },
  { id: "inspections:inspect", domain: "inspections", pattern: /inspect/i },

  // Service-request families the complaint pattern misses: the report side
  // (noise, sanitation) and the contact channels (compliments, feedback).
  { id: "service-requests:noise", domain: "service-requests", pattern: /\bnoise (?:from|complaint)/i },
  {
    id: "service-requests:missed-collection",
    domain: "service-requests",
    pattern: /\bmissed (?:trash|recycling|compost|collection)/i,
  },
  { id: "service-requests:litter", domain: "service-requests", pattern: /\blitter/i },
  { id: "service-requests:feedback", domain: "service-requests", pattern: /\b(?:compliment|feedback)\b/i },
  { id: "service-requests:report-verb", domain: "service-requests", pattern: /\breport\b/i },
];

/** Tag an article with its coverage domain. */
export function tagCoverageDomain(entry: IndexArticleEntry): DomainTag {
  for (const field of ["title", "description"] as const) {
    const text = entry[field];
    for (const { id, domain, pattern } of DOMAIN_PATTERNS) {
      if (pattern.test(text)) {
        return { domain, matchedBy: field, patternId: id, taxonomyVersion: DOMAIN_TAXONOMY_VERSION };
      }
    }
  }
  return { domain: "other", matchedBy: "none", patternId: "other:none", taxonomyVersion: DOMAIN_TAXONOMY_VERSION };
}
