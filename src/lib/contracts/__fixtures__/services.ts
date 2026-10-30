// MOCK FIXTURES — full-depth example services for the four parallel builds
// to code against (task todo_O2keBBqw).
//
// These are fixtures, NOT captured data. Identities follow the real catalog
// seeds (HIC KA-01808; the DEP water-tap record is svc:dep:water-tap-permit /
// KA-02076, panel S3-F3), and provenance shapes follow the real classifier
// output (ruleId "R006-service-action" pattern; evidence span = the matched
// action-verb text, not the article title — panel S1-M7/S3-F7). Values that
// are placeholder or deliberately differ from any real record are marked
// FIXTURE. Every snapshot ref is snap:fixture-* (panel S4-M5) so a fixture
// can never masquerade as a real capture. Nothing here was fetched from
// nyc.gov by this module; do not ship these values to users.

import { CATALOG_SCHEMA_VERSION } from "../../catalog/types";

import type {
  EstimateBlock,
  GovernmentService,
  RequiredDocument,
  ServiceSummary,
  StepInstruction,
  VersionStamps,
} from "../index";

/** Stamp fixtures carry so they can never masquerade as a real catalog.
 * Each stamp matches its producer-kind schema (panel N1) while remaining
 * unmistakably fake — year 0000, `0.0.0-fixture` prerelease. */
export const FIXTURE_VERSIONS: VersionStamps = {
  catalogVersion: "0000-01-01.0",
  crosswalkVersion: "0.0.0-fixture",
  embeddingModelVersion: "0.0.0-fixture",
};

