import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ApiErrorEnvelopeSchema,
  ApiResponseSchema,
  EstimateBlockSchema,
  GetServiceEstimateResultSchema,
  GovernmentServiceSchema,
  ResolveServicesResultSchema,
  RequiredDocumentSchema,
  ServiceSummarySchema,
  StepInstructionSchema,
} from "./index";
import { FIXTURE_VERSIONS, SERVICE_FIXTURES } from "./__fixtures__/services";

const [hic, dep] = SERVICE_FIXTURES;

/** One success envelope per tool, assembled from fixture data. */
const resolveResult = {
  ok: true,
  tool: "resolve_services",
  versions: { app: "0.1.0", schema: "0.1.0", catalog: "0.0.0-fixture", crosswalk: "0.0.0-fixture", embeddingModel: "0.0.0-fixture" },
  data: {
    resolution: {
      serviceIds: [dep.service.identifier],
      resolutionLayer: "alias-rules",
      versions: FIXTURE_VERSIONS,
    },
    services: [dep.summary],
  },
};

const estimateResult = {
  ok: true,
  tool: "get_service_estimate",
  versions: resolveResult.versions,
  data: { serviceId: hic.service.identifier, estimate: hic.estimate },
};

const stepResult = {
  ok: true,
  tool: "get_step_instructions",
  versions: resolveResult.versions,
  data: { serviceId: dep.service.identifier, steps: dep.steps },
};

const documentsResult = {
  ok: true,
  tool: "get_required_documents",
  versions: resolveResult.versions,
  data: { serviceId: dep.service.identifier, documents: dep.documents },
};

/** parse → JSON serialize → parse; the second parse must equal the first. */
function roundTrips(schema: z.ZodType, value: unknown): boolean {
  const once = schema.parse(value);
  return JSON.stringify(schema.parse(JSON.parse(JSON.stringify(once)))) === JSON.stringify(once);
}

describe("contract fixtures", () => {
  it("parse against every record schema", () => {
    for (const fixture of SERVICE_FIXTURES) {
      expect(() => GovernmentServiceSchema.parse(fixture.service)).not.toThrow();
      expect(() => ServiceSummarySchema.parse(fixture.summary)).not.toThrow();
      expect(() => EstimateBlockSchema.parse(fixture.estimate)).not.toThrow();
      expect(() => z.array(StepInstructionSchema).parse(fixture.steps)).not.toThrow();
      expect(() => z.array(RequiredDocumentSchema).parse(fixture.documents)).not.toThrow();
    }
  });

  it("round-trip stable: parse → serialize → parse", () => {
    for (const fixture of SERVICE_FIXTURES) {
      expect(roundTrips(GovernmentServiceSchema, fixture.service)).toBe(true);
      expect(roundTrips(ServiceSummarySchema, fixture.summary)).toBe(true);
      expect(roundTrips(EstimateBlockSchema, fixture.estimate)).toBe(true);
      expect(roundTrips(z.array(StepInstructionSchema), fixture.steps)).toBe(true);
      expect(roundTrips(z.array(RequiredDocumentSchema), fixture.documents)).toBe(true);
    }
  });
});

describe("GoalResolution", () => {
  it("accepts the explicit no-match state (empty ids)", () => {
    const result = ResolveServicesResultSchema.parse({
      ...resolveResult,
      data: { resolution: { serviceIds: [], resolutionLayer: "llm_assist", versions: FIXTURE_VERSIONS }, services: [] },
    });
    expect(result.data.resolution.serviceIds).toEqual([]);
  });

  it("requires all three version stamps", () => {
    const resolution = { serviceIds: [hic.service.identifier], resolutionLayer: "exact-id", versions: { catalogVersion: "c" } };
    const result = ResolveServicesResultSchema.safeParse({ ...resolveResult, data: { resolution, services: [] } });
    expect(result.error?.issues[0].path).toContain("crosswalkVersion");
  });
});

