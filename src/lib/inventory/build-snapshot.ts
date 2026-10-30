import { sha256Hex } from "./hash";
import {
  SNAPSHOT_SCHEMA_VERSION,
  type IndexArticleEntry,
  type InventorySnapshot,
  type SearchProbeFacts,
} from "./types";

export interface BuildSnapshotInput {
  entries: IndexArticleEntry[];
  html: string;
  sourceUrl: string;
  capturedAt: string;
  searchProbe: SearchProbeFacts;
}

/** Assemble the versioned snapshot from parsed entries and capture facts. */
export function buildInventorySnapshot(input: BuildSnapshotInput): InventorySnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    capturedAt: input.capturedAt,
    sourceUrl: input.sourceUrl,
    sourceSha256: sha256Hex(input.html),
    articleCount: input.entries.length,
    articles: input.entries,
    verification: { searchProbe: input.searchProbe },
  };
}

export function parseSnapshotJson(text: string): InventorySnapshot {
  const value: unknown = JSON.parse(text);
  if (!isInventorySnapshot(value)) {
    throw new Error("not an inventory snapshot: schema mismatch");
  }
  return value;
}

function isInventorySnapshot(value: unknown): value is InventorySnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.schemaVersion !== "string" ||
    typeof record.capturedAt !== "string" ||
    typeof record.sourceUrl !== "string" ||
    typeof record.sourceSha256 !== "string" ||
    typeof record.articleCount !== "number" ||
    !Array.isArray(record.articles)
  ) {
    return false;
  }
  for (const entry of record.articles) {
    if (!isArticleEntry(entry)) {
      return false;
    }
  }
  const verification = record.verification;
  if (typeof verification !== "object" || verification === null) {
    return false;
  }
  const probe = (verification as Record<string, unknown>).searchProbe;
  if (typeof probe !== "object" || probe === null) {
    return false;
  }
  const probeRecord = probe as Record<string, unknown>;
  return typeof probeRecord.query === "string" && typeof probeRecord.totalResults === "number";
}

function isArticleEntry(value: unknown): value is IndexArticleEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.ka === "string" &&
    typeof record.title === "string" &&
    typeof record.description === "string"
  );
}
