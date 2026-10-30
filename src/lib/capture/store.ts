import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseFieldDump } from "./formdump";
import { bundleSha256, sha256Hex, snapshotDirName, snapshotIdFromDirName } from "./hash";
import type { ArtifactName, BoundaryKind, CaptureMethod, CaptureMode, FormFieldDump, SnapshotArtifact, SourceSnapshot } from "./types";
import { CAPTURE_SCHEMA_VERSION } from "./types";

/**
 * Content-addressed snapshot store. Layout on disk:
 *
 *   <rootDir>/snap_<hex12>/meta.json        — the SourceSnapshot record
 *   <rootDir>/snap_<hex12>/page.html        — rendered HTML
 *   <rootDir>/snap_<hex12>/screenshot.png   — full-page screenshot
 *   <rootDir>/snap_<hex12>/fields.json      — DOM form-field dump
 *   <rootDir>/snap_<hex12>/network.json     — bounded request log
 *
 * The id is derived from the artifact bytes; reads re-verify every hash, so a
 * tampered or truncated snapshot fails loudly instead of poisoning the
 * golden-diff harness.
 */

const REQUIRED_ARTIFACTS: readonly ArtifactName[] = ["fields.json", "page.html", "screenshot.png"];

export interface SnapshotMetaInput {
  url: string;
  resolvedUrl: string;
  capturedAt: string;
  method: CaptureMethod;
  httpStatus: number;
  captureMode: CaptureMode;
  stoppedAt: BoundaryKind;
  boundarySignals: string[];
  notes: string | null;
}

export interface BuiltSnapshot {
  snapshot: SourceSnapshot;
  contents: Map<string, Buffer>;
}

export function buildSourceSnapshot(
  meta: SnapshotMetaInput,
  artifacts: ReadonlyArray<{ name: string; bytes: Buffer }>,
): BuiltSnapshot {
  if (artifacts.length === 0) {
    throw new Error("a snapshot needs at least one artifact");
  }
  const hashed: SnapshotArtifact[] = artifacts.map((a) => ({
    name: a.name,
    sha256: sha256Hex(a.bytes),
    bytes: a.bytes.length,
  }));
  const bundle = bundleSha256(hashed);
  const snapshot: SourceSnapshot = {
    id: `snap:${bundle.slice(0, 12)}`,
    ...meta,
    artifacts: hashed,
  };
  return {
    snapshot,
    contents: new Map(artifacts.map((a) => [a.name, a.bytes])),
  };
}

export async function writeSnapshot(
  rootDir: string,
  built: BuiltSnapshot,
): Promise<string> {
  const dir = path.join(rootDir, snapshotDirName(built.snapshot.id));
  const metaPath = path.join(dir, "meta.json");
  const metaJson = JSON.stringify({ ...built.snapshot, captureSchema: CAPTURE_SCHEMA_VERSION }, null, 2) + "\n";

  let exists = false;
  try {
    await stat(dir);
    exists = true;
  } catch {
    // not written yet — expected on first capture
  }
  if (exists) {
    const existing = await readFile(metaPath, "utf8");
    if (existing !== metaJson) {
      throw new Error(
        `snapshot id collision at ${dir}: existing bundle differs from new capture under the same content id`,
      );
    }
    return dir; // idempotent: identical content already stored
  }

  await mkdir(dir, { recursive: true });
  await writeFile(metaPath, metaJson, "utf8");
  for (const [name, bytes] of built.contents) {
    await writeFile(path.join(dir, name), bytes);
  }
  return dir;
}

export interface ReadSnapshot {
  snapshot: SourceSnapshot;
  contents: Map<string, Buffer>;
}

export async function readSnapshot(rootDir: string, id: string): Promise<ReadSnapshot> {
  const dir = path.join(rootDir, snapshotDirName(id));
  const meta = await readSnapshotMeta(rootDir, id);
  const contents = new Map<string, Buffer>();
  for (const artifact of meta.artifacts) {
    contents.set(artifact.name, await readFile(path.join(dir, artifact.name)));
  }
  verifyIntegrity(meta, contents);
  return { snapshot: meta, contents };
}

export async function readSnapshotMeta(rootDir: string, id: string): Promise<SourceSnapshot> {
  const dir = path.join(rootDir, snapshotDirName(id));
  const raw = await readFile(path.join(dir, "meta.json"), "utf8");
  return parseSnapshotMeta(JSON.parse(raw) as unknown);
}

/** Field dump for a snapshot, parsed through the same validation as capture time. */
export async function readFieldDump(rootDir: string, id: string): Promise<FormFieldDump> {
  const { contents } = await readSnapshot(rootDir, id);
  return parseFieldDump(JSON.parse(contents.get("fields.json")!.toString("utf8")) as unknown);
}

export async function listSnapshotIds(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith("snap_"))
    .map((e) => snapshotIdFromDirName(e.name))
    .sort();
}

function verifyIntegrity(meta: SourceSnapshot, contents: Map<string, Buffer>): void {
  for (const artifact of meta.artifacts) {
    const bytes = contents.get(artifact.name);
    if (bytes === undefined) {
      throw new Error(`snapshot ${meta.id} is missing artifact ${artifact.name}`);
    }
    const actual = sha256Hex(bytes);
    if (actual !== artifact.sha256) {
      throw new Error(
        `snapshot ${meta.id} artifact ${artifact.name} failed integrity: expected ${artifact.sha256}, got ${actual}`,
      );
    }
  }
  const recomputed = bundleSha256(meta.artifacts);
  if (`snap:${recomputed.slice(0, 12)}` !== meta.id) {
    throw new Error(`snapshot ${meta.id} bundle hash does not match its id`);
  }
}

export function parseSnapshotMeta(raw: unknown): SourceSnapshot {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`snapshot meta must be an object, got ${typeof raw}`);
  }
  const m = raw as Record<string, unknown>;
  const artifacts = m.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error("snapshot meta has no artifacts");
  }
  return {
    id: requireString(m.id, "meta.id"),
    url: requireString(m.url, "meta.url"),
    resolvedUrl: requireString(m.resolvedUrl, "meta.resolvedUrl"),
    capturedAt: requireString(m.capturedAt, "meta.capturedAt"),
    method: requireString(m.method, "meta.method") as CaptureMethod,
    httpStatus: typeof m.httpStatus === "number" ? m.httpStatus : 0,
    captureMode: requireString(m.captureMode, "meta.captureMode") as CaptureMode,
    stoppedAt: requireString(m.stoppedAt, "meta.stoppedAt") as BoundaryKind,
    boundarySignals: Array.isArray(m.boundarySignals)
      ? m.boundarySignals.map((s) => requireString(s, "meta.boundarySignals entry"))
      : [],
    notes: typeof m.notes === "string" ? m.notes : null,
    artifacts: artifacts.map((a) => {
      const a2 = a as Record<string, unknown>;
      return {
        name: requireString(a2.name, "artifact.name"),
        sha256: requireString(a2.sha256, "artifact.sha256"),
        bytes: typeof a2.bytes === "number" ? a2.bytes : 0,
      };
    }),
  };
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new Error(`${what} must be a string, got ${typeof value}`);
  }
  return value;
}

// Canonical artifact set every snapshot must carry.
export const REQUIRED_ARTIFACT_NAMES: readonly ArtifactName[] = REQUIRED_ARTIFACTS;
