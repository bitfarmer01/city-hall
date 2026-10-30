import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { parseFieldDump } from "./formdump";
import {
  bundleSha256,
  sha256Hex,
  snapshotDirName,
  snapshotIdFromDirName,
  SNAPSHOT_DIR_PATTERN,
  SNAPSHOT_ID_PATTERN,
} from "./hash";
import type {
  ArtifactName,
  BoundaryKind,
  CaptureMethod,
  CaptureMode,
  FormFieldDump,
  GovernanceFields,
  SnapshotArtifact,
  SourceSnapshot,
} from "./types";
import {
  ARTIFACT_NAMES,
  BOUNDARY_KINDS,
  CAPTURE_METHODS,
  CAPTURE_MODES,
  CAPTURE_SCHEMA_VERSION,
  GOVERNANCE_ARTIFACT_NAME,
} from "./types";

/**
 * Content-addressed snapshot store. Layout on disk:
 *
 *   <rootDir>/snap_<hex12>/meta.json        — the SourceSnapshot record
 *   <rootDir>/snap_<hex12>/page.html        — rendered HTML
 *   <rootDir>/snap_<hex12>/screenshot.png   — full-page screenshot
 *   <rootDir>/snap_<hex12>/fields.json      — DOM form-field dump
 *   <rootDir>/snap_<hex12>/network.json     — bounded request log
 *   <rootDir>/snap_<hex12>/governance.json  — canonical serialization of the
 *                                             governance fields, hashed like
 *                                             any other artifact
 *
 * The id is derived from the artifact bytes INCLUDING governance.json, so the
 * fields that decide governance (url, captureMode, stoppedAt, boundarySignals)
 * sit inside the SHA-256 chain: flipping one changes the id. Reads re-verify
 * every hash plus the governance binding, so a tampered or truncated snapshot
 * fails loudly instead of poisoning the golden-diff harness.
 */

/** Default snapshot root for the capture/replay CLIs — the two must agree. */
export const DEFAULT_SNAPSHOT_ROOT = "fixtures/snapshots";

// Canonical artifact set every snapshot must carry (governance.json is
// synthesized by buildSourceSnapshot, so it is required of the OUTPUT set,
// never accepted as build input).
const REQUIRED_ARTIFACTS: readonly ArtifactName[] = [
  "fields.json",
  "governance.json",
  "page.html",
  "screenshot.png",
];

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
  const names = new Set<string>();
  for (const a of artifacts) {
    assertArtifactName(a.name);
    if (a.name === GOVERNANCE_ARTIFACT_NAME) {
      throw new Error(
        `${GOVERNANCE_ARTIFACT_NAME} is derived from the meta — pass the governance fields instead`,
      );
    }
    if (names.has(a.name)) {
      throw new Error(`duplicate artifact ${a.name}`);
    }
    names.add(a.name);
  }
  // Enforce the canonical set at build time (M6): a snapshot that would fail
  // verification later must never be written.
  for (const name of REQUIRED_ARTIFACTS) {
    if (name !== GOVERNANCE_ARTIFACT_NAME && !names.has(name)) {
      throw new Error(`snapshot is missing required artifact ${name}`);
    }
  }
  // governance.json is synthesized from the meta itself, so the bundle digest
  // covers exactly the fields the governance gate acts on (H1).
  const governanceBytes = governanceArtifactBytes(meta);
  const hashed: SnapshotArtifact[] = [
    ...artifacts.map((a) => ({
      name: a.name,
      sha256: sha256Hex(a.bytes),
      bytes: a.bytes.length,
    })),
    { name: GOVERNANCE_ARTIFACT_NAME, sha256: sha256Hex(governanceBytes), bytes: governanceBytes.length },
  ];
  const bundle = bundleSha256(hashed);
  const snapshot: SourceSnapshot = {
    id: `snap:${bundle.slice(0, 12)}`,
    ...meta,
    artifacts: hashed,
  };
  return {
    snapshot,
    contents: new Map([
      ...artifacts.map((a) => [a.name, a.bytes] as const),
      [GOVERNANCE_ARTIFACT_NAME, governanceBytes],
    ]),
  };
}

