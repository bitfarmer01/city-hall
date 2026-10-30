// Tier-2 timelines — build spec D6. Two provenance classes, one tier shape
// (the D4.5 contract's dataset + query pair is the provenance record):
//
//  1. Published processing times. A channel's ISO-8601 `processingTime`
//     (e.g. P21D on the HIC online channel) is a verbatim, captured source
//     fact — it renders at tier 2 with the owning NYC311 article recorded
//     as the dataset and the channel field as the query. Published is not
//     empirical, so the label says so; a tier-2 item computed from data
//     carries its dataset + query instead.
//
//  2. Empirical timelines from NYC Open Data. Rows live in
//     data/estimates/timelines.json, hand-committed only where a dataset
//     extract is verified — dataset ID, the query that produced the number,
//     the as-of date, and the sample size. The registry is empty today: the
//     DOB Permit Issuance dataset (ipu4-2q9a) is verified to exist but its
//     columns are not (art_wJiwwN0o §3 flags this [U]), so no honest
//     computed row can ship yet. The mechanism is ready; rows land when a
//     verified extract does.
//
// A service with neither gets no tier-2 item — an honest gap, never a
// guessed range (that is tier 3's job, and only from the curated table).

import type { ServiceRecord } from "@/lib/catalog/types";

import { EstimatesError, ISO_DATE_PATTERN, type TimelineEstimate } from "./types";
import { SERVICE_ID_PATTERN } from "@/lib/catalog/ids";

