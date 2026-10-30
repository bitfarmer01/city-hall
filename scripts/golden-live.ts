/**
 * Check B CLI — weekly live drift leg (spec D10b).
 *
 * Re-captures every public page/portal target through the public-boundary
 * driver (never bypassing or retrying stops), diffs fresh evidence against
 * the committed baselines, and re-hashes PDF fixtures against upstream —
 * because forms and pages drift without any code change. Writes bundles to
 * a gitignored scratch root so committed evidence stays pristine.
 *
 * Exit 1 when a live target misses a required field/document/in-person step,
 * or when a PDF's upstream bytes no longer hash to its extraction record.
 * Output: a markdown report for the weekly artifact + a JSON summary line.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { loadCatalogIndex } from "../src/lib/golden/catalog-index";
import { captureAndDiffTarget } from "../src/lib/golden/live";
import { loadGoldenSet } from "../src/lib/golden/manifest";
import type { CheckBReport } from "../src/lib/golden/types";

const ROOT = path.resolve(import.meta.dirname, "..");
const LIVE_ROOT = path.join(ROOT, "fixtures", "golden-live");
const CATALOG_PATH = path.join(ROOT, "data/catalog/catalog.json");
const REPORT_PATH = path.join(ROOT, "data/golden/weekly-report.md");

interface PdfDrift {
  serviceId: string;
  targetId: string;
  url: string;
  expectedSha: string | null;
  actualSha: string | null;
  note: string;
}

async function checkPdfDrift(set: Awaited<ReturnType<typeof loadGoldenSet>>["set"]): Promise<PdfDrift[]> {
  const drift: PdfDrift[] = [];
  for (const service of set.services) {
    for (const target of service.targets) {
      if (target.kind !== "pdf_checklist") continue;
      try {
        const res = await fetch(target.url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) {
          drift.push({ serviceId: service.serviceId, targetId: target.id, url: target.url, expectedSha: null, actualSha: null, note: `upstream returned HTTP ${res.status}` });
          continue;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const actual = createHash("sha256").update(bytes).digest("hex");
        const record = JSON.parse(await readFile(path.join(ROOT, target.extractionPath!), "utf8")) as { form: { sha256: string } };
        if (actual !== record.form.sha256) {
          drift.push({
            serviceId: service.serviceId, targetId: target.id, url: target.url,
            expectedSha: record.form.sha256, actualSha: actual,
            note: "upstream bytes differ from the extraction record — re-extract and re-baseline (human review)",
          });
        }
      } catch (err) {
        drift.push({
          serviceId: service.serviceId, targetId: target.id, url: target.url,
          expectedSha: null, actualSha: null,
          note: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }
  return drift;
}

async function main() {
  const { set, expectations } = await loadGoldenSet(ROOT);
  const catalog = await loadCatalogIndex(CATALOG_PATH);
  await mkdir(path.join(LIVE_ROOT, "bundles"), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const rows: CheckBReport["rows"] = [];

  try {
    for (const service of set.services) {
      for (const target of service.targets) {
        if (target.kind === "pdf_checklist") continue; // covered by the drift check
        const expectation = expectations.get(target.expectationFile);
        if (!expectation) throw new Error(`missing expectation ${target.expectationFile}`);
        const { row } = await captureAndDiffTarget(page, target, expectation, service, path.join(LIVE_ROOT, "bundles"));
        rows.push(row);
        console.log(`${row.status.padEnd(18)} ${service.serviceId}/${target.id}${row.note ? ` — ${row.note}` : ""}`);
        await new Promise((r) => setTimeout(r, 1000)); // polite pacing
      }
    }
  } finally {
    await browser.close();
  }

  const pdfDrift = await checkPdfDrift(set);

  const failed = rows.filter((r) => r.status === "fail").length;
  const failedPdf = pdfDrift.length > 0;
  const passed = failed === 0 && !failedPdf;

  const lines: string[] = [];
  lines.push(`# Check B weekly live report — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Catalog ${catalog.version} · golden-set ${set.schemaVersion} · ${set.services.length} services`);
  lines.push("");
  lines.push(`**Gate: ${passed ? "PASS" : "FAIL"}** — ${failed} missed live-minus-catalog, ${pdfDrift.length} PDF drift findings.`);
  lines.push("");
  if (failed > 0) {
    lines.push("## Misses (zero is the gate)");
    lines.push("");
    for (const row of rows) {
      for (const f of row.findings.failures) {
        lines.push(`- \`${row.serviceId}/${row.targetId}\` ${f.kind} ${f.reason}: ${f.key} — ${f.detail}`);
      }
    }
    lines.push("");
  }
  if (pdfDrift.length > 0) {
    lines.push("## PDF upstream drift (re-extract + human-reviewed re-baseline required)");
    lines.push("");
    for (const d of pdfDrift) {
      lines.push(`- \`${d.serviceId}/${d.targetId}\` ${d.url} — ${d.note}`);
    }
    lines.push("");
  }
  lines.push("## Per-target status");
  lines.push("");
  for (const row of rows) {
    lines.push(`- ${row.status} \`${row.serviceId}/${row.targetId}\`${row.note ? ` — ${row.note}` : ""}`);
  }

  console.log(`\n${lines.join("\n")}`);
  console.log(JSON.stringify({ gate: { passed, failed, failedPdf }, totals: { services: set.services.length, targets: rows.length } }));

  if (process.argv.includes("--write-report")) {
    await writeFile(REPORT_PATH, `${lines.join("\n")}\n`);
    console.log(`\nreport written to ${REPORT_PATH}`);
  }
  if (!passed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
