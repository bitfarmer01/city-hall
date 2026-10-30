import { describe, expect, it } from "vitest";

import { DOMAIN_TAXONOMY_VERSION, tagCoverageDomain } from "./domain";
import type { IndexArticleEntry } from "./types";

// Fixture entries are real (KA, title, description) triples from the
// committed 2026-10-30 inventory snapshot, chosen from the owner-required
// domain examples (locked decision #12) and the multi-keyword titles the
// priority order was derived from.
function entry(ka: string, title: string, description: string): IndexArticleEntry {
  return { id: `nyc311-${ka}`, ka: ka as IndexArticleEntry["ka"], title, description };
}

describe("tagCoverageDomain — the five domains plus other", () => {
  it("tags permit articles across the DOB / street-fair / food-permit examples", () => {
    for (const e of [
      entry("KA-02104", "Building Construction or Alteration Permit", "Apply for a permit to construct or alter a building."),
      entry("KA-01261", "Block Party, Street Fair, or Event Permit", "Apply for a permit to hold a block party, street fair, parade, or other event on a City street or sidewalk."),
      entry("KA-01825", "Temporary Food Service Establishment Permit", "Apply for a permit to serve food or drinks at a special event or street fair."),
    ]) {
      const tag = tagCoverageDomain(e);
      expect(tag.domain).toBe("permits");
      expect(tag.patternId).toBe("permits:permit");
      expect(tag.matchedBy).toBe("title");
    }
  });

  it("tags licensing articles across the TLC / DCWP / DOHMH examples", () => {
    for (const e of [
      entry("KA-03043", "Taxi Driver License", "Apply for a license to drive a taxi, black car, limousine, ambulette, or commuter van."),
      entry("KA-01808", "Home Improvement Contractor License", "Apply for or renew a license to do construction or repair work at residences."),
      entry("KA-01890", "Dog License", "Apply for, renew, update, or replace a dog license."),
    ]) {
      const tag = tagCoverageDomain(e);
      expect(tag.domain).toBe("licensing");
      expect(tag.patternId).toBe("licensing:license");
    }
  });

  it("tags inspection articles across the DOB / FDNY examples", () => {
    for (const e of [
      entry("KA-01294", "Electrical Inspection", "Schedule an inspection of work done by a licensed electrician."),
      entry("KA-01300", "Fire Alarm Inspection", "Schedule an inspection of a fire alarm."),
    ]) {
      const tag = tagCoverageDomain(e);
      expect(tag.domain).toBe("inspections");
      expect(tag.patternId).toBe("inspections:inspect");
    }
  });

  it("tags public-records articles across the vital records / FOIL / property examples", () => {
    for (const [e, patternId] of [
      [entry("KA-01012", "Birth Certificate Order", "Get a copy of a birth certificate."), "public-records:vital-certificate"],
      [entry("KA-01028", "Death Certificate Order", "Get a copy of a death certificate."), "public-records:vital-certificate"],
      [entry("KA-01021", "City Agency Record or FOIL Request", "Request a City Agency record or make a Freedom of Information Law (FOIL) request."), "public-records:foil"],
      [entry("KA-01665", "Property Deed or Record", "Search for or get copies of property ownership records, such as deeds and mortgages. Get copies of tax maps."), "public-records:property-record"],
    ] as const) {
      const tag = tagCoverageDomain(e);
      expect(tag.domain).toBe("public-records");
      expect(tag.patternId).toBe(patternId);
    }
  });

  it("does not tag 'Birth Control' as a public record", () => {
    const tag = tagCoverageDomain(
      entry("KA-02581", "Birth Control", "Get birth control."),
    );
    expect(tag.domain).not.toBe("public-records");
  });

  it("tags 311 service-request reports across the noise / heat / sanitation examples", () => {
    for (const [e, patternId] of [
      [entry("KA-01017", "Noise from Neighbor", "Report a noisy neighbor."), "service-requests:noise"],
      [entry("KA-01036", "Heat or Hot Water Complaint in a Residential Building", "Report a problem with heat or hot water in a residential building."), "service-requests:complaint"],
      [entry("KA-01788", "Missed Trash, Recycling, or Compost Collection", "Report waste that was not picked up on your collection day or at a scheduled appointment."), "service-requests:missed-collection"],
    ] as const) {
      const tag = tagCoverageDomain(e);
      expect(tag.domain).toBe("service-requests");
      expect(tag.patternId).toBe(patternId);
    }
  });

  it("falls back to other for articles no pattern claims", () => {
    for (const e of [
      entry("KA-01336", "NYC311 Content API", "Learn about the 311 Application Programming Interface (API)."),
      entry("KA-03636", "Noise Safety and Health", "Learn about noise and how to prevent noise-induced hearing loss."),
      entry("KA-03693", "Voter Rights", "Learn your rights as a voter."),
    ]) {
      const tag = tagCoverageDomain(e);
      expect(tag.domain).toBe("other");
      expect(tag.matchedBy).toBe("none");
      expect(tag.patternId).toBe("other:none");
    }
  });
});

