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
 * Run the injected fallback, validate its output against the catalog, and
 * log the attempt. A fallback that throws is recorded with the error note
 * and yields no IDs — the fallback can degrade the answer to a logged
 * no-match, but it can never throw into the deterministic path.
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
    const result = await llmAssist(request);
    if (result) {
      rawServiceIds = result.serviceIds;
      note = result.note;
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

  sink.append({
    request,
    rawServiceIds,
    acceptedServiceIds,
    rejectedServiceIds,
    note,
    error,
  });

  return { serviceIds: acceptedServiceIds };
}
