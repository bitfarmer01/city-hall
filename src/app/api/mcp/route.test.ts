// MCP adapter tests — the D9 verified-by trio, on the /api/mcp endpoint:
//
// 1. MCP-client integration: a REAL MCP client (official SDK) drives the
//    stateless Streamable HTTP endpoint through an in-process fetch shim
//    and exercises all four tools against the committed catalog.
// 2. OpenAPI surface: the generated document is served at /api/openapi.json
//    (covered in ../routes.test.ts and the snapshot test).
// 3. Auth rejection: missing bearer / invalid bearer / unconfigured token →
//    401 with an error envelope and NO catalog data in the body.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

import { MCP_TOOL_NAMES } from "@/lib/api/routes";

const MCP_URL = "http://localhost:3000/api/mcp";
const TEST_TOKEN = "test-bearer-token-ci-only";

/** In-process fetch shim: dispatches to the route handler, injecting the bearer header. */
function makeFetchLike(token: string | null): FetchLike {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    if (token !== null) headers.set("authorization", `Bearer ${token}`);
    const request = new Request(typeof url === "string" ? url : url.toString(), {
      method: init?.method ?? "POST",
      headers,
      body: init?.body,
    });
    const { POST, GET } = await import("./route");
    return request.method === "GET" ? GET(request) : POST(request);
  };
}

