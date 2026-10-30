import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { snapshotIdFromDirName } from "./hash";
import {
  buildSourceSnapshot,
  metaBoundBytes,
  listSnapshotDirs,
  listSnapshotIds,
  parseFieldDumpFromContents,
  parseSnapshotMeta,
  readFieldDump,
  readSnapshot,
  readSnapshotMeta,
  writeSnapshot,
} from "./store";
import { CAPTURE_SCHEMA_VERSION, META_BOUND_ARTIFACT_NAME } from "./types";

// Each test gets its own temp root: the tamper test deliberately corrupts a
// snapshot directory, and isolation keeps that from leaking into other cases.
async function freshRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cityhall-store-"));
}

function built() {
  return buildSourceSnapshot(
    {
      url: "https://example.nyc.gov/form",
      resolvedUrl: "https://example.nyc.gov/form",
      capturedAt: "2026-10-30T12:00:00.000Z",
      method: "headless",
      httpStatus: 200,
      captureMode: "public_reachable",
      stoppedAt: "none",
      boundarySignals: [],
      notes: null,
    },
    [
      { name: "page.html", bytes: Buffer.from("<html>form</html>") },
      { name: "screenshot.png", bytes: Buffer.from("png-bytes") },
      { name: "fields.json", bytes: Buffer.from(JSON.stringify({ url: "x", capturedAt: "x", fields: [], submitButtons: [] })) },
    ],
  );
}

const HEX64 = "a".repeat(64);

function metaForParse(overrides: Record<string, unknown> = {}) {
  return {
    id: "snap:000000000000",
    url: "https://example.nyc.gov/form",
    resolvedUrl: "https://example.nyc.gov/form",
    capturedAt: "2026-10-30T12:00:00.000Z",
    method: "headless",
    httpStatus: 200,
    captureMode: "public_reachable",
    stoppedAt: "none",
    boundarySignals: [],
    notes: null,
    captureSchema: CAPTURE_SCHEMA_VERSION,
    artifacts: [
      { name: "page.html", sha256: HEX64, bytes: 1 },
      { name: "screenshot.png", sha256: HEX64, bytes: 1 },
      { name: "fields.json", sha256: HEX64, bytes: 1 },
      { name: "meta-bound.json", sha256: HEX64, bytes: 1 },
    ],
    ...overrides,
  };
}

