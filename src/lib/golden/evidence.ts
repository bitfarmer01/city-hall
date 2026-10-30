import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CatalogExpectation, ExpectedField } from "../capture/golden";
import { readSnapshot } from "../capture/store";
import type { FormFieldDump } from "../capture/types";
import { collapseWhitespace, decodeHtmlEntities } from "../inventory/html-text";

/**
 * Offline evidence builder for Check B. The committed evidence is the record:
 * capture bundles are read through the integrity-verifying store (a tampered
 * bundle throws), and a PDF checklist's bytes are re-hashed against its
 * extraction record before the extracted fields may act as comparison
 * evidence. Everything here runs without network access.
 */

/** Visible text of a captured page — the in-person scan's input. */
export function htmlToText(html: string): string {
  const withoutInvisible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Block-level boundaries become newlines so sentence splitting sees them.
    .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article|td|th)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const text = decodeHtmlEntities(withoutInvisible.replace(/<[^>]+>/g, " "));
  return text
    .split("\n")
    .map((line) => collapseWhitespace(line))
    .filter((line) => line.length > 0)
    .join("\n");
}

export interface SnapshotEvidence {
  kind: "snapshot";
  dump: FormFieldDump;
  pageText: string | null;
  captureMode: "public_reachable" | "authenticated_unreachable";
  boundary: string;
}

export async function loadSnapshotEvidence(
  snapshotsRoot: string,
  snapshotId: string,
): Promise<SnapshotEvidence> {
  const { snapshot, contents } = await readSnapshot(snapshotsRoot, snapshotId);
  const dump = JSON.parse(contents.get("fields.json")!.toString("utf8")) as FormFieldDump;
  return {
    kind: "snapshot",
    dump,
    pageText: htmlToText(contents.get("page.html")!.toString("utf8")),
    captureMode: snapshot.captureMode,
    boundary: snapshot.stoppedAt,
  };
}

// ---------------------------------------------------------------------------
// PDF checklists — the comparison target for auth-gated services
// ---------------------------------------------------------------------------

/**
 * Extracted field record, mirroring python/pdf_extraction/model.py
 * FormField.to_dict() as stored in data/catalog/forms/*.catalog.json.
 * (Typed locally rather than importing the catalog module: the extraction
 * files are pipeline outputs, and the golden harness reads their stored shape.)
 */
export interface ExtractedFieldRecord {
  nativeName: string | null;
  visibleLabel: string | null;
  fieldType: string;
  requiredStatus: string;
}

export interface ExtractionRecord {
  form: { id: string; sha256: string; sourceUrl: string; pages: number };
  fields: ExtractedFieldRecord[];
}

/**
 * PDF field statuses that count as required evidence. The gate must not miss
 * a required field: author_declared_required is the PDF's own statement,
 * inferred_required the extractor's justified inference — both must be
 * cataloged. unknown/not_marked_required are non-gating.
 */
export const GATING_REQUIRED_STATUSES: ReadonlySet<string> = new Set([
  "author_declared_required",
  "inferred_required",
]);

/** Extracted PDF fields → the FormFieldDump vocabulary the diff speaks. */
export function extractedFieldsToDump(record: ExtractionRecord): FormFieldDump {
  const fields = record.fields.map((f) => {
    const tag = f.fieldType === "textarea" ? "textarea" : "input";
    return {
      tag,
      type: f.fieldType,
      name: f.nativeName ?? "",
      id: "",
      label: f.visibleLabel ?? f.nativeName ?? "",
      required: GATING_REQUIRED_STATUSES.has(f.requiredStatus),
      requiredMarker: false,
      options: [],
      optionsTotal: 0,
      accept: null,
      multiple: false,
    } satisfies FormFieldDump["fields"][number];
  });
  return {
    url: record.form.sourceUrl,
    capturedAt: "",
    fields,
    submitButtons: [],
  };
}

export function expectedFieldsFromExtraction(record: ExtractionRecord): ExpectedField[] {
  const dump = extractedFieldsToDump(record);
  const seen = new Map<string, ExpectedField>();
  for (const f of dump.fields) {
    const key = `${f.label.toLowerCase()}:${f.type}`;
    // A label seen optional first and required later collapses to required —
    // the baseline must claim at least as much as any duplicate requires.
    const existing = seen.get(key);
    if (!existing || (f.required && !existing.required)) {
      seen.set(key, { label: f.label, type: f.type, required: f.required });
    }
  }
  return [...seen.values()];
}

/**
 * Loads a committed PDF checklist: verifies the fixture bytes still hash to
 * the extraction record's sha256, then returns the record + derived dump.
 * A hash mismatch means the fixture and its baseline diverged — evidence
 * corruption, not a diff result.
 */
export async function loadPdfEvidence(
  repoRoot: string,
  pdfPath: string,
  extractionPath: string,
): Promise<{ record: ExtractionRecord; dump: FormFieldDump }> {
  const record = JSON.parse(await readFile(path.join(repoRoot, extractionPath), "utf8")) as ExtractionRecord;
  if (!record.form?.sha256 || !Array.isArray(record.fields)) {
    throw new Error(`extraction record ${extractionPath} is missing form.sha256 or fields`);
  }
  const pdfBytes = await readFile(path.join(repoRoot, pdfPath));
  const actual = createHash("sha256").update(pdfBytes).digest("hex");
  if (actual !== record.form.sha256) {
    throw new Error(
      `PDF fixture ${pdfPath} failed integrity: extraction record expects ${record.form.sha256}, got ${actual} — re-extract and re-baseline`,
    );
  }
  return { record, dump: extractedFieldsToDump(record) };
}

/** The diff needs the raw CatalogExpectation shape for PDF-backed targets. */
export function expectationFromExtraction(
  serviceId: string,
  label: string,
  record: ExtractionRecord,
): CatalogExpectation {
  return {
    serviceId,
    label,
    sourceUrl: record.form.sourceUrl,
    expectedFields: expectedFieldsFromExtraction(record),
    expectedDocuments: [],
  };
}
