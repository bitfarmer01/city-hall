import { isKaNumber } from "./ka";
import type { IndexArticleEntry } from "./types";

// Structure assertions are the loud-failure gate between the live portal and
// the catalog: a redesign or population shift must fail the snapshot build,
// never shrink the catalog silently. Tolerances and the search-endpoint
// cross-check per build spec D2 and art_TMXzOIRU §4–§5.

/** Allowed relative drift of article count / search totals vs the baseline. */
export const COUNT_TOLERANCE = 0.05;

export class StructureAssertionError extends Error {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(
      `NYC311 structure assertions failed (${violations.length}):\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
    this.name = "StructureAssertionError";
    this.violations = violations;
  }
}

export interface IndexBaseline {
  articleCount: number;
  /** Baseline total for the configured search-endpoint probe query. */
  searchTotal?: number;
}

const PERCENT = Math.round(COUNT_TOLERANCE * 100);

export function isWithinTolerance(
  actual: number,
  baseline: number,
  tolerance: number = COUNT_TOLERANCE,
): boolean {
  return Math.abs(actual - baseline) / baseline <= tolerance;
}

/**
 * Invariant + baseline assertions over parsed entries. The parser already
 * rejects malformed pages; this layer is the independent gate (count within
 * tolerance of the pinned baseline, no duplicates, no empty fields) so a
 * regression in the parser or the portal cannot pass silently.
 */
export function assertIndexStructure(
  entries: readonly IndexArticleEntry[],
  baseline?: IndexBaseline,
): void {
  const violations: string[] = [];
  if (entries.length === 0) {
    violations.push("enumeration produced zero articles");
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isKaNumber(entry.ka)) {
      violations.push(`${entry.ka}: malformed KA number`);
    }
    if (seen.has(entry.ka)) {
      violations.push(`${entry.ka}: duplicate article`);
    }
    seen.add(entry.ka);
    if (!entry.title) {
      violations.push(`${entry.ka}: empty title`);
    }
    if (!entry.description) {
      violations.push(`${entry.ka}: empty description`);
    }
  }
  if (baseline && !isWithinTolerance(entries.length, baseline.articleCount)) {
    violations.push(
      `article count ${entries.length} deviates more than ${PERCENT}% from baseline ` +
        `${baseline.articleCount} — possible index redesign or mass retirement`,
    );
  }
  if (violations.length > 0) {
    throw new StructureAssertionError(violations);
  }
}

// Dead articles return HTTP 200 with no ka-content div (art_TMXzOIRU §2) —
// status codes cannot detect them; the div's absence is the signal.
const KA_CONTENT_PATTERN = /<div[^>]*class="[^"]*\bka-content\b[^"]*"/;

export function assertArticlePageHasContent(ka: string, html: string): void {
  if (!KA_CONTENT_PATTERN.test(html)) {
    throw new StructureAssertionError([
      `article ${ka}: no ka-content div — page unavailable or redesigned`,
    ]);
  }
}

// The portal search reports an exact total ("Results 1 - 10 of 345 for query
// : permit") — an independent population channel for the cross-check.
const RESULT_COUNT_BLOCK = /<h3 class="result-count">([\s\S]*?)<\/h3>/;

export function parseSearchTotal(html: string, query: string): number {
  const scope = RESULT_COUNT_BLOCK.exec(html)?.[1] ?? html;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const totalPattern = new RegExp(
    `Results \\d+ - \\d+ of (\\d+) for query : ${escapedQuery}`,
  );
  const match = totalPattern.exec(scope);
  if (!match) {
    throw new StructureAssertionError([
      `search endpoint reported no exact total for query "${query}" — layout changed or probe failed`,
    ]);
  }
  return Number.parseInt(match[1], 10);
}

export function assertSearchTotal(actual: number, baseline: number): void {
  if (!isWithinTolerance(actual, baseline)) {
    throw new StructureAssertionError([
      `search total ${actual} deviates more than ${PERCENT}% from baseline ${baseline} — ` +
        `index population may have shifted sharply`,
    ]);
  }
}

/** Evenly spaced sample indices over a sorted list (first, spread, last). */
export function sampleIndices(total: number, count: number): number[] {
  if (total <= 0 || count <= 0) {
    return [];
  }
  const k = Math.min(count, total);
  if (k === 1) {
    return [0];
  }
  const last = total - 1;
  const picked = new Set<number>();
  for (let i = 0; i < k; i += 1) {
    picked.add(Math.round((i * last) / (k - 1)));
  }
  return [...picked].sort((a, b) => a - b);
}
