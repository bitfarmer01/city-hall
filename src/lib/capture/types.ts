// Capture-harness record types: the SourceSnapshot sidecar from the build
// spec's data model (art_RVpFZFo1 — record table) plus the capture-policy
// vocabulary from the architecture research (art_wJiwwN0o §4b).

/**
 * Where a capture stopped, in policy order. "none" means the public form was
 * reached and captured. Every other kind is a stop condition: the harness
 * never proceeds past it — no credentials, no challenge solving, no retries
 * against rate limits.
 */
export type BoundaryKind =
  | "none"
  | "login_wall"
  | "nyc_id"
  | "anti_bot"
  | "rate_limited"
  | "error";

/**
 * Capture-mode enum fixed by the task brief. Anything that stopped before a
 * public form was reached records authenticated_unreachable; the `stoppedAt`
 * field carries the precise reason (auth wall, NYC.ID, anti-bot challenge,
 * rate limit, or HTTP error). The mode answers "could the harness compare the
 * live form?" — the only question the golden-diff harness acts on.
 */
export type CaptureMode = "public_reachable" | "authenticated_unreachable";

/** Method vocabulary from the SourceSnapshot record in the build spec. */
export type CaptureMethod = "headless";

/**
 * One field in the DOM form-field dump — the primary capture evidence
 * (art_wJiwwN0o §4b: screenshots corroborate, the DOM dump proves).
 * Attribute data only: the dump never records entered values, because the
 * harness never enters any.
 */
export interface CapturedField {
  /** Input element tag: "input" | "textarea" | "select". */
  tag: "input" | "textarea" | "select";
  /** DOM type attribute ("text", "email", "file", "password", "select-one", …). */
  type: string;
  /** DOM `name` attribute, or "". */
  name: string;
  /** DOM `id`, or "". */
  id: string;
  /** Resolved visible label (label[for], aria-label/labelledby, wrapping label, placeholder), or "". */
  label: string;
  /** DOM `required` attribute or aria-required="true". */
  required: boolean;
  /** The visible label (or placeholder) carries a "*" marker — a hint the DOM alone cannot confirm. */
  requiredMarker: boolean;
  /** Option labels for select; value attributes for radio/checkbox. Capped at MAX_FIELD_OPTIONS. */
  options: string[];
  /** Total options found before the cap — keeps the cap honest. */
  optionsTotal: number;
  /** File inputs: `accept` filter, null when absent. */
  accept: string | null;
  /** File inputs: multi-upload allowed. */
  multiple: boolean;
}

/** DOM form-field dump for one captured page. */
export interface FormFieldDump {
  /** The URL requested (the final post-redirect URL lives on the snapshot). */
  url: string;
  /** ISO-8601 instant the dump was taken. */
  capturedAt: string;
  fields: CapturedField[];
  /** Visible labels of submit buttons. */
  submitButtons: string[];
}

/** One stored file that makes up a snapshot bundle. */
export interface SnapshotArtifact {
  name: string;
  sha256: string;
  bytes: number;
}

/** Canonical artifact filenames of a snapshot bundle. */
export type ArtifactName = "fields.json" | "governance.json" | "network.json" | "page.html" | "screenshot.png";

/** Every artifact filename a snapshot may contain — anything else is rejected at parse and build time. */
export const ARTIFACT_NAMES: readonly ArtifactName[] = [
  "fields.json",
  "governance.json",
  "network.json",
  "page.html",
  "screenshot.png",
];

/**
 * SourceSnapshot record (build spec data model): every displayed claim in the
 * catalog traces to one of these. The id is content-derived — see hash.ts.
 */
export interface SourceSnapshot {
  /** `snap:{sha256-12}` — bundle content hash, first 12 hex chars. */
  id: string;
  /** URL requested. */
  url: string;
  /** Post-redirect URL of the loaded document. */
  resolvedUrl: string;
  /** ISO-8601 instant the capture completed. */
  capturedAt: string;
  method: CaptureMethod;
  /** Main-document HTTP status (0 if the browser never got a response). */
  httpStatus: number;
  captureMode: CaptureMode;
  /** "none" iff captureMode is public_reachable. */
  stoppedAt: BoundaryKind;
  /** Machine-readable detection reasons for stoppedAt. */
  boundarySignals: string[];
  /** Fixed attestation for public-boundary captures. */
  notes: string | null;
  artifacts: SnapshotArtifact[];
}

/**
 * Semantic version of this capture-harness record schema (meta.json + fields.json).
 * 0.2.0: governance fields are bound into the integrity chain — every snapshot
 * carries a hashed governance.json artifact and the bundle id covers it
 * (schema 0.1.0 snapshots predate the binding and fail verification closed).
 */
export const CAPTURE_SCHEMA_VERSION = "0.2.0";

/** The artifact holding the canonical serialization of the governance fields. */
export const GOVERNANCE_ARTIFACT_NAME = "governance.json";

/** The meta fields that decide governance — bound into the bundle digest via governance.json. */
export type GovernanceFields = Pick<SourceSnapshot, "url" | "captureMode" | "stoppedAt" | "boundarySignals">;

/** Closed vocabulary of capture methods. */
export const CAPTURE_METHODS: readonly CaptureMethod[] = ["headless"];

/** Closed vocabulary of capture modes. */
export const CAPTURE_MODES: readonly CaptureMode[] = ["public_reachable", "authenticated_unreachable"];

/** Closed vocabulary of boundary kinds. */
export const BOUNDARY_KINDS: readonly BoundaryKind[] = [
  "none",
  "login_wall",
  "nyc_id",
  "anti_bot",
  "rate_limited",
  "error",
];

/** Fixed attestation stored on every snapshot this harness produces. */
export const PUBLIC_BOUNDARY_NOTE =
  "Public-boundary capture: no credentials used, no form values entered, no challenge solved.";
