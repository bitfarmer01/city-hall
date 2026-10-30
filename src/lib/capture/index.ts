// Public surface of the capture harness. All policy enforcement is pure and
// lives in boundary.ts; driver.ts is the only module that touches a browser.
export { classifyBoundary } from "./boundary";
export type { BoundaryInput, BoundaryVerdict } from "./boundary";
export { capturePage } from "./driver";
export type { CapturePageOptions, CapturePageResult } from "./driver";
export { EXTRACT_FIELDS_SCRIPT } from "./extract-script";
export { MAX_FIELD_OPTIONS, parseDumpBody, parseFieldDump } from "./formdump";
export type { DumpBody } from "./formdump";
export { bundleSha256, sha256Hex, snapshotDirName, snapshotId, snapshotIdFromDirName } from "./hash";
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
  listSnapshotIds,
  readFieldDump,
  readSnapshot,
  readSnapshotMeta,
  writeSnapshot,
} from "./store";
export type { SnapshotMetaInput } from "./store";
export {
  CAPTURE_SCHEMA_VERSION,
  PUBLIC_BOUNDARY_NOTE,
} from "./types";
export type {
  BoundaryKind,
  CaptureMode,
  CapturedField,
  FormFieldDump,
  SnapshotArtifact,
  SourceSnapshot,
} from "./types";
