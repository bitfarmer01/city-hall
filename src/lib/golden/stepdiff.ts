import type { GoldenDiff, GoldenFinding } from "../capture/golden";
import { scanInPersonSignals, normalizeSignalLabel } from "./inperson";
import type { GoldenExpectation } from "./expectation";
import type { InPersonDiff } from "./types";

/**
 * In-person step comparison, shared by the offline gate (check.ts) and the
 * live leg (live.ts). The live evidence is the captured page text scanned for
 * in-person signals; the catalog side is the baseline's inPersonSteps — both
 * in the scanner's bounded phrase vocabulary, so the comparison is mechanical:
 *
 *  - live signal the baseline does not claim → miss (gate failure);
 *  - baseline claim with no live signal → stale claim (warning);
 *  - no live signal at all → nothing provable either way (no finding).
 */

export function diffInPerson(pageText: string | null, expectation: GoldenExpectation): InPersonDiff {
  const liveSignals = pageText
    ? scanInPersonSignals(pageText).map((s) => normalizeSignalLabel(s.phrase))
    : [];
  const claimed = new Set(expectation.inPersonSteps);
  return {
    live: liveSignals,
    missing: liveSignals.filter((p) => !claimed.has(p)),
    stale: [...claimed].filter((p) => !liveSignals.includes(p)),
  };
}

/** Folds a field/document diff and the in-person comparison into one finding set. */
export function mergeFindings(findings: GoldenDiff, inPerson: InPersonDiff | null): GoldenDiff {
  if (inPerson === null) return findings;
  const failures: GoldenFinding[] = [
    ...findings.failures,
    ...inPerson.missing.map((phrase) => ({
      kind: "field" as const,
      reason: "live_only_required" as const,
      key: `in-person:${phrase}`,
      detail: `live page shows in-person requirement "${phrase}" the catalog baseline does not claim`,
    })),
  ];
  const warnings: GoldenFinding[] = [
    ...findings.warnings,
    ...inPerson.stale.map((phrase) => ({
      kind: "field" as const,
      reason: "catalog_only" as const,
      key: `in-person:${phrase}`,
      detail: `catalog baseline claims in-person "${phrase}" with no live page signal (drift or over-claim)`,
    })),
  ];
  return { failures, warnings };
}
