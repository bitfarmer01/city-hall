import { NextResponse } from "next/server";

import { buildHealthPayload } from "@/lib/health";

// GET route handlers are dynamic by default (Next 15+), so the timestamp
// reflects the live serving process rather than a build-time snapshot.
export async function GET() {
  return NextResponse.json(buildHealthPayload());
}
