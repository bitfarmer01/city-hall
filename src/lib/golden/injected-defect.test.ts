import path from "node:path";

import { describe, expect, it } from "vitest";

import { diffLiveMinusCatalog } from "../capture/golden";
import { loadCatalogIndex } from "./catalog-index";
import { runCheckB } from "./check";
import { loadGoldenSet } from "./manifest";
import type { GoldenSet } from "./types";
import type { FormFieldDump } from "../capture/types";

/**
 * The DoD's injected-defect property (art_wJiwwN0o §4b / spec D10): "remove a
 * golden field → check B fails." Split by what committed evidence can prove:
 *
 *  - Real evidence: the committed set passes; dropping a baseline's in-person
 *    claims (the claim class the corpus actually carries) fails the gate.
 *  - Synthetic evidence: a live dump carrying a required field the baseline
 *    lacks fails the gate with live_only_required. The committed corpus has
 *    no author-declared-required fields (PDF forms mark none, article DOMs
 *    carry no required inputs), so the required-field miss is demonstrated
 *    against a synthetic dump rather than faked on real data.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SNAPSHOTS_ROOT = path.join(REPO_ROOT, "data", "golden", "captures");
const CATALOG_PATH = path.join(REPO_ROOT, "data", "catalog", "catalog.json");

const PW1_EXPECTATION = "data/golden/expectations/svc-buildings-building-construction-alteration-permit--pdf-pw1.json";
const BIRTH_ARTICLE = "data/golden/expectations/svc-dohmh-birth-certificate-order--article.json";

describe("Check B injected-defect property", () => {
  it("passes the gate on committed evidence as seeded", async () => {
    const { set, expectations } = await loadGoldenSet(REPO_ROOT);
    const catalog = await loadCatalogIndex(CATALOG_PATH);
    const { report } = await runCheckB(set, expectations, { repoRoot: REPO_ROOT, snapshotsRoot: SNAPSHOTS_ROOT }, catalog);
    expect(report.gate.passed).toBe(true);
    expect(report.gate.failureCount).toBe(0);
    expect(report.domainSpread.ok).toBe(true);
    expect(report.totals.services).toBe(20);
    expect(report.totals.targets).toBe(27);
  }, 30_000);

  it("fails when a golden baseline drops an in-person claim (real committed evidence)", async () => {
    const { set, expectations } = await loadGoldenSet(REPO_ROOT);
    const target = set.services.flatMap((s) => s.targets).find((t) => t.expectationFile === BIRTH_ARTICLE);
    expect(target, "birth-certificate article expectation must be in the manifest").toBeDefined();

    const original = expectations.get(BIRTH_ARTICLE)!;
    expect(original.inPersonSteps.length, "birth baseline must claim in-person signals").toBeGreaterThan(0);

    const mutated = new Map(expectations);
    mutated.set(BIRTH_ARTICLE, { ...original, inPersonSteps: [] });
    const catalog = await loadCatalogIndex(CATALOG_PATH);
    const { report } = await runCheckB(set, mutated, { repoRoot: REPO_ROOT, snapshotsRoot: SNAPSHOTS_ROOT }, catalog);

    expect(report.gate.passed).toBe(false);
    const row = report.rows.find((r) => r.targetId === "article" && r.serviceId === "svc:dohmh:birth-certificate-order");
    expect(row?.findings.failures.some((f) => f.key.startsWith("in-person:"))).toBe(true);
  }, 30_000);

  it("fails when a live dump carries a required field the baseline lacks (synthetic)", async () => {
    const { expectations } = await loadGoldenSet(REPO_ROOT);
    const expectation = expectations.get(BIRTH_ARTICLE)!;

    // Synthetic live evidence: one required field the baseline does not name.
    const dump: FormFieldDump = {
      url: "https://portal.311.nyc.gov/article/?kanumber=KA-01012",
      capturedAt: "2026-10-30T00:00:00.000Z",
      fields: [
        {
          tag: "input", type: "text", name: "death_cert_number", id: "dcn", label: "Death certificate number",
          required: true, requiredMarker: false, options: [], optionsTotal: 0, accept: null, multiple: false,
        },
      ],
      submitButtons: [],
    };
    const diff = diffLiveMinusCatalog(dump, expectation);
    expect(diff.failures.some((f) => f.reason === "live_only_required" && f.key.includes("death certificate number"))).toBe(true);
  }, 30_000);

  it("keeps optional-only gaps non-gating (warnings), per the spec", async () => {
    const { expectations } = await loadGoldenSet(REPO_ROOT);
    const expectation = expectations.get(BIRTH_ARTICLE)!;

    const dump: FormFieldDump = {
      url: "https://portal.311.nyc.gov/article/?kanumber=KA-01012",
      capturedAt: "2026-10-30T00:00:00.000Z",
      fields: [
        {
          tag: "input", type: "text", name: "optional_field", id: "opt", label: "An optional field",
          required: false, requiredMarker: false, options: [], optionsTotal: 0, accept: null, multiple: false,
        },
      ],
      submitButtons: [],
    };
    const diff = diffLiveMinusCatalog(dump, expectation);
    expect(diff.failures).toHaveLength(0);
    expect(diff.warnings.length).toBeGreaterThan(0);
  }, 30_000);

  it("rejects a catalog-backed service whose domain drifts from the catalog", async () => {
    const { set, expectations } = await loadGoldenSet(REPO_ROOT);
    const catalog = await loadCatalogIndex(CATALOG_PATH);
    // The dog license is catalog-backed as licensing; claiming it under
    // permits must be rejected, not silently scored.
    const drifted: GoldenSet = {
      ...set,
      services: set.services.map((s) =>
        s.serviceId === "svc:dohmh:dog-license" ? { ...s, domain: "permits" as const } : s,
      ),
    };
    await expect(
      runCheckB(drifted, expectations, { repoRoot: REPO_ROOT, snapshotsRoot: SNAPSHOTS_ROOT }, catalog),
    ).rejects.toThrow(/disagrees/);
  }, 30_000);

  it("documents the PW1 baseline's honest required-ness (no author-declared required fields)", async () => {
    const { expectations } = await loadGoldenSet(REPO_ROOT);
    const pw1 = expectations.get(PW1_EXPECTATION)!;
    expect(pw1.expectedFields.length).toBeGreaterThan(200);
    expect(pw1.expectedFields.every((f) => !f.required)).toBe(true);
  }, 30_000);
});
