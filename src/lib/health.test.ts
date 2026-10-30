import { describe, expect, it } from "vitest";

import { buildHealthPayload } from "./health";

describe("buildHealthPayload", () => {
  it("stamps ok status with app and schema versions", () => {
    const payload = buildHealthPayload();

    expect(payload.status).toBe("ok");
    expect(payload.app.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(payload.schema.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("renders the provided instant as an ISO-8601 timestamp", () => {
    const payload = buildHealthPayload(new Date("2026-10-30T12:34:56Z"));

    expect(payload.timestamp).toBe("2026-10-30T12:34:56.000Z");
  });
});
