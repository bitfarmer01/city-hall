// API response envelopes + error shapes for the four MCP tools (deliverable
// 6, spec D9). This is the one internal contract both adapters and the web
// app share: the web app's own routes return these shapes, and each adapter
// (MCP, OpenAPI) is a thin skin over them.
//
// Every response carries version stamps — the three data stamps (spec D5)
// plus the app/schema stamps every API response carries (AGENTS.md) — and
// so does the ERROR envelope (panel H3≡S4-M1): a failed call must be
// replayable against pinned versions too.
//
// STRICT-ENVELOPE EVOLUTION POLICY (panel S4-S1): every envelope is a strict
// object — unknown keys are rejections, not noise, so a consumer that pins a
// schema version gets byte-stable behavior. Additive changes are made by
// adding OPTIONAL fields here and letting strict consumers ignore them;
// breaking changes (required field, type change, removed field) bump the
// catalog schema version and require a parser update on every consumer
// before the producer ships. Request schemas (below) are the write-side of
// the same rule: each tool's input is validated, not trusted.

import { z } from "zod";

import { EstimateBlockSchema } from "./estimate";
import { GoalResolutionSchema } from "./resolution";
import {
  CatalogSnapshotVersionSchema,
  EmbeddingModelVersionSchema,
  SemverVersionSchema,
  ServiceIdSchema,
} from "./primitives";
import { RequiredDocumentSchema } from "./required-document";
import { ServiceSummarySchema } from "./service-summary";
import { StepInstructionSchema } from "./step-instruction";

/**
 * The four tools (task todo_O2keBBqw): resolve services, get service
 * estimate, get step-by-step instructions, get required documents. Spec D9's
 * `get_service` detail tool is served by the summaries in resolve_services
 * until the D4 catalog lands; the D9 worker can add it on top of these
 * envelopes without breaking them.
 */
export const TOOL_NAMES = [
  "resolve_services",
  "get_service_estimate",
  "get_step_instructions",
  "get_required_documents",
] as const;
export const ToolNameSchema = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolNameSchema>;

// ---------------------------------------------------------------------------
// Request schemas (panel H2) — the write side of the four tools. The MCP
// adapter validates tool arguments here before calling the core; the OpenAPI
// schema is generated from the same shapes; the web app routes reuse them
// as input validation. An ID in a request is a claim, not a fact.
// ---------------------------------------------------------------------------

export const ResolveServicesRequestSchema = z.strictObject({
  /** The goal utterance, e.g. "I want to open a restaurant in Brooklyn". */
  goal: z.string().min(1).max(2000),
});
export type ResolveServicesRequest = z.infer<typeof ResolveServicesRequestSchema>;

export const GetServiceEstimateRequestSchema = z.strictObject({
  serviceId: ServiceIdSchema,
});
export type GetServiceEstimateRequest = z.infer<typeof GetServiceEstimateRequestSchema>;

export const GetStepInstructionsRequestSchema = z.strictObject({
  serviceId: ServiceIdSchema,
});
export type GetStepInstructionsRequest = z.infer<typeof GetStepInstructionsRequestSchema>;

export const GetRequiredDocumentsRequestSchema = z.strictObject({
  serviceId: ServiceIdSchema,
});
export type GetRequiredDocumentsRequest = z.infer<typeof GetRequiredDocumentsRequestSchema>;

export const API_ERROR_CODES = [
  "not_found",
  "invalid_input",
  "unsupported_goal",
  "rate_limited",
  "internal",
] as const;
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/**
 * Response version stamps: data stamps (D5) + app/schema (AGENTS.md rule).
 * Each stamp validates against its own producer's format (panel N1): the
 * catalog stamp is the bundle's date-stamp, the retriever stamp is a
 * lowercase token, app/schema/crosswalk are semver. The D5 names map
 * `catalog` ↔ `catalog_version`, `crosswalk` ↔ `crosswalk_version`,
 * `embeddingModel` ↔ `embedding_model_version`.
 */
