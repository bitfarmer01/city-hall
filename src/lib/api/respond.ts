// Response helpers for the core route handlers — the only place an
// ApiRequestError becomes an HTTP status. Error envelopes carry no catalog
// data and no version stamps (the auth-rejection test relies on the same
// shape for 401s: no data, ever).

import { ApiRequestError, type ApiErrorPayload } from "./types";

export function jsonOk(payload: unknown, status: 200 = 200): Response {
  return Response.json(payload, { status });
}

export function jsonError(error: ApiErrorPayload, status: 400 | 404): Response {
  return Response.json(error, { status });
}

/** Map a thrown error from a core operation to its wire response. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiRequestError) {
    return jsonError({ error: { code: error.code, message: error.message } }, error.httpStatus);
  }
  // Never swallow: an unexpected failure is a 500 with the message in the
  // server log, and a generic envelope on the wire.
  console.error("[api] unhandled error:", error);
  return Response.json(
    { error: { code: "internal" as const, message: "Internal error" } },
    { status: 500 },
  );
}
