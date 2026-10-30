import { describe, expect, it } from "vitest";

import { bundleSha256, sha256Hex, snapshotDirName, snapshotId, snapshotIdFromDirName } from "./hash";

describe("sha256Hex", () => {
  it("hashes the empty string to the known sha256 value", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes buffers and strings of identical bytes identically", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe(sha256Hex("abc"));
  });
});

describe("bundleSha256", () => {
  it("is order-independent over artifact hashes", () => {
    const a = { name: "page.html", sha256: "aa".repeat(32) };
    const b = { name: "fields.json", sha256: "bb".repeat(32) };
    expect(bundleSha256([a, b])).toBe(bundleSha256([b, a]));
  });

  it("differs when any artifact hash differs", () => {
    const a = { name: "page.html", sha256: "aa".repeat(32) };
    const b = { name: "page.html", sha256: "bb".repeat(32) };
    expect(bundleSha256([a])).not.toBe(bundleSha256([b]));
  });
});

describe("snapshotId", () => {
  it("takes the first 12 hex chars of the bundle hash", () => {
    const bundle = "a".repeat(64);
    expect(snapshotId(bundle)).toBe(`snap:${"a".repeat(12)}`);
  });

  it("rejects input that is not a 64-char hex hash", () => {
    expect(() => snapshotId("nothex")).toThrow(/not 64 hex chars/);
  });
});

describe("dir-name round trip", () => {
  it("maps id to filesystem-safe dir name and back", () => {
    const id = snapshotId("a".repeat(64));
    const dir = snapshotDirName(id);
    expect(dir).toMatch(/^snap_[0-9a-f]{12}$/);
    expect(snapshotIdFromDirName(dir)).toBe(id);
  });

  it("rejects malformed ids and dir names", () => {
    expect(() => snapshotDirName("snap:zzz")).toThrow(/not a snapshot id/);
    expect(() => snapshotIdFromDirName("other_abc")).toThrow(/not a snapshot directory/);
  });
});
