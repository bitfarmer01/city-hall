#!/usr/bin/env node
/**
 * Offline replay: run the golden diff for every stored snapshot that has a
 * catalog expectation, without any network access — the stored snapshot is
 * the evidence, and integrity is re-verified from artifact hashes.
 *
 *   npx tsx scripts/replay-snapshots.ts [--root fixtures/portal]
 *
 * Exits 1 when any matched diff has blocking failures (live form shows a
 * required field/document the catalog lacks). Snapshots without a matching
 * expectation are reported as ungoverned, not failures — expectations grow
 * with the catalog.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { APP_VERSION } from "../src/lib/health";
import { diffLiveMinusCatalog, hasBlockingFailures, parseExpectation } from "../src/lib/capture/golden";
import { listSnapshotIds, readFieldDump, readSnapshotMeta } from "../src/lib/capture/store";
import { CAPTURE_SCHEMA_VERSION } from "../src/lib/capture/types";

async function loadExpectations(dir: string): Promise<Map<string, ReturnType<typeof parseExpectation>>> {
  const byUrl = new Map<string, ReturnType<typeof parseExpectation>>();
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return byUrl; // no expectations dir yet — everything reports ungoverned
  }
  for (const name of names) {
    const expectation = parseExpectation(JSON.parse(await readFile(path.join(dir, name), "utf8")) as unknown);
    byUrl.set(expectation.sourceUrl, expectation);
  }
  return byUrl;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf("--root");
  const root = rootIdx >= 0 ? (args[rootIdx + 1] ?? "fixtures/portal") : "fixtures/portal";

  const expectations = await loadExpectations(path.join(root, "expectations"));
  const ids = await listSnapshotIds(root);

  let failures = 0;
  const rows: string[] = [];
  for (const id of ids) {
    const meta = await readSnapshotMeta(root, id); // re-verifies integrity hashes
    const expectation = expectations.get(meta.url);
    if (meta.captureMode !== "public_reachable") {
      rows.push(`${meta.id}  ${meta.stoppedAt.padEnd(12)}  (skipped: ${meta.captureMode})`);
      continue;
    }
    if (!expectation) {
      rows.push(`${meta.id}  public_reachable  (ungoverned: no catalog expectation for ${meta.url})`);
      continue;
    }
    const dump = await readFieldDump(root, id);
    const diff = diffLiveMinusCatalog(dump, expectation);
    if (hasBlockingFailures(diff)) {
      failures += diff.failures.length;
      rows.push(`${meta.id}  FAIL (${diff.failures.length} missed required entries)`);
      for (const f of diff.failures) rows.push(`         miss  ${f.kind}  ${f.detail}`);
    } else {
      rows.push(`${meta.id}  ok (${diff.warnings.length} warnings)`);
    }
    for (const w of diff.warnings) rows.push(`         warn  ${w.kind}  ${w.detail}`);
  }

  console.log(
    `replay report — app ${APP_VERSION}, capture schema ${CAPTURE_SCHEMA_VERSION}, snapshots ${ids.length}, blocking failures ${failures}\n` +
      rows.join("\n"),
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
