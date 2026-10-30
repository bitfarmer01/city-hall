// MOCK FIXTURES — full-depth example services for the four parallel builds
// to code against while the D4 catalog is in flight (task todo_O2keBBqw).
//
// These are fixtures, NOT captured data. Both derive from the build spec's
// worked examples (the verified $200 HIC fee, the DEP water-tap steps); step
// requirements for HIC and every document entry are placeholder shapes
// marked FIXTURE. Nothing here was fetched from nyc.gov by this module; do
// not ship these values to users.

import type {
  EstimateBlock,
  GovernmentService,
  RequiredDocument,
  ServiceSummary,
  StepInstruction,
  VersionStamps,
} from "../index";

/** Stamp fixtures carry so they can never masquerade as a real catalog. */
export const FIXTURE_VERSIONS: VersionStamps = {
  catalogVersion: "0.0.0-fixture",
  crosswalkVersion: "0.0.0-fixture",
  embeddingModelVersion: "0.0.0-fixture",
};

export interface ServiceFixture {
  service: GovernmentService;
  summary: ServiceSummary;
  estimate: EstimateBlock;
  steps: StepInstruction[];
  documents: RequiredDocument[];
}

const hicFixture: ServiceFixture = {
  service: {
    "@context": "https://schema.org",
    "@type": "GovernmentService",
    identifier: "svc:dcwp:home-improvement-contractor-license",
    name: "Home Improvement Contractor License",
    alternateName: ["HIC license", "home improvement contractor registration"],
    serviceType: "License",
    provider: {
      "@type": "GovernmentOrganization",
      name: "Department of Consumer and Worker Protection",
      identifier: "nyc-dcwp",
    },
    jurisdiction: { "@type": "AdministrativeArea", name: "New York City" },
    serviceOutput: { "@type": "Permit", name: "Home Improvement Contractor license" },
    availableChannel: [
      {
        "@type": "ServiceChannel",
        serviceUrl: "https://a866-dcwpbp.nyc.gov/account/services",
        processingTime: "P21D",
      },
      {
        "@type": "ServiceChannel",
        name: "In-person (hardship appointments only)",
        servicePostalAddress: "42 Broadway, New York NY",
      },
    ],
    offers: [
      {
        "@type": "Offer",
        price: 200,
        priceCurrency: "USD",
        description: "Two-year license term. Source: NYC311 KA-01808, captured 2026-10-30.",
      },
    ],
    subjectOf: [
      {
        "@type": "CreativeWork",
        url: "/catalog/svc:dcwp:home-improvement-contractor-license/blueprint.json",
      },
      { "@type": "CreativeWork", url: "https://portal.311.nyc.gov/article/?kanumber=KA-01808" },
    ],
  },
  summary: {
    id: "svc:dcwp:home-improvement-contractor-license",
    title: "Home Improvement Contractor License",
    agency: { id: "nyc-dcwp", name: "Department of Consumer and Worker Protection" },
    domain: "licensing",
    domainSource: "keyword",
    domainAppliesToCatalog: true,
    disposition: {
      disposition: "service",
      subtype: "apply",
      reason: "action:apply",
      ruleId: "verb-apply",
      classifierVersion: "fixture",
      evidence: { kind: "index-text", span: "Home Improvement Contractor License" },
    },
  },
  estimate: {
    serviceId: "svc:dcwp:home-improvement-contractor-license",
    tiers: [
      {
        tier: 1,
        label: "License fee",
        amountText: "$200",
        amountValue: 200,
        currency: "USD",
        sourceCitation: "NYC311 KA-01808, captured 2026-10-30 (two-year license term)",
        sourceUrl: "https://portal.311.nyc.gov/article/?kanumber=KA-01808",
        capturedAt: "2026-10-30",
      },
      {
        tier: 3,
        label: "Total time to license",
        rangeText: "3-8 weeks",
        basis: "FIXTURE heuristic: shape only — a real basis names the varying review steps",
      },
    ],
  },
  steps: [
    {
      id: "stp:svc:dcwp:home-improvement-contractor-license:010",
      sequence: 1,
      requirement: "Apply online through the DCWP Licensing Portal",
      responsibleAgency: { id: "nyc-dcwp", name: "Department of Consumer and Worker Protection" },
      fulfillmentMethod: "document_upload",
      upload: {
        portalId: "portal:dcwp:licensing",
        acceptedFormats: ["pdf"],
        maxSizeBytes: null,
        sizeLimitVerified: false,
      },
      responsibleJurisdiction: "nyc",
      feeNotes: ["FIXTURE note — credit-card surcharge renders here, never in the headline"],
      sourceRefs: ["snap:fixture-dcwp-hic-001"],
    },
    {
      id: "stp:svc:dcwp:home-improvement-contractor-license:020",
      sequence: 2,
      requirement: "Hardship in-person appointment at 42 Broadway, if online filing is impossible",
      responsibleAgency: { id: "nyc-dcwp", name: "Department of Consumer and Worker Protection" },
      fulfillmentMethod: "in_person_appearance",
      responsibleJurisdiction: "nyc",
      sourceRefs: ["snap:fixture-dcwp-hic-001"],
    },
  ],
  documents: [
    {
      id: "form:dcwp:hic-application",
      serviceId: "svc:dcwp:home-improvement-contractor-license",
      name: "Home Improvement Contractor License Application",
      description: "FIXTURE entry — attachments required per the application",
      sourceRefs: ["snap:fixture-dcwp-hic-001"],
    },
  ],
};

