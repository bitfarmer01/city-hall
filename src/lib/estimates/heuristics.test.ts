import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import type { SourceSnapshotRecord } from "@/lib/catalog/types";

import { buildHeuristicEstimates, parseHeuristicRows, type HeuristicRow } from "./heuristics";
import type { SnapshotsById } from "./fees";
import { EstimatesError } from "./types";

const REGISTRY_FILE = "data/estimates/heuristics.json";

let committedRegistry: unknown;

beforeAll(() => {
  committedRegistry = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
});

// Fixture row — test-only; no production heuristic exists in the registry.
function fixtureRow(overrides: Partial<HeuristicRow> = {}): HeuristicRow {
  return {
    serviceId: "svc:dohmh:birth-certificate-order",
    label: "Typical mail-order turnaround",
    rangeText: "2–4 weeks",
    basis: "test fixture demonstrating the gap-filler shape; no production heuristic exists",
    ...overrides,
  };
}

describe("parseHeuristicRows", () => {
  it("accepts the committed registry (empty — rows are added by review)", () => {
    expect(parseHeuristicRows(committedRegistry)).toEqual([]);
  });

  it("accepts a valid row and preserves its fields", () => {
    const rows = parseHeuristicRows([fixtureRow()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].rangeText).toBe("2–4 weeks");
    expect(rows[0].basis).toMatch(/test fixture/);
  });

  it("refuses a non-array registry", () => {
    expect(() => parseHeuristicRows("[]")).toThrow(EstimatesError);
  });

  it("refuses a row without a basis — the basis is the honesty guarantee", () => {
    try {
      parseHeuristicRows([fixtureRow({ basis: "  " })]);
      expect.unreachable("expected EstimatesError");
    } catch (error) {
      expect((error as EstimatesError).violations.join("\n")).toMatch(/basis/);
    }
  });

  it("refuses empty labels, ranges, and bad service IDs", () => {
    try {
      parseHeuristicRows([
        fixtureRow({ label: "" }),
        fixtureRow({ rangeText: "" }),
        fixtureRow({ serviceId: "birth-certificates" }),
      ]);
      expect.unreachable("expected EstimatesError");
    } catch (error) {
      const violations = (error as EstimatesError).violations;
      expect(violations).toHaveLength(3);
    }
  });

  it("refuses sourceRefs that resolve to no snapshot", () => {
    const noSnapshots: SnapshotsById = new Map();
    try {
      parseHeuristicRows([fixtureRow({ sourceRefs: ["snap:000000000000"] })], noSnapshots);
      expect.unreachable("expected EstimatesError");
    } catch (error) {
      expect((error as EstimatesError).violations.join("\n")).toMatch(/resolves to no snapshot/);
    }
  });

  it("accepts sourceRefs that resolve in the provided bundle", () => {
    const snap: SourceSnapshotRecord = {
      id: "snap:19f5de5b4340",
      url: "https://portal.311.nyc.gov/article/?kanumber=KA-01808",
      capturedAt: "2026-10-30",
      method: "manual",
      sha256: "0".repeat(64),
    };
    const rows = parseHeuristicRows([fixtureRow({ sourceRefs: [snap.id] })], new Map([[snap.id, snap]]));
    expect(rows).toHaveLength(1);
  });
});

describe("buildHeuristicEstimates", () => {
  it("maps registry rows to tier-3 items for the matching service only", () => {
    const other = fixtureRow({ serviceId: "svc:dohmh:dog-license" });
    const items = buildHeuristicEstimates("svc:dohmh:birth-certificate-order", [fixtureRow(), other]);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      tier: 3,
      label: "Typical mail-order turnaround",
      rangeText: "2–4 weeks",
      basis: "test fixture demonstrating the gap-filler shape; no production heuristic exists",
    });
  });

  it("never synthesizes a tier-3 item from empty rows", () => {
    expect(buildHeuristicEstimates("svc:dohmh:birth-certificate-order", [])).toEqual([]);
  });
});