/** Strips a key so absence (not merely undefined) can be tested. */
function withoutKey(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

describe("buildSourceSnapshot", () => {
  it("derives the id from artifact content", () => {
    const result = built();
    expect(result.snapshot.id).toMatch(/^snap:[0-9a-f]{12}$/);
  });

  it("produces the same id for identical bytes", () => {
    expect(built().snapshot.id).toBe(built().snapshot.id);
  });

  it("changes the id when any artifact byte changes", () => {
    const modified = buildSourceSnapshot(
      {
        url: "https://example.nyc.gov/form",
        resolvedUrl: "https://example.nyc.gov/form",
        capturedAt: "2026-10-30T12:00:00.000Z",
        method: "headless",
        httpStatus: 200,
        captureMode: "public_reachable",
        stoppedAt: "none",
        boundarySignals: [],
        notes: null,
      },
      [
        { name: "page.html", bytes: Buffer.from("<html>form!</html>") },
        { name: "screenshot.png", bytes: Buffer.from("png-bytes") },
        { name: "fields.json", bytes: Buffer.from(JSON.stringify({ url: "x", capturedAt: "x", fields: [], submitButtons: [] })) },
      ],
    );
    expect(modified.snapshot.id).not.toBe(built().snapshot.id);
  });

  it("synthesizes a meta-bound.json artifact covering every meta field except id and artifacts (H1/M1)", () => {
    const result = built();
    const bound = result.contents.get(META_BOUND_ARTIFACT_NAME);
    expect(bound).toBeDefined();
    const { id, artifacts, ...provenance } = result.snapshot;
    expect(id).toBeDefined();
    expect(artifacts.length).toBeGreaterThan(0);
    expect(JSON.parse(bound!.toString("utf8"))).toEqual(provenance);
    expect(bound!.equals(metaBoundBytes(result.snapshot))).toBe(true);
    expect(result.snapshot.artifacts.find((a) => a.name === META_BOUND_ARTIFACT_NAME)).toBeDefined();
  });

  it("keeps non-empty boundarySignals intact in the meta-bound record", () => {
    // Regression: key sorting must not use the JSON.stringify replacer-array
    // form, which filters nested keys and would silently empty the signals
    // array inside the bound record.
    const result = buildSourceSnapshot(
      {
        url: "https://example.nyc.gov/form",
        resolvedUrl: "https://example.nyc.gov/form",
        capturedAt: "2026-10-30T12:00:00.000Z",
        method: "headless",
        httpStatus: 200,
        captureMode: "authenticated_unreachable",
        stoppedAt: "login_wall",
        boundarySignals: ["nyc_id_marker_with_password_field"],
        notes: null,
      },
      [
        { name: "page.html", bytes: Buffer.from("x") },
        { name: "screenshot.png", bytes: Buffer.from("x") },
        { name: "fields.json", bytes: Buffer.from("{}") },
      ],
    );
    const bound = JSON.parse(result.contents.get(META_BOUND_ARTIFACT_NAME)!.toString("utf8")) as {
      boundarySignals: string[];
    };
    expect(bound.boundarySignals).toEqual(["nyc_id_marker_with_password_field"]);
  });

  it("changes the id when a governance field changes, with identical captured bytes (H1)", () => {
    const base = built();
    const meta = {
      url: base.snapshot.url,
      resolvedUrl: base.snapshot.resolvedUrl,
      capturedAt: base.snapshot.capturedAt,
      method: base.snapshot.method,
      httpStatus: base.snapshot.httpStatus,
      // The only changes: governance fields. Captured bytes stay identical.
      captureMode: "authenticated_unreachable" as const,
      stoppedAt: "login_wall" as const,
      boundarySignals: ["login_wall"],
      notes: base.snapshot.notes,
    };
    const stopped = buildSourceSnapshot(meta, [
      { name: "page.html", bytes: base.contents.get("page.html")! },
      { name: "screenshot.png", bytes: base.contents.get("screenshot.png")! },
      { name: "fields.json", bytes: base.contents.get("fields.json")! },
    ]);
    expect(stopped.snapshot.id).not.toBe(base.snapshot.id);
  });

  it("refuses a build missing a required artifact with the designed error (M6)", () => {
    const meta = built().snapshot;
    const page = { name: "page.html" as const, bytes: Buffer.from("<html>form</html>") };
    const shot = { name: "screenshot.png" as const, bytes: Buffer.from("png-bytes") };
    expect(() => buildSourceSnapshot(meta, [page, shot])).toThrow(/missing required artifact fields\.json/);
    expect(() => buildSourceSnapshot(meta, [])).toThrow(/needs at least one artifact/);
  });

  it("refuses to build with an artifact name outside the canonical enum (M4)", () => {
    const meta = built().snapshot;
    expect(() =>
      buildSourceSnapshot(meta, [
        { name: "page.html", bytes: Buffer.from("x") },
        { name: "screenshot.png", bytes: Buffer.from("x") },
        { name: "fields.json", bytes: Buffer.from("{}") },
        { name: "../../etc/passwd", bytes: Buffer.from("x") },
      ]),
    ).toThrow(/artifact name/);
    expect(() =>
      buildSourceSnapshot(meta, [
        { name: "page.html", bytes: Buffer.from("x") },
        { name: "screenshot.png", bytes: Buffer.from("x") },
        { name: "fields.json", bytes: Buffer.from("{}") },
        { name: META_BOUND_ARTIFACT_NAME, bytes: Buffer.from("{}") },
      ]),
    ).toThrow(/meta-bound\.json is derived/);
  });
});

describe("write/read round trip", () => {
  it("writes, lists, and reads back with matching metadata", async () => {
    const dir = await freshRoot();
    const result = built();
    const out = await writeSnapshot(dir, result);
    expect(out).toMatch(/snap_[0-9a-f]{12}$/);

    expect(await listSnapshotIds(dir)).toEqual([result.snapshot.id]);

    const read = await readSnapshot(dir, result.snapshot.id);
    expect(read.snapshot).toEqual(result.snapshot);
    expect(read.contents.get("page.html")!.toString()).toBe("<html>form</html>");

    const meta = await readSnapshotMeta(dir, result.snapshot.id);
    expect(meta.capturedAt).toBe("2026-10-30T12:00:00.000Z");
  });

  it("is idempotent for identical content", async () => {
    const dir = await freshRoot();
    const result = built();
    await writeSnapshot(dir, result);
    await expect(writeSnapshot(dir, result)).resolves.toBeDefined();
  });

  it("refuses an id collision with different metadata", async () => {
    const dir = await freshRoot();
    const result = built();
    await writeSnapshot(dir, result);
    const imposter = {
      snapshot: { ...result.snapshot, notes: "tampered" },
      contents: result.contents,
    };
    await expect(writeSnapshot(dir, imposter)).rejects.toThrow(/id collision/);
  });

  it("fails integrity verification when an artifact is tampered with", async () => {
    const dir = await freshRoot();
    const result = built();
    const out = await writeSnapshot(dir, result);
    await writeFile(path.join(out, "page.html"), Buffer.from("<html>tampered</html>"));
    await expect(readSnapshot(dir, result.snapshot.id)).rejects.toThrow(/failed integrity/);
  });

  it("names the missing required artifact instead of dying as a TypeError (M6)", async () => {
    const dir = await freshRoot();
    const result = built();
    const out = await writeSnapshot(dir, result);
    const raw = JSON.parse(await readFile(path.join(out, "meta.json"), "utf8")) as {
      artifacts: Array<{ name: string }>;
    };
    raw.artifacts = raw.artifacts.filter((a) => a.name !== "fields.json");
    await writeFile(path.join(out, "meta.json"), JSON.stringify(raw, null, 2) + "\n");

    await expect(readSnapshot(dir, result.snapshot.id)).rejects.toThrow(/missing required artifact fields\.json/);
  });

  it("parses the stored field dump through the same validation as capture time", async () => {
    const dir = await freshRoot();
    const result = built();
    await writeSnapshot(dir, result);
    await expect(readFieldDump(dir, result.snapshot.id)).resolves.toMatchObject({
      url: "x",
      fields: [],
    });
  });

  it("stamps meta.json with the capture schema version", async () => {
    const dir = await freshRoot();
    const result = built();
    const out = await writeSnapshot(dir, result);
    const meta = JSON.parse(await readFile(path.join(out, "meta.json"), "utf8")) as Record<string, unknown>;
    expect(meta.captureSchema).toBe(CAPTURE_SCHEMA_VERSION);
  });
});

describe("meta-bound binding (H1/M1)", () => {
  it("rejects a snapshot whose meta governance fields were flipped but meta-bound.json is stale", async () => {
    const dir = await freshRoot();
    const result = built();
    const out = await writeSnapshot(dir, result);
    const raw = JSON.parse(await readFile(path.join(out, "meta.json"), "utf8")) as {
      captureMode: string;
      stoppedAt: string;
    };
    raw.captureMode = "authenticated_unreachable";
    raw.stoppedAt = "login_wall";
    await writeFile(path.join(out, "meta.json"), JSON.stringify(raw, null, 2) + "\n");

    await expect(readSnapshot(dir, result.snapshot.id)).rejects.toThrow(/meta-bound/);
  });

  it("rejects a snapshot whose meta-bound.json artifact was edited in place", async () => {
    const dir = await freshRoot();
    const result = built();
    const out = await writeSnapshot(dir, result);
    await writeFile(path.join(out, META_BOUND_ARTIFACT_NAME), Buffer.from("{}"));

    await expect(readSnapshot(dir, result.snapshot.id)).rejects.toThrow(/meta-bound/);
  });

  // Probe-C attack class (panel M1): every non-artifact meta field is
  // provenance. Flipping ANY of them in meta.json — keeping meta-bound.json
  // stale — must fail verification, not silently parse.
  it.each([
    ["capturedAt", (m: Record<string, unknown>) => {
      m.capturedAt = "2030-01-01T00:00:00.000Z";
    }],
    ["resolvedUrl", (m: Record<string, unknown>) => {
      m.resolvedUrl = "https://example.nyc.gov/tampered";
    }],
    ["httpStatus", (m: Record<string, unknown>) => {
      m.httpStatus = 404;
    }],
    ["notes", (m: Record<string, unknown>) => {
      m.notes = "Tampered attestation";
    }],
  ])("rejects a tampered %s in meta.json with a stale meta-bound.json (probe-C)", async (_field, mutate) => {
    const dir = await freshRoot();
    const result = built();
    const out = await writeSnapshot(dir, result);
    const raw = JSON.parse(await readFile(path.join(out, "meta.json"), "utf8")) as Record<string, unknown>;
    mutate(raw);
    await writeFile(path.join(out, "meta.json"), JSON.stringify(raw, null, 2) + "\n");

    await expect(readSnapshot(dir, result.snapshot.id)).rejects.toThrow(/meta-bound/);
  });
});

describe("id ↔ directory binding (M5, S4 M-4/M-5)", () => {
  it("rejects a meta.json planted in a directory named for a different id", async () => {
    const dir = await freshRoot();
    const result = built();
    const out = await writeSnapshot(dir, result);

    const foreignDir = path.join(dir, "snap_000000000000");
    await mkdir(foreignDir, { recursive: true });
    await copyFile(path.join(out, "meta.json"), path.join(foreignDir, "meta.json"));

    await expect(readSnapshotMeta(dir, "snap:000000000000")).rejects.toThrow(/binding broken/);
  });

  it("round-trips well-formed directory names through snapshotIdFromDirName", () => {
    expect(snapshotIdFromDirName("snap_deadbeefcafe")).toBe("snap:deadbeefcafe");
  });
});

describe("listing (M5, H3)", () => {
  it("lists well-formed ids and reports malformed snap_* directories separately", async () => {
    const dir = await freshRoot();
    const result = built();
    await writeSnapshot(dir, result);
    await mkdir(path.join(dir, "snap_backup"), { recursive: true });

    expect(await listSnapshotIds(dir)).toEqual([result.snapshot.id]);
    const dirs = await listSnapshotDirs(dir);
    expect(dirs.find((d) => d.dirName === "snap_backup")).toEqual({ dirName: "snap_backup", id: null });
  });

  it("propagates readdir failures other than ENOENT (fail closed)", async () => {
    const dir = await freshRoot();
    await chmod(dir, 0o000);
    try {
      await expect(listSnapshotIds(dir)).rejects.toThrow();
    } finally {
      await chmod(dir, 0o755);
    }
  });
});

describe("parseSnapshotMeta (strict provenance, M1)", () => {
  it("rejects enum garbage instead of silently defaulting", () => {
    expect(() => parseSnapshotMeta(metaForParse({ captureMode: "Public" }))).toThrow(/captureMode/);
    expect(() => parseSnapshotMeta(metaForParse({ stoppedAt: "wall" }))).toThrow(/stoppedAt/);
    expect(() => parseSnapshotMeta(metaForParse({ method: "authenticated" }))).toThrow(/method/);
  });

  it("rejects a captureMode/stoppedAt mismatch in both directions", () => {
    expect(() => parseSnapshotMeta(metaForParse({ captureMode: "authenticated_unreachable" }))).toThrow(/disagree/);
    expect(() =>
      parseSnapshotMeta(metaForParse({ captureMode: "public_reachable", stoppedAt: "login_wall" })),
    ).toThrow(/disagree/);
  });

  it("requires httpStatus and boundarySignals present and typed", () => {
    expect(() => parseSnapshotMeta(withoutKey(metaForParse(), "httpStatus"))).toThrow(/httpStatus/);
    expect(() => parseSnapshotMeta(metaForParse({ httpStatus: "200" }))).toThrow(/httpStatus/);
    expect(() => parseSnapshotMeta(metaForParse({ httpStatus: 200.5 }))).toThrow(/httpStatus/);
    expect(() => parseSnapshotMeta(withoutKey(metaForParse(), "boundarySignals"))).toThrow(/boundarySignals/);
    expect(() => parseSnapshotMeta(metaForParse({ boundarySignals: "none" }))).toThrow(/boundarySignals/);
    expect(() => parseSnapshotMeta(metaForParse({ boundarySignals: [42] }))).toThrow(/boundarySignals entry/);
  });

  it("rejects unknown top-level meta fields instead of silently ignoring them (M3)", () => {
    // A typo'd field name must be an error, not a silently-dropped field —
    // the same doctrine as the enum garbage tests above.
    expect(() => parseSnapshotMeta(metaForParse({ bogusField: 1 }))).toThrow(/unknown meta.json field "bogusField"/);
    expect(() => parseSnapshotMeta(metaForParse({ captureShema: "0.3.0" }))).toThrow(
      /unknown meta.json field "captureShema"/,
    );
  });

  it("rejects a missing or mismatched captureSchema (M3)", () => {
    expect(() => parseSnapshotMeta(withoutKey(metaForParse(), "captureSchema"))).toThrow(
      /captureSchema must be a string/,
    );
    expect(() => parseSnapshotMeta(metaForParse({ captureSchema: "0.2.0" }))).toThrow(
      /not supported by this verifier/,
    );
  });

  it("rejects artifact names outside the canonical enum, including traversal (M4)", () => {
    expect(() =>
      parseSnapshotMeta(
        metaForParse({ artifacts: [{ name: "../secrets", sha256: HEX64, bytes: 1 }] }),
      ),
    ).toThrow(/artifact name/);
  });

  it("rejects duplicate artifact entries", () => {
    const artifacts = [
      { name: "page.html", sha256: HEX64, bytes: 1 },
      { name: "page.html", sha256: HEX64, bytes: 1 },
    ];
    expect(() => parseSnapshotMeta(metaForParse({ artifacts }))).toThrow(/duplicate artifact/);
  });

  it("accepts a fully valid meta record", () => {
    expect(parseSnapshotMeta(metaForParse()).id).toBe("snap:000000000000");
  });
});

describe("parseFieldDumpFromContents", () => {
  it("throws the designed error when fields.json is absent", () => {
    expect(() => parseFieldDumpFromContents(new Map())).toThrow(/missing the required artifact fields\.json/);
  });
});

describe("committed fixture schema pin (M3)", () => {
  it("was migrated to the current capture schema and parses under it", async () => {
    const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/snapshots");
    const ids = await listSnapshotIds(fixtureRoot);
    expect(ids).toHaveLength(1);
    const meta = await readSnapshotMeta(fixtureRoot, ids[0]!);
    expect(meta.captureSchema).toBe(CAPTURE_SCHEMA_VERSION);
    // The pin that keeps this test (and the catalog pipeline) honest when the
    // fixture drifts: id ↔ directory ↔ bundle must agree.
    expect(ids[0]).toBe(`snap:${meta.id.slice(5)}`);
    expect(meta.id).toBe("snap:a777dc9a2500");
  });
});
