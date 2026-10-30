import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSourceSnapshot, listSnapshotIds, readFieldDump, readSnapshot, readSnapshotMeta, writeSnapshot } from "./store";
import { CAPTURE_SCHEMA_VERSION } from "./types";

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
      [{ name: "page.html", bytes: Buffer.from("<html>form!</html>") }],
    );
    expect(modified.snapshot.id).not.toBe(built().snapshot.id);
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
    const { readFile } = await import("node:fs/promises");
    const meta = JSON.parse(await readFile(path.join(out, "meta.json"), "utf8")) as Record<string, unknown>;
    expect(meta.captureSchema).toBe(CAPTURE_SCHEMA_VERSION);
  });
});
