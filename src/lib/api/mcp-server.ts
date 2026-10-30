// The MCP adapter's server factory — build spec D9 (locked decision #8).
// A thin surface over the SAME core operations the routes dispatch to: the
// four tools (resolve_goal, get_service, get_estimate, get_documents) call
// resolveGoal / getServiceDetail / getServiceEstimate / getServiceDocuments.
// Determinism lives in the core, never in the harness — this file adds no
// logic, only protocol.
//
// Tool names and descriptions come from the route registry (routes.ts), so
// the MCP surface and the generated OpenAPI document cannot drift apart.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { SERVICE_ID_PATTERN } from "@/lib/catalog/ids";
import { APP_VERSION } from "@/lib/health";

import {
  getServiceDetail,
  getServiceDocuments,
  getServiceEstimate,
  resolveGoal,
  parseGoalInput,
  parseServiceId,
  type ApiContext,
} from "./core";
import { routeForTool } from "./routes";

/** Tool result content: pretty-printed JSON of the core response payload. */
function jsonContent(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

const SERVICE_ID_SHAPE = z.string().regex(SERVICE_ID_PATTERN).describe("Catalog service ID, e.g. svc:dohmh:dog-license");

/**
 * Build the city-hall MCP server over an API context. A fresh server per
 * request (the stateless pattern) — no sessions, no cross-request state.
 */
export function createCityHallMcpServer(ctx: ApiContext): McpServer {
  const server = new McpServer(
    { name: "city-hall", version: APP_VERSION },
    { instructions:
        "NYC Service Estimation Assistant — resolve a goal ('I want to build X') to NYC services, then " +
        "fetch each service's estimate, step-by-step instructions, and required documents. Every answer " +
        "carries catalog/crosswalk/embedding version stamps; it is grounded in the city-hall catalog, not generated.",
    },
  );

  const resolveRoute = routeForTool("resolve_goal");
  server.registerTool(
    "resolve_goal",
    {
      title: resolveRoute?.summary,
      description: resolveRoute?.description,
      inputSchema: { goal: z.string().min(1).max(2000).describe("Free-form goal utterance, e.g. 'I want to license my dog'") },
    },
    async ({ goal }) => jsonContent(await resolveGoal(parseGoalInput({ goal }), ctx)),
  );

  const serviceRoute = routeForTool("get_service");
  server.registerTool(
    "get_service",
    {
      title: serviceRoute?.summary,
      description: serviceRoute?.description,
      inputSchema: { serviceId: SERVICE_ID_SHAPE },
    },
    async ({ serviceId }) => jsonContent(getServiceDetail(parseServiceId(serviceId, "serviceId"), ctx)),
  );

  const estimateRoute = routeForTool("get_estimate");
  server.registerTool(
    "get_estimate",
    {
      title: estimateRoute?.summary,
      description: estimateRoute?.description,
      inputSchema: { serviceId: SERVICE_ID_SHAPE },
    },
    async ({ serviceId }) => jsonContent(getServiceEstimate(parseServiceId(serviceId, "serviceId"), ctx)),
  );

  const documentsRoute = routeForTool("get_documents");
  server.registerTool(
    "get_documents",
    {
      title: documentsRoute?.summary,
      description: documentsRoute?.description,
      inputSchema: { serviceId: SERVICE_ID_SHAPE },
    },
    async ({ serviceId }) => jsonContent(getServiceDocuments(parseServiceId(serviceId, "serviceId"), ctx)),
  );

  return server;
}
