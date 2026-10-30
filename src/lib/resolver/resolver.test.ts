// Pipeline tests (D5): five layers in order, version stamps on every
// resolution, the determinism property (same input × 10 → identical
// output), and llm_assist isolation — the fallback can never touch a
// deterministic result.

import { describe, expect, it } from "vitest";

import { loadCatalogBundle } from "./catalog-source";
import { createResolver, type ResolverOptions } from "./resolver";
import { InMemoryLlmAssistSink } from "./llm-assist";
import { CROSSWALK_RULES_VERSION } from "./rules";
import { EMBEDDING_MODEL_VERSION } from "./retrieval";
import type { LlmAssistFn } from "./types";

const bundle = loadCatalogBundle();

function makeResolver(options: ResolverOptions = {}) {
  return createResolver(bundle, options);
}

describe("version stamps", () => {
  it("carries all three pinned versions", () => {
    const resolver = makeResolver();
    expect(resolver.versions).toEqual({
      catalogVersion: bundle.catalogVersion,
      crosswalkVersion: CROSSWALK_RULES_VERSION,
      embeddingModelVersion: EMBEDDING_MODEL_VERSION,
    });
  });

  it("stamps every resolution with the same frozen set", async () => {
    const resolver = makeResolver();
    for (const utterance of ["dog license", "open a restaurant", "purple elephant"]) {
      const result = await resolver.resolve(utterance);
      expect(result.versions).toEqual(resolver.versions);
    }
  });
});

describe("layer tags", () => {
  it("layer 1 — exact IDs resolve as exact-id", async () => {
    const resolver = makeResolver();
    const result = await resolver.resolve("KA-01890");
    expect(result.resolutionLayer).toBe("exact-id");
    expect(result.serviceIds).toEqual(["svc:dohmh:dog-license"]);
  });

  it("layer 2 — curated goals resolve as alias-rules", async () => {
    const resolver = makeResolver();
    const result = await resolver.resolve("I want to open a restaurant");
    expect(result.resolutionLayer).toBe("alias-rules");
    expect(result.serviceIds).toEqual(["svc:dohmh:food-service-establishment-permit"]);
  });

  it("layer 3 — paraphrases resolve as semantic-retrieval", async () => {
    const resolver = makeResolver();
    // Not an alias and no rule fires ("tap" without permit/connect/plug/map);
    // retrieval anchors on water/tap vocabulary.
    const result = await resolver.resolve("water tap");
    expect(result.resolutionLayer).toBe("semantic-retrieval");
    expect(result.serviceIds[0]).toBe("svc:dep:water-tap-permit");
  });

  it("layer 4 — low-cosine lexical matches resolve as search-fallback", async () => {
    const resolver = makeResolver();
    // "appointment" shares one rare token with the elevator-inspection
    // document but sits below the retrieval cosine floor, so the IDF search
    // layer is what accepts it (probed: retrieval empty, search score 1.0).
    const result = await resolver.resolve("appointment");
    expect(result.resolutionLayer).toBe("search-fallback");
    expect(result.serviceIds).toEqual(["svc:buildings:elevator-escalator-inspection"]);
  });

  it("no deterministic match → empty serviceIds", async () => {
    const resolver = makeResolver();
    const result = await resolver.resolve("purple elephant");
    expect(result.serviceIds).toEqual([]);
    expect(result.resolutionLayer).toBe("search-fallback");
  });
});

describe("determinism property", () => {
  const UTTERANCES = [
    "I want to build an extension on my house",
    "KA-02076",
    "my neighbor is too loud",
    "renew my dog's license",
    "water tap",
    "purple elephant",
    "what is the meaning of life",
  ];

  it("same input × 10 → identical output, bit for bit", async () => {
    const resolver = makeResolver();
    for (const utterance of UTTERANCES) {
      const first = JSON.stringify(await resolver.resolve(utterance));
      for (let run = 0; run < 10; run += 1) {
        const again = JSON.stringify(await resolver.resolve(utterance));
        expect(again, `run ${run} for "${utterance}" diverged`).toBe(first);
      }
    }
  });

  it("two resolvers over the same bundle agree", async () => {
    const a = makeResolver();
    const b = makeResolver();
    for (const utterance of UTTERANCES) {
      expect(await b.resolve(utterance)).toEqual(await a.resolve(utterance));
    }
  });
});

