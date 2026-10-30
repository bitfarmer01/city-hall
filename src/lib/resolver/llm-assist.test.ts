// llm_assist tests: validation (only catalog IDs survive), logging fidelity,
// error capture, and sink snapshot semantics.

import { describe, expect, it } from "vitest";

import { InMemoryLlmAssistSink, runLlmAssist, sanitizeLogText } from "./llm-assist";
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

  // S4 finding F1/H2 — every malformed output shape is model junk routed
  // to the throwing-fallback machinery: logged with an error note, empty
  // result, and NEVER a throw out of runLlmAssist.
  it.each([
    ["serviceIds is a number", async () => ({ serviceIds: 42 as unknown as string[] })],
    ["serviceIds is null", async () => ({ serviceIds: null as unknown as string[] })],
    ["serviceIds is a non-iterable object", async () => ({ serviceIds: ({ a: 1 }) as unknown as string[] })],
    ["result is a truthy non-object", (async () => "garbage") as unknown as LlmAssistFn],
    ["result is an empty string", (async () => "") as unknown as LlmAssistFn],
  ])("degrades a malformed result (%s) to a logged no-match instead of throwing", async (_label, fallback) => {
    const sink = new InMemoryLlmAssistSink();

    const outcome = await runLlmAssist(fallback, INPUT, CANDIDATES, sink);

    expect(outcome.serviceIds).toEqual([]);
    const entries = sink.all();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.rawServiceIds).toEqual([]);
    expect(entries[0]?.acceptedServiceIds).toEqual([]);
    expect(entries[0]?.error).toMatch(/^malformed llm_assist result shape:/);
  });

  it("still handles a null result as an honest no-match with no error", async () => {
    const sink = new InMemoryLlmAssistSink();
    const fallback: LlmAssistFn = async () => null;

    const outcome = await runLlmAssist(fallback, INPUT, CANDIDATES, sink);

    expect(outcome.serviceIds).toEqual([]);
    expect(sink.all()[0]?.error).toBeUndefined();
  });
});

describe("sanitizeLogText (S4 finding F3/M8)", () => {
  it("strips ANSI escape sequences as units", () => {
    expect(sanitizeLogText("\x1b[31mred\x1b[0m")).toBe("red");
    expect(sanitizeLogText("cursor \x1b[2J\x1b[Hreset")).toBe("cursor reset");
  });

  it("strips control characters (newlines, null bytes, C1)", () => {
    // Control bytes are REMOVED, not converted to spaces — a tab is as
    // capable of forging alignment in a log line as a newline.
    expect(sanitizeLogText("line1\nline2\r\ntab\tstop\u0000end\u009f")).toBe("line1line2tabstopend");
  });

  it("removes a truncated escape sequence without leaking its terminator", () => {
    // A sequence with no final byte cannot be consumed as a unit — the
    // control sweep still removes the ESC, leaving only inert text.
    expect(sanitizeLogText("junk \x1b[31")).toBe("junk [31");
    expect(sanitizeLogText("trailing \x1b")).toBe("trailing ");
    // CSI consumes greedily up to a valid final byte ("n" IS a final byte,
    // e.g. \\x1b[31n is a DSR) — a truncated sequence followed by text is
    // consumed as a unit, never partially leaked.
    expect(sanitizeLogText("bad \x1b[31 no final byte")).toBe("bad o final byte");
  });

  it("leaves clean text untouched", () => {
    expect(sanitizeLogText("dog license renewal — KA-01890")).toBe("dog license renewal — KA-01890");
  });
});

describe("log entry goal-text sanitization (S4 finding F3/M8)", () => {
  it("stores goal text with control characters and ANSI escapes sanitized", async () => {
    const sink = new InMemoryLlmAssistSink();
    const fallback: LlmAssistFn = async () => ({ serviceIds: [] });

    await runLlmAssist(
      fallback,
      { ...INPUT, utterance: "dog\x1b[31m license\nrenewal\u0000" },
      CANDIDATES,
      sink,
    );

    const entry = sink.all()[0];
    expect(entry?.request.utterance).toBe("dog licenserenewal");
    expect(entry?.request.utterance).not.toContain("\n");
    expect(entry?.request.utterance).not.toContain("\x1b");
  });

  it("cannot mutate the request the model actually saw", async () => {
    const sink = new InMemoryLlmAssistSink();
    const fallback: LlmAssistFn = async () => ({ serviceIds: [] });
    const request = { ...INPUT, utterance: "goal\x1b[31m text\n" };

    await runLlmAssist(fallback, request, CANDIDATES, sink);

    expect(request.utterance).toBe("goal\x1b[31m text\n");
    expect(sink.all()[0]?.request.utterance).toBe("goal text");
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
