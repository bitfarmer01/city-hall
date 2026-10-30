// OpenAPI document generation — build spec D9: the GPT Actions schema is
// GENERATED from the same route definitions (CORE_API_ROUTES + the component
// schemas), never hand-maintained. The builder is deterministic — no clock,
// no environment reads — so the snapshot test can pin the document and a
// contract change is always a visible golden diff.

import { OPENAPI_INFO_VERSION, COMPONENT_SCHEMAS } from "./schemas";
import { CORE_API_ROUTES, type RouteDefinition } from "./routes";

const SCHEMA_REF_BASE = "#/components/schemas/";

function schemaRef(name: string): { $ref: string } {
  return { $ref: `${SCHEMA_REF_BASE}${name}` };
}

function parameterObject(route: RouteDefinition): object[] {
  return (route.params ?? []).map((param) => ({
    name: param.name,
    in: param.in,
    required: param.in === "path" ? true : undefined,
    description: param.description,
    schema: param.schema,
  }));
}

function operationObject(route: RouteDefinition): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  for (const [status, definition] of Object.entries(route.responses)) {
    responses[status] = {
      description: definition.description,
      ...(definition.schemaRef && {
        content: { "application/json": { schema: schemaRef(definition.schemaRef) } },
      }),
    };
  }

  return {
    operationId: route.operationId,
    summary: route.summary,
    description: route.description,
    ...(route.params && route.params.length > 0 && { parameters: parameterObject(route) }),
    ...(route.requestBody && {
      requestBody: {
        description: route.requestBody.description,
        required: true,
        content: { "application/json": { schema: schemaRef(route.requestBody.schemaRef) } },
      },
    }),
    responses,
  };
}

/** The generated OpenAPI document for the core API. Pure and clock-free. */
export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of CORE_API_ROUTES) {
    paths[route.path] = { ...paths[route.path], [route.method]: operationObject(route) };
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "city-hall core API",
      version: OPENAPI_INFO_VERSION,
      description:
        "NYC Service Estimation Assistant — resolves goals to NYC services and returns grounded " +
        "estimates, ordered step-by-step instructions, and required documents. This document is " +
        "generated from the core route definitions; the MCP adapter exposes the same operations. " +
        "Every success response carries version stamps (catalog, crosswalk, embedding model) so any " +
        "answer is replayable against pinned data versions.",
    },
    // Servers are deliberately omitted: the GPT Actions surface supplies the
    // deployment base URL at configuration time, and baking one here would
    // invent a fact about the deployment.
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: COMPONENT_SCHEMAS,
    },
    security: [{ bearerAuth: [] }],
  };
}