describe("llm_assist isolation", () => {
  const NO_MATCH = "animal paperwork";

  it("a no-match stays a no-match and the log stays empty without a fallback", async () => {
    const resolver = makeResolver();
    const result = await resolver.resolve(NO_MATCH);
    expect(result.serviceIds).toEqual([]);
    expect(result.resolutionLayer).not.toBe("llm_assist");
    expect(resolver.llmLog()).toEqual([]);
  });

  it("the fallback never fires on deterministic resolutions — even when configured", async () => {
    let fallbackCalls = 0;
    const fallback: LlmAssistFn = async () => {
      fallbackCalls += 1;
      return { serviceIds: ["svc:dohmh:dog-license"] };
    };
    const resolver = makeResolver({ llmAssist: fallback });

    const deterministic = await resolver.resolve("I want to open a restaurant");
    expect(deterministic.serviceIds).toEqual(["svc:dohmh:food-service-establishment-permit"]);
    expect(deterministic.resolutionLayer).toBe("alias-rules");
    expect(fallbackCalls).toBe(0);
    expect(resolver.llmLog()).toEqual([]);
  });

  it("the fallback fires only on an empty deterministic result, labeled llm_assist", async () => {
    const fallback: LlmAssistFn = async () => ({ serviceIds: ["svc:dohmh:dog-license"] });
    const resolver = makeResolver({ llmAssist: fallback });

    const result = await resolver.resolve(NO_MATCH);
    expect(result.resolutionLayer).toBe("llm_assist");
    expect(result.serviceIds).toEqual(["svc:dohmh:dog-license"]);
    expect(resolver.llmLog()).toHaveLength(1);
  });

  it("fallback junk (unknown IDs) is dropped before reaching the result", async () => {
    const fallback: LlmAssistFn = async () => ({
      serviceIds: ["svc:nope:invented", "svc:dohmh:dog-license"],
    });
    const resolver = makeResolver({ llmAssist: fallback });

    const result = await resolver.resolve(NO_MATCH);
    expect(result.serviceIds).toEqual(["svc:dohmh:dog-license"]);
    expect(resolver.llmLog()[0]?.rejectedServiceIds).toEqual(["svc:nope:invented"]);
  });

  it("a throwing fallback degrades to a logged no-match, never an exception", async () => {
    const fallback: LlmAssistFn = async () => {
      throw new Error("provider down");
    };
    const resolver = makeResolver({ llmAssist: fallback });

    const result = await resolver.resolve(NO_MATCH);
    expect(result.serviceIds).toEqual([]);
    expect(resolver.llmLog()[0]?.error).toBe("provider down");
  });

  it("log entries land in the injected sink, not just the in-memory one", async () => {
    const injected = new InMemoryLlmAssistSink();
    const fallback: LlmAssistFn = async () => ({ serviceIds: [] });
    const resolver = makeResolver({ llmAssist: fallback, llmSink: injected });

    await resolver.resolve(NO_MATCH);
    expect(injected.all()).toHaveLength(1);
  });

  // S4 finding F1/H2, end to end: a malformed model response must degrade
  // to a logged no-match inside resolve(), never throw out of it.
  it.each([
    ["serviceIds is a number", async () => ({ serviceIds: 42 as unknown as string[] })],
    ["serviceIds is null", async () => ({ serviceIds: null as unknown as string[] })],
    ["result is a truthy non-object", (async () => "garbage") as unknown as LlmAssistFn],
    ["result is an empty string", (async () => "") as unknown as LlmAssistFn],
  ])("malformed fallback output (%s) resolves as a logged no-match, never a throw", async (_label, fallback) => {
    const resolver = makeResolver({ llmAssist: fallback });

    const result = await resolver.resolve(NO_MATCH);

    expect(result.serviceIds).toEqual([]);
    expect(result.resolutionLayer).toBe("llm_assist");
    const entry = resolver.llmLog()[0];
    expect(entry?.acceptedServiceIds).toEqual([]);
    expect(entry?.error).toMatch(/^malformed llm_assist result shape:/);
  });
});

describe("search idf robustness (S4 finding F2/H3)", () => {
  it("a corpus-absent junk token cannot no-match an otherwise-resolvable query", async () => {
    const resolver = makeResolver();

    const clean = await resolver.resolve("from renew");
    expect(clean.resolutionLayer).toBe("search-fallback");
    expect(clean.serviceIds).toHaveLength(4);

    const withJunk = await resolver.resolve("from renew zqvwk");
    expect(withJunk.resolutionLayer).toBe(clean.resolutionLayer);
    expect(withJunk.serviceIds).toEqual(clean.serviceIds);
  });
});
