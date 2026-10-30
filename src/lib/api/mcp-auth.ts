// Bearer auth for the MCP adapter — build spec D9: Streamable HTTP with
// bearer auth, and the auth-rejection guarantee (missing/invalid bearer →
// 401 with NO data). Fail-closed: when MCP_BEARER_TOKEN is unset, every
// request is rejected — the adapter never serves anonymously.
//
// The comparison is timing-safe (node:crypto timingSafeEqual) so token
// validity is not observable through response timing.

import { timingSafeEqual } from "node:crypto";

import type { ApiErrorPayload } from "./types";

const BEARER_PATTERN = /^Bearer[ ]+(.+)$/i;

export type BearerCheck =
  | { ok: true }
  | { ok: false; response: Response };

function unauthorized(message: string): Response {
  const payload: ApiErrorPayload = { error: { code: "invalid_request", message } };
  return Response.json(payload, {
    status: 401,
    headers: { "WWW-Authenticate": 'Bearer realm="city-hall-mcp", error="invalid_token"' },
  });
}

/** Extract the raw Authorization header value, or null when absent/malformed. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = BEARER_PATTERN.exec(header.trim());
  return match ? match[1] : null;
}

/** Timing-safe string compare; unequal lengths never leak which side mismatched. */
export function tokensMatch(a: string, b: string): boolean {
  const aBytes = Buffer.from(a, "utf8");
  const bBytes = Buffer.from(b, "utf8");
  if (aBytes.length !== bBytes.length) {
    // Still burn a comparison on a same-length prefix so short-vs-long
    // probes look identical to same-length wrong-token probes.
    timingSafeEqual(aBytes, aBytes);
    return false;
  }
  return timingSafeEqual(aBytes, bBytes);
}

/**
 * Enforce bearer auth for an MCP request. Returns the rejection response
 * (401, no catalog data in the body) or ok.
 */
export function requireBearerAuth(request: Request): BearerCheck {
  const expected = process.env.MCP_BEARER_TOKEN;
  if (expected === undefined || expected.length === 0) {
    // Fail closed — an unconfigured deployment serves no one.
    console.error("[mcp] MCP_BEARER_TOKEN is not set; rejecting all requests (fail closed)");
    return { ok: false, response: unauthorized("Bearer authentication is required") };
  }

  const presented = bearerToken(request);
  if (!presented || !tokensMatch(presented, expected)) {
    return { ok: false, response: unauthorized("Missing or invalid bearer token") };
  }
  return { ok: true };
}
