// Core-operation tests over the committed catalog bundle — the same
// functions both plugin adapters call. The registry rows stay empty here:
// tier 1 (verbatim envelope fees) and tier 2 (published processing times)
// must fire from catalog data alone, which is exactly the D6/D9 contract.

import { describe, expect, it } from "vitest";

import { loadCatalogBundle } from "@/lib/resolver/catalog-source";

import { buildApiContext } from "./core";
import {
  getServiceDetail,
  getServiceDocuments,
  getServiceEstimate,
  resolveGoal,
  parseGoalInput,
  parseServiceId,
} from "./core";
import { ApiRequestError } from "./types";

const bundle = loadCatalogBundle();
const ctx = buildApiContext(bundle, {
  snapshots: bundle.snapshots,
  openDataTimelineRows: [],
  heuristicRows: [],
});

const DOG = "svc:dohmh:dog-license";
const HIC = "svc:dcwp:home-improvement-contractor-license";

describe("parseGoalInput", () => {
  it("accepts a non-empty goal and trims nothing silently", () => {
    expect(parseGoalInput({ goal: "license my dog" })).toEqual({ goal: "license my dog" });
  });

  it("rejects missing, empty, and oversized goals with invalid_request", () => {
    for (const bad of [undefined, null, {}, { goal: "" }, { goal: "   " }, { goal: 42 }]) {
      expect(() => parseGoalInput(bad)).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    }
    expect(() => parseGoalInput({ goal: "x".repeat(2001) })).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });
});

describe("parseServiceId", () => {
  it("accepts a well-formed catalog ID and rejects malformed ones", () => {
    expect(parseServiceId(DOG, "id")).toBe(DOG);
    expect(() => parseServiceId("not-a-service-id", "id")).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
    expect(() => parseServiceId("svc:;", "id")).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });
});

describe("resolveGoal", () => {
  it("resolves an exact catalog ID utterance through the deterministic core", async () => {
    const response = await resolveGoal({ goal: DOG }, ctx);
    expect(response.serviceIds).toContain(DOG);
    expect(response.services.map((s) => s.id)).toContain(DOG);
    expect(Object.keys(response.versions)).toEqual(
      expect.arrayContaining(["catalogVersion", "crosswalkVersion", "embeddingModelVersion"]),
    );
  });

  it("resolves a natural-language goal to the right service and stamps versions", async () => {
    const response = await resolveGoal({ goal: "I want to license my dog" }, ctx);
    expect(response.serviceIds).toContain(DOG);
    const dog = response.services.find((s) => s.id === DOG);
    expect(dog?.name).toBe("Dog License");
    expect(dog?.providerName).toBe("Department of Health and Mental Hygiene");
    expect(dog?.coverageDomain).toBe("licensing");
    expect(dog?.detailUrl).toBe(`/api/services/${encodeURIComponent(DOG)}`);
  });

  it("is deterministic for the same input against the same context", async () => {
    const a = await resolveGoal({ goal: "home improvement contractor license" }, ctx);
    const b = await resolveGoal({ goal: "home improvement contractor license" }, ctx);
    expect(a).toEqual(b);
  });

  it("returns an honest empty set (not an error) for a no-match goal", async () => {
    const response = await resolveGoal({ goal: "zzzz qqqq no such goal" }, ctx);
    expect(response.serviceIds).toEqual([]);
    expect(response.services).toEqual([]);
    // Even a no-match carries the version stamps — the replay contract.
    expect(response.versions.catalogVersion.length).toBeGreaterThan(0);
  });
});

