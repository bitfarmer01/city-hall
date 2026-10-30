import { describe, expect, it } from "vitest";

import { buildServiceEnvelope, EnvelopeBuildError, type EnvelopeBuildInput } from "./envelope";
import { feeId, serviceId } from "./ids";
import type { AgencyRecord } from "./types";

// Real values: DCWP verified in the research session (art_mcM1Ssao §5.1,
// [N2]/[N3]); the $200 two-year HIC fee is quoted on the captured KA-01808
// page (fixtures/snapshots/snap_a777dc9a2500 — the real bundle id).
const DCWP: AgencyRecord = {
  id: "nyc-dcwp",
  name: "Department of Consumer and Worker Protection",
  abbreviation: "DCWP",
  level: "nyc",
  urls: ["https://www.nyc.gov/site/dca/businesses/licenses-apply.page"],
  schemaOrg: {
    "@type": "GovernmentOrganization",
    name: "Department of Consumer and Worker Protection",
    identifier: "nyc-dcwp",
  },
};

function hicInput(): EnvelopeBuildInput {
  return {
    catalogId: serviceId("dcwp", "home-improvement-contractor-license"),
    nyc311ArticleId: "nyc311-KA-01808",
    nyc311ArticleUrl: "https://portal.311.nyc.gov/article/?kanumber=KA-01808",
    title: "Home Improvement Contractor License",
    description: "Apply for or renew a license to do construction or repair work at residences.",
    alternateNames: ["HIC license", "home improvement contractor registration"],
    serviceType: "License",
    domain: "licensing",
    agency: DCWP,
    channels: [
      { name: "Online", serviceUrl: "https://a866-dcwpbp.nyc.gov/account/services" },
      {
        name: "In-person (hardship appointments only)",
        servicePostalAddress: "42 Broadway, New York NY",
      },
    ],
    fees: [
      {
        identifier: feeId("dcwp", "home-improvement-contractor-license", "two-year-term"),
        price: 200,
        description: "Two-year license term. Source: NYC311 KA-01808, captured 2026-10-30.",
        sourceRefs: ["snap:a777dc9a2500"],
        capturedAt: "2026-10-30",
      },
    ],
    serviceOutputName: "Home Improvement Contractor license",
  };
}

describe("buildServiceEnvelope", () => {
  it("builds the spec's representative HIC envelope shape", () => {
    const envelope = buildServiceEnvelope(hicInput());

    expect(envelope["@context"]).toBe("https://schema.org");
    expect(envelope["@type"]).toBe("GovernmentService");
    expect(envelope.identifier).toEqual([
      "svc:dcwp:home-improvement-contractor-license",
      "nyc311-KA-01808",
    ]);
    expect(envelope.provider).toEqual({
      "@type": "GovernmentOrganization",
      name: "Department of Consumer and Worker Protection",
      identifier: "nyc-dcwp",
    });
    expect(envelope.jurisdiction).toEqual({
      "@type": "AdministrativeArea",
      name: "New York City",
    });
    expect(envelope.serviceOutput).toEqual({
      "@type": "Permit",
      name: "Home Improvement Contractor license",
    });
    expect(envelope.availableChannel).toHaveLength(2);
    expect(envelope.subjectOf).toEqual([
      { "@type": "CreativeWork", url: "https://portal.311.nyc.gov/article/?kanumber=KA-01808" },
    ]);
  });

  it("keeps the coverage domain in the x: extension namespace", () => {
    const envelope = buildServiceEnvelope(hicInput());
    expect(envelope["x:coverageDomain"]).toBe("licensing");
    expect(envelope["x:domainTaxonomyVersion"]).toBe("1.0.0");
  });

  it("carries fee provenance on every offer", () => {
    const envelope = buildServiceEnvelope(hicInput());
    expect(envelope.offers).toEqual([
      {
        "@type": "Offer",
        identifier: "fee:dcwp:home-improvement-contractor-license:two-year-term",
        price: 200,
        priceCurrency: "USD",
        description: "Two-year license term. Source: NYC311 KA-01808, captured 2026-10-30.",
        "x:sourceRefs": ["snap:a777dc9a2500"],
        "x:capturedAt": "2026-10-30",
      },
    ]);
  });

  it("omits optional members instead of emitting empty noise", () => {
    const input = hicInput();
    const envelope = buildServiceEnvelope({ ...input, alternateNames: undefined, fees: [] });
    expect("alternateName" in envelope).toBe(false);
    expect(envelope.offers).toEqual([]);
  });

  it("is deterministic — same input, identical envelope", () => {
    expect(buildServiceEnvelope(hicInput())).toEqual(buildServiceEnvelope(hicInput()));
  });

  it("refuses an unsourced fee, a bad price, and non-https URLs", () => {
    const badFee: EnvelopeBuildInput = {
      ...hicInput(),
      fees: [{ ...hicInput().fees[0], sourceRefs: [], capturedAt: "" }],
    };
    expect(() => buildServiceEnvelope(badFee)).toThrow(EnvelopeBuildError);

    const badPrice: EnvelopeBuildInput = {
      ...hicInput(),
      fees: [{ ...hicInput().fees[0], price: -1 }],
    };
    expect(() => buildServiceEnvelope(badPrice)).toThrow(/non-finite or negative/);

    const httpChannel: EnvelopeBuildInput = {
      ...hicInput(),
      channels: [{ name: "Online", serviceUrl: "http://a866-dcwpbp.nyc.gov/account/services" }],
    };
    expect(() => buildServiceEnvelope(httpChannel)).toThrow(/https:\/\//);
  });

  it("collects all violations into one rejection", () => {
    const input = hicInput();
    const input2: EnvelopeBuildInput = {
      ...input,
      fees: [{ ...input.fees[0], sourceRefs: [], capturedAt: "" }],
      nyc311ArticleUrl: "not-a-url",
    };
    try {
      buildServiceEnvelope(input2);
      expect.unreachable("expected EnvelopeBuildError");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvelopeBuildError);
      const violations = (error as EnvelopeBuildError).violations;
      expect(violations).toHaveLength(3);
    }
  });
});
