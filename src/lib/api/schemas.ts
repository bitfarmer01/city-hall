// Component JSON Schemas for the OpenAPI document (3.0.3-compatible), kept
// beside the TypeScript contract in types.ts. The snapshot test pins the
// assembled document; edit schemas and types together, then regenerate the
// golden with `npm run openapi:generate`.
//
// 3.0.3 notes: no `const` (use single-value `enum`), no type arrays — the
// GPT Actions surface validates against 3.0.x semantics.

import { SCHEMA_VERSION } from "@/lib/health";

/** Registered component schemas, keyed by name — assembled into `components.schemas`. */
export const COMPONENT_SCHEMAS: Record<string, object> = {
  VersionStamps: {
    type: "object",
    description:
      "The three version stamps every answer carries — replaying with pinned versions reproduces the answer.",
    properties: {
      catalogVersion: { type: "string", example: "2026-10-30.1" },
      crosswalkVersion: { type: "string" },
      embeddingModelVersion: { type: "string" },
    },
    required: ["catalogVersion", "crosswalkVersion", "embeddingModelVersion"],
  },

  ResolveGoalRequest: {
    type: "object",
    description: "Free-form goal utterance, e.g. \"I want to license my dog\".",
    properties: {
      goal: { type: "string", minLength: 1, maxLength: 2000 },
    },
    required: ["goal"],
  },

  ServiceSummary: {
    type: "object",
    properties: {
      id: { type: "string", description: "Catalog service ID, e.g. svc:dohmh:dog-license" },
      name: { type: "string" },
      serviceType: { type: "string" },
      providerName: { type: "string" },
      coverageDomain: {
        type: "string",
        description: "Coverage domain from the D2b taxonomy (permits, 311 requests, public records, licensing, inspections).",
      },
      nyc311ArticleId: { type: "string", example: "KA-01890" },
      detailUrl: { type: "string", description: "API path for the full service detail." },
    },
    required: ["id", "name", "serviceType", "providerName", "coverageDomain", "nyc311ArticleId", "detailUrl"],
  },

  ResolveGoalResponse: {
    type: "object",
    properties: {
      serviceIds: {
        type: "array",
        items: { type: "string" },
        description: "Ordered resolved service IDs; highest-confidence first. Empty = no-match.",
      },
      resolutionLayer: {
        type: "string",
        description:
          "The deterministic resolver layer that fired (exact-id, alias-rules, semantic-retrieval, search-fallback). " +
          "The llm_assist layer never appears on the API surface in v1.",
        enum: ["exact-id", "alias-rules", "semantic-retrieval", "search-fallback"],
      },
      services: { type: "array", items: { $ref: "#/components/schemas/ServiceSummary" } },
      versions: { $ref: "#/components/schemas/VersionStamps" },
    },
    required: ["serviceIds", "resolutionLayer", "services", "versions"],
  },

  ServiceEnvelope: {
    type: "object",
    description:
      "Pure schema.org GovernmentService JSON-LD envelope (locked decision #4). " +
      "Catalog facts schema.org has no term for live under the documented x: extension namespace. " +
      "See https://schema.org/GovernmentService.",
    properties: {
      "@context": { type: "string", enum: ["https://schema.org"] },
      "@type": { type: "string", enum: ["GovernmentService"] },
      identifier: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 2,
        description: "Two-element pair [catalogId, nyc311ArticleId].",
      },
      name: { type: "string" },
      description: { type: "string" },
      alternateName: { type: "array", items: { type: "string" } },
      serviceType: { type: "string" },
      provider: { type: "object" },
      jurisdiction: { type: "object" },
      serviceOutput: { type: "object" },
      availableChannel: { type: "array", items: { type: "object" } },
      offers: { type: "array", items: { type: "object" } },
      subjectOf: { type: "array", items: { type: "object" } },
    },
    required: ["@context", "@type", "identifier", "name", "description", "serviceType", "provider", "jurisdiction", "availableChannel", "offers", "subjectOf"],
    // JSON-LD envelopes are open by design — additionalProperties stays true (default).
  },

  AgencyRef: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
    },
    required: ["id", "name"],
  },

  StepUpload: {
    type: "object",
    description: "Upload constraints, honest by construction: maxSizeBytes is null and sizeLimitVerified is false unless a source states a limit.",
    properties: {
      portalId: { type: "string" },
      portalUrl: { type: "string" },
      acceptedFormats: { type: "array", items: { type: "string" } },
      maxSizeBytes: { type: "integer", nullable: true },
      sizeLimitVerified: { type: "boolean" },
      multipleAllowed: { type: "boolean" },
    },
    required: ["maxSizeBytes", "sizeLimitVerified"],
  },

  StepFee: {
    type: "object",
    description: "The step's feeRef offer resolved into display shape.",
    properties: {
      feeId: { type: "string" },
      amountValue: { type: "number" },
      currency: { type: "string" },
      description: { type: "string" },
    },
    required: ["feeId", "currency", "description"],
  },

  StepDependency: {
    type: "object",
    description: "A step dependency — NYC step IDs, or agency-labeled state/federal/utility dependencies (locked decision #3).",
    properties: {
      agencyId: { type: "string" },
      label: { type: "string" },
      note: { type: "string" },
    },
    required: ["label"],
  },

  InstructionStep: {
    type: "object",
    description: "One ordered instruction: a blueprint step with its fee resolved and surcharge notes attached.",
    properties: {
      id: { type: "string" },
      sequence: { type: "integer", minimum: 1 },
      phase: { type: "string" },
      requirement: { type: "string" },
      fulfillmentMethod: {
        type: "string",
        enum: ["site_visit", "in_person_appearance", "notarized_wet_signature", "document_upload", "online_submission", "mail_in"],
      },
      responsibleAgency: { $ref: "#/components/schemas/AgencyRef" },
      administeredBy: { $ref: "#/components/schemas/AgencyRef" },
      issuedBy: { $ref: "#/components/schemas/AgencyRef" },
      upload: { $ref: "#/components/schemas/StepUpload" },
      fee: { $ref: "#/components/schemas/StepFee" },
      feeNotes: {
        type: "array",
        items: { type: "string" },
        description: "Contingent fees/surcharges — rendered here per the D6 rule, never in a headline estimate.",
      },
      dependencies: { type: "array", items: { $ref: "#/components/schemas/StepDependency" } },
      notes: { type: "string" },
      sourceRefs: { type: "array", items: { type: "string" }, description: "SourceSnapshot IDs backing every factual claim." },
    },
    required: ["id", "sequence", "requirement", "fulfillmentMethod", "responsibleAgency", "feeNotes", "dependencies", "sourceRefs"],
  },

  DocumentSummary: {
    type: "object",
    properties: {
      formId: { type: "string" },
      formNumber: { type: "string", nullable: true },
      title: { type: "string" },
      sourceUrl: { type: "string" },
      fillableClass: { type: "string", enum: ["acroform", "xfa", "hybrid", "flattened", "scanned"] },
    },
    required: ["formId", "formNumber", "title", "sourceUrl", "fillableClass"],
  },

  ServiceDetailResponse: {
    type: "object",
    properties: {
      service: { $ref: "#/components/schemas/ServiceEnvelope" },
      instructions: {
        type: "array",
        items: { $ref: "#/components/schemas/InstructionStep" },
        description: "Ordered step-by-step instructions (sequence ascending).",
      },
      documents: { type: "array", items: { $ref: "#/components/schemas/DocumentSummary" } },
      versions: { $ref: "#/components/schemas/VersionStamps" },
    },
    required: ["service", "instructions", "documents", "versions"],
  },

  FeeEstimate: {
    type: "object",
    description: "Tier 1 — a published fee, verbatim, with source citation + capture date.",
    properties: {
      tier: { type: "integer", enum: [1] },
      label: { type: "string" },
      amountText: { type: "string" },
      amountValue: { type: "number" },
      currency: { type: "string" },
      sourceCitation: { type: "string" },
      sourceUrl: { type: "string" },
      capturedAt: { type: "string", description: "ISO yyyy-mm-dd as-of." },
    },
    required: ["tier", "label", "amountText", "currency", "sourceCitation", "sourceUrl", "capturedAt"],
  },

  TimelineEstimate: {
    type: "object",
    description: "Tier 2 — an empirical timeline; dataset + query are the provenance.",
    properties: {
      tier: { type: "integer", enum: [2] },
      label: { type: "string" },
      durationText: { type: "string" },
      dataset: { type: "string" },
      query: { type: "string" },
      sourceUrl: { type: "string" },
    },
    required: ["tier", "label", "durationText", "dataset", "query"],
  },

  HeuristicEstimate: {
    type: "object",
    description: "Tier 3 — a labeled heuristic gap-filler; basis states why it is only a range.",
    properties: {
      tier: { type: "integer", enum: [3] },
      label: { type: "string" },
      rangeText: { type: "string" },
      basis: { type: "string" },
    },
    required: ["tier", "label", "rangeText", "basis"],
  },

  EstimateTier: {
    description: "One estimate item, labeled by its tier (1 fee, 2 timeline, 3 heuristic).",
    oneOf: [
      { $ref: "#/components/schemas/FeeEstimate" },
      { $ref: "#/components/schemas/TimelineEstimate" },
      { $ref: "#/components/schemas/HeuristicEstimate" },
    ],
  },

  EstimateResponse: {
    type: "object",
    properties: {
      serviceId: { type: "string" },
      tiers: { type: "array", items: { $ref: "#/components/schemas/EstimateTier" }, description: "Tier 1 → 2 → 3." },
      headline: {
        type: "array",
        items: { type: "string" },
        description: "Rendered headline lines: every fee carries source + as-of; a heuristic line carries its label.",
      },
      versions: { $ref: "#/components/schemas/VersionStamps" },
    },
    required: ["serviceId", "tiers", "headline", "versions"],
  },

  RequiredFieldCounts: {
    type: "object",
    description: "Required-status counts by the honest four-value enum — never collapsed to a boolean (locked decision #6).",
    properties: {
      total: { type: "integer" },
      author_declared_required: { type: "integer" },
      not_marked_required: { type: "integer" },
      inferred_required: { type: "integer" },
      unknown: { type: "integer" },
    },
    required: ["total", "author_declared_required", "not_marked_required", "inferred_required", "unknown"],
  },

  DocumentEntry: {
    allOf: [{ $ref: "#/components/schemas/DocumentSummary" }],
    type: "object",
    properties: {
      pages: { type: "integer" },
      sha256: { type: "string" },
      revisionDate: { type: "string" },
      fieldCounts: {
        $ref: "#/components/schemas/RequiredFieldCounts",
        nullable: true,
        description: "null when the form carries no extracted fields.",
      },
    },
    required: ["pages", "sha256", "fieldCounts"],
  },

  DocumentsResponse: {
    type: "object",
    properties: {
      serviceId: { type: "string" },
      documents: { type: "array", items: { $ref: "#/components/schemas/DocumentEntry" } },
      versions: { $ref: "#/components/schemas/VersionStamps" },
    },
    required: ["serviceId", "documents", "versions"],
  },

  ApiError: {
    type: "object",
    description: "Error envelope. Carries no catalog data and no version stamps.",
    properties: {
      error: {
        type: "object",
        properties: {
          code: { type: "string", enum: ["invalid_request", "not_found"] },
          message: { type: "string" },
        },
        required: ["code", "message"],
      },
    },
    required: ["error"],
  },
};

/** The OpenAPI document's `info.version` — the API contract version, not the app version. */
export const OPENAPI_INFO_VERSION = SCHEMA_VERSION;
