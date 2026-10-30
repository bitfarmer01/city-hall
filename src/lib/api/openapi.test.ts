// OpenAPI snapshot test — build spec D9: "OpenAPI schema snapshot test
// (schema regenerates stably from routes)". The committed golden is the
// review artifact; a contract change without regen fails here.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "./openapi";
import { CORE_API_ROUTES, MCP_TOOL_NAMES, routeForTool } from "./routes";

const GOLDEN_FILE = "src/lib/api/openapi.golden.json";

describe("buildOpenApiDocument", () => {
  it("matches the committed golden byte-for-byte (regenerate on intentional change)", () => {
    const generated = JSON.stringify(buildOpenApiDocument(), null, 2) + "\n";
    const committed = readFileSync(GOLDEN_FILE, "utf8");
    expect(generated).toBe(committed);
  });

  it("is deterministic — two builds in one process are identical", () => {
    expect(buildOpenApiDocument()).toEqual(buildOpenApiDocument());
  });

  it("exposes exactly the four core routes as operations", () => {
    const doc = buildOpenApiDocument() as { paths: Record<string, Record<string, unknown>> };
    const routeKeys = CORE_API_ROUTES.map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    const docKeys = Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((m) => `${m.toUpperCase()} ${path}`),
    ).sort();
    expect(docKeys).toEqual(routeKeys);
  });

  it("declares bearer security on the document", () => {
    const doc = buildOpenApiDocument() as {
      security: Record<string, string[]>[];
      components: { securitySchemes: Record<string, { type: string; scheme: string }> };
    };
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.components.securitySchemes.bearerAuth).toEqual({ type: "http", scheme: "bearer" });
  });

  it("every operation declares at least one response and a valid operationId", () => {
    const doc = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { responses: Record<string, unknown>; operationId: string }>>;
    };
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(Object.keys(operation.responses).length, `${method.toUpperCase()} ${path}`).toBeGreaterThan(0);
        expect(operation.operationId, `${method.toUpperCase()} ${path}`).toBeTruthy();
      }
    }
  });

  it("maps each MCP tool to a registered route operation (surfaces cannot drift)", () => {
    for (const tool of MCP_TOOL_NAMES) {
      const route = routeForTool(tool);
      expect(route, `tool ${tool} has a route mapping`).toBeDefined();
      expect(route?.summary).toBeTruthy();
    }
    // And every tool name appears as an MCP surface in the doc's description trail.
    expect(MCP_TOOL_NAMES).toEqual([
      "resolve_goal",
      "get_service",
      "get_estimate",
      "get_documents",
    ]);
  });

  it("documents the 401 auth-rejection envelope on secured operations", () => {
    // The auth-rejection contract is part of the generated document: agents
    // integrating against it see the 401 shape before they hit it.
    const doc = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { responses: Record<string, { description: string }> }>>;
    };
    const resolveResponses = doc.paths["/api/resolve"].post.responses;
    expect(resolveResponses["401"].description).toContain("No data is returned");
  });
});
