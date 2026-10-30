#!/usr/bin/env node
/**
 * Offline replay CLI: run the golden diff for every stored snapshot that has
 * a catalog expectation, without any network access — the stored snapshot is
 * the evidence, and integrity (artifact hashes + governance binding) is
 * re-verified for every row before it is classified.
 *
 *   npx tsx scripts/replay-snapshots.ts [--root fixtures/snapshots]
 *
 * Fails closed (non-zero exit) when: the root is unreadable or holds no
 * snapshots (exit 1), a snapshot could not be read (error rows, exit 1), any
 * matched diff has blocking failures (exit 1), or evidence is corrupted
 * (thrown, exit 2). Snapshots without a matching expectation are reported as
 * ungoverned, not failures — expectations grow with the catalog.
 */
import { DEFAULT_SNAPSHOT_ROOT, listSnapshotDirs } from "../src/lib/capture/store";
import { replayRoot } from "../src/lib/capture/replay";
import { APP_VERSION } from "../src/lib/health";
import { CAPTURE_SCHEMA_VERSION } from "../src/lib/capture/types";

function parseRoot(argv: string[]): string {
  const rootIdx = argv.indexOf("--root");
  if (rootIdx < 0) {
    return DEFAULT_SNAPSHOT_ROOT;
  }
  const value = argv[rootIdx + 1];
  // A valueless --root must error, not silently fall back: an operator typo
  // ("--root" as the last arg) would otherwise replay the wrong root.
  if (value === undefined || value.startsWith("--")) {
    console.error("error: --root requires a value, e.g. --root fixtures/snapshots");
    process.exit(2);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = parseRoot(args);

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
      case "error":
        return `${row.snapshotId}  ERROR  ${row.error ?? "could not be read"}`;
    }
  });

  console.log(
    `replay report — app ${APP_VERSION}, capture schema ${CAPTURE_SCHEMA_VERSION}, snapshots ${report.snapshotCount}, blocking failures ${report.blockingFailures}, unreadable ${report.errorCount}\n` +
      rows.join("\n"),
  );
  if (report.snapshotCount === 0) {
    const dirs = await listSnapshotDirs(root).catch(() => []);
    console.error(`error: no snapshots found under ${root} (${dirs.length} snap_* entries, none well-formed) — the replay gate fails closed`);
    process.exit(1);
  }
  process.exit(report.blockingFailures > 0 || report.errorCount > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
