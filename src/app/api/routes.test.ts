// Route-handler tests — the thin adapters. These cover the HTTP seams the
// unit tests don't: status codes, the error envelope on the wire, missing
// query parameters, and the served OpenAPI document.

import { describe, expect, it } from "vitest";

import { POST as resolvePOST } from "./resolve/route";
import { GET as serviceGET } from "./services/[id]/route";
import { GET as estimateGET } from "./estimate/route";
import { GET as documentsGET } from "./documents/route";
import { GET as openapiGET } from "./openapi.json/route";
import { buildOpenApiDocument } from "@/lib/api/openapi";

const DOG = "svc:dohmh:dog-license";

function jsonRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/resolve", () => {
  it("200s with the service set and version stamps", async () => {
    const response = await resolvePOST(jsonRequest("http://localhost/api/resolve", { goal: "license my dog" }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.serviceIds).toContain(DOG);
    expect(payload.versions.catalogVersion).toBeTruthy();
  });

  it("400s a malformed body with the error envelope", async () => {
    const response = await resolvePOST(jsonRequest("http://localhost/api/resolve", { wrong: true }));
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.code).toBe("invalid_request");
    expect(payload.error.message).toBeTruthy();
  });

  it("400s a non-JSON body", async () => {
    const response = await resolvePOST(
      new Request("http://localhost/api/resolve", { method: "POST", body: "not json" }),
    );
    expect(response.status).toBe(400);
  });
});

describe("GET /api/services/[id]", () => {
  it("200s with detail for a known ID (URL-encoded)", async () => {
    const url = `http://localhost/api/services/${encodeURIComponent(DOG)}`;
    const response = await serviceGET(new Request(url), { params: Promise.resolve({ id: encodeURIComponent(DOG) }) });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.service.name).toBe("Dog License");
    expect(payload.versions.crosswalkVersion).toBeTruthy();
  });

  it("404s an unknown ID", async () => {
    const response = await serviceGET(new Request("http://localhost/api/services/svc:x:y"), {
      params: Promise.resolve({ id: "svc:x:y" }),
    });
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error.code).toBe("not_found");
  });

  it("400s a malformed ID", async () => {
    const response = await serviceGET(new Request("http://localhost/api/services/garbage"), {
      params: Promise.resolve({ id: "garbage" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("GET /api/estimate and /api/documents", () => {
  it("400s a missing serviceId query parameter", async () => {
    const estimate = await estimateGET(new Request("http://localhost/api/estimate"));
    expect(estimate.status).toBe(400);
    const documents = await documentsGET(new Request("http://localhost/api/documents"));
    expect(documents.status).toBe(400);
  });

  it("400s a malformed serviceId", async () => {
    const estimate = await estimateGET(new Request("http://localhost/api/estimate?serviceId=oops"));
    expect(estimate.status).toBe(400);
  });

  it("200s the estimate for a known ID", async () => {
    const url = `http://localhost/api/estimate?serviceId=${encodeURIComponent(DOG)}`;
    const response = await estimateGET(new Request(url));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.serviceId).toBe(DOG);
    expect(Array.isArray(payload.tiers)).toBe(true);
  });

  it("200s the documents for a known ID", async () => {
    const url = `http://localhost/api/documents?serviceId=${encodeURIComponent(DOG)}`;
    const response = await documentsGET(new Request(url));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.serviceId).toBe(DOG);
    expect(Array.isArray(payload.documents)).toBe(true);
  });

  it("404s an unknown serviceId", async () => {
    const url = "http://localhost/api/estimate?serviceId=svc:nonexistent:service";
    expect((await estimateGET(new Request(url))).status).toBe(404);
    expect((await documentsGET(new Request(url))).status).toBe(404);
  });
});

describe("GET /api/openapi.json", () => {
  it("serves exactly the generated document", async () => {
    const response = await openapiGET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(buildOpenApiDocument());
  });
});