describe("schema rejections", () => {
  it("throws with a path when a required field is missing", () => {
    const rest: Record<string, unknown> = { ...hic.summary };
    delete rest.title;
    const result = ServiceSummarySchema.safeParse(rest);
    expect(result.error?.issues[0].path).toContain("title");
  });

  it("throws on unrecognized extra fields", () => {
    const result = ServiceSummarySchema.safeParse({ ...hic.summary, bogus: true });
    expect(result.error?.issues[0].message).toMatch(/[Uu]nrecognized key/);
  });

  it("rejects malformed service and step ids", () => {
    expect(GovernmentServiceSchema.safeParse({ ...hic.service, identifier: "KA-01808" }).success).toBe(false);
    expect(
      StepInstructionSchema.safeParse({ ...hic.steps[0], id: "step-one" }).success,
    ).toBe(false);
  });

  it("couples upload specs to the document_upload method", () => {
    const [uploadStep] = hic.steps;
    const withoutUpload = { ...uploadStep, upload: undefined };
    const result = StepInstructionSchema.safeParse(withoutUpload);
    expect(result.error?.issues[0].message).toMatch(/document_upload steps require an upload spec/);
  });

  it("rejects an upload spec on a non-upload step", () => {
    const inPerson = { ...hic.steps[1], upload: hic.steps[0].upload };
    const result = StepInstructionSchema.safeParse(inPerson);
    expect(result.error?.issues[0].message).toMatch(/only valid on document_upload steps/);
  });

  it("requires a dependency note on non-NYC steps", () => {
    const stateStep = { ...hic.steps[1], responsibleJurisdiction: "nys" };
    const result = StepInstructionSchema.safeParse(stateStep);
    expect(result.error?.issues[0].message).toMatch(/dependencyNote/);
    expect(
      StepInstructionSchema.parse({ ...stateStep, dependencyNote: "State-run service" }).dependencyNote,
    ).toBe("State-run service");
  });

  it("rejects the conflated evidence string the classifier used to emit", () => {
    const result = ServiceSummarySchema.safeParse({
      ...hic.summary,
      disposition: { ...hic.summary.disposition, evidence: "verb-apply: Home Improvement Contractor License" },
    });
    expect(result.error?.issues[0].path).toContain("evidence");
  });

  it("rejects an unknown evidence kind", () => {
    const result = ServiceSummarySchema.safeParse({
      ...hic.summary,
      disposition: { ...hic.summary.disposition, evidence: { kind: "vibes", span: "x" } },
    });
    expect(result.error?.issues[0].path).toContain("evidence");
  });

  it("rejects an unknown domain source", () => {
    const result = ServiceSummarySchema.safeParse({ ...hic.summary, domainSource: "vibes" });
    expect(result.error?.issues[0].path).toContain("domainSource");
  });

  it("couples domain applicability to the service disposition", () => {
    const informational = {
      ...hic.summary,
      domainAppliesToCatalog: true,
      disposition: { ...hic.summary.disposition, disposition: "informational" },
    };
    const rejected = ServiceSummarySchema.safeParse(informational);
    expect(rejected.error?.issues[0].message).toMatch(/coverage-meaningful only for services/);
    const accepted = ServiceSummarySchema.safeParse({ ...informational, domainAppliesToCatalog: false });
    expect(accepted.success).toBe(true);
  });

  it("rejects a tier-1 fee without a captured-at date", () => {
    const [fee] = hic.estimate.tiers;
    const result = EstimateBlockSchema.safeParse({ ...hic.estimate, tiers: [{ ...fee, capturedAt: undefined }] });
    expect(result.error?.issues[0].path).toContain("capturedAt");
    const badDate = EstimateBlockSchema.safeParse({ ...hic.estimate, tiers: [{ ...fee, capturedAt: "recently" }] });
    expect(badDate.error?.issues[0].message).toMatch(/ISO date/);
  });
});

describe("API envelopes", () => {
  it("dispatches each tool result through the discriminated union", () => {
    expect(ApiResponseSchema.parse(resolveResult)).toMatchObject({ tool: "resolve_services" });
    expect(ApiResponseSchema.parse(estimateResult)).toMatchObject({ tool: "get_service_estimate" });
    expect(ApiResponseSchema.parse(stepResult)).toMatchObject({ tool: "get_step_instructions" });
    expect(ApiResponseSchema.parse(documentsResult)).toMatchObject({ tool: "get_required_documents" });
  });

  it("rejects a success envelope whose data does not match its tool", () => {
    const mismatched = { ...estimateResult, tool: "get_step_instructions" };
    expect(GetServiceEstimateResultSchema.safeParse(mismatched).success).toBe(false);
    expect(ApiResponseSchema.safeParse(mismatched).success).toBe(false);
  });

  it("accepts the error envelope shape", () => {
    const error = {
      ok: false,
      tool: "resolve_services",
      error: { code: "unsupported_goal", message: "No services match the goal" },
    };
    expect(ApiErrorEnvelopeSchema.parse(error)).toMatchObject({ ok: false });
    expect(ApiResponseSchema.safeParse(error).success).toBe(true);
  });
});
