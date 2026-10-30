// Tier-3 heuristics — build spec D6, gap-filler ONLY. The engine never
// synthesizes a range: every heuristic row is hand-curated in
// data/estimates/heuristics.json, states its basis (why it is a range and
// nothing better exists), and optionally carries sourceRefs when the basis
// points at a committed snapshot. The renderer (render.ts) guarantees a
// tier-3 item can never appear without its "estimate" label.
//
// The registry is empty today — no service in the catalog lacks both a fee
// and a published time while having a source that could ground a range.
// Rows are added by review, one at a time, with the basis recorded.

import { SERVICE_ID_PATTERN } from "@/lib/catalog/ids";

import { EstimatesError } from "./types";
import type { HeuristicEstimate } from "./types";
import type { SnapshotsById } from "./fees";

/** One curated heuristic row — the registry schema. */
export interface HeuristicRow {
  serviceId: string;
  label: string;
  /** The range as displayed, e.g. "2–4 weeks". */
  rangeText: string;
  /** Why this is only a range — the basis, not a fake citation. */
  basis: string;
  /** Snapshot IDs backing the basis, when the basis cites a source. */
  sourceRefs?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate parsed registry JSON. Collects every violation into one
 * EstimatesError; sourceRefs, when present, must resolve in the bundle.
 */
export function parseHeuristicRows(raw: unknown, snapshots?: SnapshotsById): HeuristicRow[] {
  if (!Array.isArray(raw)) {
    throw new EstimatesError(["heuristic registry must be a JSON array"]);
  }

  const violations: string[] = [];
  const rows: HeuristicRow[] = [];

  raw.forEach((entry, index) => {
    const where = `heuristics[${index}]`;
    if (!isRecord(entry)) {
      violations.push(`${where} is not an object`);
      return;
    }
    const { serviceId, label, rangeText, basis, sourceRefs } = entry;

    if (typeof serviceId !== "string" || !SERVICE_ID_PATTERN.test(serviceId)) {
      violations.push(`${where}.serviceId ${JSON.stringify(serviceId)} does not match ${SERVICE_ID_PATTERN}`);
    }
    if (typeof label !== "string" || label.trim().length === 0) {
      violations.push(`${where}.label must be non-empty display text`);
    }
    if (typeof rangeText !== "string" || rangeText.trim().length === 0) {
      violations.push(`${where}.rangeText must be non-empty display text`);
    }
    if (typeof basis !== "string" || basis.trim().length === 0) {
      violations.push(`${where}.basis must state why this is only a range`);
    }
    if (sourceRefs !== undefined) {
      if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
        violations.push(`${where}.sourceRefs, when present, must be a non-empty array`);
      } else if (snapshots !== undefined) {
        for (const ref of sourceRefs) {
          if (typeof ref !== "string" || !snapshots.has(ref)) {
            violations.push(`${where}.sourceRefs entry ${JSON.stringify(ref)} resolves to no snapshot in this bundle`);
          }
        }
      }
    }

    const valid =
      typeof serviceId === "string" &&
      SERVICE_ID_PATTERN.test(serviceId) &&
      typeof label === "string" &&
      label.trim().length > 0 &&
      typeof rangeText === "string" &&
      rangeText.trim().length > 0 &&
      typeof basis === "string" &&
      basis.trim().length > 0 &&
      (sourceRefs === undefined || (Array.isArray(sourceRefs) && sourceRefs.length > 0));
    if (valid) {
      rows.push({
        serviceId,
        label,
        rangeText,
        basis,
        ...(Array.isArray(sourceRefs) ? { sourceRefs: [...sourceRefs] } : {}),
      });
    }
  });

  if (violations.length > 0) {
    throw new EstimatesError(violations);
  }
  return rows;
}

/**
 * Registry rows → tier-3 estimates for one service. This is the ONLY
 * source of tier-3 items — nothing here derives a number from catalog data.
 */
export function buildHeuristicEstimates(
  serviceId: string,
  rows: readonly HeuristicRow[],
): HeuristicEstimate[] {
  return rows
    .filter((row) => row.serviceId === serviceId)
    .map((row) => ({
      tier: 3 as const,
      label: row.label,
      rangeText: row.rangeText,
      basis: row.basis,
    }));
}
