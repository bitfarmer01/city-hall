// POST /api/resolve — thin adapter: parse → core operation → respond.
// All logic lives in src/lib/api (the shared contract); nothing here but wiring.

import { resolveGoal, parseGoalInput } from "@/lib/api/core";
import { getApiContext } from "@/lib/api/context";
import { errorResponse, jsonOk } from "@/lib/api/respond";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const input = parseGoalInput(body);
    return jsonOk(await resolveGoal(input, getApiContext()));
  } catch (error) {
    return errorResponse(error);
  }
}
