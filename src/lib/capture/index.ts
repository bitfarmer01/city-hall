// Public surface of the capture harness. All policy enforcement is pure and
// lives in boundary.ts; driver.ts is the only module that touches a browser.
export { classifyBoundary } from "./boundary";
export type { BoundaryInput, BoundaryVerdict } from "./boundary";
export { capturePage } from "./driver";
export type { CapturePageOptions, CapturePageResult } from "./driver";
export { EXTRACT_FIELDS_SCRIPT } from "./extract-script";
export { MAX_FIELD_OPTIONS, parseDumpBody, parseFieldDump } from "./formdump";
export type { DumpBody } from "./formdump";
export { bundleSha256, sha256Hex, snapshotDirName, snapshotId, snapshotIdFromDirName, SNAPSHOT_DIR_PATTERN, SNAPSHOT_ID_PATTERN } from "./hash";
export {
  diffLiveMinusCatalog,
  fieldKey,
  hasBlockingFailures,
  normalizeKey,
} from "./golden";
export type {
  CatalogExpectation,
  ExpectedField,
  FindingReason,
  GoldenDiff,
  GoldenFinding,
} from "./golden";
export { loadExpectations, replayRoot } from "./replay";
export type { ReplayReport, ReplayRow } from "./replay";
export {
  buildSourceSnapshot,
  DEFAULT_SNAPSHOT_ROOT,
  listSnapshotDirs,
  listSnapshotIds,
  metaBoundBytes,
  parseFieldDumpFromContents,
  readFieldDump,
  readSnapshot,
  readSnapshotMeta,
  writeSnapshot,
} from "./store";
export type { SnapshotDirEntry, SnapshotMetaInput } from "./store";
export {
  ARTIFACT_NAMES,
  BOUNDARY_KINDS,
  CAPTURE_METHODS,
  CAPTURE_MODES,
  CAPTURE_SCHEMA_VERSION,
  META_BOUND_ARTIFACT_NAME,
  PUBLIC_BOUNDARY_NOTE,
} from "./types";
export type {
  ArtifactName,
  BoundaryKind,
  CaptureMode,
  CapturedField,
  FormFieldDump,
  SnapshotArtifact,
  SourceSnapshot,
} from "./types";
