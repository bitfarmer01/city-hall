// llm_assist tests: validation (only catalog IDs survive), logging fidelity,
// error capture, and sink snapshot semantics.

import { describe, expect, it } from "vitest";

import { InMemoryLlmAssistSink, runLlmAssist } from "./llm-assist";
import type { LlmAssistFn } from "./types";

const CANDIDATES = new Set(["svc:dohmh:dog-license", "svc:dohmh:birth-certificate-order"]);
const INPUT = {
  utterance: "animal paperwork",
  canonicalText: "animal paperwork",
  tokens: ["animal", "paperwork"],
  candidateServiceIds: [...CANDIDATES],
};

describe("runLlmAssist", () => {
  it("keeps validated catalog IDs and logs raw vs accepted vs rejected", async () => {
    const sink = new InMemoryLlmAssistSink();
    const fallback: LlmAssistFn = async () => ({
      serviceIds: ["svc:dohmh:dog-license", "svc:nope:invented"],
      note: "guessed one",
    });

    const outcome = await runLlmAssist(fallback, INPUT, CANDIDATES, sink);

    expect(outcome.serviceIds).toEqual(["svc:dohmh:dog-license"]);
    const entries = sink.all();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.request).toEqual(INPUT);
    expect(entries[0]?.rawServiceIds).toEqual(["svc:dohmh:dog-license", "svc:nope:invented"]);
    expect(entries[0]?.acceptedServiceIds).toEqual(["svc:dohmh:dog-license"]);
    expect(entries[0]?.rejectedServiceIds).toEqual(["svc:nope:invented"]);
    expect(entries[0]?.note).toBe("guessed one");
    expect(entries[0]?.error).toBeUndefined();
  });

  it("deduplicates and preserves the fallback's order for accepted IDs", async () => {
    const sink = new InMemoryLlmAssistSink();
    const fallback: LlmAssistFn = async () => ({
      serviceIds: [
        "svc:dohmh:birth-certificate-order",
        "svc:dohmh:dog-license",
        "svc:dohmh:birth-certificate-order",
      ],
    });

    const outcome = await runLlmAssist(fallback, INPUT, CANDIDATES, sink);
    expect(outcome.serviceIds).toEqual(["svc:dohmh:birth-certificate-order", "svc:dohmh:dog-license"]);
  });

  it("returns an empty outcome when every ID is rejected", async () => {
    const sink = new InMemoryLlmAssistSink();
    const fallback: LlmAssistFn = async () => ({
      serviceIds: ["svc:nope:invented"],
      note: "nothing real",
    });

    const outcome = await runLlmAssist(fallback, INPUT, CANDIDATES, sink);
    expect(outcome.serviceIds).toEqual([]);
    expect(outcome).not.toHaveProperty("note");
    const entries = sink.all();
    expect(entries[0]?.acceptedServiceIds).toEqual([]);
    expect(entries[0]?.rejectedServiceIds).toEqual(["svc:nope:invented"]);
    expect(entries[0]?.note).toBe("nothing real");
  });

  it("captures a thrown fallback error in the log instead of propagating it", async () => {
    const sink = new InMemoryLlmAssistSink();
    const fallback: LlmAssistFn = async () => {
      throw new Error("provider down");
    };

    const outcome = await runLlmAssist(fallback, INPUT, CANDIDATES, sink);
    expect(outcome.serviceIds).toEqual([]);
    const entries = sink.all();
    expect(entries[0]?.error).toContain("provider down");
    expect(entries[0]?.acceptedServiceIds).toEqual([]);
  });

  it("appends entries in call order", async () => {
    const sink = new InMemoryLlmAssistSink();
    const fallback: LlmAssistFn = async () => ({ serviceIds: [] });

    await runLlmAssist(fallback, INPUT, CANDIDATES, sink);
    await runLlmAssist(fallback, { ...INPUT, utterance: "second try" }, CANDIDATES, sink);

    const entries = sink.all();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.request.utterance).toBe("animal paperwork");
    expect(entries[1]?.request.utterance).toBe("second try");
  });
});

describe("InMemoryLlmAssistSink", () => {
  it("all() returns a snapshot — mutating it does not affect the sink", () => {
    const sink = new InMemoryLlmAssistSink();
    sink.append({
      request: INPUT,
      rawServiceIds: [],
      acceptedServiceIds: [],
      rejectedServiceIds: [],
    });

    const snapshot = sink.all() as unknown as { push: (entry: unknown) => void };
    snapshot.push({ tampered: true });
    expect(sink.all()).toHaveLength(1);
    expect(sink.all()[0]?.request.utterance).toBe("animal paperwork");
  });
});
