// GET /api/services/[id] — thin adapter over the shared getServiceDetail
// operation. Params are a Promise per the Next 16 route convention
// (node_modules/next/dist/docs route.md).

import { getServiceDetail, parseServiceId } from "@/lib/api/core";
import { getApiContext } from "@/lib/api/context";
import { errorResponse, jsonOk } from "@/lib/api/respond";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const serviceId = parseServiceId(decodeURIComponent(id), "path parameter id");
    return jsonOk(getServiceDetail(serviceId, getApiContext()));
  } catch (error) {
    return errorResponse(error);
  }
}
