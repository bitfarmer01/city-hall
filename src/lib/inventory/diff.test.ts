import { describe, expect, it } from "vitest";

import { diffIsEmpty, diffSnapshots } from "./diff";
import type { IndexArticleEntry, InventorySnapshot } from "./types";

type EntryTuple = readonly [ka: `KA-${string}`, title: string, description: string];

function makeEntry([ka, title, description]: EntryTuple): IndexArticleEntry {
  return { id: `nyc311-${ka}`, ka, title, description };
}

function makeSnapshot(entries: readonly EntryTuple[]): InventorySnapshot {
  return {
    schemaVersion: "0.1.0",
    capturedAt: "2026-10-30T17:11:43.820Z",
    sourceUrl: "https://portal.311.nyc.gov/all-articles/",
    sourceSha256: "abc123",
    articleCount: entries.length,
    articles: entries.map(makeEntry),
    verification: { searchProbe: { query: "permit", totalResults: 345 } },
  };
}

describe("diffSnapshots", () => {
  it("reports added, removed, and changed articles", () => {
    const before = makeSnapshot([
      ["KA-01011", "Alternate Side Parking and Street Cleaning", "Learn about ASP."],
      ["KA-01236", "Bed Bug Complaint", "Report bed bugs."],
    ]);
    const after = makeSnapshot([
      ["KA-01011", "Alternate Side Parking and Street Cleaning", "Learn about ASP rules."],
      ["KA-01236", "Bed Bug Complaint", "Report bed bugs."],
      ["KA-01808", "Home Improvement Contractor License", "Apply for or renew a license."],
    ]);

    const diff = diffSnapshots(before, after);
    expect(diff.added.map((e) => e.ka)).toEqual(["KA-01808"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([
      {
        ka: "KA-01011",
        before: { title: "Alternate Side Parking and Street Cleaning", description: "Learn about ASP." },
        after: { title: "Alternate Side Parking and Street Cleaning", description: "Learn about ASP rules." },
      },
    ]);
    expect(diffIsEmpty(diff)).toBe(false);
  });

  it("reports removals", () => {
    const before = makeSnapshot([
      ["KA-01011", "Alternate Side Parking", "Learn about ASP."],
      ["KA-01236", "Bed Bug Complaint", "Report bed bugs."],
    ]);
    const after = makeSnapshot([["KA-01236", "Bed Bug Complaint", "Report bed bugs."]]);

    const diff = diffSnapshots(before, after);
    expect(diff.added).toEqual([]);
    expect(diff.removed.map((e) => e.ka)).toEqual(["KA-01011"]);
    expect(diff.changed).toEqual([]);
  });

  it("is empty for identical snapshots", () => {
    const snapshot = makeSnapshot([
      ["KA-01011", "Alternate Side Parking", "Learn about ASP."],
      ["KA-01236", "Bed Bug Complaint", "Report bed bugs."],
    ]);
    const diff = diffSnapshots(snapshot, snapshot);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diffIsEmpty(diff)).toBe(true);
  });

  it("preserves the snapshot's KA order in its outputs", () => {
    const before = makeSnapshot([]);
    const after = makeSnapshot([
      ["KA-01808", "Home Improvement Contractor License", "Apply."],
      ["KA-01011", "Alternate Side Parking", "Learn."],
    ]);
    // The builder sorts snapshot articles by KA; diffSnapshots preserves that
    // order rather than re-sorting. Feed a sorted snapshot and outputs stay sorted.
    const sortedAfter = { ...after, articles: [...after.articles].reverse() };
    const diff = diffSnapshots(before, sortedAfter);
    expect(diff.added.map((e) => e.ka)).toEqual(["KA-01011", "KA-01808"]);
  });
});
