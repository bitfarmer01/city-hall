import type { CapturedField, FormFieldDump } from "./types";

/** Cap on per-field option lists; the total is always recorded alongside. */
export const MAX_FIELD_OPTIONS = 100;

/**
 * Runs inside the browser via page.evaluate — must stay self-contained:
 * no imports, no closure references. Returns attribute data only; it never
 * reads or sets input values, focuses anything, or dispatches events.
 */
export function extractFieldsInPage(): { fields: unknown[]; submitButtons: string[] } {
  const MAX = 100;

  function text(s: unknown): string {
    return typeof s === "string" ? s.trim() : "";
  }

  function labelFor(el: Element): string {
    const input = el as HTMLInputElement;
    if (input.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (lab && lab.textContent) return lab.textContent.trim();
    }
    const ariaLabel = input.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    const labelledBy = input.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((ref) => document.getElementById(ref)?.textContent?.trim() ?? "")
        .filter((t) => t.length > 0);
      if (parts.length > 0) return parts.join(" ");
    }
    const wrap = input.closest("label");
    if (wrap && wrap.textContent) return wrap.textContent.trim();
    const placeholder = input.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
    return input.getAttribute("title")?.trim() ?? "";
  }

  function field(el: Element, tag: "input" | "textarea" | "select"): Record<string, unknown> {
    const input = el as HTMLInputElement;
    const label = labelFor(el);
    const type = tag === "input" ? (input.getAttribute("type") ?? "text").toLowerCase() : tag === "select" ? "select-one" : "textarea";
    const options: string[] = [];
    let optionsTotal = 0;
    if (tag === "select") {
      for (const opt of (el as HTMLSelectElement).options) {
        optionsTotal += 1;
        if (options.length < MAX) options.push(opt.text.trim());
      }
    } else if (type === "radio" || type === "checkbox") {
      optionsTotal = 1;
      const value = input.getAttribute("value");
      if (value) options.push(value.trim());
    }
    return {
      tag,
      type,
      name: input.getAttribute("name") ?? "",
      id: input.id ?? "",
      label,
      required: input.hasAttribute("required") || input.getAttribute("aria-required") === "true",
      requiredMarker: label.includes("*") || (input.getAttribute("placeholder") ?? "").includes("*"),
      options,
      optionsTotal,
      accept: input.getAttribute("accept"),
      multiple: input.hasAttribute("multiple"),
    };
  }

  const fields: unknown[] = [];
  for (const el of document.querySelectorAll("input")) {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    // Attribute-only inventory: buttons and hidden inputs are not form fields
    // an applicant fills; submit buttons are recorded separately below.
    if (type === "submit" || type === "button" || type === "image" || type === "hidden" || type === "reset") {
      continue;
    }
    fields.push(field(el, "input"));
  }
  for (const el of document.querySelectorAll("textarea")) {
    fields.push(field(el, "textarea"));
  }
  for (const el of document.querySelectorAll("select")) {
    fields.push(field(el, "select"));
  }

  const submitButtons: string[] = [];
  for (const el of document.querySelectorAll("button, input[type=submit]")) {
    const label =
      el instanceof HTMLInputElement ? (el.value ?? "") : ((el as HTMLElement).innerText ?? "");
    const trimmed = text(label).replace(/\s+/g, " ");
    if (trimmed) submitButtons.push(trimmed);
  }

  return { fields, submitButtons };
}

/**
 * Validates and normalizes the dump body — the part the in-page extractor
 * produces (fields + submitButtons). Used fresh from page.evaluate and again
 * when reading a stored fields.json; throws on structural garbage, because a
 * malformed dump is evidence corruption, never silently defaulted.
 */
export function parseDumpBody(raw: unknown): Omit<FormFieldDump, "url" | "capturedAt"> {
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
