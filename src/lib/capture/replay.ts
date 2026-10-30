import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { diffLiveMinusCatalog, hasBlockingFailures, parseExpectation } from "./golden";
import type { CatalogExpectation, GoldenFinding } from "./golden";
import { SNAPSHOT_DIR_PATTERN } from "./hash";
import { listSnapshotDirs, parseFieldDumpFromContents, readSnapshot } from "./store";
import type { CaptureMode } from "./types";

/**
 * Offline replay core. Stored snapshots are the evidence: every row is read
 * through readSnapshot — which parses the meta, verifies every artifact hash,
 * and checks the governance binding — BEFORE the row is classified, so a
 * tampered snapshot fails the run whatever its capture mode claims. The
 * golden diff runs against committed catalog expectations with zero network
 * access. This is what Check B (zero-miss golden set) replays from in CI.
 */

export interface ReplayRow {
  snapshotId: string;
  /** null on error rows, where the snapshot could not be read at all. */
  url: string | null;
  /** null on error rows. */
  captureMode: CaptureMode | null;
  /** null when the page was publicly reachable. */
  stoppedAt: string | null;
  status: "skipped_boundary" | "ungoverned" | "ok" | "fail" | "error";
  failures: GoldenFinding[];
  warnings: GoldenFinding[];
  /** Set on error rows: why this directory could not be replayed as a snapshot. */
  error?: string;
}

export interface ReplayReport {
  rows: ReplayRow[];
  snapshotCount: number;
  blockingFailures: number;
  /** Rows that could not be read at all (malformed snapshot directories). */
  errorCount: number;
}

/**
 * Loads catalog expectation files (one JSON per service) from a directory.
 * A missing directory is the honest empty state — expectations grow with the
 * catalog — but an unreadable one or a present file that fails to parse is
 * evidence corruption and fails closed (H3).
 */
export async function loadExpectations(dir: string): Promise<Map<string, CatalogExpectation>> {
  const byUrl = new Map<string, CatalogExpectation>();
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return byUrl; // no expectations dir yet — everything reports ungoverned
    }
    throw err;
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
  const dirs = await listSnapshotDirs(root);
  if (dirs.length === 0) {
    // Fail closed: an empty (or missing) snapshot root means the evidence is
    // gone — replaying nothing must never read as a green gate (H3).
    throw new Error(`no snapshots found under ${root} — an empty snapshot root is an evidence failure, not a pass`);
  }

  let blockingFailures = 0;
  let errorCount = 0;
  const rows: ReplayRow[] = [];
  for (const entry of dirs) {
    // Directory-name junk (e.g. a stray snap_backup/) is isolated as an error
    // row (M5) — it cannot read as a snapshot, and the well-formed evidence
    // around it still replays. Content-level corruption inside a well-named
    // snapshot is a different thing entirely: readSnapshot below throws and
    // fails the whole run, because tampered evidence must halt the gate.
    if (entry.id === null) {
      errorCount++;
      rows.push({
        snapshotId: entry.dirName,
        url: null,
        captureMode: null,
        stoppedAt: null,
        status: "error",
        failures: [],
        warnings: [],
        error: `not a valid snapshot directory name (expected ${SNAPSHOT_DIR_PATTERN})`,
      });
      continue;
    }

    // Full verified read for EVERY row — ungoverned and boundary-stopped
    // snapshots get the same hash + governance verification as governed ones
    // (H2); classification only happens on evidence that survived it.
    const { snapshot: meta, contents } = await readSnapshot(root, entry.id);

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
    const dump = parseFieldDumpFromContents(contents);
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

  return { rows, snapshotCount: dirs.length - errorCount, blockingFailures, errorCount };
}
