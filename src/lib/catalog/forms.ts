// Bridge from the Python PDF-extraction pipeline's catalog JSON
// (python/pdf_extraction/model.py to_catalog_dict) to the catalog's
// FormRecord / FormFieldRecord / SourceSnapshotRecord. The Python side is
// the verified extraction toolchain (locked decision #9); this module only
// translates and shape-checks — it never mutates a field's meaning.

import type {
  FillableClass,
  FormFieldRecord,
  FormRecord,
  ProvenanceRecord,
  RequirementLevel,
  RequiredStatus,
  SourceLayer,
  SourceSnapshotRecord,
} from "./types";

/** Shape of one extraction output file (data/catalog/forms/*.catalog.json). */
export interface ExtractedFormCatalog {
  schemaVersion: string;
  generatedAt: string;
  form: FormRecord;
  fields: FormFieldRecord[];
  snapshot: SourceSnapshotRecord;
}

const REQUIRED_STATUSES: readonly RequiredStatus[] = [
  "author_declared_required",
  "not_marked_required",
  "inferred_required",
  "unknown",
];

const SOURCE_LAYERS: readonly SourceLayer[] = ["acroform", "xfa", "ocr", "layout_geometry"];

const FILLABLE_CLASSES: readonly FillableClass[] = [
  "acroform",
  "xfa",
  "hybrid",
  "flattened",
  "scanned",
];

const REQUIREMENT_LEVELS: readonly RequirementLevel[] = [
  "required",
  "conditionally_required",
  "optional",
  "unknown",
];

