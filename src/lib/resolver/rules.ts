// Layer 2b — declarative, versioned rules. The pinned-research design
// (art_wJiwwN0o §2): keyword/attribute rules evaluated in a defined order
// with a specificity tiebreaker, so an input that satisfies two rules lands
// on the more specific one — deterministically.
//
// Semantics: a rule matches when EVERY one of its patterns matches the
// canonical text (AND); specificity is the pattern count (more required
// hits = more specific); ties break by table order. Patterns use stems
// (`licens` covers license/licenses/licensing; `inspect` covers
// inspection/inspections/inspector) so morphology never splits a family.
//
// Locked decision #12: the rules must give every coverage domain a layer-2
// path. The build's crosswalk-domain guard and golden.test.ts both pin
// that; this table is where a missing domain becomes visible.

/**
 * Version of the ruleset — this table plus the alias seeds and the
 * abbreviation/synonym maps. Bump when any of them changes; golden diffs
 * in the same PR are the review artifact (pinned research §2).
 */
export const CROSSWALK_RULES_VERSION = "1.0.0";

export interface ResolverRule {
  /** `rules:{slug}` — referenced by test names and golden diagnostics. */
  id: string;
  /** Primary coverage domain; "multi" for goals spanning domains. */
  domain: string;
  /** ALL must match the canonical text. */
  patterns: RegExp[];
  /** Ordered resolved services — highest-confidence first. */
  serviceIds: string[];
}

const SERVICE = {
  buildingPermit: "svc:buildings:building-construction-alteration-permit",
  elevatorInspection: "svc:buildings:elevator-escalator-inspection",
  hicLicense: "svc:dcwp:home-improvement-contractor-license",
  waterTapPermit: "svc:dep:water-tap-permit",
  birthCertificate: "svc:dohmh:birth-certificate-order",
  dogLicense: "svc:dohmh:dog-license",
  foodEstablishmentPermit: "svc:dohmh:food-service-establishment-permit",
  noiseFromNeighbor: "svc:311:noise-from-neighbor",
} as const;

/** Ordered rule table — specificity desc, then table order. */
export const RESOLVER_RULES: readonly ResolverRule[] = [
  {
    id: "rules:noise-from-neighbor",
    domain: "service-requests",
    patterns: [/noise|noisy|loud/, /\bcomplain|neighbor|report\b/],
    serviceIds: [SERVICE.noiseFromNeighbor],
  },
  {
    id: "rules:birth-certificate-order",
    domain: "public-records",
    patterns: [/birth certificate/, /\bord|cop|replac|lost|vital\b/],
    serviceIds: [SERVICE.birthCertificate],
  },
  {
    id: "rules:home-improvement-contractor-license",
    domain: "licensing",
    patterns: [/home improvement contractor|working on homes|residential (?:construction|repair)/, /\blicen|registr/],
    serviceIds: [SERVICE.hicLicense],
  },
  {
    id: "rules:dog-license",
    domain: "licensing",
    patterns: [/\bdog\b|\bcanine\b/, /\blicen|registr/],
    serviceIds: [SERVICE.dogLicense],
  },
  {
    id: "rules:elevator-escalator-inspection",
    domain: "inspections",
    patterns: [/\belevator\b|\bescalator\b/, /inspect|appointment|inspector\b/],
    serviceIds: [SERVICE.elevatorInspection],
  },
  {
    id: "rules:building-construction-alteration-permit",
    domain: "permits",
    patterns: [/\bbuilding\b|construct|alter/, /\bpermit\b|\bfiling\b/],
    serviceIds: [SERVICE.buildingPermit],
  },
  {
    id: "rules:water-tap-permit",
    domain: "permits",
    patterns: [/water tap|water main|sewer pipe|wet connection/, /\bpermit\b|\bconnect|\bplug\b|\bmap\b/],
    serviceIds: [SERVICE.waterTapPermit],
  },
  {
    id: "rules:food-service-establishment-permit",
    domain: "permits",
    patterns: [/\bfood\b|restaurant|eatery|\bcafe\b|\bdiner\b/, /\bpermit\b|\brun\b|\boperate\b/],
    serviceIds: [SERVICE.foodEstablishmentPermit],
  },
  {
    id: "rules:home-renovation",
    domain: "multi",
    patterns: [/renovat|remodel|fix up|rehabilitat/, /home|apartment|residence|house|building|premises|storefront/],
    // License before permit: the licensed contractor is the one who pulls
    // the permit. Order MUST match the xw:home-renovation crosswalk;
    // golden.test.ts fails when rule and crosswalk disagree.
    serviceIds: [SERVICE.hicLicense, SERVICE.buildingPermit],
  },
];

export interface RuleMatch {
  rule: ResolverRule;
  /** Table position — the deterministic tiebreaker. */
  order: number;
}

/**
 * All matching rules, best first: specificity (pattern count) descending,
 * then table order. Returns an empty array when nothing matches.
 */
export function applyRules(canonicalText: string): RuleMatch[] {
  const matches: RuleMatch[] = [];
  for (let order = 0; order < RESOLVER_RULES.length; order += 1) {
    const rule = RESOLVER_RULES[order];
    if (rule.patterns.every((pattern) => pattern.test(canonicalText))) {
      matches.push({ rule, order });
    }
  }
  matches.sort((a, b) => {
    const specificity = b.rule.patterns.length - a.rule.patterns.length;
    return specificity !== 0 ? specificity : a.order - b.order;
  });
  return matches;
}

/** Best rule match, or null — the pipeline resolves through this. */
export function matchRules(canonicalText: string): string[] | null {
  if (canonicalText.length === 0) {
    return null;
  }
  const [best] = applyRules(canonicalText);
  return best ? [...best.rule.serviceIds] : null;
}
