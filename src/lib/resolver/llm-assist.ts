// Layer 5 — the logged, non-authoritative LLM fallback (locked decision
// #7). The resolver never ships a model: an LlmAssistFn is INJECTED by the
// caller that runs one (a surface with a model key, a harness, a human
// review tool). Its output is validated against the catalog — unknown IDs
// are dropped before they can reach a result, order preserved — and every
// call is recorded in an append-only log with what the model returned,
// what was accepted, and what was rejected.
//
// Excluded from the determinism guarantee BY CONSTRUCTION: the layer only
// runs when all four deterministic layers miss, it can only RETURN ids
// (never mutate a deterministic result), and its outputs become
// deterministic only when a human promotes them into alias/rules rows —
// at which point the same utterance resolves through the deterministic
// core (pinned research art_wJiwwN0o §2, the GetCalFresh
// promote-computed-logic pattern).

import type {
  LlmAssistFn,
  LlmAssistLogEntry,
  LlmAssistRequest,
} from "./types";

/**
 * Append-only log of llm_assist calls. Implementations persist or forward
 * entries and assign their own sequence numbers; the resolver core only
 * appends.
 */
export interface LlmAssistSink {
  append(entry: LlmAssistLogEntry): void;
}

/** In-memory sink — tests, dev servers, and as the default. */
export class InMemoryLlmAssistSink implements LlmAssistSink {
  private readonly entries: LlmAssistLogEntry[] = [];

  append(entry: LlmAssistLogEntry): void {
    this.entries.push({ ...entry });
  }

  /** Snapshot of the entries so far, oldest first. */
  all(): readonly LlmAssistLogEntry[] {
    return [...this.entries];
  }
}

export interface LlmAssistOutcome {
  /** Validated service IDs (unknown IDs dropped, order preserved). */
  serviceIds: string[];
}

/**
 * Strip control characters and ANSI escape sequences from goal text before
 * it is stored in a log entry (S4 finding F3/M8). Raw utterances are
 * user-controlled, and control bytes can forge log lines or corrupt a
 * downstream terminal. Escape sequences are removed as units first so a
 * truncated sequence cannot leak its terminator; any surviving C0/C1
 * control byte (newline, ESC, DEL, …) is stripped after.
 */
const ANSI_ESCAPE_SEQUENCE =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\x1b\\)|[@-Z\\-_])/g;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

export function sanitizeLogText(text: string): string {
  return text.replace(ANSI_ESCAPE_SEQUENCE, "").replace(CONTROL_CHARACTERS, "");
}

/** Describe a malformed fallback result for the error note — never throws. */
function describeMalformed(result: unknown): string {
  if (result === null || typeof result !== "object") {
    return typeof result === "string" ? `string "${result}"` : typeof result;
  }
  return `serviceIds of type ${typeof (result as { serviceIds?: unknown }).serviceIds}`;
}

/**
 * Run the injected fallback, validate its output against the catalog, and
 * log the attempt. A fallback that throws — or returns a malformed shape —
 * is recorded with the error note and yields no IDs: the fallback can
 * degrade the answer to a logged no-match, but it can never throw into the
 * deterministic path.
 */
export async function runLlmAssist(
  llmAssist: LlmAssistFn,
  request: LlmAssistRequest,
  knownServiceIds: ReadonlySet<string>,
  sink: LlmAssistSink,
): Promise<LlmAssistOutcome> {
  let rawServiceIds: string[] = [];
  let note: string | undefined;
  let error: string | undefined;

  try {
    // The model boundary is untrusted at runtime regardless of the static
    // LlmAssistResult type, so the shape check happens HERE, inside the
    // guard (S4 finding F1/H2 — validating below the try let a malformed
    // serviceIds throw out of resolve()).
    const result: unknown = await llmAssist(request);
    if (result !== null && result !== undefined) {
      const serviceIds: unknown = (result as { serviceIds?: unknown }).serviceIds;
      if (!Array.isArray(serviceIds)) {
        throw new TypeError(`malformed llm_assist result shape: ${describeMalformed(result)}`);
      }
      rawServiceIds = serviceIds;
      note = (result as { note?: string }).note;
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const acceptedServiceIds: string[] = [];
  const rejectedServiceIds: string[] = [];
  const seen = new Set<string>();
  for (const serviceId of rawServiceIds) {
    if (!knownServiceIds.has(serviceId)) {
      rejectedServiceIds.push(serviceId);
    } else if (!seen.has(serviceId)) {
      // Dedupe preserving first occurrence — a resolution never lists the
      // same service twice.
      seen.add(serviceId);
      acceptedServiceIds.push(serviceId);
    }
  }

  // The stored entry carries SANITIZED goal text (S4 finding F3/M8): the
  // model saw the verbatim utterance, but the audit copy must not be able
  // to forge log lines through a downstream terminal. canonicalText and
  // tokens cannot carry control bytes today (canonicalize strips them);
  // they are sanitized anyway so the log boundary does not depend on that.
  const loggedRequest: LlmAssistRequest = {
    ...request,
    utterance: sanitizeLogText(request.utterance),
    canonicalText: sanitizeLogText(request.canonicalText),
    tokens: request.tokens.map(sanitizeLogText),
  };

  sink.append({
    request: loggedRequest,
    rawServiceIds,
    acceptedServiceIds,
    rejectedServiceIds,
    note,
    error,
  });

  return { serviceIds: acceptedServiceIds };
}
