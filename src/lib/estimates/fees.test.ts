import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import type { CatalogBundle, ServiceEnvelope, ServiceOffer, SourceSnapshotRecord } from "@/lib/catalog/types";

import { buildServiceEnvelope } from "@/lib/catalog/envelope";
import { feeId, serviceId } from "@/lib/catalog/ids";

import {
  buildFeeEstimates,
  capturedAtDatesAgree,
  formatUsd,
  snapshotsById,
  splitFeeLabel,
} from "./fees";
import { EstimatesError } from "./types";

const CATALOG_FILE = "data/catalog/catalog.json";

let bundle: CatalogBundle;
let hic: CatalogBundle["services"][number];

beforeAll(() => {
  bundle = JSON.parse(readFileSync(CATALOG_FILE, "utf8")) as CatalogBundle;
  hic = bundle.services.find((s) => s.meta.catalogId === "svc:dcwp:home-improvement-contractor-license")!;
});

const DCWP = {
  id: "nyc-dcwp",
  name: "Department of Consumer and Worker Protection",
  abbreviation: "DCWP",
  level: "nyc" as const,
  urls: ["https://www.nyc.gov/site/dca/businesses/licenses-apply.page"],
  schemaOrg: {
    "@type": "GovernmentOrganization" as const,
    name: "Department of Consumer and Worker Protection",
    identifier: "nyc-dcwp",
  },
};

function hicEnvelopeWith(offers: ServiceOffer[]): ServiceEnvelope {
  // The real builder refuses most malformed offers upstream; the extractor
  // re-checks because it is the render boundary, so refusal paths need
  // malformed envelopes the builder would never emit.
  return { ...hic.envelope, offers };
}

function testOffer(overrides: Partial<ServiceOffer> = {}): ServiceOffer {
  return {
    "@type": "Offer",
    identifier: feeId("dcwp", "home-improvement-contractor-license", "two-year-term"),
    price: 200,
    priceCurrency: "USD",
    description: "Two-year license term. Source: NYC311 KA-01808, captured 2026-10-30.",
    "x:sourceRefs": ["snap:19f5de5b4340"],
    "x:capturedAt": "2026-10-30",
    ...overrides,
  };
}

/**
 * The numeric gate's threat model is a producer that bypasses the envelope
 * builder — a tampered catalog or an unchecked runtime load (shakedown
 * S4-F1). These fixtures forge past the static types exactly that way.
 */
function forgedOffer(patch: Record<string, unknown>): ServiceOffer {
  return { ...testOffer(), ...patch } as unknown as ServiceOffer;
}

const ARTICLE_SNAP: SourceSnapshotRecord = {
  id: "snap:19f5de5b4340",
  url: "https://portal.311.nyc.gov/article/?kanumber=KA-01808",
  capturedAt: "2026-10-30",
  method: "http_fetch",
  sha256: "0".repeat(64),
};

describe("splitFeeLabel", () => {
  it("strips the seed's documented ' Source: ' tail", () => {
    expect(splitFeeLabel("Two-year license term. Source: NYC311 KA-01808, captured 2026-10-30.")).toBe(
      "Two-year license term.",
    );
  });

  it("keeps a description that carries no source tail", () => {
    expect(splitFeeLabel("Annual fee; renewal $280/yr.")).toBe("Annual fee; renewal $280/yr.");
  });
});