/** Provenance stamps fixtures carry — semver-shaped, unmistakably fake. */
export const FIXTURE_CLASSIFIER_RULES_VERSION = "0.0.0-fixture";
export const FIXTURE_DOMAIN_TAXONOMY_VERSION = "0.0.0-fixture";

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
    // D4's ServiceEnvelope tuple identifier (panel B1) — locked decision #1.
    identifier: ["svc:dcwp:home-improvement-contractor-license", "nyc311-KA-01808"],
    name: "Home Improvement Contractor License",
    description: "FIXTURE description — apply for or renew a home improvement contractor license.",
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
        name: "Online",
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
        identifier: "fee:dcwp:home-improvement-contractor-license:two-year-term",
        price: 200,
        priceCurrency: "USD",
        description: "Two-year license term. Source: NYC311 KA-01808, captured 2026-10-30.",
        "x:sourceRefs": ["snap:fixture-dcwp-hic-001"],
        "x:capturedAt": "2026-10-30",
      },
    ],
    subjectOf: [
      { "@type": "CreativeWork", url: "https://portal.311.nyc.gov/article/?kanumber=KA-01808" },
    ],
    "x:coverageDomain": "licensing",
    "x:domainTaxonomyVersion": FIXTURE_DOMAIN_TAXONOMY_VERSION,
    schemaVersion: CATALOG_SCHEMA_VERSION,
  },
  summary: {
    id: "svc:dcwp:home-improvement-contractor-license",
    title: "Home Improvement Contractor License",
    agency: { id: "nyc-dcwp", name: "Department of Consumer and Worker Protection" },
    domain: "licensing",
    domainSource: "keyword",
    domainAppliesToCatalog: true,
    domainTaxonomyVersion: FIXTURE_DOMAIN_TAXONOMY_VERSION,
    disposition: {
      disposition: "service",
      serviceSubtype: "apply",
      reason: "action:apply",
      ruleId: "R006-service-action",
      classifierRulesVersion: FIXTURE_CLASSIFIER_RULES_VERSION,
      evidence: {
        kind: "index-text",
        span: "Apply for a Home Improvement Contractor License",
      },
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
        // Tier-2 fixture row (panel S3-F4) — empirical timeline with the
        // dataset + query recorded; capturedAt deliberately omitted (the
        // optional pin, panel S1-S1).
        tier: 2,
        label: "Typical processing time",
        durationText: "about 3 weeks",
        dataset: "nyc-dcwp-license-application-processing",
        query: "FIXTURE query — median days from application to issuance, FY2026",
        sourceUrl: "https://data.cityofnewyork.us/",
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
      serviceId: "svc:dcwp:home-improvement-contractor-license",
      sequence: 1,
      requirement: "Apply online through the DCWP Licensing Portal",
      responsibleAgency: { id: "nyc-dcwp", name: "Department of Consumer and Worker Protection" },
      fulfillmentMethod: "document_upload",
      upload: {
        portalId: "portal:dcwp:licensing",
        portalUrl: "https://a866-dcwpbp.nyc.gov/account/services",
        acceptedFormats: ["pdf"],
        maxSizeBytes: null,
        sizeLimitVerified: false,
        multipleAllowed: true,
      },
      responsibleJurisdiction: "nyc",
      feeRef: "fee:dcwp:home-improvement-contractor-license:two-year-term",
      feeNotes: ["FIXTURE note — credit-card surcharge renders here, never in the headline"],
      sourceRefs: ["snap:fixture-dcwp-hic-001"],
    },
    {
      id: "stp:svc:dcwp:home-improvement-contractor-license:020",
      serviceId: "svc:dcwp:home-improvement-contractor-license",
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
    // Real catalog identity (panel S3-F3): svc:dep:water-tap-permit, KA-02076.
    identifier: ["svc:dep:water-tap-permit", "nyc311-KA-02076"],
    name: "Water Tap Permit",
    description: "FIXTURE description — permit to install, plug, or disconnect a water tap.",
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
        name: "Online (PARIS)",
        serviceUrl: "https://www.nyc.gov/site/dep/about/permit-and-review-information-system.page",
      },
    ],
    // Empty offers is the honest state — the catalog hasn't verified a fee
    // schedule for this service (D4's DEP seed carries fees: []).
    offers: [],
    subjectOf: [
      { "@type": "CreativeWork", url: "https://portal.311.nyc.gov/article/?kanumber=KA-02076" },
    ],
    "x:coverageDomain": "permits",
    "x:domainTaxonomyVersion": FIXTURE_DOMAIN_TAXONOMY_VERSION,
    schemaVersion: CATALOG_SCHEMA_VERSION,
  },
  summary: {
    id: "svc:dep:water-tap-permit",
    title: "Water Tap Permit",
    agency: { id: "nyc-dep", name: "Department of Environmental Protection" },
    domain: "permits",
    domainSource: "keyword",
    domainAppliesToCatalog: true,
    domainTaxonomyVersion: FIXTURE_DOMAIN_TAXONOMY_VERSION,
    disposition: {
      disposition: "service",
      serviceSubtype: "apply",
      reason: "action:apply",
      ruleId: "R006-service-action",
      classifierRulesVersion: FIXTURE_CLASSIFIER_RULES_VERSION,
      evidence: {
        kind: "page-accordion",
        span: "Apply to plug or cap a water tap",
      },
    },
  },
  estimate: {
    serviceId: "svc:dep:water-tap-permit",
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
  // fulfillment methods), including the honest unverified upload size limit —
  // re-keyed to the real record identity (panel S3-F3).
  steps: [
    {
      id: "stp:svc:dep:water-tap-permit:010",
      serviceId: "svc:dep:water-tap-permit",
      sequence: 1,
      requirement: "Application filed by a licensed master plumber",
      responsibleAgency: { id: "nyc-dep", name: "Department of Environmental Protection" },
      fulfillmentMethod: "in_person_appearance",
      responsibleJurisdiction: "nyc",
      sourceRefs: ["snap:fixture-dep-001"],
    },
    {
      id: "stp:svc:dep:water-tap-permit:020",
      serviceId: "svc:dep:water-tap-permit",
      sequence: 2,
      requirement: "DOB-approved site plan, plumbing riser diagram, Schedule B",
      responsibleAgency: { id: "nyc-dep", name: "Department of Environmental Protection" },
      fulfillmentMethod: "document_upload",
      upload: {
        portalId: "portal:dep:paris",
        portalUrl: "https://www.nyc.gov/site/dep/about/permit-and-review-information-system.page",
        acceptedFormats: ["pdf"],
        maxSizeBytes: null,
        sizeLimitVerified: false,
        multipleAllowed: true,
      },
      responsibleJurisdiction: "nyc",
      sourceRefs: ["snap:fixture-dep-002"],
    },
    {
      id: "stp:svc:dep:water-tap-permit:030",
      serviceId: "svc:dep:water-tap-permit",
      sequence: 3,
      requirement: "Notarized affidavit from the property owner (plugging a tap)",
      responsibleAgency: { id: "nyc-dep", name: "Department of Environmental Protection" },
      fulfillmentMethod: "notarized_wet_signature",
      responsibleJurisdiction: "nyc",
      sourceRefs: ["snap:fixture-dep-002"],
    },
  ],
  documents: [
    {
      id: "form:dep:schedule-b",
      serviceId: "svc:dep:water-tap-permit",
      name: "Schedule B — plumbing fixtures",
      formNumber: "DEP Schedule B",
      description: "FIXTURE entry — filed with the tap application",
      sourceRefs: ["snap:fixture-dep-002"],
    },
  ],
};

/** The fixture corpus, in stable order (licensing, permits). */
export const SERVICE_FIXTURES: readonly ServiceFixture[] = [hicFixture, depFixture];
