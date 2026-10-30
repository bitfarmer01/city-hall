// View-model builder tests over the real committed catalog bundle (D7).
// Same grounding rule as the resolver tests: the fixture is data/catalog/
// catalog.json, so a shape drift fails here loudly instead of rendering
// wrong on a page.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildEstimateBlock,
  parseHeuristicRows,
  parseOpenDataTimelineRows,
  parseSurchargeRows,
  snapshotsById,
  surchargeNotesByStepId,
  type EstimateContext,
} from "@/lib/estimates";
import { loadCatalogBundle, type CatalogBundle } from "@/lib/resolver/catalog-source";

import { formatBytes, uploadLimitText, FULFILLMENT_LABELS } from "./display";
import {
  buildBrowseCards,
  buildServiceView,
  domainCounts,
  estimateItemView,
  filterBrowseCards,
  firstParam,
  resolutionLayerPhrase,
  type ServiceViewDeps,
} from "./views";

const bundle: CatalogBundle = loadCatalogBundle(join(process.cwd(), "data/catalog/catalog.json"));

const registries = {
  timelines: parseOpenDataTimelineRows(JSON.parse(readFileSync(join(process.cwd(), "data/estimates/timelines.json"), "utf8"))),
  heuristics: parseHeuristicRows(JSON.parse(readFileSync(join(process.cwd(), "data/estimates/heuristics.json"), "utf8"))),
  surcharges: parseSurchargeRows(
    JSON.parse(readFileSync(join(process.cwd(), "data/estimates/surcharges.json"), "utf8")),
    snapshotsById(bundle.snapshots),
  ),
};

const estimateContext: EstimateContext = {
  snapshots: bundle.snapshots,
  openDataTimelineRows: registries.timelines,
  heuristicRows: registries.heuristics,
};

const deps: ServiceViewDeps = {
  estimateContext,
  agenciesById: new Map(bundle.agencies.map((agency) => [agency.id, agency])),
  formsById: new Map(bundle.forms.map((form) => [form.id, form])),
  fieldsByFormId: bundle.formFields.reduce<Map<string, typeof bundle.formFields>>((acc, field) => {
    const fields = acc.get(field.formId) ?? [];
    fields.push(field);
    acc.set(field.formId, fields);
    return acc;
  }, new Map()),
  surchargeNotes: surchargeNotesByStepId(registries.surcharges),
};

function service(catalogId: string) {
  const record = bundle.services.find((s) => s.meta.catalogId === catalogId);
  if (record === undefined) throw new Error(`test fixture missing service ${catalogId}`);
  return record;
}

function view(catalogId: string) {
  return buildServiceView(service(catalogId), deps);
}