describe("tagCoverageDomain — priority order on real multi-keyword titles", () => {
  it("resolves complaint titles to service requests over licensing and inspections", () => {
    for (const e of [
      entry("KA-01438", "Private Elevator or Escalator Inspector Complaint", "Report a problem with a licensed private elevator or escalator inspector."),
      entry("KA-01734", "Department of State (DOS) Licensed Professional or Business Complaint", "Report a problem with a New York State Department of State licensed professional or firm."),
      entry("KA-01178", "Department of Consumer and Worker Protection License and Complaint Sign", "Request a sign that licensed businesses must post for customers."),
    ]) {
      const tag = tagCoverageDomain(e);
      expect(tag.domain).toBe("service-requests");
      expect(tag.patternId).toBe("service-requests:complaint");
    }
  });

  it("resolves inspection-license titles to licensing over inspections", () => {
    for (const e of [
      entry("KA-01729", "Motor Vehicle Inspection License", "Apply for a license to inspect motor vehicles and related equipment."),
      entry("KA-01742", "Elevator or Escalator Inspection License", "Apply for a license to be a private elevator inspection agency inspector or director."),
    ]) {
      expect(tagCoverageDomain(e).domain).toBe("licensing");
    }
  });

  it("resolves permit-or-inspection titles to permits over inspections", () => {
    const tag = tagCoverageDomain(
      entry("KA-01456", "FDNY Permit or Inspection", "Apply for a permit or request an inspection for a business or high occupancy residential facility."),
    );
    expect(tag.domain).toBe("permits");
  });

  it("resolves inspection-report titles to inspections over the report verb", () => {
    const tag = tagCoverageDomain(
      entry("KA-01302", "Food Cart Inspection Report", "Get a health inspection report for a mobile food vendor."),
    );
    expect(tag.domain).toBe("inspections");
  });

  it("falls through to the description when the title matches nothing", () => {
    const tag = tagCoverageDomain(
      entry(
        "KA-01014",
        "Buses and Subways",
        "Get information or make a complaint about a MetroCard or bus or subway run by the Metropolitan Transportation Authority (MTA).",
      ),
    );
    expect(tag.domain).toBe("service-requests");
    expect(tag.matchedBy).toBe("description");
  });
});

describe("tagCoverageDomain — stamps and determinism", () => {
  it("stamps the taxonomy version on every tag", () => {
    const tag = tagCoverageDomain(entry("KA-01017", "Noise from Neighbor", "Report a noisy neighbor."));
    expect(tag.taxonomyVersion).toBe(DOMAIN_TAXONOMY_VERSION);
  });

  it("returns identical tags for the same entries × 10", () => {
    const entries = [
      entry("KA-02104", "Building Construction or Alteration Permit", "Apply for a permit to construct or alter a building."),
      entry("KA-03043", "Taxi Driver License", "Apply for a license to drive a taxi, black car, limousine, ambulette, or commuter van."),
      entry("KA-01294", "Electrical Inspection", "Schedule an inspection of work done by a licensed electrician."),
      entry("KA-01021", "City Agency Record or FOIL Request", "Request a City Agency record or make a Freedom of Information Law (FOIL) request."),
      entry("KA-01017", "Noise from Neighbor", "Report a noisy neighbor."),
      entry("KA-03693", "Voter Rights", "Learn your rights as a voter."),
    ];
    const first = JSON.stringify(entries.map(tagCoverageDomain));
    for (let run = 0; run < 10; run += 1) {
      expect(JSON.stringify(entries.map(tagCoverageDomain))).toBe(first);
    }
  });
});
