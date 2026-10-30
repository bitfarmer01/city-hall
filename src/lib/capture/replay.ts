import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { diffLiveMinusCatalog, hasBlockingFailures, parseExpectation } from "./golden";
import type { CatalogExpectation, GoldenFinding } from "./golden";
import { SNAPSHOT_DIR_PATTERN } from "./hash";
import { listSnapshotDirs, parseFieldDumpFromContents, readSnapshot } from "./store";
import { sanitizeForLog } from "./sanitize";
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
  /** The capture schema the snapshot was written under; null on error rows
   * (S4 M-3 — the CLI prints this per snapshot so version skew is visible). */
  captureSchema: string | null;
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
  /** Rows that could not be read at all (malformed snapshot directories).
   * Isolation contract (S1 M-C): per-snapshot failures are isolated into
   * error rows by design and do NOT throw — a consumer that checks only
   * blockingFailures will read a run with error rows as clean. Any consumer
   * deciding pass/fail MUST check errorCount (or use the CLI, which fails
   * non-zero on error rows). */
  errorCount: number;
  /** Root-level coverage-floor findings (M2): expectations that matched zero
   * governed snapshots, an expectations-but-nothing-governed root, or a strict
   * mode with zero governed rows. Also counted in blockingFailures so the
   * existing exit-code logic fails closed. */
  coverageFindings: string[];
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

export interface ReplayOptions {
  /** Strict mode (M2): also block when the root contains zero governed
   * snapshots even though no expectations exist yet — the opt-in arming of
   * the coverage floor until catalog expectations are committed. */
  strict?: boolean;
}

export async function replayRoot(root: string, options: ReplayOptions = {}): Promise<ReplayReport> {
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
        // The name came from the filesystem, not the codebase — escape it
        // before it lands in a row that the CLI prints (log-injection
        // hardening; the CLI re-sanitizes on print, idempotently).
        snapshotId: sanitizeForLog(entry.dirName),
        url: null,
        captureMode: null,
        stoppedAt: null,
        captureSchema: null,
        status: "error",
        failures: [],
        warnings: [],
        error: entry.isDirectory
          ? `not a valid snapshot directory name (expected ${SNAPSHOT_DIR_PATTERN})`
          : `snap_-prefixed entry is a file, not a snapshot directory`,
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
        captureSchema: meta.captureSchema,
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
        captureSchema: meta.captureSchema,
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
      captureSchema: meta.captureSchema,
      status: hasBlockingFailures(diff) ? "fail" : "ok",
      failures: diff.failures,
      warnings: diff.warnings,
    });
  }

  // Coverage floor (M2): a gate that passes when expectations match nothing
  // is a green light for an empty evidence set. These findings are root-level
  // — they do not belong to any single row — and count as blocking failures.
  const governedRows = rows.filter((r) => r.status === "ok" || r.status === "fail");
  const governedUrls = new Set(governedRows.map((r) => r.url));
  const coverageFindings: string[] = [];
  if (expectations.size > 0 && governedRows.length === 0) {
    coverageFindings.push(
      `coverage floor: ${expectations.size} expectation(s) exist but zero snapshots are governed by them`,
    );
  }
  for (const url of expectations.keys()) {
    if (!governedUrls.has(url)) {
      coverageFindings.push(`coverage floor: expectation URL ${url} matches zero governed snapshots`);
    }
  }
  if (options.strict && governedRows.length === 0) {
    coverageFindings.push("strict mode: this root contains zero governed snapshots");
  }

  return {
    rows,
    snapshotCount: dirs.length - errorCount,
    blockingFailures: blockingFailures + coverageFindings.length,
    errorCount,
    coverageFindings,
  };
}
