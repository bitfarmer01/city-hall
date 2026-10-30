// Linker tests (D4): referential integrity, ID discipline, honesty rules,
// and diff-stable output. A violation-free link is the gate every catalog
// change must clear in CI.

import { describe, expect, it } from "vitest";

import type {
  AgencyRecord,
  BlueprintStepRecord,
  FormFieldRecord,
  GoalCrosswalkRecord,
  ServiceCatalogMeta,
  ServiceRecord,
  SourceSnapshotRecord,
} from "./types";
import { LinkError, linkCatalog, stableStringify, type LinkInput } from "./link";

const AGENCY: AgencyRecord = {
  id: "nyc-dcwp",
  name: "Department of Consumer and Worker Protection",
  abbreviation: "DCWP",
  level: "nyc",
  urls: [],
  schemaOrg: { "@type": "GovernmentOrganization", name: "Department of Consumer and Worker Protection", identifier: "nyc-dcwp" },
};

const META: ServiceCatalogMeta = {
  catalogId: "svc:dcwp:home-improvement-contractor-license",
  nyc311ArticleId: "nyc311-KA-01808",
  nyc311ArticleUrl: "https://portal.311.nyc.gov/article/?kanumber=KA-01808",
  domain: "licensing",
  serviceSubtype: "license",
  classifiedDisposition: "service",
  classifierRulesVersion: "1.0.0",
  domainTaxonomyVersion: "1.0.0",
};

function stepFor(catalogId: string, overrides: Partial<BlueprintStepRecord> = {}): BlueprintStepRecord {
  return {
    id: `stp:${catalogId}:010`,
    serviceId: catalogId,
    sequence: 1,
    requirement: "Apply for the license online",
    fulfillmentMethod: "online_submission",
    responsibleAgency: { id: "nyc-dcwp", name: "Department of Consumer and Worker Protection" },
    sourceRefs: ["snap:f29b96c047dd"],
    ...overrides,
  };
}

function step(overrides: Partial<BlueprintStepRecord> = {}): BlueprintStepRecord {
  return stepFor("svc:dcwp:home-improvement-contractor-license", overrides);
}

function service(overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  const meta: ServiceCatalogMeta = { ...META, ...overrides.meta };
  return {
    envelope: {
      "@context": "https://schema.org",
      "@type": "GovernmentService",
      identifier: [meta.catalogId, meta.nyc311ArticleId],
      name: "Home Improvement Contractor License",
      description: "Apply for or renew a home improvement contractor license.",
      serviceType: "License",
      provider: { "@type": "GovernmentOrganization", name: AGENCY.name, identifier: AGENCY.id },
      jurisdiction: { "@type": "AdministrativeArea", name: "New York City" },
      availableChannel: [],
      offers: [],
      subjectOf: [{ "@type": "CreativeWork", url: meta.nyc311ArticleUrl }],
      "x:coverageDomain": meta.domain,
      "x:domainTaxonomyVersion": meta.domainTaxonomyVersion,
      ...overrides.envelope,
    },
    meta,
    steps: overrides.steps ?? [stepFor(meta.catalogId)],
    formIds: overrides.formIds ?? [],
  };
}

const SNAPSHOT: SourceSnapshotRecord = {
  id: "snap:f29b96c047dd",
  url: "https://portal.311.nyc.gov/article/?kanumber=KA-01808",
  capturedAt: "2026-10-30",
  method: "manual",
  sha256: "f29b96c047dd0000000000000000000000000000000000000000000000000000",
};

function baseInput(overrides: Partial<LinkInput> = {}): LinkInput {
  return {
    catalogVersion: "2026-10-30.1",
    generatedAt: "2026-10-30",
    sourceInventory: {
      snapshotId: "snap:63aff11a928c",
      capturedAt: "2026-10-30T17:11:43.820Z",
      sha256: "63aff11a928c0000000000000000000000000000000000000000000000000000",
      articleCount: 2093,
    },
    agencies: [AGENCY],
    services: [service()],
    portals: [],
    forms: [],
    formFields: [],
    snapshots: [SNAPSHOT],
    crosswalks: [],
    ...overrides,
  };
}

function violationsOf(input: LinkInput): string[] {
  try {
    linkCatalog(input);
  } catch (error) {
    if (error instanceof LinkError) return error.violations;
    throw error;
  }
  return [];
}

