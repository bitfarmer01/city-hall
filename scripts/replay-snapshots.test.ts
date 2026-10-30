import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { buildSourceSnapshot, writeSnapshot } from "../src/lib/capture/store";

// M14: the replay gate must be a real command-line contract — exit 0 only on
// a fully verified, fully passing replay; non-zero on tampering, missing
// required fields, or an empty/unreadable root. These tests spawn the actual
// script (via tsx) exactly the way CI runs it.
function runReplay(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/replay-snapshots.ts", ...args], {
    encoding: "utf8",
    timeout: 120_000,
  });
}

const FIELD = {
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

async function governedRootWith(label: string, expectedLabels: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "cityhall-replay-cli-"));
  const url = "https://example.nyc.gov/form";
  const result = buildSourceSnapshot(
    {
      url,
      resolvedUrl: url,
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
      {
        name: "fields.json",
        bytes: Buffer.from(
          JSON.stringify({ url, capturedAt: "2026-10-30T12:00:00.000Z", fields: [FIELD], submitButtons: ["Submit"] }),
        ),
      },
    ],
  );
  await writeSnapshot(root, result);
  await mkdir(path.join(root, "expectations"), { recursive: true });
  await writeFile(
    path.join(root, "expectations", "svc-test.json"),
    JSON.stringify({
      serviceId: "svc:test:example",
      label,
      sourceUrl: url,
      expectedFields: expectedLabels.map((l) => ({ label: l, type: "text", required: false })),
      expectedDocuments: [],
    }),
  );
  return root;
}

describe("replay CLI (spawned, exit codes per M14)", () => {
  it("exits 0 against the committed fixture root", () => {
    const result = runReplay([]); // exercises the shared DEFAULT_SNAPSHOT_ROOT (M11)
    expect(result.status).toBe(0);
    // Text summary line carries the counts; the CLI is a gate, not a JSON API.
    expect(result.stdout).toMatch(/snapshots [1-9]\d*, blocking failures 0, unreadable 0/);
    expect(result.stdout).toContain("snap:");
  });

  it("exits 1 when a governed snapshot fails its expectation (missing required field)", async () => {
    const root = await governedRootWith("Example service", []); // expectation omits the required field
    const result = runReplay(["--root", root]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/blocking failures 1/);
  });

  it("exits non-zero on an empty root (fail closed, H3)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cityhall-replay-cli-empty-"));
    const result = runReplay(["--root", root]);
    expect(result.status).not.toBe(0);
  });

  it("exits non-zero when the root does not exist", () => {
    const result = runReplay(["--root", "/nonexistent/snapshot-root-xyz"]);
    expect(result.status).not.toBe(0);
  });
});
