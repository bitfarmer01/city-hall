import { parseExpectation } from "../capture/golden";
import type { CatalogExpectation } from "../capture/golden";
import { normalizeSignalLabel } from "./inperson";

/**
 * A golden baseline expectation: the capture harness's CatalogExpectation
 * (fields + documents, the diff vocabulary of diffLiveMinusCatalog) plus the
 * in-person step claims the article page must show. Stored one per target in
 * data/golden/expectations/; parseExpectation's strictness carries over — a
 * malformed baseline throws instead of silently ungoverning a target.
 */
export interface GoldenExpectation extends CatalogExpectation {
  /** Catalog in-person claims for the service, in the scanner's vocabulary. */
  inPersonSteps: string[];
}

export function parseGoldenExpectation(raw: unknown): GoldenExpectation {
  const base = parseExpectation(raw);
  if (typeof raw !== "object" || raw === null) {
    throw new Error("golden expectation must be an object");
  }
  const e = raw as Record<string, unknown>;
  const inPersonSteps = e.inPersonSteps === undefined ? [] : e.inPersonSteps;
  if (!Array.isArray(inPersonSteps) || inPersonSteps.some((s) => typeof s !== "string")) {
    throw new Error("golden expectation inPersonSteps must be an array of strings");
  }
  return {
    ...base,
    inPersonSteps: inPersonSteps.map((s) => normalizeSignalLabel(s as string)),
  };
}
