// The single loader for the committed catalog bundle. Parse-strict, like
// the inventory snapshot's parseSnapshotJson (panel review, finding 1): a
// shape drift throws instead of silently resolving against a partial
// catalog. Callers: the resolver tests, the golden harness, and — later —
// the API surfaces.

import { readFileSync } from "node:fs";

import type { CatalogBundle } from "../catalog/types";

const DEFAULT_CATALOG_FILE = "data/catalog/catalog.json";

/** Minimal structural validation — presence and base types of the fields the resolver reads. */
function assertBundleShape(value: unknown, path: string): CatalogBundle {
  const record = value as Record<string, unknown>;
  // The variable annotation (not just the arrow's return type) is what lets
  // the compiler narrow after `if (bad) fail(...)` — keep it on the const.
  const fail: (what: string) => never = (what) => {
    throw new Error(`${path}: catalog bundle ${what} is missing or malformed`);
  };

  if (typeof record.schemaVersion !== "string" || record.schemaVersion.length === 0) fail("schemaVersion");
  if (typeof record.catalogVersion !== "string" || record.catalogVersion.length === 0) fail("catalogVersion");
  if (!Array.isArray(record.services)) fail("services array");
  for (const service of record.services as Record<string, unknown>[]) {
    const meta = service.meta as Record<string, unknown> | undefined;
    if (!meta || typeof meta.catalogId !== "string") fail("service meta.catalogId");
    if (typeof meta.domain !== "string") fail(`service ${String(meta.catalogId)} meta.domain`);
    if (!service.envelope) fail(`service ${String(meta.catalogId)} envelope`);
  }
  if (!Array.isArray(record.crosswalks)) fail("crosswalks array");

  return record as unknown as CatalogBundle;
}

export function loadCatalogBundle(path: string = DEFAULT_CATALOG_FILE): CatalogBundle {
  return assertBundleShape(JSON.parse(readFileSync(path, "utf8")), path);
}
