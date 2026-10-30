// Evidence records → SourceSnapshot records. Research-session captures
// (art_TMXzOIRU, art_mcM1Ssao) are quoted verbatim into committed evidence
// files; the catalog never re-fetches those pages. The snapshot's sha256 is
// the hash of the evidence record's own bytes, so every sourced fact still
// resolves to a hashed, dated record — the hash semantics are documented on
// the record's notes field.

import type { SourceSnapshotRecord } from "./types";

/** One committed evidence record (data/catalog/seed/evidence/*.json). */
export interface EvidenceRecord {
  id: string;
  /** The page the quote was captured from. */
  url: string;
  /** Verbatim quote from that page, as recorded during the capture. */
  quote: string;
  /** When the capture happened (ISO-8601 date or datetime). */
  capturedAt: string;
  /** Where the capture is documented (research artifact, fixture path). */
  capturedBy: string;
  note?: string;
}

/**
 * Build the snapshot record for one evidence file. `sha256` is the hash of
 * the evidence file's own bytes — the build script hashes the file it read.
 */
export function snapshotFromEvidence(
  record: EvidenceRecord,
  sha256: string,
  storagePath: string,
): SourceSnapshotRecord {
  return {
    id: `snap:${sha256.slice(0, 12)}`,
    url: record.url,
    capturedAt: record.capturedAt,
    method: "manual",
    sha256,
    storagePath,
    notes:
      `Evidence record for a research-session capture (${record.capturedBy}). ` +
      "sha256 hashes this committed evidence record's bytes; the live page was not re-fetched.",
  };
}

/**
 * Build the snapshot record for a committed fixture file that is a saved
 * copy of a fetched page (e.g. the D2b article fixtures). The hash is of
 * the fixture bytes themselves.
 */
export function snapshotFromFixture(
  url: string,
  sha256: string,
  storagePath: string,
  capturedAt: string,
  notes?: string,
): SourceSnapshotRecord {
  return {
    id: `snap:${sha256.slice(0, 12)}`,
    url,
    capturedAt,
    method: "http_fetch",
    sha256,
    storagePath,
    ...(notes !== undefined ? { notes } : {}),
  };
}
