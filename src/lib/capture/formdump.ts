import type { CapturedField, FormFieldDump } from "./types";

/** Cap on per-field option lists; the total is always recorded alongside. */
export const MAX_FIELD_OPTIONS = 100;

/** A validated dump body: fields + submit buttons, without capture provenance. */
export type DumpBody = Omit<FormFieldDump, "url" | "capturedAt">;

/**
 * The in-page extraction itself lives in extract-script.ts as a plain-JS
 * script string: page.evaluate serializes the extractor into the browser,
 * where no Node bundler exists to supply transform helpers, so the source
 * must be plain JS. This module owns what happens on each side of the wire.
 */

/**
 * Validates and normalizes the dump body — the part the in-page extractor
 * produces (fields + submitButtons). Used fresh from page.evaluate and again
 * when reading a stored fields.json; throws on structural garbage, because a
 * malformed dump is evidence corruption, never silently defaulted.
 */
export function parseDumpBody(raw: unknown): DumpBody {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`field dump must be an object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.fields)) {
    throw new Error("field dump is missing the fields array");
  }
  if (!Array.isArray(obj.submitButtons)) {
    throw new Error("field dump is missing the submitButtons array");
  }
  return {
    fields: obj.fields.map(parseField),
    submitButtons: obj.submitButtons.map((b) => requireString(b, "submitButtons entry")),
  };
}

/**
 * Full parser for a stored dump record (fields.json): body plus the capture
 * provenance (url, capturedAt) the driver attaches before persisting.
 */
export function parseFieldDump(raw: unknown): FormFieldDump {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`field dump must be an object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;
  const body = parseDumpBody(obj);
  return {
    url: requireString(obj.url, "dump.url"),
    capturedAt: requireString(obj.capturedAt, "dump.capturedAt"),
    ...body,
  };
}

function parseField(raw: unknown): CapturedField {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`field must be an object, got ${typeof raw}`);
  }
  const f = raw as Record<string, unknown>;
  const tag = requireString(f.tag, "field.tag");
  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    throw new Error(`field.tag must be input|textarea|select, got ${tag}`);
  }
  const options = Array.isArray(f.options) ? f.options.map((o) => requireString(o, "field.options entry")) : [];
  return {
    tag,
    type: requireString(f.type, "field.type"),
    name: optionalString(f.name),
    id: optionalString(f.id),
    label: optionalString(f.label),
    required: f.required === true,
    requiredMarker: f.requiredMarker === true,
    options: options.slice(0, MAX_FIELD_OPTIONS),
    optionsTotal: typeof f.optionsTotal === "number" ? f.optionsTotal : options.length,
    accept: typeof f.accept === "string" ? f.accept : null,
    multiple: f.multiple === true,
  };
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new Error(`${what} must be a string, got ${typeof value}`);
  }
  return value;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
