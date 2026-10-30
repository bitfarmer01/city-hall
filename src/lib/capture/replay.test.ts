import { cp, mkdir, mkdtemp, readFile, readdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSourceSnapshot, writeSnapshot } from "./store";
import type { BoundaryKind, FormFieldDump } from "./types";
import { loadExpectations, replayRoot } from "./replay";

async function freshRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cityhall-replay-"));
}

/** Copies the committed real capture into a tmp root so tamper tests can mutilate a copy. */
async function copyFixtureToTemp(): Promise<string> {
  const root = await freshRoot();
  await cp(path.join("fixtures", "snapshots"), root, { recursive: true });
  return root;
}

function dumpWith(fields: FormFieldDump["fields"]): FormFieldDump {
  return {
    url: "https://example.nyc.gov/form",
    capturedAt: "2026-10-30T12:00:00.000Z",
    fields,
    submitButtons: ["Submit"],
  };
}

const TEXT_FIELD = {
  tag: "input" as const,
  type: "text",
  name: "applicant_name",
  id: "f1",
  label: "Applicant full name",
  required: true,
  requiredMarker: true,
  options: [],
  optionsTotal: 0,
  accept: null,
  multiple: false,
};

async function snapshotWith(root: string, opts: { url: string; fields: FormFieldDump["fields"]; mode?: "public_reachable" | "authenticated_unreachable"; stoppedAt?: BoundaryKind }) {
  const dump = dumpWith(opts.fields);
  const result = buildSourceSnapshot(
    {
      url: opts.url,
      resolvedUrl: opts.url,
      capturedAt: "2026-10-30T12:00:00.000Z",
      method: "headless",
      httpStatus: 200,
      captureMode: opts.mode ?? "public_reachable",
      stoppedAt: opts.stoppedAt ?? "none",
      boundarySignals: [],
      notes: null,
    },
    [
      { name: "fields.json", bytes: Buffer.from(JSON.stringify(dump)) },
      { name: "page.html", bytes: Buffer.from("<html>form</html>") },
      { name: "screenshot.png", bytes: Buffer.from("png-bytes") },
    ],
  );
  await writeSnapshot(root, result);
  return result;
}

async function writeExpectation(root: string, sourceUrl: string, labels: string[]): Promise<void> {
  await mkdir(path.join(root, "expectations"), { recursive: true });
  await writeFile(
    path.join(root, "expectations", "svc-test.json"),
    JSON.stringify(expectationFile(sourceUrl, labels)),
  );
}

function expectationFile(sourceUrl: string, labels: string[]) {
  return {
    serviceId: "svc:test:example",
    label: "Example service",
    sourceUrl,
    expectedFields: labels.map((label) => ({ label, type: "text", required: false })),
    expectedDocuments: [],
  };
}

describe("replayRoot (offline, zero network)", () => {
  it("reports ungoverned when no expectation matches", async () => {
    const root = await freshRoot();
    await snapshotWith(root, { url: "https://example.nyc.gov/form", fields: [TEXT_FIELD] });

    const report = await replayRoot(root);
    expect(report.snapshotCount).toBe(1);
    expect(report.blockingFailures).toBe(0);
    expect(report.rows[0].status).toBe("ungoverned");
  });

  it("reproduces the golden diff from the stored snapshot only", async () => {
    const root = await freshRoot();
    const url = "https://example.nyc.gov/form";
    await snapshotWith(root, { url, fields: [TEXT_FIELD] });
    // Expectation omits the required field the live dump carries → the
    // replayed diff must catch it, with no page ever fetched.
    await writeExpectation(root, url, []);

    const report = await replayRoot(root);
    expect(report.rows[0].status).toBe("fail");
    expect(report.rows[0].failures[0].reason).toBe("live_only_required");
    expect(report.blockingFailures).toBe(1);
  });

  it("passes a governed snapshot whose fields match the expectation", async () => {
    const root = await freshRoot();
    const url = "https://example.nyc.gov/form";
    await snapshotWith(root, { url, fields: [TEXT_FIELD] });
    await writeExpectation(root, url, ["Applicant full name"]);

    const report = await replayRoot(root);
    expect(report.rows[0].status).toBe("ok");
    expect(report.blockingFailures).toBe(0);
  });

  it("skips boundary-stopped snapshots without failing", async () => {
    const root = await freshRoot();
    await snapshotWith(root, {
      url: "https://example.nyc.gov/login",
      fields: [],
      mode: "authenticated_unreachable",
      stoppedAt: "login_wall",
    });

    const report = await replayRoot(root);
    expect(report.rows[0].status).toBe("skipped_boundary");
    expect(report.rows[0].stoppedAt).toBe("login_wall");
    expect(report.blockingFailures).toBe(0);
  });
});

