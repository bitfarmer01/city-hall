// The core API route registry — the ONE definition of each route. The OpenAPI
// document is generated from these definitions (never hand-maintained), the
// route handlers in src/app/api dispatch through them, and the MCP adapter's
// tool descriptions quote the same operation summaries. Adding a route here
// is what makes it exist on every surface (locked decision #8).

import { SERVICE_ID_PATTERN } from "@/lib/catalog/ids";

/** The auth-rejection response shared by every operation (no data on 401 — ever). */
const UNAUTHORIZED_RESPONSE = {
  description: "Missing or invalid bearer token. No data is returned.",
  schemaRef: "ApiError",
} as const;

export type ParamDefinition = {
  name: string;
  in: "path" | "query";
  description: string;
  schema: { type: "string"; pattern?: string };
};

export type ResponseDefinition = {
  description: string;
  /** Component schema name for the success payload, when there is one. */
  schemaRef?: string;
};

export type RouteDefinition = {
  /** OpenAPI path template — braces mark path parameters. */
  path: string;
  method: "get" | "post";
  operationId: string;
  summary: string;
  description: string;
  params?: ParamDefinition[];
  requestBody?: { description: string; schemaRef: string };
  responses: Record<string, ResponseDefinition>;
};

/**
 * The four core routes (spec D9 "Core API"): the web app's own data routes.
 * Every plugin surface is an adapter over exactly these — a new agent
 * integration is a schema over this registry, not a fork of the logic.
 */
export const CORE_API_ROUTES: RouteDefinition[] = [
  {
    path: "/api/resolve",
    method: "post",
    operationId: "resolveGoal",
    summary: "Resolve a goal to NYC services",
    description:
      "Resolves a free-form goal utterance (\"I want to build X\") to an ordered set of NYC service IDs " +
      "through the deterministic five-layer resolver. The same goal with the same pinned versions always " +
      "yields the same service set; the layer that fired is part of the response. An empty serviceIds " +
      "array is an honest no-match.",
    requestBody: { description: "The goal utterance.", schemaRef: "ResolveGoalRequest" },
    responses: {
      "200": { description: "Ordered service set with per-service summaries and version stamps.", schemaRef: "ResolveGoalResponse" },
      "400": { description: "Malformed request (missing/empty goal).", schemaRef: "ApiError" },
      "401": UNAUTHORIZED_RESPONSE,
    },
  },
  {
    path: "/api/services/{id}",
    method: "get",
    operationId: "getService",
    summary: "Get service detail with step-by-step instructions",
    description:
      "Returns the service's pure schema.org GovernmentService envelope, its ordered step-by-step " +
      "instructions (each labeled with the responsible agency, fulfillment method, upload constraints, " +
      "resolved fee, and surcharge notes), and the forms it requires. State, federal, and utility " +
      "requirements appear as labeled dependencies on steps, distinct from NYC-run steps.",
    params: [
      {
        name: "id",
        in: "path",
        description: "Catalog service ID, e.g. svc:dohmh:dog-license.",
        schema: { type: "string", pattern: SERVICE_ID_PATTERN.source },
      },
    ],
    responses: {
      "200": { description: "Service envelope, ordered instructions, and document summaries.", schemaRef: "ServiceDetailResponse" },
      "400": { description: "Service ID does not match the catalog ID pattern.", schemaRef: "ApiError" },
      "401": UNAUTHORIZED_RESPONSE,
      "404": { description: "Unknown service ID.", schemaRef: "ApiError" },
    },
  },
  {
    path: "/api/estimate",
    method: "get",
    operationId: "getEstimate",
    summary: "Get the tiered estimate for a service",
    description:
      "Tiered estimate for one service: tier-1 fees verbatim with source citation and capture date, " +
      "tier-2 empirical timelines with dataset provenance, tier-3 heuristics explicitly labeled. Every " +
      "rendered headline line carries its source or label; surcharges never appear in a headline (they " +
      "live on the step instructions).",
    params: [
      {
        name: "serviceId",
        in: "query",
        description: "Catalog service ID, e.g. svc:dcwp:home-improvement-contractor-license.",
        schema: { type: "string", pattern: SERVICE_ID_PATTERN.source },
      },
    ],
    responses: {
      "200": { description: "Tiered estimate with rendered headline lines and version stamps.", schemaRef: "EstimateResponse" },
      "400": { description: "Missing or malformed serviceId.", schemaRef: "ApiError" },
      "401": UNAUTHORIZED_RESPONSE,
      "404": { description: "Unknown service ID.", schemaRef: "ApiError" },
    },
  },
  {
    path: "/api/documents",
    method: "get",
    operationId: "getDocuments",
    summary: "Get the required documents for a service",
    description:
      "The document catalog for one service: every required form with its source URL, fillable class, " +
      "hash, and a required-status summary of its extracted fields (the honest four-value enum — never " +
      "collapsed to a boolean).",
    params: [
      {
        name: "serviceId",
        in: "query",
        description: "Catalog service ID, e.g. svc:dohmh:dog-license.",
        schema: { type: "string", pattern: SERVICE_ID_PATTERN.source },
      },
    ],
    responses: {
      "200": { description: "Required documents with field required-status summaries.", schemaRef: "DocumentsResponse" },
      "400": { description: "Missing or malformed serviceId.", schemaRef: "ApiError" },
      "401": UNAUTHORIZED_RESPONSE,
      "404": { description: "Unknown service ID.", schemaRef: "ApiError" },
    },
  },
];

/** MCP tool name ←→ route operationId, so adapters cannot drift apart. */
export const MCP_TOOL_TO_OPERATION: Record<string, string> = {
  resolve_goal: "resolveGoal",
  get_service: "getService",
  get_estimate: "getEstimate",
  get_documents: "getDocuments",
};

/** The four MCP tool names, in contract order (build spec D9). */
export const MCP_TOOL_NAMES: string[] = Object.keys(MCP_TOOL_TO_OPERATION);

/** Look up a route by its MCP tool name — the MCP adapter's source of descriptions. */
export function routeForTool(toolName: string): RouteDefinition | undefined {
  const operationId = MCP_TOOL_TO_OPERATION[toolName];
  return CORE_API_ROUTES.find((route) => route.operationId === operationId);
}
