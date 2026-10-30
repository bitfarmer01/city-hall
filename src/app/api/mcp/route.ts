// POST /api/mcp — the MCP adapter endpoint: Streamable HTTP, stateless,
// bearer-auth (build spec D9; plugin surface per locked decision #8).
//
// Stateless pattern (MCP TS SDK): a fresh WebStandardStreamableHTTPServer-
// Transport + server per request, `sessionIdGenerator: undefined` — no
// sessions, no cross-request state; every POST is independent. JSON-only
// responses (enableJsonResponse) keep the stateless contract exact — no SSE
// streams to keep alive.
//
// Auth runs before anything else, on every method: a rejected request gets
// 401 with an error envelope and no catalog data (the auth-rejection test
// pins this).

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { getApiContext } from "@/lib/api/context";
import { requireBearerAuth } from "@/lib/api/mcp-auth";
import { createCityHallMcpServer } from "@/lib/api/mcp-server";

export async function POST(request: Request) {
  const auth = requireBearerAuth(request);
  if (!auth.ok) return auth.response;

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createCityHallMcpServer(getApiContext());
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // Stateless: the transport and server live for exactly one request.
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

// Streamable HTTP's GET (server-initiated streams) and DELETE (session
// termination) are session features — meaningless in stateless mode. Reject
// after auth so unauthenticated probes learn nothing about method support.

export async function GET(request: Request) {
  const auth = requireBearerAuth(request);
  if (!auth.ok) return auth.response;
  return methodNotAllowed();
}

export async function DELETE(request: Request) {
  const auth = requireBearerAuth(request);
  if (!auth.ok) return auth.response;
  return methodNotAllowed();
}

function methodNotAllowed(): Response {
  return Response.json(
    { error: { code: "invalid_request", message: "Method not allowed; POST JSON-RPC messages to this endpoint" } },
    { status: 405, headers: { Allow: "POST" } },
  );
}