export const ResponseVersionsSchema = z.strictObject({
  app: SemverVersionSchema,
  schema: SemverVersionSchema,
  catalog: CatalogSnapshotVersionSchema,
  crosswalk: SemverVersionSchema,
  embeddingModel: EmbeddingModelVersionSchema,
});
export type ResponseVersions = z.infer<typeof ResponseVersionsSchema>;

/**
 * Control-character and ANSI-escape stripping at the contract boundary
 * (panel S4): error text is echoed to surfaces and logs, so terminal escape
 * sequences and C0 control chars never ride through. CSI sequences are
 * removed whole; any remaining C0/C1 DEL byte is removed individually.
 */
const stripControlAndAnsi = (text: string): string =>
  text.replace(/\u001B\[[0-9;]*[A-Za-z]|[\u0000-\u001F\u007F]/g, "");

const ErrorTextSchema = (max: number) =>
  z.string().transform(stripControlAndAnsi).pipe(z.string().min(1).max(max));

/**
 * Failure envelope. `code` routes recovery; `message` is human-readable.
 * `versions` rides every failure too (panel H3≡S4-M1 — AGENTS.md
 * every-response rule): failed calls are replayable against pinned versions.
 */
export const ApiErrorEnvelopeSchema = z.strictObject({
  ok: z.literal(false),
  tool: ToolNameSchema,
  versions: ResponseVersionsSchema,
  error: z.strictObject({
    code: ApiErrorCodeSchema,
    message: ErrorTextSchema(2000),
    detail: ErrorTextSchema(4000).optional(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

/** Success-envelope shell; per-tool schemas spread this with their `data`. */
const ApiSuccessBase = {
  ok: z.literal(true),
  tool: ToolNameSchema,
  versions: ResponseVersionsSchema,
} as const;

export const ResolveServicesResultSchema = z.strictObject({
  ...ApiSuccessBase,
  tool: z.literal("resolve_services"),
  data: z.strictObject({
    resolution: GoalResolutionSchema,
    /** Summaries for the resolved ids, same order — what surfaces render. */
    // Defensive cap (panel S4-S3): a goal resolving to more services than
    // this is a crosswalk bug, not a bigger page.
    services: z.array(ServiceSummarySchema).max(50),
  }),
});
export type ResolveServicesResult = z.infer<typeof ResolveServicesResultSchema>;

export const GetServiceEstimateResultSchema = z.strictObject({
  ...ApiSuccessBase,
  tool: z.literal("get_service_estimate"),
  data: z.strictObject({
    serviceId: ServiceIdSchema,
    estimate: EstimateBlockSchema,
  }),
});
export type GetServiceEstimateResult = z.infer<typeof GetServiceEstimateResultSchema>;

export const GetStepInstructionsResultSchema = z.strictObject({
  ...ApiSuccessBase,
  tool: z.literal("get_step_instructions"),
  data: z.strictObject({
    serviceId: ServiceIdSchema,
    steps: z.array(StepInstructionSchema).max(50),
  }),
});
export type GetStepInstructionsResult = z.infer<typeof GetStepInstructionsResultSchema>;

export const GetRequiredDocumentsResultSchema = z.strictObject({
  ...ApiSuccessBase,
  tool: z.literal("get_required_documents"),
  data: z.strictObject({
    serviceId: ServiceIdSchema,
    documents: z.array(RequiredDocumentSchema).max(50),
  }),
});
export type GetRequiredDocumentsResult = z.infer<typeof GetRequiredDocumentsResultSchema>;

/** All four tool results, discriminated by `tool` — adapter dispatch shape. */
export const ApiSuccessEnvelopeSchema = z.discriminatedUnion("tool", [
  ResolveServicesResultSchema,
  GetServiceEstimateResultSchema,
  GetStepInstructionsResultSchema,
  GetRequiredDocumentsResultSchema,
]);
export type ApiSuccessEnvelope = z.infer<typeof ApiSuccessEnvelopeSchema>;

export const ApiResponseSchema = z.union([ApiSuccessEnvelopeSchema, ApiErrorEnvelopeSchema]);
export type ApiResponse = z.infer<typeof ApiResponseSchema>;