async function connectClient(token: string | null): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: makeFetchLike(token) });
  const client = new Client({ name: "city-hall-test-client", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

function toolPayload(raw: unknown): Record<string, unknown> {
  const result = raw as { isError?: boolean; content: { type: string; text: string }[] };
  expect(result.isError, JSON.stringify(result).slice(0, 400)).toBeFalsy();
  const text = result.content[0]?.text ?? "";
  return JSON.parse(text) as Record<string, unknown>;
}

const DOG = "svc:dohmh:dog-license";

beforeAll(() => {
  vi.stubEnv("MCP_BEARER_TOKEN", TEST_TOKEN);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("MCP integration (official client, stateless Streamable HTTP)", () => {
  it("handshakes and lists exactly the four spec tools with descriptions", async () => {
    const client = await connectClient(TEST_TOKEN);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
      for (const tool of tools) {
        expect(tool.description?.length ?? 0).toBeGreaterThan(20);
      }
      // The goal tool declares its required string argument.
      const resolveTool = tools.find((t) => t.name === "resolve_goal");
      expect(resolveTool?.inputSchema).toMatchObject({
        type: "object",
        properties: { goal: { type: "string" } },
        required: ["goal"],
      });
    } finally {
      await client.close();
    }
  });

  it("resolve_goal resolves a natural-language goal against the committed catalog", async () => {
    const client = await connectClient(TEST_TOKEN);
    try {
      const payload = toolPayload(await client.callTool({ name: "resolve_goal", arguments: { goal: "I want to license my dog" } }));
      expect((payload.serviceIds as string[])).toContain(DOG);
      const dog = (payload.services as { id: string; name: string }[]).find((s) => s.id === DOG);
      expect(dog?.name).toBe("Dog License");
      // Version stamps ride along — the replay contract holds over MCP.
      expect((payload.versions as Record<string, string>).catalogVersion).toBeTruthy();
    } finally {
      await client.close();
    }
  });

  it("get_service returns the envelope and ordered instructions", async () => {
    const client = await connectClient(TEST_TOKEN);
    try {
      const payload = toolPayload(
        await client.callTool({ name: "get_service", arguments: { serviceId: "svc:dcwp:home-improvement-contractor-license" } }),
      );
      const detail = payload as unknown as { service: { name: string }; instructions: { sequence: number }[] };
      expect(detail.service.name).toBe("Home Improvement Contractor License");
      const sequences = detail.instructions.map((s) => s.sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    } finally {
      await client.close();
    }
  });

  it("get_estimate returns the tiered estimate with sources", async () => {
    const client = await connectClient(TEST_TOKEN);
    try {
      const payload = toolPayload(
        await client.callTool({
          name: "get_estimate",
          arguments: { serviceId: "svc:dcwp:home-improvement-contractor-license" },
        }),
      );
      const estimate = payload as unknown as { tiers: { tier: number; sourceUrl?: string }[] };
      const tier1 = estimate.tiers.find((t) => t.tier === 1);
      expect(tier1?.sourceUrl).toContain("KA-01808");
    } finally {
      await client.close();
    }
  });

  it("get_documents returns the document catalog with required-status counts", async () => {
    const client = await connectClient(TEST_TOKEN);
    try {
      const payload = toolPayload(await client.callTool({ name: "get_documents", arguments: { serviceId: DOG } }));
      const documents = payload as unknown as { serviceId: string; documents: { formId: string; fieldCounts: unknown }[] };
      expect(documents.serviceId).toBe(DOG);
      for (const doc of documents.documents) {
        expect(doc.formId).toMatch(/^form:/);
        expect(doc.fieldCounts).toBeDefined();
      }
    } finally {
      await client.close();
    }
  });

  it("reports a tool error (not a crash) for an unknown service ID", async () => {
    const client = await connectClient(TEST_TOKEN);
    try {
      const result = (await client.callTool({
        name: "get_service",
        arguments: { serviceId: "svc:nonexistent:service" },
      })) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Unknown service ID");
    } finally {
      await client.close();
    }
  });

  it("is stateless: two independent clients get identical resolve results", async () => {
    const a = await connectClient(TEST_TOKEN);
    const b = await connectClient(TEST_TOKEN);
    try {
      const args = { name: "resolve_goal", arguments: { goal: "birth certificate" } } as const;
      expect(toolPayload(await a.callTool(args))).toEqual(toolPayload(await b.callTool(args)));
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe("MCP auth rejection — 401, no data", () => {
  const PROBE_BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

  async function postWith(authorization?: string): Promise<Response> {
    const { POST } = await import("./route");
    return POST(
      new Request(MCP_URL, {
        method: "POST",
        headers: { "content-type": "application/json", ...(authorization && { authorization }) },
        body: PROBE_BODY,
      }),
    );
  }

  it("rejects a request with no Authorization header", async () => {
    const response = await postWith();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("rejects a wrong token", async () => {
    const response = await postWith("Bearer wrong-token");
    expect(response.status).toBe(401);
  });

  it("rejects a malformed Authorization header", async () => {
    expect((await postWith("Basic dXNlcjpwYXNz")).status).toBe(401);
    expect((await postWith("Bearer")).status).toBe(401);
  });

  it("fails closed when MCP_BEARER_TOKEN is unset", async () => {
    vi.stubEnv("MCP_BEARER_TOKEN", undefined as unknown as string);
    try {
      const response = await postWith(`Bearer ${TEST_TOKEN}`);
      expect(response.status).toBe(401);
    } finally {
      vi.stubEnv("MCP_BEARER_TOKEN", TEST_TOKEN);
    }
  });

  it("the 401 body is an error envelope with no catalog data", async () => {
    const response = await postWith("Bearer wrong-token");
    const text = await response.text();
    const payload = JSON.parse(text) as { error: { code: string } };
    expect(payload.error.code).toBe("invalid_request");
    // The no-data guarantee: none of the catalog's shapes leak on rejection.
    expect(text).not.toContain("serviceIds");
    expect(text).not.toContain("envelope");
    expect(text).not.toContain("instructions");
    expect(text).not.toContain("svc:");
  });

  it("rejects unauthenticated method probes (GET/DELETE) with 401, authenticated ones with 405", async () => {
    const { GET, DELETE } = await import("./route");
    const unauthGet = await GET(new Request(MCP_URL));
    expect(unauthGet.status).toBe(401);

    const authGet = await GET(new Request(MCP_URL, { headers: { authorization: `Bearer ${TEST_TOKEN}` } }));
    expect(authGet.status).toBe(405);
    expect(authGet.headers.get("allow")).toBe("POST");

    const authDelete = await DELETE(new Request(MCP_URL, { method: "DELETE", headers: { authorization: `Bearer ${TEST_TOKEN}` } }));
    expect(authDelete.status).toBe(405);
  });
});