class FormBridgeError extends Error {
  constructor(message: string) {
    super(`extraction JSON rejected: ${message}`);
    this.name = "FormBridgeError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new FormBridgeError(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

function optStr(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nullableStr(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseProvenance(raw: unknown, where: string): ProvenanceRecord {
  if (!isObject(raw)) throw new FormBridgeError(`${where} must be an object`);
  const layer = str(raw, "sourceLayer", where);
  if (!SOURCE_LAYERS.includes(layer as SourceLayer)) {
    throw new FormBridgeError(`${where}.sourceLayer "${layer}" is not a SourceLayer`);
  }
  const confidence = raw["confidence"];
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
    throw new FormBridgeError(`${where}.confidence must be in [0,1]`);
  }
  return {
    sourceLayer: layer as SourceLayer,
    tool: str(raw, "tool", where),
    confidence,
    ...(optStr(raw, "note") !== undefined ? { note: optStr(raw, "note") } : {}),
  };
}

function parseField(raw: unknown, expectedFormId: string): FormFieldRecord {
  if (!isObject(raw)) throw new FormBridgeError("field entry must be an object");
  const where = `field ${String(raw["id"] ?? "?")}`;
  const requiredStatus = str(raw, "requiredStatus", where);
  if (!REQUIRED_STATUSES.includes(requiredStatus as RequiredStatus)) {
    // Locked decision #6: requiredStatus is a 4-value enum, never a boolean.
    throw new FormBridgeError(`${where}.requiredStatus "${requiredStatus}" is not one of the four enum values`);
  }
  const requirementLevel = str(raw, "requirementLevel", where);
  if (!REQUIREMENT_LEVELS.includes(requirementLevel as RequirementLevel)) {
    throw new FormBridgeError(`${where}.requirementLevel "${requirementLevel}" is not a RequirementLevel`);
  }
  const formId = str(raw, "formId", where);
  if (formId !== expectedFormId) {
    throw new FormBridgeError(`${where}.formId "${formId}" does not match the form "${expectedFormId}"`);
  }
  const id = str(raw, "id", where);
  if (!id.startsWith("fld:")) {
    throw new FormBridgeError(`${where} is not a fld: ID`);
  }
  return {
    id,
    formId,
    nativeName: nullableStr(raw, "nativeName"),
    visibleLabel: nullableStr(raw, "visibleLabel"),
    fieldType: str(raw, "fieldType", where),
    requiredStatus: requiredStatus as RequiredStatus,
    requirementLevel: requirementLevel as RequirementLevel,
    provenance: parseProvenance(raw["provenance"], `${where}.provenance`),
    ...(raw["labelProvenance"] !== undefined && raw["labelProvenance"] !== null
      ? { labelProvenance: parseProvenance(raw["labelProvenance"], `${where}.labelProvenance`) }
      : {}),
    ...(isObject(raw["bbox"]) ? { bbox: raw["bbox"] as Record<string, unknown> } : {}),
    ...(Array.isArray(raw["options"]) ? { options: raw["options"].map(String) } : {}),
    ...(optStr(raw, "semanticType") !== undefined ? { semanticType: optStr(raw, "semanticType") } : {}),
    ...(optStr(raw, "notes") !== undefined ? { notes: optStr(raw, "notes") } : {}),
  };
}

/**
 * Parse one extraction output file. `raw` is the parsed JSON of
 * `ExtractedForm.to_catalog_dict()`. Throws FormBridgeError naming every
 * rejected aspect — silently dropping a field would poison the catalog.
 */
export function parseExtractedForm(raw: unknown): ExtractedFormCatalog {
  if (!isObject(raw)) throw new FormBridgeError("document must be an object");
  const formRaw = raw["form"];
  const snapshotRaw = raw["snapshot"];
  if (!isObject(formRaw)) throw new FormBridgeError("form must be an object");
  if (!isObject(snapshotRaw)) throw new FormBridgeError("snapshot must be an object");

  const formId = str(formRaw, "id", "form");
  if (!formId.startsWith("form:")) {
    throw new FormBridgeError(`form.id "${formId}" is not a form: ID`);
  }
  const fillableClass = str(formRaw, "fillableClass", "form");
  if (!FILLABLE_CLASSES.includes(fillableClass as FillableClass)) {
    throw new FormBridgeError(`form.fillableClass "${fillableClass}" is not a FillableClass`);
  }

  const form: FormRecord = {
    id: formId,
    agency: str(formRaw, "agency", "form"),
    formNumber: nullableStr(formRaw, "formNumber"),
    title: str(formRaw, "title", "form"),
    sourceUrl: str(formRaw, "sourceUrl", "form"),
    sha256: str(formRaw, "sha256", "form"),
    pages: typeof formRaw["pages"] === "number" ? formRaw["pages"] : (() => {
      throw new FormBridgeError("form.pages must be a number");
    })(),
    fillableClass: fillableClass as FillableClass,
    ...(optStr(formRaw, "revisionDate") !== undefined ? { revisionDate: optStr(formRaw, "revisionDate") } : {}),
    ...(optStr(formRaw, "snapshotId") !== undefined ? { snapshotId: optStr(formRaw, "snapshotId") } : {}),
    ...(optStr(formRaw, "notes") !== undefined ? { notes: optStr(formRaw, "notes") } : {}),
  };

  const snapshot: SourceSnapshotRecord = {
    id: str(snapshotRaw, "id", "snapshot"),
    url: str(snapshotRaw, "url", "snapshot"),
    capturedAt: str(snapshotRaw, "capturedAt", "snapshot"),
    method: "http_fetch",
    sha256: str(snapshotRaw, "sha256", "snapshot"),
    ...(typeof snapshotRaw["httpStatus"] === "number" ? { httpStatus: snapshotRaw["httpStatus"] } : {}),
    ...(optStr(snapshotRaw, "storagePath") !== undefined ? { storagePath: optStr(snapshotRaw, "storagePath") } : {}),
    ...(optStr(snapshotRaw, "notes") !== undefined ? { notes: optStr(snapshotRaw, "notes") } : {}),
  };

  if (!Array.isArray(raw["fields"])) throw new FormBridgeError("fields must be an array");
  const fields = raw["fields"].map((field) => parseField(field, formId));

  return {
    schemaVersion: str(raw, "schemaVersion", "document"),
    generatedAt: str(raw, "generatedAt", "document"),
    form,
    fields,
    snapshot,
  };
}
