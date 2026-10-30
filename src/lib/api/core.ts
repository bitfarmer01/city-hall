// The core API operations — the one internal contract both plugin adapters
// sit on (build spec D9, locked decision #8). Pure functions over versioned
// data: (input, CatalogBundle, estimate registries) → response. No Next
// imports, no clocks, no I/O beyond what the caller hands in — the same
// functions serve the route handlers, the MCP tools, and the tests.
//
// Failure style: ApiRequestError (invalid_request 400 / not_found 404).
// Unknown service IDs are honest 404s, never empty success shapes.

import { SERVICE_ID_PATTERN } from "@/lib/catalog/ids";
import type { BlueprintStepRecord, CatalogBundle, ServiceRecord } from "@/lib/catalog/types";
import {
  buildEstimateBlock,
  renderEstimateHeadline,
  type EstimateContext,
} from "@/lib/estimates";
import type { SurchargeRow } from "@/lib/estimates/surcharges";
import { createResolver, type Resolver } from "@/lib/resolver/resolver";
import type { VersionStamps } from "@/lib/resolver/types";

import {
  ApiRequestError,
  type DocumentEntry,
  type DocumentSummary,
  type EstimateResponse,
  type InstructionStep,
  type RequiredFieldCounts,
  type ResolveGoalRequest,
  type ResolveGoalResponse,
  type ServiceDetailResponse,
  type ServiceSummary,
  type DocumentsResponse,
} from "./types";

/** Estimate registries + the bundle — everything the operations read. */
export interface ApiContext {
  bundle: CatalogBundle;
  estimates: EstimateContext;
  /** Curated surcharge notes keyed by step ID (D6: notes live on instructions). */
  surchargeRows: SurchargeRow[];
  resolver: Resolver;
}

export function buildApiContext(
  bundle: CatalogBundle,
  estimates: EstimateContext,
  surchargeRows: SurchargeRow[] = [],
): ApiContext {
  return { bundle, estimates, surchargeRows, resolver: createResolver(bundle) };
}

// ---------------------------------------------------------------------------
// Input parsing — colocated with the operations; the route registry's
// validators call these (single place each rule lives).
// ---------------------------------------------------------------------------

export function parseGoalInput(value: unknown): ResolveGoalRequest {
  const record = isRecord(value) ? value : {};
  const goal = record.goal;
  if (typeof goal !== "string" || goal.trim().length === 0) {
    throw new ApiRequestError("invalid_request", 400, "Request body must be {\"goal\": string} with a non-empty goal");
  }
  if (goal.length > 2000) {
    throw new ApiRequestError("invalid_request", 400, "goal must be at most 2000 characters");
  }
  return { goal };
}

