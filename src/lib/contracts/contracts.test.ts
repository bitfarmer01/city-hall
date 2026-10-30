import { describe, expect, it } from "vitest";

import { buildServiceEnvelope, type EnvelopeBuildInput } from "../catalog/envelope";
import { CATALOG_SCHEMA_VERSION, type AgencyRecord } from "../catalog/types";
import type { CoverageDomain } from "../inventory/domain";
import { CLASSIFIER_RULES_VERSION, type ArticleClassification } from "../inventory/classify";
import { loadCatalogBundle } from "../resolver/catalog-source";
import { createResolver } from "../resolver/resolver";
import { CROSSWALK_RULES_VERSION } from "../resolver/rules";
import { EMBEDDING_MODEL_VERSION } from "../resolver/retrieval";

import agencySeeds from "../../../data/catalog/seed/agencies.json";
import hicSeed from "../../../data/catalog/seed/services/svc-dcwp-home-improvement-contractor-license.json";
import depSeed from "../../../data/catalog/seed/services/svc-dep-water-tap-permit.json";

import {
  EstimateBlockSchema,
  TimelineEstimateSchema,
} from "./estimate";
import {
  GetRequiredDocumentsRequestSchema,
  GetServiceEstimateRequestSchema,
  GetServiceEstimateResultSchema,
  GetStepInstructionsRequestSchema,
  ApiErrorEnvelopeSchema,
  ApiResponseSchema,
  ResolveServicesRequestSchema,
  ResolveServicesResultSchema,
} from "./api";
import { RealSnapshotRefSchema } from "./primitives";
import { GovernmentServiceSchema } from "./government-service";
import { GoalResolutionSchema } from "./resolution";
import { RequiredDocumentSchema } from "./required-document";
import { ServiceSummarySchema } from "./service-summary";
import { StepInstructionSchema } from "./step-instruction";
import { FIXTURE_VERSIONS, SERVICE_FIXTURES } from "./__fixtures__/services";

/** Response versions for envelope tests — each stamp matches its producer
 * kind (panel N1), fixture-marked and unmistakably fake. */
const RESPONSE_VERSIONS = {
  app: "0.0.0-fixture",
  schema: CATALOG_SCHEMA_VERSION,
  catalog: "0000-01-01.0",
  crosswalk: "0.0.0-fixture",
  embeddingModel: "0.0.0-fixture",
};

/** Parse → JSON round-trip → parse must yield the same value. */
const roundTrips = <S extends { parse: (v: unknown) => unknown }>(schema: S, value: unknown): boolean => {
  const first = schema.parse(value);
  const second = schema.parse(JSON.parse(JSON.stringify(first)));
  return JSON.stringify(first) === JSON.stringify(second);
};

// The catalog's linker supplies title/description/agency from the snapshot;
// the seeds carry the domain-specific inputs verbatim.
const agencyRecord = (id: string): AgencyRecord => {
  const found = agencySeeds.find((agency) => agency.id === id);
  if (!found) throw new Error(`agency ${id} missing from seed agencies`);
  return found as AgencyRecord;
};

