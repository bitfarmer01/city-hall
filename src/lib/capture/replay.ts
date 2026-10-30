import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { diffLiveMinusCatalog, hasBlockingFailures, parseExpectation } from "./golden";
import type { CatalogExpectation, GoldenFinding } from "./golden";
import { listSnapshotIds, readFieldDump, readSnapshotMeta } from "./store";
import type { CaptureMode } from "./types";

/**
 * Offline replay core. Stored snapshots are the evidence: every read
 * re-verifies artifact hashes, and the golden diff runs against committed
 * catalog expectations with zero network access. This is what Check B
 * (zero-miss golden set) replays from in CI.
 */

export interface ReplayRow {
  snapshotId: string;
  url: string;
  captureMode: CaptureMode;
  /** null when the page was publicly reachable. */
  stoppedAt: string | null;
  status: "skipped_boundary" | "ungoverned" | "ok" | "fail";
  failures: GoldenFinding[];
  warnings: GoldenFinding[];
}

export interface ReplayReport {
  rows: ReplayRow[];
  snapshotCount: number;
  blockingFailures: number;
}

/**
 * Loads catalog expectation files (one JSON per service) from a directory.
 * A missing directory is the honest empty state — expectations grow with the
 * catalog — but a present file that fails to parse is evidence corruption.
 */
export async function loadExpectations(dir: string): Promise<Map<string, CatalogExpectation>> {
  const byUrl = new Map<string, CatalogExpectation>();
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return byUrl; // no expectations dir yet — everything reports ungoverned
  }
  for (const name of names) {
    const raw = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    const expectation = parseExpectation(raw);
    byUrl.set(expectation.sourceUrl, expectation);
  }
  return byUrl;
}

export async function replayRoot(root: string): Promise<ReplayReport> {
  const expectations = await loadExpectations(path.join(root, "expectations"));
  const ids = await listSnapshotIds(root);

  let blockingFailures = 0;
  const rows: ReplayRow[] = [];
  for (const id of ids) {
    const meta = await readSnapshotMeta(root, id); // re-verifies integrity hashes
    if (meta.captureMode !== "public_reachable") {
      rows.push({
        snapshotId: meta.id,
        url: meta.url,
        captureMode: meta.captureMode,
        stoppedAt: meta.stoppedAt,
        status: "skipped_boundary",
        failures: [],
        warnings: [],
      });
      continue;
    }
    const expectation = expectations.get(meta.url);
    if (!expectation) {
      rows.push({
        snapshotId: meta.id,
        url: meta.url,
        captureMode: meta.captureMode,
        stoppedAt: null,
        status: "ungoverned",
        failures: [],
        warnings: [],
      });
      continue;
    }
    const dump = await readFieldDump(root, id);
    const diff = diffLiveMinusCatalog(dump, expectation);
    if (hasBlockingFailures(diff)) {
      blockingFailures += diff.failures.length;
    }
    rows.push({
      snapshotId: meta.id,
      url: meta.url,
      captureMode: meta.captureMode,
      stoppedAt: null,
      status: hasBlockingFailures(diff) ? "fail" : "ok",
      failures: diff.failures,
      warnings: diff.warnings,
    });
  }

  return { rows, snapshotCount: ids.length, blockingFailures };
}
