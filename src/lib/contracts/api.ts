// API response envelopes + error shapes for the four MCP tools (deliverable
// 6, spec D9). This is the one internal contract both adapters and the web
// app share: the web app's own routes return these shapes, and each adapter
// (MCP, OpenAPI) is a thin skin over them.
//
// Every response carries version stamps — the three data stamps (spec D5)
// plus the app/schema stamps every API response carries (AGENTS.md).

import { z } from "zod";

import { EstimateBlockSchema } from "./estimate";
import { GoalResolutionSchema } from "./resolution";
import {
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

export const API_ERROR_CODES = [
  "not_found",
  "invalid_input",
  "unsupported_goal",
  "rate_limited",
  "internal",
] as const;
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** Response version stamps: data stamps (D5) + app/schema (AGENTS.md rule). */
export const ResponseVersionsSchema = z.strictObject({
  app: z.string().min(1),
  schema: z.string().min(1),
  catalog: z.string().min(1),
  crosswalk: z.string().min(1),
  embeddingModel: z.string().min(1),
});
export type ResponseVersions = z.infer<typeof ResponseVersionsSchema>;

/** Failure envelope. `code` routes recovery; `message` is human-readable. */
export const ApiErrorEnvelopeSchema = z.strictObject({
  ok: z.literal(false),
  tool: ToolNameSchema,
  error: z.strictObject({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    detail: z.string().optional(),
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
    services: z.array(ServiceSummarySchema),
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
    steps: z.array(StepInstructionSchema),
  }),
});
export type GetStepInstructionsResult = z.infer<typeof GetStepInstructionsResultSchema>;

export const GetRequiredDocumentsResultSchema = z.strictObject({
  ...ApiSuccessBase,
  tool: z.literal("get_required_documents"),
  data: z.strictObject({
    serviceId: ServiceIdSchema,
    documents: z.array(RequiredDocumentSchema),
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
