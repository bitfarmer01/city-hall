import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSourceSnapshot, writeSnapshot } from "./store";
import type { BoundaryKind, FormFieldDump } from "./types";
import { replayRoot } from "./replay";

async function freshRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cityhall-replay-"));
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
    [{ name: "fields.json", bytes: Buffer.from(JSON.stringify(dump)) }],
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

describe("committed fixture replay (real capture, zero network)", () => {
  // The fixture is a real live capture of a public NYC311 page, committed so
  // this test proves the harness reproduces offline: hash-verified reads, a
  // parsed field dump, and a clean empty-expectation diff.
  const FIXTURE_ROOT = "fixtures/snapshots";
  const FIXTURE_ID = "snap:a59b2828c958";

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
