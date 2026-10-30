import type { FormFieldDump } from "./types";
import { sanitizeForLog } from "./sanitize";

/**
 * Golden-diff, pure: compare a live (or replayed) form-field dump against the
 * catalog's expectation for a service. The DoD gate is live-minus-catalog
 * (art_wJiwwN0o §4b): anything the live form shows that the catalog lacks is
 * a miss — a required one fails the check, an optional one warns. Catalog
 * entries absent from the live form are extras (warnings): the form may have
 * changed, or the catalog may be stale.
 */

export interface ExpectedField {
  label: string;
  type: string;
  required: boolean;
}

export interface CatalogExpectation {
  serviceId: string;
  label: string;
  sourceUrl: string;
  expectedFields: ExpectedField[];
  /** Labels of document/upload slots the service requires. */
  expectedDocuments: string[];
}

export type FindingReason = "live_only_required" | "live_only_optional" | "catalog_only";

export interface GoldenFinding {
  kind: "field" | "document";
  reason: FindingReason;
  /** Normalized match key that did (not) line up. */
  key: string;
  detail: string;
}

export interface GoldenDiff {
  /** Required live evidence the catalog lacks — the check-B gate. */
  failures: GoldenFinding[];
  /** Extras and optional-only gaps — surfaced, not gating. */
  warnings: GoldenFinding[];
}

export function hasBlockingFailures(diff: GoldenDiff): boolean {
  return diff.failures.length > 0;
}

/**
 * Defensive parser for stored expectation JSON files. Throws on structural
 * garbage — a malformed expectation would silently ungovern a snapshot.
 */
export function parseExpectation(raw: unknown): CatalogExpectation {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`catalog expectation must be an object, got ${typeof raw}`);
  }
  const e = raw as Record<string, unknown>;
  if (!Array.isArray(e.expectedFields)) {
    throw new Error("catalog expectation is missing expectedFields array");
  }
  if (!Array.isArray(e.expectedDocuments)) {
    throw new Error("catalog expectation is missing expectedDocuments array");
  }
  return {
    serviceId: requireString(e.serviceId, "expectation.serviceId"),
    label: requireString(e.label, "expectation.label"),
    sourceUrl: requireString(e.sourceUrl, "expectation.sourceUrl"),
    expectedFields: e.expectedFields.map((f) => {
      if (typeof f !== "object" || f === null) {
        throw new Error(`expected field must be an object, got ${typeof f}`);
      }
      const field = f as Record<string, unknown>;
      return {
        label: requireString(field.label, "expectedField.label"),
        type: requireString(field.type, "expectedField.type"),
        required: field.required === true,
      };
    }),
    expectedDocuments: e.expectedDocuments.map((d) => requireString(d, "expectedDocuments entry")),
  };
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new Error(`${what} must be a string, got ${typeof value}`);
  }
  return value;
}

export function diffLiveMinusCatalog(
  live: FormFieldDump,
  expected: CatalogExpectation,
): GoldenDiff {
  const liveFieldKeys = new Map<string, { required: boolean; label: string }>();
  for (const f of live.fields) {
    liveFieldKeys.set(fieldKey(f), { required: f.required, label: f.label });
  }
  const expectedFieldKeys = new Map<string, ExpectedField>();
  for (const f of expected.expectedFields) {
    expectedFieldKeys.set(fieldKey(f), f);
  }

  const failures: GoldenFinding[] = [];
  const warnings: GoldenFinding[] = [];

  for (const [key, liveField] of liveFieldKeys) {
    if (expectedFieldKeys.has(key)) continue;
    if (liveField.required) {
      failures.push({
        kind: "field",
        reason: "live_only_required",
        key,
        detail: `live form has required field "${sanitizeForLog(liveField.label)}" absent from catalog`,
      });
    } else {
      warnings.push({
        kind: "field",
        reason: "live_only_optional",
        key,
        detail: `live form has optional field "${sanitizeForLog(liveField.label)}" absent from catalog`,
      });
    }
  }
  for (const [key, expectedField] of expectedFieldKeys) {
    if (liveFieldKeys.has(key)) continue;
    warnings.push({
      kind: "field",
      reason: "catalog_only",
      key,
      detail: `catalog expects ${expectedField.required ? "required" : "optional"} field "${sanitizeForLog(expectedField.label)}" not found in live dump`,
    });
  }

  // Document slots are file inputs. Any live upload slot the catalog does not
  // name is a required-channel gap; catalog documents without a live slot warn.
  const liveFileLabels = live.fields
    .filter((f) => f.tag === "input" && f.type === "file")
    .map((f) => normalizeKey(f.label));
  for (const doc of expected.expectedDocuments) {
    if (!liveFileLabels.includes(normalizeKey(doc))) {
      warnings.push({
        kind: "document",
        reason: "catalog_only",
        key: normalizeKey(doc),
        detail: `catalog requires document "${sanitizeForLog(doc)}" with no matching live upload slot`,
      });
    }
  }

  return { failures, warnings };
}

/** Normalized match key for a field: normalized label + normalized type. */
export function fieldKey(f: { label: string; type: string }): string {
  return `${normalizeKey(f.label)}:${normalizeType(f.type)}`;
}

function normalizeType(type: string): string {
  return type === "select-one" ? "select" : type.toLowerCase();
}

export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[*:]+$|^\*/, "")
    .trim();
}
