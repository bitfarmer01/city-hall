/**
 * Check B CLI — zero-miss golden set, offline leg (spec D10b).
 *
 * Runs entirely on committed evidence: manifest, capture bundles, PDF
 * fixtures, extraction records, catalog bundle. Green = zero missed required
 * fields, documents, or in-person steps across the golden set, and all five
 * coverage domains present. Exit 1 otherwise. Wired to CI on catalog PRs.
 */
import path from "node:path";

import { loadCatalogIndex } from "../src/lib/golden/catalog-index";
import { runCheckB } from "../src/lib/golden/check";
import { loadGoldenSet } from "../src/lib/golden/manifest";
import type { CheckBReport } from "../src/lib/golden/types";

const ROOT = path.resolve(import.meta.dirname, "..");
const SNAPSHOTS_ROOT = path.join(ROOT, "data", "golden", "captures");
const CATALOG_PATH = path.join(ROOT, "data/catalog/catalog.json");

export async function runOfflineCheck(): Promise<{ report: CheckBReport; passed: boolean }> {
  const { set, expectations } = await loadGoldenSet(ROOT);
  const catalog = await loadCatalogIndex(CATALOG_PATH);
  const { report } = await runCheckB(set, expectations, { repoRoot: ROOT, snapshotsRoot: SNAPSHOTS_ROOT }, catalog);
  return { report, passed: report.gate.passed };
}

async function main() {
  const { report, passed } = await runOfflineCheck();

  console.log(`Check B — zero-miss golden set (${report.totals.services} services, ${report.totals.targets} targets)`);
  console.log(`versions: golden-set ${report.versions.goldenSetSchema} · capture ${report.versions.captureSchema} · catalog ${report.versions.catalog ?? "n/a"}`);
  console.log("");
  for (const d of report.perDomain) {
    console.log(
      `  ${d.domain.padEnd(16)} services=${d.services} ok=${d.ok} failed=${d.failed} boundary=${d.skippedBoundary} unverifiable=${d.unverifiable}`,
    );
  }
  console.log(
    `\ntotals: ok=${report.totals.ok} failed=${report.totals.failed} skipped(boundary)=${report.totals.skippedBoundary} unverifiable=${report.totals.unverifiable}`,
  );
  console.log(`domain spread: ${report.domainSpread.ok ? "all five present" : `MISSING ${report.domainSpread.missing.join(", ")}`}`);

  if (report.totals.failed > 0) {
    console.log("\nFAILURES (live-minus-catalog misses — zero is the gate):");
    for (const row of report.rows) {
      for (const f of row.findings.failures) {
        console.log(`  [${row.serviceId}/${row.targetId}] ${f.kind} ${f.reason}: ${f.key} — ${f.detail}`);
      }
    }
  }
  const warnings = report.rows.flatMap((r) => r.findings.warnings);
  if (warnings.length > 0) {
    console.log("\nwarnings (extra catalog entries — non-gating):");
    for (const row of report.rows) {
      for (const w of row.findings.warnings) {
        console.log(`  [${row.serviceId}/${row.targetId}] ${w.key} — ${w.detail}`);
      }
    }
  }

  console.log(`\ngate: ${passed ? "PASS" : "FAIL"} (${report.gate.failureCount} failures)`);
  console.log(JSON.stringify({ gate: report.gate, domainSpread: report.domainSpread, totals: report.totals, versions: report.versions }));
  if (!passed) process.exit(1);
}

// Run only when invoked directly, so tests can import runOfflineCheck.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