describe("buildServiceView — identity and envelope mapping", () => {
  it("carries the envelope identity, agency, and domain label", () => {
    const v = view("svc:dohmh:dog-license");
    expect(v.catalogId).toBe("svc:dohmh:dog-license");
    expect(v.name).toBe(service("svc:dohmh:dog-license").envelope.name);
    expect(v.agencyName).toBe(service("svc:dohmh:dog-license").envelope.provider.name);
    expect(v.domain).toBe("licensing");
    expect(v.domainLabel).toBe("Licensing");
    expect(v.articleId).toBe(service("svc:dohmh:dog-license").meta.nyc311ArticleId);
  });

  it("sorts steps by sequence regardless of stored order", () => {
    const v = view("svc:dep:water-tap-permit");
    const sequences = v.steps.map((step) => step.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
    expect(v.steps.map((step) => step.sequence)).toEqual([1, 2, 3]);
  });

  it("labels every fulfillment method from the single vocabulary", () => {
    const v = view("svc:dep:water-tap-permit");
    for (const step of v.steps) {
      expect(step.fulfillmentLabel).toBe(FULFILLMENT_LABELS[step.fulfillmentMethod]);
    }
  });
});

describe("buildServiceView — estimates", () => {
  it("renders the HIC fee as tier-1 with source citation and as-of", () => {
    const v = view("svc:dcwp:home-improvement-contractor-license");
    const fee = v.estimateItems.find((item) => item.kind === "fee");
    expect(fee).toBeDefined();
    if (fee?.kind !== "fee") return;
    expect(fee.amountText).toBe("$200.00");
    expect(fee.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fee.sourceCitation).toContain("(captured 2026-10-30)");
    expect(fee.sourceUrl).toMatch(/^https:\/\//);
  });

  it("renders the published processing time as a tier-2 timeline with provenance", () => {
    const v = view("svc:dcwp:home-improvement-contractor-license");
    const timeline = v.estimateItems.find((item) => item.kind === "timeline");
    expect(timeline).toBeDefined();
    if (timeline?.kind !== "timeline") return;
    expect(timeline.durationText).toContain("21 days");
    expect(timeline.dataset).toContain("KA-01808");
    expect(timeline.query.length).toBeGreaterThan(0);
  });

  it("leaves a service with no captured fees an honest empty estimate", () => {
    const v = view("svc:311:noise-from-neighbor");
    expect(v.estimateItems).toEqual([]);
  });

  it("maps tiers 1:1 — a fee never loses its source, a heuristic never loses its label input", () => {
    const record = service("svc:dcwp:home-improvement-contractor-license");
    const block = buildEstimateBlock(record, estimateContext);
    const views = block.tiers.map(estimateItemView);
    expect(views).toHaveLength(block.tiers.length);
    for (let i = 0; i < block.tiers.length; i += 1) {
      expect(views[i].kind).toBe(["fee", "timeline", "heuristic"][block.tiers[i].tier - 1]);
    }
  });
});

describe("buildServiceView — honesty fields", () => {
  it("renders an unverified, unstated upload limit as exactly that", () => {
    const v = view("svc:buildings:building-construction-alteration-permit");
    const upload = v.steps.flatMap((step) => (step.upload ? [step.upload] : []))[0];
    expect(upload).toBeDefined();
    if (!upload) return;
    expect(upload.limitText).toBe("no size limit stated (not verified)");
    expect(upload.sizeLimitVerified).toBe(false);
    expect(upload.acceptedFormats).toEqual(["pdf"]);
    expect(upload.portalUrl).toMatch(/^https:\/\//);
  });

  it("resolves dependency agency levels — NYC stays labeled NYC", () => {
    const v = view("svc:dep:water-tap-permit");
    const step2 = v.steps.find((step) => step.sequence === 2);
    const dep = step2?.dependencies.find((d) => d.agencyId === "nyc-buildings");
    expect(dep).toBeDefined();
    if (!dep) return;
    expect(dep.level).toBe("nyc");
    expect(dep.levelLabel).toBe("NYC");
  });

  it("labels a dependency with no agency as external — never as an NYC step", () => {
    const v = view("svc:dohmh:food-service-establishment-permit");
    const external = v.steps
      .flatMap((step) => step.dependencies)
      .filter((dep) => dep.agencyId === undefined);
    expect(external.length).toBeGreaterThan(0);
    for (const dep of external) {
      expect(dep.level).toBe("external");
      expect(dep.levelLabel).toBe("External");
    }
  });

  it("preserves all four requiredStatus values in document field counts", () => {
    const v = view("svc:dohmh:birth-certificate-order");
    expect(v.documents.length).toBe(2);
    for (const doc of v.documents) {
      const { total, byStatus } = doc.fieldCounts;
      expect(total).toBeGreaterThan(0);
      expect(byStatus.author_declared_required + byStatus.not_marked_required + byStatus.inferred_required + byStatus.unknown).toBe(total);
    }
  });

  it("counts fields for a known form — PW1 has hundreds of fields, all accounted for", () => {
    const v = view("svc:buildings:building-construction-alteration-permit");
    const pw1 = v.documents.find((doc) => doc.formNumber === "PW1");
    expect(pw1).toBeDefined();
    if (!pw1) return;
    const bundleFields = bundle.formFields.filter((field) => field.formId === "form:buildings:pw1").length;
    expect(pw1.fieldCounts.total).toBe(bundleFields);
  });

  it("carries administeredBy when it differs from the responsible agency", () => {
    const v = view("svc:dohmh:food-service-establishment-permit");
    const step = v.steps.find((s) => s.administeredByName !== undefined);
    expect(step?.administeredByName).toBe("Department of Consumer and Worker Protection");
  });
});

describe("browse views", () => {
  const cards = buildBrowseCards(bundle.services);

  it("builds one card per catalog service", () => {
    expect(cards).toHaveLength(bundle.services.length);
    expect(new Set(cards.map((card) => card.catalogId)).size).toBe(cards.length);
  });

  it("carries a fee-from line only for services with offers", () => {
    const hic = cards.find((card) => card.catalogId === "svc:dcwp:home-improvement-contractor-license");
    expect(hic?.feeFromText).toBe("From $200.00");
    const noise = cards.find((card) => card.catalogId === "svc:311:noise-from-neighbor");
    expect(noise?.feeFromText).toBeUndefined();
  });

  it("searches by name, alias, and agency tokens (AND semantics)", () => {
    expect(filterBrowseCards(cards, { q: "dog" }).map((c) => c.catalogId)).toEqual(["svc:dohmh:dog-license"]);
    // "license my dog" — tokens must all hit the same card.
    expect(filterBrowseCards(cards, { q: "license my dog" }).map((c) => c.catalogId)).toEqual(["svc:dohmh:dog-license"]);
    // Multi-token miss matches nothing.
    expect(filterBrowseCards(cards, { q: "dog fish" })).toEqual([]);
  });

  it("is case-insensitive and trims the query", () => {
    expect(filterBrowseCards(cards, { q: "  DOG  " })).toHaveLength(1);
  });

  it("filters by domain exactly", () => {
    const permits = filterBrowseCards(cards, { domain: "permits" });
    expect(permits).toHaveLength(3);
    expect(new Set(permits.map((c) => c.domain))).toEqual(new Set(["permits"]));
  });

  it("combines domain and query filters", () => {
    const both = filterBrowseCards(cards, { domain: "licensing", q: "dog" });
    expect(both.map((c) => c.catalogId)).toEqual(["svc:dohmh:dog-license"]);
    const disjoint = filterBrowseCards(cards, { domain: "permits", q: "dog" });
    expect(disjoint).toEqual([]);
  });

  it("counts domains over the full card set in taxonomy order", () => {
    const counts = domainCounts(cards);
    expect(counts.map((c) => c.domain)).toEqual([
      "permits",
      "service-requests",
      "public-records",
      "licensing",
      "inspections",
    ]);
    expect(counts.find((c) => c.domain === "permits")?.count).toBe(3);
    expect(counts.some((c) => c.domain === "other")).toBe(false);
  });

  it("is deterministic — same input, same order", () => {
    const again = buildBrowseCards(bundle.services);
    expect(again).toEqual(cards);
    expect(filterBrowseCards(cards, { q: "license" })).toEqual(filterBrowseCards(again, { q: "license" }));
  });
});

describe("display helpers", () => {
  it("formats byte sizes readably", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });

  it("states upload limits honestly on both axes", () => {
    expect(uploadLimitText({ maxSizeBytes: null, sizeLimitVerified: false })).toBe("no size limit stated (not verified)");
    expect(uploadLimitText({ maxSizeBytes: null, sizeLimitVerified: true })).toBe("no size limit stated (verified)");
    expect(uploadLimitText({ maxSizeBytes: 10 * 1024 * 1024, sizeLimitVerified: true })).toBe("up to 10 MB (verified)");
  });

  it("normalizes repeated query params to the first value", () => {
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam("a")).toBe("a");
    expect(firstParam(["a", "b"])).toBe("a");
  });

  it("phrases every resolution layer, with llm_assist visibly outside the guarantee", () => {
    expect(resolutionLayerPhrase("alias-rules")).toBe("known-goal match");
    expect(resolutionLayerPhrase("llm_assist")).toContain("outside the deterministic guarantee");
  });
});