const depFixture: ServiceFixture = {
  service: {
    "@context": "https://schema.org",
    "@type": "GovernmentService",
    identifier: "svc:dep:water-tap-plug",
    name: "Water Tap Plug or Disconnect",
    serviceType: "Permit",
    provider: {
      "@type": "GovernmentOrganization",
      name: "Department of Environmental Protection",
      identifier: "nyc-dep",
    },
    jurisdiction: { "@type": "AdministrativeArea", name: "New York City" },
    availableChannel: [
      {
        "@type": "ServiceChannel",
        name: "DEP permitting application office",
        servicePostalAddress: "59-17 Junction Blvd, Flushing NY",
      },
    ],
    subjectOf: [
      { "@type": "CreativeWork", url: "/catalog/svc:dep:water-tap-plug/blueprint.json" },
      { "@type": "CreativeWork", url: "https://portal.311.nyc.gov/article/?kanumber=KA-01203" },
    ],
  },
  summary: {
    id: "svc:dep:water-tap-plug",
    title: "Water Tap Plug or Disconnect",
    agency: { id: "nyc-dep", name: "Department of Environmental Protection" },
    domain: "permits",
    domainSource: "keyword",
    domainAppliesToCatalog: true,
    disposition: {
      disposition: "service",
      subtype: "apply",
      reason: "action:apply",
      ruleId: "verb-apply",
      classifierVersion: "fixture",
      evidence: { kind: "page-accordion", span: "Plug or cap a water tap" },
    },
  },
  estimate: {
    serviceId: "svc:dep:water-tap-plug",
    tiers: [
      {
        tier: 3,
        label: "Tap fee",
        rangeText: "varies by tap size",
        basis:
          "FIXTURE heuristic: DEP fees vary with tap diameter; the flat-fee tier stays empty until the catalog verifies the schedule",
      },
    ],
  },
  // Steps verbatim from the build spec's BlueprintStep example (three
  // fulfillment methods), including the honest unverified upload size limit.
  steps: [
    {
      id: "stp:svc:dep:water-tap-plug:010",
      sequence: 1,
      requirement: "Application filed by a licensed master plumber",
      responsibleAgency: { id: "nyc-dep", name: "Department of Environmental Protection" },
      fulfillmentMethod: "in_person_appearance",
      responsibleJurisdiction: "nyc",
      sourceRefs: ["snap:3f9c2a71b4d0"],
    },
    {
      id: "stp:svc:dep:water-tap-plug:020",
      sequence: 2,
      requirement: "DOB-approved site plan, plumbing riser diagram, Schedule B",
      responsibleAgency: { id: "nyc-dep", name: "Department of Environmental Protection" },
      fulfillmentMethod: "document_upload",
      upload: {
        portalId: "portal:dep:paris",
        acceptedFormats: ["pdf"],
        maxSizeBytes: null,
        sizeLimitVerified: false,
      },
      responsibleJurisdiction: "nyc",
      sourceRefs: ["snap:8b12e0f6c3aa"],
    },
    {
      id: "stp:svc:dep:water-tap-plug:030",
      sequence: 3,
      requirement: "Notarized affidavit from the property owner (plugging a tap)",
      responsibleAgency: { id: "nyc-dep", name: "Department of Environmental Protection" },
      fulfillmentMethod: "notarized_wet_signature",
      responsibleJurisdiction: "nyc",
      sourceRefs: ["snap:8b12e0f6c3aa"],
    },
  ],
  documents: [
    {
      id: "form:dep:schedule-b",
      serviceId: "svc:dep:water-tap-plug",
      name: "Schedule B — plumbing fixtures",
      formNumber: "DEP Schedule B",
      description: "FIXTURE entry — filed with the tap application",
      sourceRefs: ["snap:8b12e0f6c3aa"],
    },
  ],
};

/** The fixture corpus, in stable order (licensing, permits). */
export const SERVICE_FIXTURES: readonly ServiceFixture[] = [hicFixture, depFixture];
