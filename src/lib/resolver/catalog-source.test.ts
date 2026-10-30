// Catalog loader negative paths (S3 finding M9): the parse-strict loader
// must THROW on shape drift — a partial catalog must never silently reach
// the resolver. Each case asserts the throw AND its exact message, which
// names the drifted field for the operator.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCatalogBundle } from "./catalog-source";

const VALID_BUNDLE = {
  schemaVersion: "1.0.0",
  catalogVersion: "2026-10-30.1",
  services: [
    {
      meta: { catalogId: "svc:test:thing", domain: "licensing" },
      envelope: { name: "Thing" },
    },
  ],
  crosswalks: [],
};

let scratchDir: string;

function writeBundle(content: unknown): string {
  scratchDir = mkdtempSync(join(tmpdir(), "catalog-source-"));
  const path = join(scratchDir, "catalog.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

afterEach(() => {
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("loadCatalogBundle — fail closed on shape drift (S3 finding M9)", () => {
  it("loads a well-formed bundle unchanged (positive control)", () => {
    const path = writeBundle(VALID_BUNDLE);
    const bundle = loadCatalogBundle(path);
    expect(bundle.catalogVersion).toBe("2026-10-30.1");
    expect(bundle.services).toHaveLength(1);
  });

  it.each([
    ["missing schemaVersion", { schemaVersion: undefined }, "schemaVersion"],
    ["non-string schemaVersion", { schemaVersion: 3 }, "schemaVersion"],
    ["empty catalogVersion", { catalogVersion: "" }, "catalogVersion"],
    ["services not an array", { services: {} }, "services array"],
    ["service without meta", { services: [{ envelope: { name: "Thing" } }] }, "service meta.catalogId"],
    [
      "service without meta.catalogId",
      { services: [{ meta: { domain: "licensing" }, envelope: { name: "Thing" } }] },
      "service meta.catalogId",
    ],
    [
      "service without envelope",
      { services: [{ meta: { catalogId: "svc:test:thing", domain: "licensing" } }] },
      "service svc:test:thing envelope",
    ],
    ["missing crosswalks", { crosswalks: undefined }, "crosswalks array"],
  ])("shape drift (%s) throws with the field named in the message", (_label, overrides, what) => {
    const path = writeBundle({ ...VALID_BUNDLE, ...overrides });

    let message = "";
    try {
      loadCatalogBundle(path);
    } catch (caught) {
      message = (caught as Error).message;
    }

    expect(message).toBe(`${path}: catalog bundle ${what} is missing or malformed`);
  });
});
