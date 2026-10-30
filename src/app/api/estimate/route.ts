// GET /api/estimate?serviceId=… — thin adapter over the shared
// getServiceEstimate operation.

import { getServiceEstimate, parseServiceId } from "@/lib/api/core";
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
    return jsonOk(getServiceEstimate(parsed, getApiContext()));
  } catch (error) {
    return errorResponse(error);
  }
}
