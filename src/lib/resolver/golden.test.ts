// Golden files (D5, verified-by item 1): every committed crosswalk
// utterance and test case must resolve to its expected service IDs through
// the real pipeline over the real committed bundle. This is the review
// artifact for crosswalk changes: a golden diff in a PR is the change.

import { describe, expect, it } from "vitest";

import { loadCatalogBundle } from "./catalog-source";
import { createResolver } from "./resolver";
import type { GoalCrosswalkRecord } from "../catalog/types";

const bundle = loadCatalogBundle();
const resolver = createResolver(bundle);

const ALL_DOMAINS = ["inspections", "licensing", "permits", "public-records", "service-requests"] as const;

const EXPECTED_NO_MATCH = ["purple elephant", "cheap flights to Miami", "what is the meaning of life", ""];

describe("crosswalk goldens", () => {
  it("every crosswalk utterance resolves to its ordered service IDs", async () => {
    const failures: string[] = [];
    for (const crosswalk of bundle.crosswalks) {
      for (const utterance of crosswalk.utterances) {
        const result = await resolver.resolve(utterance);
        if (JSON.stringify(result.serviceIds) !== JSON.stringify(crosswalk.serviceIds)) {
          failures.push(
            `"${utterance}" (${crosswalk.id}) → [${result.resolutionLayer}] ${JSON.stringify(result.serviceIds)}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("every crosswalk test case resolves to its expected service IDs", async () => {
    const failures: string[] = [];
    for (const crosswalk of bundle.crosswalks) {
      for (const testCase of crosswalk.testCases) {
        const result = await resolver.resolve(testCase.utterance);
        if (JSON.stringify(result.serviceIds) !== JSON.stringify(testCase.expectedServiceIds)) {
          failures.push(
            `"${testCase.utterance}" (${crosswalk.id}) → [${result.resolutionLayer}] ${JSON.stringify(result.serviceIds)}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("no crosswalk resolution leans on the LLM layer", async () => {
    // Determinism guarantee: curated goldens must resolve in the
    // deterministic core (layers 1–2 here), never via llm_assist.
    const layers: string[] = [];
    for (const crosswalk of bundle.crosswalks as GoalCrosswalkRecord[]) {
      for (const utterance of crosswalk.utterances) {
        layers.push((await resolver.resolve(utterance)).resolutionLayer);
      }
      for (const testCase of crosswalk.testCases) {
        layers.push((await resolver.resolve(testCase.utterance)).resolutionLayer);
      }
    }
    expect(layers.every((layer) => layer !== "llm_assist")).toBe(true);
  });

  it("the golden corpus is substantial enough to be a gate", () => {
    const total = bundle.crosswalks.reduce(
      (count, crosswalk) => count + crosswalk.utterances.length + crosswalk.testCases.length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(20);
  });

  // S3 finding M1 — the corpus must exercise every deterministic layer,
  // not only alias-rules. The census is pinned EXACTLY: adding corpus
  // cases updates this pin in the same diff, and that review friction is
  // the point — the census IS the layer-coverage statement.
  it("the golden layer census routes through layers 1, 2, 3, and 4", async () => {
    const census: Record<string, number> = {};
    let total = 0;
    for (const crosswalk of bundle.crosswalks as GoalCrosswalkRecord[]) {
      for (const utterance of crosswalk.utterances) {
        const layer = (await resolver.resolve(utterance)).resolutionLayer;
        census[layer] = (census[layer] ?? 0) + 1;
        total += 1;
      }
      for (const testCase of crosswalk.testCases) {
        const layer = (await resolver.resolve(testCase.utterance)).resolutionLayer;
        census[layer] = (census[layer] ?? 0) + 1;
        total += 1;
      }
    }
    expect(census).toEqual({
      "exact-id": 1,
      "alias-rules": 67,
      "semantic-retrieval": 1,
      "search-fallback": 1,
    });
    expect(total).toBe(70);
  });
});

describe("coverage-domain goldens", () => {
  it("crosswalk-backed goals cover all five coverage domains", () => {
    const domainsByService = new Map(bundle.services.map((s) => [s.meta.catalogId, s.meta.domain]));
    const covered = new Set<string>();
    for (const crosswalk of bundle.crosswalks) {
      for (const serviceId of crosswalk.serviceIds) {
        const domain = domainsByService.get(serviceId);
        if (domain) {
          covered.add(domain);
        }
      }
    }
    expect([...covered].sort()).toEqual([...ALL_DOMAINS].sort());
  });
});

describe("no-match goldens", () => {
  it.each(EXPECTED_NO_MATCH)("unrelated input %j resolves to nothing", async (utterance) => {
    const result = await resolver.resolve(utterance);
    expect(result.serviceIds).toEqual([]);
  });
});
