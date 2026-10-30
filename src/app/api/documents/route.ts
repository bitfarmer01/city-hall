// GET /api/documents?serviceId=… — thin adapter over the shared
// getServiceDocuments operation.

import { getServiceDocuments, parseServiceId } from "@/lib/api/core";
import { getApiContext } from "@/lib/api/context";
import { errorResponse, jsonError, jsonOk } from "@/lib/api/respond";

export async function GET(request: Request) {
  try {
    const serviceId = new URL(request.url).searchParams.get("serviceId");
    if (serviceId === null) {
      return jsonError(
        { error: { code: "invalid_request", message: "Missing required query parameter: serviceId" } },
        400,
      );
    }
    const parsed = parseServiceId(serviceId, "query parameter serviceId");
    return jsonOk(getServiceDocuments(parsed, getApiContext()));
  } catch (error) {
    return errorResponse(error);
  }
}
