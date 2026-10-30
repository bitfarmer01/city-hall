import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
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

describe("replay CLI (spawned, one tampered row per failure mode, M5)", () => {
  // Each case builds a fully valid governed root, corrupts exactly one thing,
  // and asserts the real CLI exits non-zero with the designed complaint. Five
  // cheap spawns, no browser — the CLI is the gate CI actually runs.
  const modes: Array<{
    name: string;
    mutate: (root: string) => Promise<void>;
    expectError: RegExp;
  }> = [
    {
      name: "hash mismatch (captured artifact byte flipped)",
      mutate: async (root) => {
        const snapDir = path.join(root, (await readdir(root)).find((d) => d.startsWith("snap_"))!);
        await writeFile(path.join(snapDir, "page.html"), Buffer.from("<html>tampered</html>"));
      },
      expectError: /failed integrity/,
    },
    {
      name: "strip-governance (meta.json provenance flipped, meta-bound stale)",
      mutate: async (root) => {
        const snapDir = path.join(root, (await readdir(root)).find((d) => d.startsWith("snap_"))!);
        const metaPath = path.join(snapDir, "meta.json");
        // Keep the pair internally consistent so the PARSER accepts it — the
        // stale meta-bound.json binding is what must catch this tamper.
        const meta = JSON.parse(await readFile(metaPath, "utf8")) as { captureMode: string; stoppedAt: string };
        meta.captureMode = "authenticated_unreachable";
        meta.stoppedAt = "login_wall";
        await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n");
      },
      expectError: /meta does not match/,
    },
    {
      name: "unreadable evidence (artifact chmod 000)",
      mutate: async (root) => {
        const snapDir = path.join(root, (await readdir(root)).find((d) => d.startsWith("snap_"))!);
        await chmod(path.join(snapDir, "page.html"), 0o000);
      },
      expectError: /EACCES|permission denied/i,
    },
    {
      name: "malformed governance (meta-bound.json replaced with junk bytes)",
      mutate: async (root) => {
        const snapDir = path.join(root, (await readdir(root)).find((d) => d.startsWith("snap_"))!);
        await writeFile(path.join(snapDir, "meta-bound.json"), Buffer.from("{}"));
      },
      expectError: /failed integrity/,
    },
    {
      name: "expectations-EACCES (expectations dir unreadable)",
      mutate: async (root) => {
        await chmod(path.join(root, "expectations"), 0o000);
      },
      expectError: /EACCES|permission denied/i,
    },
  ];

  it.each(modes)("exits non-zero when $name", async ({ mutate, expectError }) => {
    const root = await governedRootWith("Example service", ["Applicant full name"]);
    await mutate(root);
    const result = runReplay(["--root", root]);
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(expectError);
  });
});

describe("replay CLI (spawned, log-injection hardening + snap-file rows)", () => {
  it("escapes control characters and surfaces snap_-prefixed files as error rows", async () => {
    const root = await governedRootWith("Example service", ["Applicant full name"]);
    await mkdir(path.join(root, "snap_evil\u001b[31m\nINJECTED"), { recursive: true });
    await writeFile(path.join(root, "snap_0123456789ab"), Buffer.from("stray bytes"));

    const result = runReplay(["--root", root]);
    expect(result.status).toBe(1); // error rows fail closed
    const out = `${result.stdout}${result.stderr}`;
    // Control characters escaped, never raw — no forged lines in the gate log.
    expect(out).toContain("\\u001b");
    expect(out).not.toMatch(/\u001b/);
    expect(out).not.toMatch(/\nINJECTED/);
    // The snap_-prefixed file surfaces as an error row, not silence.
    expect(out).toContain("snap_0123456789ab");
    expect(out).toMatch(/file/i);
  });
});