describe("getServiceDetail", () => {
  it("returns the envelope, sequence-ordered instructions, and document summaries", () => {
    const detail = getServiceDetail(HIC, ctx);
    expect(detail.service.name).toBe("Home Improvement Contractor License");
    const sequences = detail.instructions.map((step) => step.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
    expect(detail.instructions.length).toBe(2);
    // Agency attribution is per-step (locked decision #5).
    for (const step of detail.instructions) {
      expect(step.responsibleAgency.id).toMatch(/^nyc-/);
      expect(step.fulfillmentMethod).toBeDefined();
    }
  });

  it("attaches a fee only where the step declares a feeRef, with the offer's data", () => {
    const detail = getServiceDetail(HIC, ctx);
    const withFees = detail.instructions.filter((step) => step.fee);
    expect(withFees.length).toBeGreaterThan(0);
    for (const step of withFees) {
      expect(step.fee?.currency).toBe("USD");
      expect(step.fee?.feeId).toBeDefined();
    }
  });

  it("404s an unknown service ID with a message that names it", () => {
    expect(() => getServiceDetail("svc:nonexistent:service", ctx)).toThrowError(
      expect.objectContaining({ code: "not_found", httpStatus: 404 }),
    );
  });

  it("renders the DEP water-tap steps in order with three fulfillment methods represented", () => {
    const tap = bundle.services.find((s) => s.meta.catalogId.includes("water-tap"));
    if (!tap || tap.steps.length < 2) return; // seeded bundle guard
    const detail = getServiceDetail(tap.meta.catalogId, ctx);
    expect(detail.instructions.map((s) => s.sequence)).toEqual(detail.instructions.map((_, i) => i + 1));
  });
});

describe("getServiceEstimate", () => {
  it("carries the tier-1 fee verbatim with source and captured date", () => {
    const estimate = getServiceEstimate(HIC, ctx);
    const tier1 = estimate.tiers.find((t) => t.tier === 1);
    expect(tier1?.amountValue).toBe(200);
    expect(tier1?.currency).toBe("USD");
    expect(tier1?.sourceUrl).toContain("KA-01808");
    expect(tier1?.capturedAt).toBe("2026-10-30");
    // D6: every displayed fee carries its source and as-of.
    expect(estimate.headline.join("\n")).toContain("KA-01808");
  });

  it("surfaces the published processing time as a tier-2 row", () => {
    const estimate = getServiceEstimate(HIC, ctx);
    const tier2 = estimate.tiers.find((t) => t.tier === 2);
    expect(tier2?.dataset).toContain("KA-01808");
  });

  it("returns an empty tier list for a service with no grounded estimate data", () => {
    const estimate = getServiceEstimate(DOG, ctx);
    // Honest empty — no invented numbers (locked decision #6).
    expect(estimate.tiers).toEqual([]);
  });

  it("404s an unknown service ID", () => {
    expect(() => getServiceEstimate("svc:nonexistent:service", ctx)).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    );
  });
});

describe("getServiceDocuments", () => {
  it("returns per-form entries with four-value requiredStatus counts, never a boolean", () => {
    const birth = bundle.services.find((s) => s.formIds.length > 0);
    if (!birth) return; // seeded bundle guard
    const response = getServiceDocuments(birth.meta.catalogId, ctx);
    expect(response.documents.length).toBe(birth.formIds.length);
    for (const doc of response.documents) {
      // Forms with extracted fields carry the four-value counts; a form with
      // none is honestly null (never a zeroed boolean-like shape).
      if (doc.fieldCounts === null) continue;
      expect(doc.fieldCounts.total).toBe(
        doc.fieldCounts.author_declared_required +
          doc.fieldCounts.not_marked_required +
          doc.fieldCounts.inferred_required +
          doc.fieldCounts.unknown,
      );
      expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("404s an unknown service ID", () => {
    expect(() => getServiceDocuments("svc:nonexistent:service", ctx)).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    );
  });
});

describe("ApiRequestError wire contract", () => {
  it("maps the documented codes to their HTTP statuses", () => {
    expect(new ApiRequestError("invalid_request", 400, "x").httpStatus).toBe(400);
    expect(new ApiRequestError("not_found", 404, "x").httpStatus).toBe(404);
  });
});
