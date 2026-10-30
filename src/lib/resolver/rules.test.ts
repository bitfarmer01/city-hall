// Rules-layer tests: pattern conjunction, specificity ordering, and
// agreement with the crosswalk seeds (the two curated sources must never
// disagree about what a goal resolves to).

import { describe, expect, it } from "vitest";

import { loadCatalogBundle } from "./catalog-source";
import { applyRules, CROSSWALK_RULES_VERSION, matchRules, RESOLVER_RULES } from "./rules";

describe("matchRules", () => {
  it("matches a single-domain goal", () => {
    const [best] = applyRules("elevator inspection");
    expect(best?.rule.id).toBe("rules:elevator-escalator-inspection");
    expect(matchRules("elevator inspection")).toEqual(["svc:buildings:elevator-escalator-inspection"]);
  });

  it("requires every pattern to fire", () => {
    // Elevator alone (no inspection intent) must not match the elevator rule.
    expect(applyRules("elevator music licensing")).toEqual([]);
    expect(matchRules("elevator music licensing")).toBeNull();
  });

  it("matches the multi-service renovation goal in crosswalk order", () => {
    expect(matchRules("renovate my apartment")).toEqual([
      "svc:dcwp:home-improvement-contractor-license",
      "svc:buildings:building-construction-alteration-permit",
    ]);
  });

  it("prefers the more specific rule when several match", () => {
    // "renovate my home" matches rules:home-renovation (2 patterns) and —
    // via "home" — nothing broader; but a text hitting both a 2-pattern and
    // a 1-pattern rule must land on the 2-pattern one. The noise rule is
    // 2-pattern; a 1-pattern-only text like "fix up" (renovation pattern 1
    // without pattern 2) matches nothing.
    const matches = applyRules("renovate my apartment");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.rule.id).toBe("rules:home-renovation");
  });

  it("returns null for text no rule matches", () => {
    expect(matchRules("purple elephant")).toBeNull();
    expect(matchRules("")).toBeNull();
  });
});

describe("rules / crosswalk agreement", () => {
  const bundle = loadCatalogBundle();

  it("the home-renovation rule and crosswalk carry the same ordered services", () => {
    const crosswalk = bundle.crosswalks.find((xw) => xw.id === "xw:home-renovation");
    expect(crosswalk).toBeDefined();
    const rule = RESOLVER_RULES.find((r) => r.id === "rules:home-renovation");
    expect(rule).toBeDefined();
    expect(rule?.serviceIds).toEqual(crosswalk?.serviceIds);
  });

  it("every rule's serviceIds reference known catalog services", () => {
    const known = new Set(bundle.services.map((s) => s.meta.catalogId));
    for (const rule of RESOLVER_RULES) {
      for (const serviceId of rule.serviceIds) {
        expect(known.has(serviceId), `${rule.id} references unknown ${serviceId}`).toBe(true);
      }
    }
  });

  it("every rule declares one of the five coverage domains (or multi)", () => {
    const domains = new Set(["inspections", "licensing", "permits", "public-records", "service-requests", "multi"]);
    for (const rule of RESOLVER_RULES) {
      expect(domains.has(rule.domain), `${rule.id} has unexpected domain ${rule.domain}`).toBe(true);
    }
  });
});

describe("CROSSWALK_RULES_VERSION", () => {
  it("is a pinned semver string", () => {
    expect(CROSSWALK_RULES_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
