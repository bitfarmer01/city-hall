#!/usr/bin/env node
/**
 * Offline replay CLI: run the golden diff for every stored snapshot that has
 * a catalog expectation, without any network access — the stored snapshot is
 * the evidence, and integrity is re-verified from artifact hashes.
 *
 *   npx tsx scripts/replay-snapshots.ts [--root fixtures/snapshots]
 *
 * Exits 1 when any matched diff has blocking failures (live form shows a
 * required field/document the catalog lacks). Snapshots without a matching
 * expectation are reported as ungoverned, not failures — expectations grow
 * with the catalog.
 */
import { replayRoot } from "../src/lib/capture/replay";
import { APP_VERSION } from "../src/lib/health";
import { CAPTURE_SCHEMA_VERSION } from "../src/lib/capture/types";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf("--root");
  const root = rootIdx >= 0 ? (args[rootIdx + 1] ?? "fixtures/snapshots") : "fixtures/snapshots";

  const report = await replayRoot(root);

  const rows = report.rows.map((row) => {
    switch (row.status) {
      case "skipped_boundary":
        return `${row.snapshotId}  ${row.stoppedAt?.padEnd(12)}  (skipped: ${row.captureMode})`;
      case "ungoverned":
        return `${row.snapshotId}  public_reachable  (ungoverned: no catalog expectation for ${row.url})`;
      case "fail":
        return [
          `${row.snapshotId}  FAIL (${row.failures.length} missed required entries)`,
          ...row.failures.map((f) => `         miss  ${f.kind}  ${f.detail}`),
          ...row.warnings.map((w) => `         warn  ${w.kind}  ${w.detail}`),
        ].join("\n");
      case "ok":
        return [
          `${row.snapshotId}  ok (${row.warnings.length} warnings)`,
          ...row.warnings.map((w) => `         warn  ${w.kind}  ${w.detail}`),
        ].join("\n");
    }
  });

  console.log(
    `replay report — app ${APP_VERSION}, capture schema ${CAPTURE_SCHEMA_VERSION}, snapshots ${report.snapshotCount}, blocking failures ${report.blockingFailures}\n` +
      rows.join("\n"),
  );
  process.exit(report.blockingFailures > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
