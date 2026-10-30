import { readFile, readdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// M14: the capture CLI must produce a real snapshot directory with a stop
// record when the target is a boundary page — spawned end-to-end over tsx,
// chromium included. The spawn MUST be async: the mock server lives in this
// worker's event loop, and a sync spawn would block the very loop the server
// needs to answer the browser (learned the hard way — goto timed out with the
// server never logging a request).
const LOGIN_PAGE = `<!doctype html>
<html>
  <head><title>Sign in — NYC.ID</title></head>
  <body>
    <form action="/credentials-post-target" method="post">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" />
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`;

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCapture(args: string[], timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "scripts/capture-portal.ts", ...args]);
    const { stdout, stderr } = child;
    if (!stdout || !stderr) {
      reject(new Error("capture CLI child streams unavailable"));
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("capture CLI did not finish in time"));
    }, timeoutMs);
    stdout.on("data", (chunk: Buffer) => out.push(chunk));
    stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
  });
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(LOGIN_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("mock server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe("capture CLI (spawned, boundary-stop route, M14)", () => {
  it("captures a login wall to exit 0 with a stop record on disk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cityhall-capture-cli-"));
    const result = await runCapture([`${baseUrl}/sign-in`, "--root", root], 180_000);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      snapshotId: string;
      dir: string;
      captureMode: string;
      stoppedAt: string;
      boundarySignals: string[];
    };
    expect(report.captureMode).toBe("authenticated_unreachable");
    // The mock page mentions NYC.ID, so the more specific nyc_id boundary
    // takes precedence over the generic login_wall stop reason.
    expect(report.stoppedAt).toBe("nyc_id");
    expect(report.boundarySignals).toContain("nyc_id_marker_with_password_field");

    // The snapshot is really on disk under its content-derived directory.
    const dirname = `snap_${report.snapshotId.slice("snap:".length)}`;
    const meta = JSON.parse(await readFile(path.join(root, dirname, "meta.json"), "utf8")) as {
      id: string;
      artifacts: Array<{ name: string }>;
    };
    expect(meta.id).toBe(report.snapshotId);
    expect(meta.artifacts.map((a) => a.name)).toContain("meta-bound.json");
    const files = await readdir(path.join(root, dirname));
    expect(files).toContain("meta-bound.json");
    expect(files).toContain("screenshot.png");
  });
});

describe("capture CLI (default-root notice)", () => {
  const CORPUS_WARNING = /committed evidence corpus/;
  const listCorpus = async (): Promise<string[]> =>
    (await readdir("fixtures/snapshots")).filter((d) => d.startsWith("snap_")).sort();

  it("prints a loud warning when no --root is given — the default lands in the committed evidence corpus", async () => {
    const before = await listCorpus();
    // Unreachable target: the capture fails before anything is written, so
    // the run cannot pollute the committed corpus it is warning about.
    const result = await runCapture(["http://127.0.0.1:1/unreachable"], 120_000);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(CORPUS_WARNING);
    expect(await listCorpus()).toEqual(before);
  });

  it("stays silent about the corpus when --root is passed explicitly", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cityhall-capture-cli-rooted-"));
    const result = await runCapture(["http://127.0.0.1:1/unreachable", "--root", root], 120_000);

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toMatch(CORPUS_WARNING);
  });
});