describe("fail-closed evidence (tamper, governance, junk dirs)", () => {
  it("fails closed on an empty snapshot root (H3)", async () => {
    await expect(replayRoot(await freshRoot())).rejects.toThrow(/no snapshots/i);
  });

  it("fails closed when the expectations dir is unreadable (H3)", async () => {
    const root = await freshRoot();
    await mkdir(path.join(root, "expectations"));
    await chmod(path.join(root, "expectations"), 0o000);
    try {
      await expect(loadExpectations(path.join(root, "expectations"))).rejects.toThrow();
    } finally {
      await chmod(path.join(root, "expectations"), 0o755);
    }
  });

  it("throws when a captured artifact byte is tampered, even for an ungoverned snapshot (H2)", async () => {
    const root = await copyFixtureToTemp();
    const snapDir = path.join(root, (await readdir(root)).find((d) => d.startsWith("snap_"))!);
    const page = await readFile(path.join(snapDir, "page.html"));
    await writeFile(path.join(snapDir, "page.html"), Buffer.concat([page, Buffer.from("tampered")]));

    await expect(replayRoot(root)).rejects.toThrow(/failed integrity/);
  });

  it("throws when meta.json governance fields no longer match the hashed governance.json (H1)", async () => {
    const root = await copyFixtureToTemp();
    const snapDir = path.join(root, (await readdir(root)).find((d) => d.startsWith("snap_"))!);
    const metaPath = path.join(snapDir, "meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as { captureMode: string; stoppedAt: string };
    // Keep the pair internally consistent so the parser accepts it — the
    // stale governance.json binding is what must catch the tamper.
    meta.captureMode = "authenticated_unreachable";
    meta.stoppedAt = "login_wall";
    await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n");

    await expect(replayRoot(root)).rejects.toThrow(/governance/);
  });

  it("isolates a stray snapshot-named directory as an error row and still replays the rest (M5)", async () => {
    const root = await freshRoot();
    await snapshotWith(root, { url: "https://example.nyc.gov/form", fields: [TEXT_FIELD] });
    await mkdir(path.join(root, "snap_backup"), { recursive: true });

    const report = await replayRoot(root);
    expect(report.errorCount).toBe(1);
    const errorRow = report.rows.find((r) => r.status === "error");
    expect(errorRow?.snapshotId).toBe("snap_backup");
    expect(errorRow?.error).toMatch(/not a valid snapshot directory name/);
    expect(report.snapshotCount).toBe(1);
    expect(report.rows.some((r) => r.status === "ungoverned")).toBe(true);
  });
});

describe("committed fixture replay (real capture, zero network)", () => {
  // The fixture is a real live capture of a public NYC311 page, committed so
  // this test proves the harness reproduces offline: hash-verified reads, a
  // parsed field dump, and a clean empty-expectation diff. replayRoot
  // verifies every row before classification, so a green replay here means
  // the fixture survived verification, not just parsing.
  const FIXTURE_ROOT = "fixtures/snapshots";
  const FIXTURE_ID = "snap:9ff1f116b526";

  it("replays the committed real capture with verified integrity", async () => {
    const report = await replayRoot(FIXTURE_ROOT);

    expect(report.snapshotCount).toBeGreaterThanOrEqual(1);
    const row = report.rows.find((r) => r.snapshotId === FIXTURE_ID);
    expect(row, "committed fixture snapshot must exist").toBeDefined();
    expect(row!.url).toBe("https://portal.311.nyc.gov/article/?kanumber=KA-01808");
    expect(row!.captureMode).toBe("public_reachable");
    expect(row!.status).toBe("ungoverned"); // no catalog expectation committed yet
    expect(report.blockingFailures).toBe(0);
  });

  it("parses the committed dump: real form controls, attribute data only", async () => {
    const { readFieldDump } = await import("./store");
    const dump = await readFieldDump(FIXTURE_ROOT, FIXTURE_ID);

    expect(dump.fields.length).toBeGreaterThan(0);
    // Real Dynamics form controls from the live page.
    expect(dump.fields.some((f) => f.name.includes("EntityFormView"))).toBe(true);
    expect(dump.fields.every((f) => !("value" in f))).toBe(true);
    expect(dump.url).toBe("https://portal.311.nyc.gov/article/?kanumber=KA-01808");
  });
});