describe("linkCatalog", () => {
  it("links a valid bundle and sorts its arrays", () => {
    const bundle = linkCatalog(
      baseInput({
        services: [
          service({ meta: { ...META, catalogId: "svc:zzz:last-one", nyc311ArticleId: "nyc311-KA-00001" } }),
          service(),
        ],
      }),
    );
    expect(bundle.services).toHaveLength(2);
    expect(bundle.services[0].meta.catalogId).toBe("svc:dcwp:home-improvement-contractor-license");
    expect(bundle.schemaVersion).toBe("0.1.0");
  });

  it("rejects a dangling step sourceRef", () => {
    const violations = violationsOf(baseInput({ services: [service({ steps: [step({ sourceRefs: ["snap:aaaaaaaaaaaa"] })] })] }));
    expect(violations.join("\n")).toContain('sourceRef "snap:aaaaaaaaaaaa" is not a known snapshot');
  });

  it("rejects an unknown responsible agency", () => {
    const violations = violationsOf(
      baseInput({ services: [service({ steps: [step({ responsibleAgency: { id: "nyc-nope", name: "Nope" } })] })] }),
    );
    expect(violations.join("\n")).toContain('responsibleAgency "nyc-nope" is not a known agency');
  });

  it("rejects a denormalized agency name that disagrees with the agency record", () => {
    const violations = violationsOf(
      baseInput({ services: [service({ steps: [step({ responsibleAgency: { id: "nyc-dcwp", name: "Consumer Affairs" } })] })] }),
    );
    expect(violations.join("\n")).toContain('name "Consumer Affairs" does not match agency record');
  });

  it("rejects an upload size limit that is set but unverified", () => {
    const violations = violationsOf(
      baseInput({
        services: [
          service({
            steps: [
              step({
                fulfillmentMethod: "document_upload",
                upload: { maxSizeBytes: 1048576, sizeLimitVerified: false },
              }),
            ],
          }),
        ],
      }),
    );
    expect(violations.join("\n")).toContain("no invented limits");
  });

  it("requires upload constraints on document_upload steps", () => {
    const violations = violationsOf(
      baseInput({ services: [service({ steps: [step({ fulfillmentMethod: "document_upload" })] })] }),
    );
    expect(violations.join("\n")).toContain("document_upload steps must carry upload constraints");
  });

  it("rejects sequence gaps", () => {
    const violations = violationsOf(
      baseInput({
        services: [
          service({
            steps: [
              step({ id: "stp:svc:dcwp:home-improvement-contractor-license:010" }),
              step({ id: "stp:svc:dcwp:home-improvement-contractor-license:030", sequence: 3 }),
            ],
          }),
        ],
      }),
    );
    expect(violations.join("\n")).toContain("step sequences must be 1..n");
  });

  it("rejects an unknown fulfillmentMethod", () => {
    const violations = violationsOf(
      baseInput({ services: [service({ steps: [step({ fulfillmentMethod: "telepathy" as BlueprintStepRecord["fulfillmentMethod"] })] })] }),
    );
    expect(violations.join("\n")).toContain('unknown fulfillmentMethod "telepathy"');
  });

  it("rejects a service whose meta disposition is not service", () => {
    const violations = violationsOf(
      baseInput({
        services: [
          service({ meta: { ...META, classifiedDisposition: "informational" as ServiceCatalogMeta["classifiedDisposition"] } }),
        ],
      }),
    );
    expect(violations.join("\n")).toContain('only disposition "service"');
  });

  it("rejects the placeholder other domain", () => {
    const violations = violationsOf(baseInput({ services: [service({ meta: { ...META, domain: "other" } })] }));
    expect(violations.join("\n")).toContain("must carry a real coverage domain");
  });

  it("rejects dangling form links from a service", () => {
    const violations = violationsOf(baseInput({ services: [service({ formIds: ["form:dcwp:nope"] })] }));
    expect(violations.join("\n")).toContain('formId "form:dcwp:nope" is not a known form');
  });

  it("rejects dangling crosswalk serviceIds", () => {
    const crosswalk: GoalCrosswalkRecord = {
      id: "xw:open-a-restaurant",
      utterances: ["I want to open a restaurant"],
      serviceIds: ["svc:nope:missing"],
      excludedServiceIds: [],
      testCases: [],
    };
    const violations = violationsOf(baseInput({ crosswalks: [crosswalk] }));
    expect(violations.join("\n")).toContain('serviceId "svc:nope:missing" is not a known service');
  });

  it("rejects a snapshot whose id is not the sha256 prefix", () => {
    const violations = violationsOf(
      baseInput({
        snapshots: [{ ...SNAPSHOT, id: "snap:aaaaaaaaaaaa" }],
      }),
    );
    expect(violations.join("\n")).toContain("is not the 12-char prefix of its sha256");
  });

  it("rejects duplicate record ids", () => {
    const violations = violationsOf(baseInput({ agencies: [AGENCY, { ...AGENCY, name: "Duplicate" }] }));
    expect(violations.join("\n")).toContain('duplicate agency id "nyc-dcwp"');
  });

  it("produces byte-identical bundles for identical input", () => {
    const input = baseInput({
      agencies: [
        AGENCY,
        {
          id: "nyc-buildings",
          name: "Department of Buildings",
          abbreviation: "DOB",
          level: "nyc",
          urls: [],
          schemaOrg: { "@type": "GovernmentOrganization", name: "Department of Buildings", identifier: "nyc-buildings" },
        },
      ],
      forms: [
        {
          id: "form:buildings:pw1",
          agency: "buildings",
          formNumber: "PW1",
          title: "Plan/Work Application",
          sourceUrl: "https://www.nyc.gov/site/buildings/forms/pw1.pdf",
          sha256: "a68fd0c754fe0000000000000000000000000000000000000000000000000000",
          pages: 2,
          fillableClass: "acroform",
        },
      ],
      formFields: [
        {
          id: "fld:form:buildings:pw1:0123abcd",
          formId: "form:buildings:pw1",
          nativeName: "topmostSubform[0].Page1[0]",
          visibleLabel: "Owner name",
          fieldType: "text",
          requiredStatus: "author_declared_required",
          requirementLevel: "required",
          provenance: { sourceLayer: "acroform", tool: "pypdf", confidence: 1 },
        } satisfies FormFieldRecord,
      ],
    });
    const first = stableStringify(linkCatalog(input));
    const second = stableStringify(linkCatalog(input));
    expect(first).toBe(second);
  });
});
