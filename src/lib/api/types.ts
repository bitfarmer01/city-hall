// The internal API contract — build spec D9 (art_RVpFZFo1) and locked
// decision #8. One contract, three consumers by construction: the web app
// renders from these routes, the MCP adapter's four tools call these
// operations, and the generated OpenAPI document describes them. The types
// here are the wire shapes; nothing outside this file may add fields to a
// response without an OpenAPI schema to match (the snapshot test pins it).
//
// Every success payload carries `versions` — the three version stamps
// (catalog / crosswalk / embedding model) that make any answer replayable
// with pinned data (locked decision #7's determinism guarantee, applied to
// the API surface per AGENTS.md).

import type { ServiceEnvelope } from "@/lib/catalog/types";
import type { EstimateTier } from "@/lib/estimates/types";
import type { VersionStamps } from "@/lib/resolver/types";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ApiErrorCode = "invalid_request" | "not_found" | "internal";

export interface ApiErrorPayload {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

/** Typed failure surfaced by the core operations; route handlers map it to a status. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly httpStatus: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

// ---------------------------------------------------------------------------
// POST /api/resolve — goal → ordered service set
// ---------------------------------------------------------------------------

export interface ResolveGoalRequest {
  /** Free-form goal utterance, e.g. "I want to license my dog". */
  goal: string;
}

/** What the surfaces render on the results page, in resolution order. */
export interface ServiceSummary {
  id: string;
  name: string;
  serviceType: string;
  providerName: string;
  /** Coverage domain from the D2b taxonomy (locked decision #12). */
  coverageDomain: string;
  nyc311ArticleId: string;
  detailUrl: string;
}

export interface ResolveGoalResponse {
  /** Ordered resolved service IDs; highest-confidence first. Empty = no-match. */
  serviceIds: string[];
  /**
   * The resolver layer that fired. `llm_assist` never appears here in v1 —
   * the API context runs the deterministic core only (no injected fallback),
   * per locked decision #7: a no-match stands as the answer.
   */
  resolutionLayer: string;
  /** Per-service summaries in the same order as `serviceIds`. */
  services: ServiceSummary[];
  versions: VersionStamps;
}

// ---------------------------------------------------------------------------
// GET /api/services/{id} — service detail with step-by-step instructions
// ---------------------------------------------------------------------------

/** One ordered instruction: a blueprint step with its fee resolved and its surcharge notes attached. */
export interface InstructionStep {
  id: string;
  sequence: number;
  phase?: string;
  requirement: string;
  fulfillmentMethod: string;
  responsibleAgency: { id: string; name: string };
  administeredBy?: { id: string; name: string };
  issuedBy?: { id: string; name: string };
  upload?: {
    portalId?: string;
    portalUrl?: string;
    acceptedFormats?: string[];
    /** null when no source states a limit — sizeLimitVerified says which. */
    maxSizeBytes: number | null;
    sizeLimitVerified: boolean;
    multipleAllowed?: boolean;
  };
  /** The step's feeRef offer resolved into display shape, when one is set. */
  fee?: {
    feeId: string;
    amountValue?: number;
    currency: string;
    description: string;
  };
  /** Contingent fees/surcharges — rendered here per the D6 surcharge rule, never in a headline. */
  feeNotes: string[];
  dependencies: { agencyId?: string; label: string; note?: string }[];
  notes?: string;
  sourceRefs: string[];
}

/** Form catalog summary on the service detail; the per-form detail lives on /api/documents. */
export interface DocumentSummary {
  formId: string;
  formNumber: string | null;
  title: string;
  sourceUrl: string;
  fillableClass: string;
}

export interface ServiceDetailResponse {
  /** The pure schema.org GovernmentService JSON-LD envelope (locked decision #4). */
  service: ServiceEnvelope;
  /** Ordered step-by-step instructions (sequence ascending). */
  instructions: InstructionStep[];
  /** Forms required by the service. */
  documents: DocumentSummary[];
  versions: VersionStamps;
}

// ---------------------------------------------------------------------------
// GET /api/estimate?serviceId=… — tiered estimate
// ---------------------------------------------------------------------------

export interface EstimateResponse {
  serviceId: string;
  /** Tier 1 → 2 → 3, each item labeled by its tier (D6). */
  tiers: EstimateTier[];
  /**
   * Rendered headline lines (renderEstimateHeadline): every fee carries its
   * source citation and as-of; a heuristic line carries its label.
   */
  headline: string[];
  versions: VersionStamps;
}

// ---------------------------------------------------------------------------
// GET /api/documents?serviceId=… — required document catalog
// ---------------------------------------------------------------------------

/** Required-status counts by the honest four-value enum — never collapsed to a boolean (locked decision #6). */
export interface RequiredFieldCounts {
  total: number;
  author_declared_required: number;
  not_marked_required: number;
  inferred_required: number;
  unknown: number;
}

export interface DocumentEntry extends DocumentSummary {
  pages: number;
  sha256: string;
  revisionDate?: string;
  fieldCounts: RequiredFieldCounts | null;
}

export interface DocumentsResponse {
  serviceId: string;
  documents: DocumentEntry[];
  versions: VersionStamps;
}
