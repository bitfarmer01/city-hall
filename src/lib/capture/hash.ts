import { createHash } from "node:crypto";

/** Hex sha256 of a string or buffer. */
export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Bundle hash: sha256 over "name:artifactHash" lines sorted by name. Same
 * artifact bytes ⇒ same bundle hash ⇒ same snapshot id, regardless of the
 * order artifacts are handed in.
 */
export function bundleSha256(
  artifacts: ReadonlyArray<{ name: string; sha256: string }>,
): string {
  const digest = [...artifacts]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((a) => `${a.name}:${a.sha256}`)
    .join("\n");
  return sha256Hex(digest);
}

/** SourceSnapshot ID: `snap:` + first 12 hex chars of the bundle hash. */
export function snapshotId(bundleHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(bundleHash)) {
    throw new Error(`bundle hash is not 64 hex chars: ${bundleHash}`);
  }
  return `snap:${bundleHash.slice(0, 12)}`;
}

/** Snapshot ids and directory names are always 12 hex chars of bundle hash. */
export const SNAPSHOT_ID_PATTERN = /^snap:[0-9a-f]{12}$/;
export const SNAPSHOT_DIR_PATTERN = /^snap_[0-9a-f]{12}$/;

/** ":" is not filesystem-safe; snapshots live in `snap_<hex12>` directories. */
export function snapshotDirName(id: string): string {
  const rest = parseId(id);
  return `snap_${rest}`;
}

/** Inverse of snapshotDirName — rejects anything but the exact directory shape. */
export function snapshotIdFromDirName(dirName: string): string {
  if (!SNAPSHOT_DIR_PATTERN.test(dirName)) {
    throw new Error(`not a snapshot directory name (expected snap_<12 hex>): ${dirName}`);
  }
  return `snap:${dirName.slice("snap_".length)}`;
}

function parseId(id: string): string {
  if (!/^snap:[0-9a-f]{12}$/.test(id)) {
    throw new Error(`not a snapshot id: ${id}`);
  }
  return id.slice("snap:".length);
}