describe("formatUsd", () => {
  it("formats a stored price deterministically", () => {
    expect(formatUsd(200)).toBe("$200.00");
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe("capturedAtDatesAgree", () => {
  it("accepts date-vs-datetime captures of the same day", () => {
    expect(capturedAtDatesAgree("2026-10-30", "2026-10-30T17:21:32.328Z")).toBe(true);
  });

  it("rejects different days", () => {
    expect(capturedAtDatesAgree("2026-10-30", "2026-10-29T17:21:32.328Z")).toBe(false);
  });
});

describe("buildFeeEstimates — real catalog", () => {
  it("extracts the HIC fee verbatim with source + as-of", () => {
    const fees = buildFeeEstimates(hic.envelope, snapshotsById(bundle.snapshots));
    expect(fees).toHaveLength(1);
    expect(fees[0]).toEqual({
      tier: 1,
      label: "Two-year license term.",
      amountText: "$200.00",
      amountValue: 200,
      currency: "USD",
      sourceCitation: "https://portal.311.nyc.gov/article/?kanumber=KA-01808 (captured 2026-10-30)",
      sourceUrl: "https://portal.311.nyc.gov/article/?kanumber=KA-01808",
      capturedAt: "2026-10-30",
    });
  });

  it("extracts the FSE annual fee", () => {
    const fse = bundle.services.find((s) => s.meta.catalogId === "svc:dohmh:food-service-establishment-permit")!;
    const fees = buildFeeEstimates(fse.envelope, snapshotsById(bundle.snapshots));
    expect(fees).toHaveLength(1);
    expect(fees[0].amountValue).toBe(280);
    expect(fees[0].amountText).toBe("$280.00");
    expect(fees[0].label).toBe(
      "Annual fee; renewal $280/yr; permit expires after 1 year on staggered dates.",
    );
  });
});

describe("buildFeeEstimates — refusals", () => {
  it("builds a fee through the real envelope builder and extracts it", () => {
    const envelope = buildServiceEnvelope({
      catalogId: serviceId("dcwp", "home-improvement-contractor-license"),
      nyc311ArticleId: "nyc311-KA-01808",
      nyc311ArticleUrl: "https://portal.311.nyc.gov/article/?kanumber=KA-01808",
      title: "Home Improvement Contractor License",
      description: "Apply for or renew a license to do construction or repair work at residences.",
      serviceType: "License",
      domain: "licensing",
      agency: DCWP,
      channels: [{ name: "Online" }],
      fees: [
        {
          identifier: feeId("dcwp", "home-improvement-contractor-license", "two-year-term"),
          price: 200,
          description: "Two-year license term. Source: NYC311 KA-01808, captured 2026-10-30.",
          sourceRefs: ["snap:19f5de5b4340"],
          capturedAt: "2026-10-30",
        },
      ],
    });
    expect(buildFeeEstimates(envelope, snapshotsById([ARTICLE_SNAP]))).toHaveLength(1);
  });

  it("refuses an offer with no sourceRefs — an unsourced fee must not display", () => {
    try {
      buildFeeEstimates(hicEnvelopeWith([testOffer({ "x:sourceRefs": [] })]), snapshotsById([ARTICLE_SNAP]));
      expect.unreachable("expected EstimatesError");
    } catch (error) {
      expect(error).toBeInstanceOf(EstimatesError);
      expect((error as EstimatesError).violations.join("\n")).toMatch(/no sourceRefs/);
    }
  });

  it("refuses a dangling snapshot ref", () => {
    try {
      buildFeeEstimates(
        hicEnvelopeWith([testOffer({ "x:sourceRefs": ["snap:ffffffffffff"] })]),
        snapshotsById([ARTICLE_SNAP]),
      );
      expect.unreachable("expected EstimatesError");
    } catch (error) {
      expect((error as EstimatesError).violations.join("\n")).toMatch(/resolves to no snapshot/);
    }
  });

  it("refuses a non-ISO capturedAt", () => {
    try {
      buildFeeEstimates(hicEnvelopeWith([testOffer({ "x:capturedAt": "October 30, 2026" })]), snapshotsById([ARTICLE_SNAP]));
      expect.unreachable("expected EstimatesError");
    } catch (error) {
      expect((error as EstimatesError).violations.join("\n")).toMatch(/not an ISO yyyy-mm-dd date/);
    }
  });

  it("refuses a capturedAt that disagrees with its snapshot", () => {
    // Same-day datetime is accepted (capturedAtDatesAgree); a different day is not.
    const stale: SourceSnapshotRecord = { ...ARTICLE_SNAP, id: "snap:bbbbbbbbbbbb", capturedAt: "2026-10-29" };
    try {
      buildFeeEstimates(
        hicEnvelopeWith([testOffer({ "x:sourceRefs": ["snap:bbbbbbbbbbbb"] })]),
        snapshotsById([stale]),
      );
      expect.unreachable("expected EstimatesError");
    } catch (error) {
      expect((error as EstimatesError).violations.join("\n")).toMatch(/disagrees with snapshot/);
    }
  });

  it("refuses a snapshot url that is not https", () => {
    const insecure: SourceSnapshotRecord = {
      ...ARTICLE_SNAP,
      id: "snap:aaaaaaaaaaaa",
      url: "http://portal.311.nyc.gov/article/?kanumber=KA-01808",
    };
    try {
      buildFeeEstimates(
        hicEnvelopeWith([testOffer({ "x:sourceRefs": ["snap:aaaaaaaaaaaa"] })]),
        snapshotsById([insecure]),
      );
      expect.unreachable("expected EstimatesError");
    } catch (error) {
      expect((error as EstimatesError).violations.join("\n")).toMatch(/not https/);
    }
  });

  it("collects every violation in one rejection", () => {
    try {
      buildFeeEstimates(
        hicEnvelopeWith([testOffer({ "x:sourceRefs": [], "x:capturedAt": "" })]),
        snapshotsById([]),
      );
      expect.unreachable("expected EstimatesError");
    } catch (error) {
      expect((error as EstimatesError).violations).toHaveLength(2);
    }
  });

  it("omits amountValue for a zero-price fee but still renders the amount", () => {
    const fees = buildFeeEstimates(
      hicEnvelopeWith([testOffer({ price: 0 })]),
      snapshotsById([ARTICLE_SNAP]),
    );
    expect(fees[0].amountText).toBe("$0.00");
    expect("amountValue" in fees[0]).toBe(false);
  });

  it("is deterministic — same inputs, identical fees", () => {
    expect(buildFeeEstimates(hic.envelope, snapshotsById(bundle.snapshots))).toEqual(
      buildFeeEstimates(hic.envelope, snapshotsById(bundle.snapshots)),
    );
  });
});

describe("buildFeeEstimates — numeric/currency honesty gate (shakedown S4-F1)", () => {
  it("A1: refuses a NaN price — $NaN must not render with a citation", () => {
    const build = () =>
      buildFeeEstimates(hicEnvelopeWith([forgedOffer({ price: NaN })]), snapshotsById([ARTICLE_SNAP]));
    expect(build).toThrow(EstimatesError);
    expect(build).toThrow(/is not finite/);
  });

  it("A2: refuses a negative price — a negative fee must not display", () => {
    const build = () =>
      buildFeeEstimates(hicEnvelopeWith([testOffer({ price: -50 })]), snapshotsById([ARTICLE_SNAP]));
    expect(build).toThrow(EstimatesError);
    expect(build).toThrow(/is negative/);
  });

  it("A3: refuses an Infinite price", () => {
    const build = () =>
      buildFeeEstimates(hicEnvelopeWith([forgedOffer({ price: Infinity })]), snapshotsById([ARTICLE_SNAP]));
    expect(build).toThrow(EstimatesError);
    expect(build).toThrow(/is not finite/);
  });

  it("A4: accepts a huge-but-finite price — the gate refuses non-finite, not large (no magnitude bound)", () => {
    const fees = buildFeeEstimates(
      hicEnvelopeWith([testOffer({ price: 1e21 })]),
      snapshotsById([ARTICLE_SNAP]),
    );
    expect(fees[0].amountText).toBe("$1,000,000,000,000,000,000,000.00");
    expect(fees[0].amountValue).toBe(1e21);
  });

  it("A5: refuses a string price — Intl would coerce it and amountValue would carry it", () => {
    const build = () =>
      buildFeeEstimates(hicEnvelopeWith([forgedOffer({ price: "200" })]), snapshotsById([ARTICLE_SNAP]));
    expect(build).toThrow(EstimatesError);
    expect(build).toThrow(/is not a number/);
  });

  it("A6: refuses a non-USD currency — formatUsd renders USD only", () => {
    const build = () =>
      buildFeeEstimates(hicEnvelopeWith([forgedOffer({ priceCurrency: "EUR" })]), snapshotsById([ARTICLE_SNAP]));
    expect(build).toThrow(EstimatesError);
    expect(build).toThrow(/is not USD/);
  });
});

describe("buildFeeEstimates — every sourceRef is validated (shakedown S1-F9)", () => {
  it("extracts the real 3-ref HIC offer and cites the primary capture", () => {
    const refs = hic.envelope.offers[0]["x:sourceRefs"];
    // The multi-ref case is real, not synthetic: the live HIC offer
    // carries three corroborating captures.
    expect(refs.length).toBeGreaterThanOrEqual(3);
    const fees = buildFeeEstimates(hic.envelope, snapshotsById(bundle.snapshots));
    expect(fees).toHaveLength(1);
    expect(fees[0].sourceCitation).toContain("(captured 2026-10-30)");
  });

  it("refuses a dangling secondary ref — corroboration must resolve too", () => {
    const refs = hic.envelope.offers[0]["x:sourceRefs"];
    const build = () =>
      buildFeeEstimates(
        hicEnvelopeWith([testOffer({ "x:sourceRefs": [refs[0], "snap:ffffffffffff"] })]),
        snapshotsById(bundle.snapshots),
      );
    expect(build).toThrow(EstimatesError);
    expect(build).toThrow(/resolves to no snapshot/);
  });
});
