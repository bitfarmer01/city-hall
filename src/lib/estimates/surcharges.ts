// Surcharges and contingent fees — build spec D6. The spec rule: they
// render INSIDE step instructions (a payment step's convenience fee, a
// returned-check penalty), never in the headline estimate. The headline
// (src/lib/estimates/types.ts) has no field that could carry one; the only
// render path is a curated note on a specific step.
//
// Rows live in data/estimates/surcharges.json and are hand-curated: a row
// must name the exact step ID, carry the display text, and reference the
// SourceSnapshot records that back the claim. There are no production rows
// yet — the DOB NOW 2% card fee is verified in research (art_wJiwwN0o §3)
// but has no committed snapshot, so no honest row can exist until the
// capture pipeline records that page. The loader refuses bad rows loudly;
// it never skips one silently.

import { STEP_ID_PATTERN } from "@/lib/catalog/ids";

import { EstimatesError } from "./types";
import type { SnapshotsById } from "./fees";

/** One curated surcharge note, rendered in the step's feeNotes. */
export interface SurchargeRow {
  /** The exact blueprint step the note rides on, `stp:{serviceId}:{seq3}`. */
  stepId: string;
  /** Display text — the note as the source states it. */
  note: string;
  /** Snapshot IDs backing the claim — never empty. */
  sourceRefs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate parsed registry JSON. Collects every violation into one
 * EstimatesError; every sourceRef must resolve in the bundle so a note
 * never renders unsourced.
 */
export function parseSurchargeRows(raw: unknown, snapshots: SnapshotsById): SurchargeRow[] {
  if (!Array.isArray(raw)) {
    throw new EstimatesError(["surcharge registry must be a JSON array"]);
  }

  const violations: string[] = [];
  const rows: SurchargeRow[] = [];

  raw.forEach((entry, index) => {
    const where = `surcharges[${index}]`;
    if (!isRecord(entry)) {
      violations.push(`${where} is not an object`);
      return;
    }
    const { stepId, note, sourceRefs } = entry;
    if (typeof stepId !== "string" || !STEP_ID_PATTERN.test(stepId)) {
      violations.push(`${where}.stepId ${JSON.stringify(stepId)} does not match ${STEP_ID_PATTERN}`);
    }
    if (typeof note !== "string" || note.trim().length === 0) {
      violations.push(`${where}.note must be non-empty display text`);
    }
    if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
      violations.push(`${where}.sourceRefs must be a non-empty array — an unsourced fee note must not ship`);
    } else {
      for (const ref of sourceRefs) {
        if (typeof ref !== "string" || !snapshots.has(ref)) {
          violations.push(`${where}.sourceRefs entry ${JSON.stringify(ref)} resolves to no snapshot in this bundle`);
        }
      }
    }
    if (typeof stepId === "string" && typeof note === "string") {
      rows.push({ stepId, note, sourceRefs: Array.isArray(sourceRefs) ? [...sourceRefs] : [] });
    }
  });

  if (violations.length > 0) {
    throw new EstimatesError(violations);
  }
  return rows;
}

/** Group notes by step ID, preserving registry order within a step. */
export function surchargeNotesByStepId(rows: readonly SurchargeRow[]): ReadonlyMap<string, string[]> {
  const byStep = new Map<string, string[]>();
  for (const row of rows) {
    const notes = byStep.get(row.stepId) ?? [];
    notes.push(row.note);
    byStep.set(row.stepId, notes);
  }
  return byStep;
}