/** Parsed ISO-8601 duration components. */
export type DurationParts = {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

const ISO_DURATION_PATTERN =
  /^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/**
 * Parse a strict subset of ISO-8601 durations (Y/M/W/D + H/M/S with the T
 * separator). Throws on anything it cannot represent rather than guessing.
 */
export function parseIsoDuration(iso: string): DurationParts {
  const match = ISO_DURATION_PATTERN.exec(iso);
  if (match === null) {
    throw new EstimatesError([`processingTime ${JSON.stringify(iso)} is not an ISO-8601 duration`]);
  }
  const parts = {
    years: Number(match[1] ?? 0),
    months: Number(match[2] ?? 0),
    weeks: Number(match[3] ?? 0),
    days: Number(match[4] ?? 0),
    hours: Number(match[5] ?? 0),
    minutes: Number(match[6] ?? 0),
    seconds: Number(match[7] ?? 0),
  };
  if (Object.values(parts).every((n) => n === 0)) {
    throw new EstimatesError([`processingTime ${JSON.stringify(iso)} has no components`]);
  }
  return parts;
}

const DURATION_UNITS: readonly (keyof DurationParts)[] = [
  "years",
  "months",
  "weeks",
  "days",
  "hours",
  "minutes",
  "seconds",
];

const DURATION_UNIT_NAMES: Record<keyof DurationParts, [string, string]> = {
  years: ["year", "years"],
  months: ["month", "months"],
  weeks: ["week", "weeks"],
  days: ["day", "days"],
  hours: ["hour", "hours"],
  minutes: ["minute", "minutes"],
  seconds: ["second", "seconds"],
};

/** Human text for a parsed duration: "21 days", "1 year, 2 months", … */
export function formatDuration(parts: DurationParts): string {
  const segments = DURATION_UNITS.filter((unit) => parts[unit] > 0).map((unit) => {
    const value = parts[unit];
    const [one, many] = DURATION_UNIT_NAMES[unit];
    return `${value} ${value === 1 ? one : many}`;
  });
  if (segments.length === 0) {
    throw new EstimatesError(["duration has no components to format"]);
  }
  return segments.join(", ");
}

/**
 * Published channel processing times → tier-2 items. Label and provenance
 * say "published" — these are the agency's stated expectation, not a
 * computed distribution.
 */
export function buildPublishedTimelines(record: ServiceRecord): TimelineEstimate[] {
  const articleId = record.meta.nyc311ArticleId;
  return record.envelope.availableChannel.flatMap((channel, index) => {
    if (channel.processingTime === undefined) {
      return [];
    }
    const channelName = channel.name ?? `channel ${index + 1}`;
    return [
      {
        tier: 2 as const,
        label: `Processing time — ${channelName} (published)`,
        durationText: formatDuration(parseIsoDuration(channel.processingTime)),
        dataset: `NYC311 article ${articleId} (published processing time)`,
        query: `availableChannel[name="${channelName}"].processingTime`,
        ...(record.meta.nyc311ArticleUrl ? { sourceUrl: record.meta.nyc311ArticleUrl } : {}),
      },
    ];
  });
}

/** One committed empirical timeline row — the registry schema. */
export interface OpenDataTimelineRow {
  serviceId: string;
  label: string;
  /** NYC Open Data dataset identifier, e.g. "ipu4-2q9a". */
  datasetId: string;
  datasetName: string;
  datasetUrl: string;
  /** The query (SoQL or equivalent) that produced the statistic. */
  query: string;
  /** As-of date of the extract, ISO yyyy-mm-dd. */
  asOf: string;
  /** Median days to completion across the extract's records. */
  medianDays: number;
  /** Record count behind the median — a median of zero records is a lie. */
  sampleSize: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate parsed registry JSON (data/estimates/timelines.json). Collects
 * every violation into one EstimatesError — a bad row blocks the build
 * instead of silently dropping a timeline.
 */
export function parseOpenDataTimelineRows(raw: unknown): OpenDataTimelineRow[] {
  if (!Array.isArray(raw)) {
    throw new EstimatesError(["opendata timeline registry must be a JSON array"]);
  }

  const violations: string[] = [];
  const rows: OpenDataTimelineRow[] = [];

  raw.forEach((entry, index) => {
    const where = `timelines[${index}]`;
    if (!isRecord(entry)) {
      violations.push(`${where} is not an object`);
      return;
    }
    const { serviceId, label, datasetId, datasetName, datasetUrl, query, asOf, medianDays, sampleSize } = entry;

    if (typeof serviceId !== "string" || !SERVICE_ID_PATTERN.test(serviceId)) {
      violations.push(`${where}.serviceId ${JSON.stringify(serviceId)} does not match ${SERVICE_ID_PATTERN}`);
    }
    if (typeof label !== "string" || label.trim().length === 0) {
      violations.push(`${where}.label must be non-empty display text`);
    }
    if (typeof datasetId !== "string" || datasetId.trim().length === 0) {
      violations.push(`${where}.datasetId must name the NYC Open Data dataset`);
    }
    if (typeof datasetName !== "string" || datasetName.trim().length === 0) {
      violations.push(`${where}.datasetName must be non-empty`);
    }
    if (typeof datasetUrl !== "string" || !datasetUrl.startsWith("https://")) {
      violations.push(`${where}.datasetUrl must be an https:// URL`);
    }
    if (typeof query !== "string" || query.trim().length === 0) {
      violations.push(`${where}.query must record the query that produced the statistic`);
    }
    if (typeof asOf !== "string" || !ISO_DATE_PATTERN.test(asOf)) {
      violations.push(`${where}.asOf ${JSON.stringify(asOf)} is not an ISO yyyy-mm-dd date`);
    }
    if (typeof medianDays !== "number" || !Number.isFinite(medianDays) || medianDays <= 0) {
      violations.push(`${where}.medianDays must be a positive finite number`);
    }
    if (typeof sampleSize !== "number" || !Number.isInteger(sampleSize) || sampleSize <= 0) {
      violations.push(`${where}.sampleSize must be a positive integer record count`);
    }

    const valid =
      typeof serviceId === "string" &&
      SERVICE_ID_PATTERN.test(serviceId) &&
      typeof label === "string" &&
      typeof datasetId === "string" &&
      typeof datasetName === "string" &&
      typeof datasetUrl === "string" &&
      typeof query === "string" &&
      typeof asOf === "string" &&
      typeof medianDays === "number" &&
      Number.isFinite(medianDays) &&
      medianDays > 0 &&
      typeof sampleSize === "number" &&
      Number.isInteger(sampleSize) &&
      sampleSize > 0;
    if (valid) {
      rows.push({ serviceId, label, datasetId, datasetName, datasetUrl, query, asOf, medianDays, sampleSize });
    }
  });

  if (violations.length > 0) {
    throw new EstimatesError(violations);
  }
  return rows;
}

/** One empirical registry row → its tier-2 estimate. */
export function buildEmpiricalTimeline(row: OpenDataTimelineRow): TimelineEstimate {
  return {
    tier: 2,
    label: row.label,
    durationText: `${row.medianDays} days (median of ${row.sampleSize} records, as of ${row.asOf})`,
    dataset: `${row.datasetName} (${row.datasetId})`,
    query: row.query,
    sourceUrl: row.datasetUrl,
  };
}

/** Every tier-2 item for one service: published channels + registry rows. */
export function buildTimelineEstimates(
  record: ServiceRecord,
  empiricalRows: readonly OpenDataTimelineRow[],
): TimelineEstimate[] {
  const serviceId = record.meta.catalogId;
  return [
    ...buildPublishedTimelines(record),
    ...empiricalRows.filter((row) => row.serviceId === serviceId).map(buildEmpiricalTimeline),
  ];
}
