// GET /api/openapi.json — serves the generated OpenAPI document for the core
// API (the GPT Actions surface). The document is built from the route
// registry, never hand-maintained; the snapshot test pins its shape.

import { buildOpenApiDocument } from "@/lib/api/openapi";

export async function GET() {
  return Response.json(buildOpenApiDocument());
}
