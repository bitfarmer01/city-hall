// Every API response carries version stamps so any rendered claim can be
// replayed against pinned data versions. Catalog, crosswalk, and embedding
// model stamps arrive with the catalog milestone (build spec D1).
export const APP_VERSION = "0.1.0";
export const SCHEMA_VERSION = "0.1.0";

export interface HealthPayload {
  status: "ok";
  app: { version: string };
  schema: { version: string };
  timestamp: string;
}

export function buildHealthPayload(now: Date = new Date()): HealthPayload {
  return {
    status: "ok",
    app: { version: APP_VERSION },
    schema: { version: SCHEMA_VERSION },
    timestamp: now.toISOString(),
  };
}