export function parseServiceId(value: unknown, what: string): string {
  if (typeof value !== "string" || !SERVICE_ID_PATTERN.test(value)) {
    throw new ApiRequestError("invalid_request", 400, `${what} must match ${SERVICE_ID_PATTERN}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ---------------------------------------------------------------------------
// The four operations
// ---------------------------------------------------------------------------

/** POST /api/resolve and the MCP resolve_goal tool. */
export async function resolveGoal(input: ResolveGoalRequest, ctx: ApiContext): Promise<ResolveGoalResponse> {
  const resolution = await ctx.resolver.resolve(input.goal);
  return {
    serviceIds: resolution.serviceIds,
    resolutionLayer: resolution.resolutionLayer,
    services: resolution.serviceIds.map((id) => serviceSummary(requireService(id, ctx))),
    versions: resolution.versions,
  };
}

/** GET /api/services/{id} and the MCP get_service tool — detail + step-by-step instructions. */
export function getServiceDetail(serviceId: string, ctx: ApiContext): ServiceDetailResponse {
  const record = requireService(serviceId, ctx);
  const feesByRef = new Map(ctx.bundle.services.flatMap((s) => s.envelope.offers).map((offer) => [offer.identifier, offer]));
  const notesByStep = surchargeNotesByStepId(ctx.surchargeRows);

  return {
    service: record.envelope,
    instructions: orderedSteps(record).map((step) => instructionStep(step, feesByRef, notesByStep)),
    documents: record.formIds.map((formId) => documentSummary(formId, ctx)),
    versions: versionStamps(ctx),
  };
}

/** GET /api/estimate?serviceId=… and the MCP get_estimate tool. */
export function getServiceEstimate(serviceId: string, ctx: ApiContext): EstimateResponse {
  const record = requireService(serviceId, ctx);
  const block = buildEstimateBlock(record, ctx.estimates);
  return {
    serviceId,
    tiers: block.tiers,
    headline: renderEstimateHeadline(block),
    versions: versionStamps(ctx),
  };
}

/** GET /api/documents?serviceId=… and the MCP get_documents tool. */
export function getServiceDocuments(serviceId: string, ctx: ApiContext): DocumentsResponse {
  const record = requireService(serviceId, ctx);
  return {
    serviceId,
    documents: record.formIds.map((formId) => documentEntry(formId, ctx)),
    versions: versionStamps(ctx),
  };
}

// ---------------------------------------------------------------------------
// Assemblers
// ---------------------------------------------------------------------------

function requireService(serviceId: string, ctx: ApiContext): ServiceRecord {
  const record = ctx.bundle.services.find((s) => s.meta.catalogId === serviceId);
  if (!record) {
    throw new ApiRequestError("not_found", 404, `Unknown service ID: ${serviceId}`);
  }
  return record;
}

/** Steps in display order; the linker guarantees sequences are unique and 1-based. */
function orderedSteps(record: ServiceRecord): BlueprintStepRecord[] {
  return [...record.steps].sort((a, b) => a.sequence - b.sequence);
}

function surchargeNotesByStepId(rows: SurchargeRow[]): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  for (const row of rows) {
    notes.set(row.stepId, [...(notes.get(row.stepId) ?? []), row.note]);
  }
  return notes;
}

function instructionStep(
  step: BlueprintStepRecord,
  feesByRef: ReadonlyMap<string, ServiceRecord["envelope"]["offers"][number]>,
  notesByStep: ReadonlyMap<string, string[]>,
): InstructionStep {
  const offer = step.feeRef ? feesByRef.get(step.feeRef) : undefined;
  return {
    id: step.id,
    sequence: step.sequence,
    ...(step.phase !== undefined && { phase: step.phase }),
    requirement: step.requirement,
    fulfillmentMethod: step.fulfillmentMethod,
    responsibleAgency: step.responsibleAgency,
    ...(step.administeredBy && { administeredBy: step.administeredBy }),
    ...(step.issuedBy && { issuedBy: step.issuedBy }),
    ...(step.upload && {
      upload: {
        ...(step.upload.portalId !== undefined && { portalId: step.upload.portalId }),
        ...(step.upload.portalUrl !== undefined && { portalUrl: step.upload.portalUrl }),
        ...(step.upload.acceptedFormats !== undefined && { acceptedFormats: step.upload.acceptedFormats }),
        maxSizeBytes: step.upload.maxSizeBytes,
        sizeLimitVerified: step.upload.sizeLimitVerified,
        ...(step.upload.multipleAllowed !== undefined && { multipleAllowed: step.upload.multipleAllowed }),
      },
    }),
    ...(offer && {
      fee: {
        feeId: offer.identifier,
        ...(offer.price !== undefined && { amountValue: offer.price }),
        currency: offer.priceCurrency,
        description: offer.description,
      },
    }),
    feeNotes: notesByStep.get(step.id) ?? [],
    dependencies: step.dependencies ?? [],
    ...(step.notes !== undefined && { notes: step.notes }),
    sourceRefs: step.sourceRefs,
  };
}

function documentSummary(formId: string, ctx: ApiContext): DocumentSummary {
  const form = ctx.bundle.forms.find((f) => f.id === formId);
  if (!form) {
    // The linker rejects dangling formIds; reaching here means a bundle
    // built outside the linker — refuse loudly rather than omit silently.
    throw new Error(`bundle integrity: service references unknown form ${formId}`);
  }
  return {
    formId: form.id,
    formNumber: form.formNumber,
    title: form.title,
    sourceUrl: form.sourceUrl,
    fillableClass: form.fillableClass,
  };
}

function documentEntry(formId: string, ctx: ApiContext): DocumentEntry {
  const form = ctx.bundle.forms.find((f) => f.id === formId);
  if (!form) {
    // The linker rejects dangling formIds; reaching here means a bundle
    // built outside the linker — refuse loudly rather than omit silently.
    throw new Error(`bundle integrity: service references unknown form ${formId}`);
  }
  const fields = ctx.bundle.formFields.filter((f) => f.formId === formId);
  const counts: RequiredFieldCounts = {
    total: fields.length,
    author_declared_required: fields.filter((f) => f.requiredStatus === "author_declared_required").length,
    not_marked_required: fields.filter((f) => f.requiredStatus === "not_marked_required").length,
    inferred_required: fields.filter((f) => f.requiredStatus === "inferred_required").length,
    unknown: fields.filter((f) => f.requiredStatus === "unknown").length,
  };
  return {
    formId: form.id,
    formNumber: form.formNumber,
    title: form.title,
    sourceUrl: form.sourceUrl,
    fillableClass: form.fillableClass,
    pages: form.pages,
    sha256: form.sha256,
    ...(form.revisionDate !== undefined && { revisionDate: form.revisionDate }),
    fieldCounts: counts,
  };
}

function serviceSummary(record: ServiceRecord): ServiceSummary {
  return {
    id: record.meta.catalogId,
    name: record.envelope.name,
    serviceType: record.envelope.serviceType,
    providerName: record.envelope.provider.name,
    coverageDomain: record.meta.domain,
    nyc311ArticleId: record.meta.nyc311ArticleId,
    detailUrl: `/api/services/${encodeURIComponent(record.meta.catalogId)}`,
  };
}

function versionStamps(ctx: ApiContext): VersionStamps {
  return ctx.resolver.versions;
}