/**
 * Canonical serialization of the governance fields — the exact bytes stored
 * as governance.json and hashed into the bundle digest. Verification compares
 * the stored artifact against these bytes, binding the fields that decide
 * governance into the chain: editing them in meta.json alone fails the
 * binding, editing them in both places fails the digest.
 */
export function governanceArtifactBytes(meta: GovernanceFields): Buffer {
  return Buffer.from(
    JSON.stringify(
      {
        boundarySignals: meta.boundarySignals,
        captureMode: meta.captureMode,
        stoppedAt: meta.stoppedAt,
        url: meta.url,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function assertArtifactName(name: string): void {
  if (!(ARTIFACT_NAMES as readonly string[]).includes(name)) {
    throw new Error(`artifact name must be one of ${ARTIFACT_NAMES.join(", ")}, got ${JSON.stringify(name)}`);
  }
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
    await writeFile(artifactPath(dir, name), bytes);
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
    contents.set(artifact.name, await readFile(artifactPath(dir, artifact.name)));
  }
  verifyIntegrity(meta, contents);
  return { snapshot: meta, contents };
}

export async function readSnapshotMeta(rootDir: string, id: string): Promise<SourceSnapshot> {
  const dir = path.join(rootDir, snapshotDirName(id));
  const raw = await readFile(path.join(dir, "meta.json"), "utf8");
  const meta = parseSnapshotMeta(JSON.parse(raw) as unknown);
  // Id↔directory binding: a meta.json moved into (or copied onto) another
  // snapshot's directory is not the snapshot it claims to be.
  if (meta.id !== id) {
    throw new Error(
      `snapshot directory binding broken: meta.id ${meta.id} does not match the requested id ${id}`,
    );
  }
  return meta;
}

/** Field dump for a snapshot, parsed through the same validation as capture time. */
export async function readFieldDump(rootDir: string, id: string): Promise<FormFieldDump> {
  const { contents } = await readSnapshot(rootDir, id);
  return parseFieldDumpFromContents(contents);
}

/** Parses the fields.json artifact out of already-read (and verified) contents. */
export function parseFieldDumpFromContents(contents: Map<string, Buffer>): FormFieldDump {
  const bytes = contents.get("fields.json");
  if (bytes === undefined) {
    throw new Error("snapshot contents are missing the required artifact fields.json");
  }
  return parseFieldDump(JSON.parse(bytes.toString("utf8")) as unknown);
}

export interface SnapshotDirEntry {
  dirName: string;
  /** null when the directory name is not a well-formed snapshot id — surfaced as an error row, never silently dropped. */
  id: string | null;
}

/**
 * Lists every snap_* directory under the root. A missing root is the honest
 * empty state (the replay CLI fails closed on the zero-snapshot report); any
 * other readdir failure is evidence corruption and propagates.
 */
export async function listSnapshotDirs(rootDir: string): Promise<SnapshotDirEntry[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith("snap_"))
    .map((e) => ({
      dirName: e.name,
      id: SNAPSHOT_DIR_PATTERN.test(e.name) ? snapshotIdFromDirName(e.name) : null,
    }))
    .sort((a, b) => (a.dirName < b.dirName ? -1 : a.dirName > b.dirName ? 1 : 0));
}

export async function listSnapshotIds(rootDir: string): Promise<string[]> {
  const dirs = await listSnapshotDirs(rootDir);
  return dirs.flatMap((d) => (d.id === null ? [] : [d.id]));
}

/** Defense-in-depth: resolve an artifact path and refuse anything leaving the snapshot dir. */
function artifactPath(dir: string, name: string): string {
  const resolvedDir = path.resolve(dir);
  const resolved = path.resolve(resolvedDir, name);
  if (!resolved.startsWith(resolvedDir + path.sep)) {
    throw new Error(`artifact path escapes the snapshot directory: ${JSON.stringify(name)}`);
  }
  return resolved;
}

function verifyIntegrity(meta: SourceSnapshot, contents: Map<string, Buffer>): void {
  // Required canonical set first (M6): a snapshot missing fields.json must die
  // with the designed error, not a TypeError downstream.
  const listed = new Set(meta.artifacts.map((a) => a.name));
  for (const name of REQUIRED_ARTIFACTS) {
    if (!listed.has(name)) {
      throw new Error(`snapshot ${meta.id} is missing required artifact ${name}`);
    }
  }
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
  // Governance binding (H1): the meta fields that decide governance must be
  // byte-identical to the hashed governance.json artifact. Flipping them in
  // meta.json alone fails here; flipping them in both places fails the
  // bundle-digest check below, because both hashes are in the chain.
  const storedGovernance = contents.get(GOVERNANCE_ARTIFACT_NAME);
  const expectedGovernance = governanceArtifactBytes(meta);
  if (storedGovernance === undefined || !storedGovernance.equals(expectedGovernance)) {
    throw new Error(
      `snapshot ${meta.id} governance fields do not match its ${GOVERNANCE_ARTIFACT_NAME} artifact — the record that decides governance was tampered with or predates capture schema 0.2.0`,
    );
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
  const id = requireString(m.id, "meta.id");
  if (!SNAPSHOT_ID_PATTERN.test(id)) {
    throw new Error(`meta.id is not a snapshot id (expected snap:<12 hex>): ${id}`);
  }
  const method = requireEnum(m.method, "meta.method", CAPTURE_METHODS);
  const captureMode = requireEnum(m.captureMode, "meta.captureMode", CAPTURE_MODES);
  const stoppedAt = requireEnum(m.stoppedAt, "meta.stoppedAt", BOUNDARY_KINDS);
  // A public capture stopped at nothing; any other mode stopped at a boundary.
  // Enforced both ways so a tampered mode/reason pair cannot parse cleanly (M1).
  if ((captureMode === "public_reachable") !== (stoppedAt === "none")) {
    throw new Error(
      `meta.captureMode and meta.stoppedAt disagree: ${captureMode} requires stoppedAt ${
        captureMode === "public_reachable" ? '"none"' : "a boundary kind"
      }, got "${stoppedAt}"`,
    );
  }
  if (typeof m.httpStatus !== "number" || !Number.isInteger(m.httpStatus)) {
    throw new Error(`meta.httpStatus must be an integer, got ${typeof m.httpStatus}`);
  }
  if (!Array.isArray(m.boundarySignals)) {
    throw new Error(`meta.boundarySignals must be an array of strings, got ${typeof m.boundarySignals}`);
  }
  if (m.notes !== undefined && m.notes !== null && typeof m.notes !== "string") {
    throw new Error(`meta.notes must be a string or null, got ${typeof m.notes}`);
  }
  const seenNames = new Set<string>();
  return {
    id,
    url: requireString(m.url, "meta.url"),
    resolvedUrl: requireString(m.resolvedUrl, "meta.resolvedUrl"),
    capturedAt: requireString(m.capturedAt, "meta.capturedAt"),
    method,
    httpStatus: m.httpStatus,
    captureMode,
    stoppedAt,
    boundarySignals: m.boundarySignals.map((s) => requireString(s, "meta.boundarySignals entry")),
    notes: typeof m.notes === "string" ? m.notes : null,
    artifacts: artifacts.map((a) => {
      if (typeof a !== "object" || a === null) {
        throw new Error(`artifact must be an object, got ${typeof a}`);
      }
      const a2 = a as Record<string, unknown>;
      // Enum-validated names close the path-traversal route: a poisoned meta
      // cannot point artifact reads outside the snapshot directory (M4).
      const name = requireString(a2.name, "artifact.name");
      assertArtifactName(name);
      if (seenNames.has(name)) {
        throw new Error(`duplicate artifact in meta: ${name}`);
      }
      seenNames.add(name);
      if (typeof a2.bytes !== "number") {
        throw new Error(`artifact.bytes for ${name} must be a number, got ${typeof a2.bytes}`);
      }
      return {
        name,
        sha256: requireString(a2.sha256, "artifact.sha256"),
        bytes: a2.bytes,
      };
    }),
  };
}

function requireEnum<E extends string>(value: unknown, what: string, allowed: readonly E[]): E {
  const s = requireString(value, what);
  if (!(allowed as readonly string[]).includes(s)) {
    throw new Error(`${what} must be one of ${allowed.join(", ")}, got ${JSON.stringify(s)}`);
  }
  return s as E;
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new Error(`${what} must be a string, got ${typeof value}`);
  }
  return value;
}

// Public alias of the canonical artifact set (see REQUIRED_ARTIFACTS above).
export const REQUIRED_ARTIFACT_NAMES: readonly ArtifactName[] = REQUIRED_ARTIFACTS;