describe("contracts", () => {
  const [hic, dep] = SERVICE_FIXTURES;

  describe("fixtures parse and round-trip", () => {
    for (const fixture of SERVICE_FIXTURES) {
      it(`parses the ${fixture.summary.id} fixture at full record depth`, () => {
        expect(() => GovernmentServiceSchema.parse(fixture.service)).not.toThrow();
        expect(() => ServiceSummarySchema.parse(fixture.summary)).not.toThrow();
        expect(() => EstimateBlockSchema.parse(fixture.estimate)).not.toThrow();
        for (const step of fixture.steps) {
          expect(() => StepInstructionSchema.parse(step)).not.toThrow();
        }
        for (const document of fixture.documents) {
          expect(() => RequiredDocumentSchema.parse(document)).not.toThrow();
        }
      });

      it(`round-trips the ${fixture.summary.id} fixture stably`, () => {
        expect(roundTrips(GovernmentServiceSchema, fixture.service)).toBe(true);
        expect(roundTrips(ServiceSummarySchema, fixture.summary)).toBe(true);
        expect(roundTrips(EstimateBlockSchema, fixture.estimate)).toBe(true);
        for (const step of fixture.steps) {
          expect(roundTrips(StepInstructionSchema, step)).toBe(true);
        }
        for (const document of fixture.documents) {
          expect(roundTrips(RequiredDocumentSchema, document)).toBe(true);
        }
      });
    }

    it("pins FIXTURE_VERSIONS so a refactor to real-looking versions fails the suite", () => {
      expect(FIXTURE_VERSIONS).toEqual({
        catalogVersion: "0000-01-01.0",
        crosswalkVersion: "0.0.0-fixture",
        embeddingModelVersion: "0.0.0-fixture",
      });
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

    it("rejects malformed step ids", () => {
      expect(StepInstructionSchema.safeParse({ ...hic.steps[0], id: "step-one" }).success).toBe(false);
    });

    it("rejects the conflated evidence string the classifier used to emit", () => {
      const result = ServiceSummarySchema.safeParse({
        ...hic.summary,
        disposition: { ...hic.summary.disposition, evidence: "R006-service-action: Apply for a license" },
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
  });

  describe("canonical envelope conformance (panel B1/S1-M6)", () => {
    const hicInput: EnvelopeBuildInput = {
      catalogId: hicSeed.catalogId,
      nyc311ArticleId: `nyc311-${hicSeed.ka}`,
      nyc311ArticleUrl: `https://portal.311.nyc.gov/article/?kanumber=${hicSeed.ka}`,
      // The linker joins these two from the inventory snapshot; the seed
      // input carries the domain-specific fields verbatim.
      title: "Home Improvement Contractor License",
      description: "FIXTURE conformance description",
      serviceType: hicSeed.serviceType,
      alternateNames: hicSeed.alternateNames,
      domain: hicSeed.domain as CoverageDomain,
      agency: agencyRecord("nyc-dcwp"),
      channels: hicSeed.channels,
      fees: hicSeed.fees,
      serviceOutputName: hicSeed.serviceOutputName,
    };

    it("parses an envelope built by D4's own builder from the HIC seed record", () => {
      const parsed = GovernmentServiceSchema.parse(buildServiceEnvelope(hicInput));
      expect(parsed.identifier).toEqual([
        "svc:dcwp:home-improvement-contractor-license",
        "nyc311-KA-01808",
      ]);
      expect(parsed["x:coverageDomain"]).toBe("licensing");
      expect(parsed.offers[0].identifier).toBe(hicSeed.fees[0].identifier);
      expect(parsed.offers[0]["x:capturedAt"]).toBe("2026-10-30");
    });

    it("parses the DEP seed record, exercising an empty offers list", () => {
      const depInput: EnvelopeBuildInput = {
        catalogId: depSeed.catalogId,
        nyc311ArticleId: `nyc311-${depSeed.ka}`,
        nyc311ArticleUrl: `https://portal.311.nyc.gov/article/?kanumber=${depSeed.ka}`,
        title: "Water Tap Permit",
        description: "FIXTURE conformance description",
        serviceType: depSeed.serviceType,
        alternateNames: depSeed.alternateNames,
        domain: depSeed.domain as CoverageDomain,
        agency: agencyRecord("nyc-dep"),
        channels: depSeed.channels,
        fees: depSeed.fees,
        serviceOutputName: depSeed.serviceOutputName,
      };
      const parsed = GovernmentServiceSchema.parse(buildServiceEnvelope(depInput));
      expect(parsed.offers).toEqual([]);
      expect(parsed["x:coverageDomain"]).toBe("permits");
    });

    it("rejects an envelope whose schemaVersion mismatches the pinned catalog version", () => {
      const mismatched = { ...hic.service, schemaVersion: "9.9.9" };
      const result = GovernmentServiceSchema.safeParse(mismatched);
      expect(result.error?.issues[0].path).toContain("schemaVersion");
    });

    it("rejects tuple identifiers that violate either half of the pair", () => {
      expect(
        GovernmentServiceSchema.safeParse({ ...hic.service, identifier: ["svc:dcwp:x", "BAD-1"] }).success,
      ).toBe(false);
      expect(GovernmentServiceSchema.safeParse({ ...hic.service, identifier: "KA-01808" }).success).toBe(false);
    });
  });

  describe("classifier boundary (panel S3-F1/S3-F2)", () => {
    it("parses a real classifier output through ServiceSummarySchema", () => {
      const evidence: ArticleClassification["evidence"] = {
        kind: "index-text",
        span: "Apply for a Home Improvement Contractor License",
      };
      const classification: ArticleClassification = {
        id: "home-improvement-contractor-license",
        ka: "KA-01808",
        title: "Home Improvement Contractor License",
        disposition: "service",
        serviceSubtype: "apply",
        reason: "action:apply",
        ruleId: "R006-service-action",
        evidence,
        rulesVersion: CLASSIFIER_RULES_VERSION,
      };
      // Boundary mapping — classifier field names → contract field names.
      // rulesVersion → classifierRulesVersion; the classifier's kinded
      // evidence ({ kind, span } — PR #8, landed) passes through unchanged:
      // the contract's ClassifierEvidenceSchema mirrors that exact shape.
      const result = ServiceSummarySchema.safeParse({
        id: "svc:dcwp:home-improvement-contractor-license",
        title: classification.title,
        agency: { id: "nyc-dcwp", name: "Department of Consumer and Worker Protection" },
        domain: "licensing",
        domainSource: "keyword",
        domainAppliesToCatalog: true,
        disposition: {
          disposition: classification.disposition,
          serviceSubtype: classification.serviceSubtype,
          reason: classification.reason,
          ruleId: classification.ruleId,
          classifierRulesVersion: classification.rulesVersion,
          evidence: classification.evidence,
        },
      });
      expect(result.success).toBe(true);
    });

    it("boundary-tests the matchedBy → domainSource mapping", () => {
      // The contract-side mapping documented on DOMAIN_SOURCES in
      // primitives.ts: 'title'/'description' → 'keyword' (a rule matched),
      // 'none' → 'fallback' (the other catch-all).
      const matchedByToDomainSource: Record<string, string> = {
        title: "keyword",
        description: "keyword",
        none: "fallback",
      };
      for (const [matchedBy, domainSource] of Object.entries(matchedByToDomainSource)) {
        const result = ServiceSummarySchema.safeParse({
          ...hic.summary,
          domainSource,
          ...(domainSource === "fallback" ? { domain: "other" } : {}),
        });
        expect(result.success, `matchedBy ${matchedBy} → ${domainSource}`).toBe(true);
      }
    });
  });

  describe("goal resolution", () => {
    it("requires all three version stamps with a clear path", () => {
      const result = GoalResolutionSchema.safeParse({
        serviceIds: [],
        resolutionLayer: "alias-rules",
        versions: { catalogVersion: "0000-01-01.0", crosswalkVersion: "0.0.0-fixture" },
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toContain("embeddingModelVersion");
    });

    it("rejects an invalid resolution layer", () => {
      const result = GoalResolutionSchema.safeParse({
        serviceIds: [],
        resolutionLayer: "magic",
        versions: FIXTURE_VERSIONS,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toContain("resolutionLayer");
    });

    it("accepts every layer the spec defines", () => {
      for (const layer of [
        "exact-id",
        "alias-rules",
        "semantic-retrieval",
        "search-fallback",
        "llm_assist",
      ]) {
        const result = GoalResolutionSchema.safeParse({
          serviceIds: [],
          resolutionLayer: layer,
          versions: FIXTURE_VERSIONS,
        });
        expect(result.success, `layer ${layer}`).toBe(true);
      }
    });
  });

  describe("estimates", () => {
    it("rejects a tier-1 fee without its source citation", () => {
      const fee = { ...hic.estimate.tiers[0], sourceCitation: undefined };
      const result = EstimateBlockSchema.safeParse({ ...hic.estimate, tiers: [fee] });
      expect(result.error?.issues[0].path).toContain("sourceCitation");
    });

    it("rejects a tier-1 fee without its source URL", () => {
      const fee = { ...hic.estimate.tiers[0], sourceUrl: undefined };
      const result = EstimateBlockSchema.safeParse({ ...hic.estimate, tiers: [fee] });
      expect(result.error?.issues[0].path).toContain("sourceUrl");
    });

    it("rejects a tier-1 fee without a captured-at date", () => {
      const [fee] = hic.estimate.tiers;
      const result = EstimateBlockSchema.safeParse({ ...hic.estimate, tiers: [{ ...fee, capturedAt: undefined }] });
      expect(result.error?.issues[0].path).toContain("capturedAt");
      const badDate = EstimateBlockSchema.safeParse({ ...hic.estimate, tiers: [{ ...fee, capturedAt: "recently" }] });
      expect(badDate.error?.issues[0].message).toMatch(/ISO date/);
    });

    it("rejects a tier-2 timeline without its dataset provenance", () => {
      const timeline = hic.estimate.tiers.find((tier) => tier.tier === 2);
      const result = EstimateBlockSchema.safeParse({
        ...hic.estimate,
        tiers: [{ ...timeline, dataset: undefined }],
      });
      expect(result.error?.issues[0].path).toContain("dataset");
    });

    it("pins tier-2 capturedAt as optional", () => {
      const timeline = hic.estimate.tiers.find((tier) => tier.tier === 2);
      expect(timeline?.tier).toBe(2);
      const parsed = TimelineEstimateSchema.parse(timeline);
      expect(parsed.capturedAt).toBeUndefined();
    });

    it("rejects non-http(s) schemes on source URLs", () => {
      const evil = {
        ...hic.estimate,
        tiers: [{ ...hic.estimate.tiers[0], sourceUrl: "javascript:void(0)" }],
      };
      expect(EstimateBlockSchema.safeParse(evil).success).toBe(false);
    });
  });

  describe("steps", () => {
    it("requires an upload spec exactly on document_upload steps", () => {
      const uploadStep = hic.steps.find((step) => step.fulfillmentMethod === "document_upload");
      const plain = { ...hic.steps[0], upload: undefined };
      expect(StepInstructionSchema.safeParse(plain).error?.issues[0].path).toContain("upload");
      expect(
        StepInstructionSchema.safeParse({ ...plain, fulfillmentMethod: "document_upload" }).error?.issues[0].path,
      ).toContain("upload");
      expect(StepInstructionSchema.safeParse(uploadStep).success).toBe(true);
    });

    it("accepts the producer fulfillment values the original enum rejected", () => {
      const base = hic.steps.find((step) => step.fulfillmentMethod === "in_person_appearance");
      for (const fulfillmentMethod of ["online_submission", "mail_in"]) {
        const result = StepInstructionSchema.safeParse({ ...base, fulfillmentMethod });
        expect(result.success, fulfillmentMethod).toBe(true);
      }
    });

    it("requires a note when fulfillment is the other escape hatch", () => {
      // Base on the upload-free step so the upload coupling doesn't mask the note check.
      const other = { ...hic.steps[1], fulfillmentMethod: "other" };
      expect(StepInstructionSchema.safeParse(other).error?.issues[0].path).toContain("fulfillmentNote");
      const noted = { ...other, fulfillmentNote: "Delivered by the borough commissioner's office" };
      expect(StepInstructionSchema.parse(noted).fulfillmentNote).toBeDefined();
    });

    it("rejects a verified-true size limit with a null value", () => {
      const uploadStep = hic.steps.find((step) => step.upload);
      const bad = {
        ...uploadStep,
        upload: { ...uploadStep?.upload, maxSizeBytes: null, sizeLimitVerified: true },
      };
      expect(StepInstructionSchema.safeParse(bad).error?.issues[0].path).toContain("sizeLimitVerified");
    });

    it("accepts an upload spec with only a portal URL (no portal id)", () => {
      const uploadStep = hic.steps.find((step) => step.upload);
      const urlOnly = { ...uploadStep, upload: { ...uploadStep?.upload, portalId: undefined } };
      expect(StepInstructionSchema.safeParse(urlOnly).success).toBe(true);
    });

    it("rejects a malformed feeRef", () => {
      expect(StepInstructionSchema.safeParse({ ...hic.steps[0], feeRef: "200 dollars" }).success).toBe(false);
    });

    it("lets structured dependencies satisfy the non-NYC labeling", () => {
      const base = hic.steps.find((step) => step.fulfillmentMethod === "in_person_appearance");
      const withDependencies = {
        ...base,
        responsibleJurisdiction: "nys",
        dependencies: [{ agencyId: "nys-dos", label: "Secretary of State entity filing" }],
      };
      expect(StepInstructionSchema.safeParse(withDependencies).success).toBe(true);
      const bare = { ...base, responsibleJurisdiction: "nys" };
      expect(StepInstructionSchema.safeParse(bare).success).toBe(false);
      expect(StepInstructionSchema.safeParse(bare).error?.issues[0].path).toContain("dependencyNote");
    });

    it("pins absence of responsibleJurisdiction as explicit NYC policy", () => {
      const base = hic.steps.find((step) => step.fulfillmentMethod === "in_person_appearance");
      const withoutJurisdiction: Record<string, unknown> = { ...base };
      delete withoutJurisdiction.responsibleJurisdiction;
      expect(StepInstructionSchema.parse(withoutJurisdiction).responsibleJurisdiction).toBe("nyc");
    });
  });

  describe("required documents", () => {
    it("rejects a document without a name", () => {
      const result = RequiredDocumentSchema.safeParse({ ...hic.documents[0], name: undefined });
      expect(result.error?.issues[0].path).toContain("name");
    });

    it("rejects a document with empty sourceRefs", () => {
      const result = RequiredDocumentSchema.safeParse({ ...hic.documents[0], sourceRefs: [] });
      expect(result.error?.issues[0].path).toContain("sourceRefs");
    });

    it("rejects a document with a malformed service id", () => {
      const result = RequiredDocumentSchema.safeParse({ ...hic.documents[0], serviceId: "svc-dcwp" });
      expect(result.error?.issues[0].path).toContain("serviceId");
    });
  });

  describe("api envelopes", () => {
    const resolveResult = {
      ok: true,
      tool: "resolve_services",
      versions: RESPONSE_VERSIONS,
      data: {
        resolution: {
          serviceIds: [dep.summary.id],
          resolutionLayer: "alias-rules",
          versions: FIXTURE_VERSIONS,
        },
        services: [dep.summary],
      },
    };
    const errorEnvelope = {
      ok: false,
      tool: "resolve_services",
      versions: RESPONSE_VERSIONS,
      error: { code: "unsupported_goal", message: "No services match the goal" },
    };

    it("accepts the success and error envelope shapes", () => {
      expect(() => ApiResponseSchema.parse(resolveResult)).not.toThrow();
      expect(() => ApiErrorEnvelopeSchema.parse(errorEnvelope)).not.toThrow();
    });

    it("accepts the explicit no-match state (empty ids)", () => {
      const result = ApiResponseSchema.parse({
        ...resolveResult,
        data: {
          resolution: { serviceIds: [], resolutionLayer: "llm_assist", versions: FIXTURE_VERSIONS },
          services: [],
        },
      });
      if (!result.ok) throw new Error("expected a success envelope");
      if (result.tool !== "resolve_services") throw new Error("dispatch failed");
      expect(result.data.resolution.serviceIds).toEqual([]);
    });

    it("carries version stamps on the error envelope", () => {
      expect(ApiResponseSchema.safeParse(errorEnvelope).success).toBe(true);
      const withoutVersions = {
        ok: false,
        tool: "resolve_services",
        error: { code: "unsupported_goal", message: "No services match the goal" },
      };
      expect(ApiErrorEnvelopeSchema.safeParse(withoutVersions).success).toBe(false);
    });

    it("dispatches each tool result through the discriminated union", () => {
      const estimateResult = {
        ok: true,
        tool: "get_service_estimate",
        versions: RESPONSE_VERSIONS,
        data: { serviceId: hic.summary.id, estimate: hic.estimate },
      };
      const stepResult = {
        ok: true,
        tool: "get_step_instructions",
        versions: RESPONSE_VERSIONS,
        data: { serviceId: dep.summary.id, steps: dep.steps },
      };
      const documentsResult = {
        ok: true,
        tool: "get_required_documents",
        versions: RESPONSE_VERSIONS,
        data: { serviceId: dep.summary.id, documents: dep.documents },
      };
      expect(ApiResponseSchema.parse(resolveResult)).toMatchObject({ tool: "resolve_services" });
      expect(ApiResponseSchema.parse(estimateResult)).toMatchObject({ tool: "get_service_estimate" });
      expect(ApiResponseSchema.parse(stepResult)).toMatchObject({ tool: "get_step_instructions" });
      expect(ApiResponseSchema.parse(documentsResult)).toMatchObject({ tool: "get_required_documents" });
    });

    it("rejects a success envelope whose data does not match its tool", () => {
      const mismatched = {
        ok: true,
        tool: "get_step_instructions",
        versions: RESPONSE_VERSIONS,
        data: { serviceId: hic.summary.id, estimate: hic.estimate },
      };
      expect(GetServiceEstimateResultSchema.safeParse(mismatched).success).toBe(false);
      expect(ApiResponseSchema.safeParse(mismatched).success).toBe(false);
    });

    it("round-trips both envelopes stably", () => {
      expect(roundTrips(ApiResponseSchema, resolveResult)).toBe(true);
      expect(roundTrips(ApiErrorEnvelopeSchema, errorEnvelope)).toBe(true);
    });

    it("rejects malformed service and step ids in results", () => {
      const result = ApiResponseSchema.safeParse({
        ...resolveResult,
        data: { ...resolveResult.data, services: [{ ...dep.summary, id: "KA-01808" }] },
      });
      expect(result.success).toBe(false);
      const steps = {
        ok: true,
        tool: "get_step_instructions",
        versions: RESPONSE_VERSIONS,
        data: {
          serviceId: dep.summary.id,
          steps: [{ ...dep.steps[0], id: "stp:something:abc" }],
        },
      };
      expect(ApiResponseSchema.safeParse(steps).success).toBe(false);
    });
  });

  describe("tool request schemas (panel H2)", () => {
    it("validates the goal for resolve_services", () => {
      expect(ResolveServicesRequestSchema.parse({ goal: "open a restaurant" }).goal).toBe(
        "open a restaurant",
      );
      expect(ResolveServicesRequestSchema.safeParse({ goal: "" }).success).toBe(false);
      expect(ResolveServicesRequestSchema.safeParse({ goal: "x".repeat(2001) }).success).toBe(false);
    });

    it("validates the service id for the three id-taking tools", () => {
      for (const schema of [
        GetServiceEstimateRequestSchema,
        GetStepInstructionsRequestSchema,
        GetRequiredDocumentsRequestSchema,
      ]) {
        expect(
          schema.safeParse({ serviceId: "svc:dcwp:home-improvement-contractor-license" }).success,
        ).toBe(true);
        expect(schema.safeParse({ serviceId: "not-a-service-id" }).success).toBe(false);
      }
    });
  });

  describe("table-driven rejections (panel S3-F5)", () => {
    const rejects: [string, () => { success: boolean }][] = [
      [
        "invalid enum value for fulfillmentMethod",
        () => StepInstructionSchema.safeParse({ ...hic.steps[0], fulfillmentMethod: "teleport" }),
      ],
      [
        "invalid enum value for resolutionLayer",
        () =>
          GoalResolutionSchema.safeParse({
            serviceIds: [],
            resolutionLayer: "magic",
            versions: FIXTURE_VERSIONS,
          }),
      ],
      [
        "invalid enum value for domain",
        () => ServiceSummarySchema.safeParse({ ...hic.summary, domain: "international" }),
      ],
      [
        "invalid enum value for disposition",
        () =>
          ServiceSummarySchema.safeParse({
            ...hic.summary,
            disposition: { ...hic.summary.disposition, disposition: "unknown" },
          }),
      ],
      [
        "invalid enum value for error code",
        () =>
          ApiErrorEnvelopeSchema.safeParse({
            ok: false,
            tool: "resolve_services",
            versions: RESPONSE_VERSIONS,
            error: { code: "exploded", message: "x" },
          }),
      ],
      [
        "response versions missing a stamp",
        () =>
          ApiErrorEnvelopeSchema.safeParse({
            ok: false,
            tool: "resolve_services",
            versions: { app: "0.1.0", schema: CATALOG_SCHEMA_VERSION, catalog: "0000-01-01.0", crosswalk: "0.0.0-fixture" },
            error: { code: "internal", message: "x" },
          }),
      ],
      [
        "service disposition with domainAppliesToCatalog false",
        () => ServiceSummarySchema.safeParse({ ...hic.summary, domainAppliesToCatalog: false }),
      ],
      [
        "fallback domainSource with a non-other domain",
        () => ServiceSummarySchema.safeParse({ ...hic.summary, domainSource: "fallback" }),
      ],
      [
        "non-service disposition carrying a subtype",
        () =>
          ServiceSummarySchema.safeParse({
            ...hic.summary,
            disposition: { ...hic.summary.disposition, disposition: "informational" },
          }),
      ],
    ];

    for (const [name, parse] of rejects) {
      it(`rejects: ${name}`, () => {
        expect(parse().success).toBe(false);
      });
    }
  });
});

// -----------------------------------------------------------------------------
// Real-producer conformance (panel N1/S3-M): the schemas must accept what the
// merged pipelines ACTUALLY emit — D5's GoalResolution, the catalog bundle's
// envelopes and steps, real snapshot refs, and tool envelopes carrying real
// stamps. Synthetic fixtures alone went blind once; these tests cannot.
// -----------------------------------------------------------------------------
describe("real producer conformance (panel N1/S3-M)", () => {
  const bundle = loadCatalogBundle();

  it("parses a real GoalResolution from D5's pipeline", async () => {
    const resolver = createResolver(bundle);
    const real = await resolver.resolve("open a restaurant");
    const parsed = GoalResolutionSchema.parse(real);
    expect(parsed.serviceIds).toEqual(real.serviceIds);
    expect(parsed.versions).toEqual({
      catalogVersion: bundle.catalogVersion,
      crosswalkVersion: CROSSWALK_RULES_VERSION,
      embeddingModelVersion: EMBEDDING_MODEL_VERSION,
    });
  });

  it("parses every real built catalog record — envelopes, steps, snapshot refs", () => {
    // The BUILT bundle (data/catalog/catalog.json) is what D4 ships and D5/D6
    // consume — the real producer output, not hand-modeled seed inputs.
    expect(bundle.services.length).toBeGreaterThan(0);
    for (const record of bundle.services) {
      const label = record.meta?.catalogId ?? "record";
      const env = GovernmentServiceSchema.safeParse(record.envelope);
      const envIssues = env.success
        ? []
        : env.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      expect(env.success, `${label} envelope: ${envIssues.join("; ")}`).toBe(true);
      for (const step of record.steps) {
        const parsed = StepInstructionSchema.safeParse(step);
        const issues = parsed.success
          ? []
          : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        expect(parsed.success, `${label} step ${step.id}: ${issues.join("; ")}`).toBe(true);
      }
      for (const step of record.steps) {
        for (const ref of step.sourceRefs) {
          expect(RealSnapshotRefSchema.safeParse(ref).success, `${label} ref ${ref}`).toBe(true);
        }
      }
    }
  });

  it("wraps a real resolution in a tool envelope carrying real stamps", async () => {
    const resolver = createResolver(bundle);
    const real = await resolver.resolve("dog license");
    const parsed = ResolveServicesResultSchema.safeParse({
      ok: true,
      tool: "resolve_services",
      versions: {
        app: "0.0.0-fixture",
        schema: CATALOG_SCHEMA_VERSION,
        catalog: bundle.catalogVersion,
        crosswalk: CROSSWALK_RULES_VERSION,
        embeddingModel: EMBEDDING_MODEL_VERSION,
      },
      data: { resolution: real, services: [] },
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps the three stamp kinds distinct (panel N1)", () => {
    const stamps = (versions: Record<string, string>) =>
      GoalResolutionSchema.safeParse({
        serviceIds: [],
        resolutionLayer: "exact-id",
        versions,
      });
    // catalog is the bundle's date-stamp, crosswalk is semver, the retriever
    // stamp is a lowercase token — a value valid for one kind must not
    // validate another.
    expect(
      stamps({ catalogVersion: "1.0.0", crosswalkVersion: "1.0.0", embeddingModelVersion: "lexical-hash-v1" }).success,
    ).toBe(false);
    expect(
      stamps({ catalogVersion: "2026-10-30.1", crosswalkVersion: "2026-10-30.1", embeddingModelVersion: "lexical-hash-v1" }).success,
    ).toBe(false);
    expect(
      stamps({ catalogVersion: "2026-10-30.1", crosswalkVersion: "1.0.0", embeddingModelVersion: "Lexical Hash v1" }).success,
    ).toBe(false);
  });

  it("caps and sanitizes error-envelope text (panel S4)", () => {
    const parse = (message: string, detail?: string) =>
      ApiErrorEnvelopeSchema.safeParse({
        ok: false,
        tool: "get_service_estimate",
        versions: RESPONSE_VERSIONS,
        error: { code: "internal", message, ...(detail === undefined ? {} : { detail }) },
      });
    const ansi = parse("[31mboom[0m");
    expect(ansi.success).toBe(true);
    if (ansi.success) expect(ansi.data.error.message).toBe("boom");
    expect(parse("x".repeat(2001)).success).toBe(false);
    expect(parse("[0m").success).toBe(false); // strips to empty → invalid
    expect(parse("ok", "x".repeat(4001)).success).toBe(false);
    expect(parse("ok", "x".repeat(4000)).success).toBe(true);
  });

  it("rejects an upload spec on a non-document_upload step (panel S4, reverse coupling)", () => {
    const [hicFixture] = SERVICE_FIXTURES;
    const step = hicFixture.steps[0];
    const result = StepInstructionSchema.safeParse({
      ...step,
      fulfillmentMethod: "in_person_appearance",
      upload: {
        portalId: "portal:dep:paris",
        acceptedFormats: ["pdf"],
        maxSizeBytes: null,
        sizeLimitVerified: false,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("upload"))).toBe(true);
    }
  });
});
