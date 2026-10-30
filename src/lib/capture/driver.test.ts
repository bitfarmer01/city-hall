import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { capturePage } from "./driver";
import { writeSnapshot } from "./store";

/**
 * Boundary-stop tests over real (mocked) HTTP: a local server plays the
 * portal, so every stop condition is exercised end-to-end — real navigation,
 * real rendering, no live-network dependency.
 *
 * The credential-stop proof is structural: the mock server logs every
 * request it receives, and the login page's form posts to /credentials-post-target.
 * A capture that "attempted credentials" would show a POST there; the test
 * asserts the server saw nothing but the initial GET.
 */

interface Route {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

const PUBLIC_FORM = `<!doctype html><html><head><title>Apply for a Sidewalk Cafe Permit — NYC</title></head>
<body>
<main><h1>Application</h1>
<form action="/credentials-post-target" method="post">
  <label for="f-name">Applicant full name *</label>
  <input id="f-name" name="applicant_name" type="text" required>
  <label for="f-borough">Borough *</label>
  <select id="f-borough" name="borough" required>
    <option value="">Choose borough…</option>
    <option>Manhattan</option><option>Brooklyn</option><option>Queens</option>
  </select>
  <label for="f-doc">Supporting document</label>
  <input id="f-doc" name="supporting_doc" type="file" accept=".pdf,.jpg" multiple>
  <label>Same as mailing address <input name="same_address" type="checkbox" value="yes"></label>
  <label for="f-notes">Notes</label>
  <textarea id="f-notes" name="notes"></textarea>
  <button type="submit">Submit application</button>
</form></main>
</body></html>`;

const LOGIN_WALL = `<!doctype html><html><head><title>Member sign in — City Portal</title></head>
<body>
<main><h1>Sign in to continue</h1>
<form action="/credentials-post-target" method="post">
  <label for="l-email">Email</label><input id="l-email" name="email" type="email" required>
  <label for="l-pass">Password</label><input id="l-pass" name="password" type="password" required>
  <button type="submit">Sign in</button>
</form></main>
</body></html>`;

const NYC_ID_WALL = LOGIN_WALL.replace("Member sign in — City Portal", "Sign in with NYC.ID");

const CHALLENGE_PAGE = `<!doctype html><html><head><title>Just a moment...</title></head>
<body><script>window._cf_chl_opt = { challenge: true };</script>
<p>Verifying your browser before proceeding.</p></body></html>`;

const routes: Record<string, Route> = {
  "/public-form": { status: 200, body: PUBLIC_FORM },
  "/login-wall": { status: 200, body: LOGIN_WALL },
  "/nycid-wall": { status: 200, body: NYC_ID_WALL },
  "/challenge": { status: 503, headers: { "cf-mitigated": "challenge" }, body: CHALLENGE_PAGE },
  "/rate-limited": { status: 429, headers: { "retry-after": "60" }, body: "Too many requests" },
  "/not-found": { status: 404, body: "Page not found" },
};

let server: Server;
let baseUrl: string;
let seen: Array<{ method: string; url: string }>;

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ method: req.method ?? "?", url: req.url ?? "?" });
    const route = routes[req.url?.split("?")[0] ?? ""];
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("no route");
      return;
    }
    res.writeHead(route.status, { "content-type": "text/html; charset=utf-8", ...route.headers });
    res.end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

async function capture(pathname: string) {
  seen = [];
  const context = await browser.newContext(); // incognito: no cookies, no storage state
  const page = await context.newPage();
  try {
    const result = await capturePage(page, `${baseUrl}${pathname}`, { capturedAt: "2026-10-30T12:00:00.000Z" });
    // Public-boundary policy holds for EVERY capture — public or boundary-stopped:
    // GETs only, and the login form's credential post target is never touched
    // (M15: shared here so all blocked-route tests inherit the assertion).
    expect(seen.some((r) => r.method !== "GET" || r.url.includes("credentials-post-target"))).toBe(false);
    return result;
  } finally {
    await context.close();
  }
}

describe("capturePage over mocked portals", { timeout: 120_000 }, () => {
  it("captures a public form: mode public_reachable, real field dump, no requests beyond GETs", async () => {
    const { snapshot, contents } = await capture("/public-form");

    expect(snapshot.captureMode).toBe("public_reachable");
    expect(snapshot.stoppedAt).toBe("none");
    expect(snapshot.httpStatus).toBe(200);
    expect(snapshot.method).toBe("headless");
    expect(snapshot.notes).toMatch(/no credentials used/);
    expect(snapshot.url).toBe(`${baseUrl}/public-form`);

    const fields = JSON.parse(contents.get("fields.json")!.toString("utf8")) as {
      fields: Array<{ label: string; type: string; required: boolean; options: string[]; accept: string | null; multiple: boolean }>;
      submitButtons: string[];
    };
    const byLabel = new Map(fields.fields.map((f) => [f.label, f]));

    const nameField = byLabel.get("Applicant full name *");
    expect(nameField).toMatchObject({ type: "text", required: true });

    const borough = byLabel.get("Borough *");
    expect(borough?.options).toEqual(["Choose borough…", "Manhattan", "Brooklyn", "Queens"]);

    const doc = byLabel.get("Supporting document");
    expect(doc).toMatchObject({ accept: ".pdf,.jpg", multiple: true });

    const checkbox = fields.fields.find((f) => f.type === "checkbox");
    expect(checkbox?.options).toEqual(["yes"]);

    expect(fields.submitButtons).toContain("Submit application");

    // Dump records attribute data only — never values.
    expect(Object.keys(fields.fields[0])).not.toContain("value");
  });

  it("stops at a mocked login wall: authenticated_unreachable, no credentials attempted", async () => {
    const { snapshot } = await capture("/login-wall");

    expect(snapshot.captureMode).toBe("authenticated_unreachable");
    expect(snapshot.stoppedAt).toBe("login_wall");
    expect(snapshot.boundarySignals).toContain("password_field_present_without_public_form");
  });

  it("stops on an NYC.ID sign-in page", async () => {
    const { snapshot } = await capture("/nycid-wall");
    expect(snapshot.captureMode).toBe("authenticated_unreachable");
    expect(snapshot.stoppedAt).toBe("nyc_id");
  });

  it("stops on an anti-bot challenge (cf-mitigated header)", async () => {
    const { snapshot } = await capture("/challenge");
    expect(snapshot.captureMode).toBe("authenticated_unreachable");
    expect(snapshot.stoppedAt).toBe("anti_bot");
    expect(snapshot.boundarySignals).toContain("cf_mitigated_challenge_header");
  });

  it("stops on a rate-limit response without retrying", async () => {
    const { snapshot } = await capture("/rate-limited");
    expect(snapshot.captureMode).toBe("authenticated_unreachable");
    expect(snapshot.stoppedAt).toBe("rate_limited");
    expect(snapshot.httpStatus).toBe(429);
    // Exactly one request for the document: no retry loop against the limit.
    expect(seen.filter((r) => r.url.startsWith("/rate-limited"))).toHaveLength(1);
  });

  it("records plain 404s as an error stop", async () => {
    const { snapshot } = await capture("/not-found");
    expect(snapshot.stoppedAt).toBe("error");
    expect(snapshot.httpStatus).toBe(404);
  });

  it("stores and re-reads a capture with hash-verified integrity", async () => {
    const { tmpdir } = await import("node:os");
    const { mkdtemp } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "cityhall-driver-"));

    const result = await capture("/public-form");
    await writeSnapshot(root, result);
    const reread = await import("./store").then((m) => m.readSnapshot(root, result.snapshot.id));
    expect(reread.snapshot).toEqual(result.snapshot);
    expect(reread.contents.get("fields.json")).toBeDefined();
  });

  it("is missing nothing in meta: every artifact hash recomputes", async () => {
    const { sha256Hex } = await import("./hash");
    const { snapshot, contents } = await capture("/public-form");
    for (const artifact of snapshot.artifacts) {
      expect(sha256Hex(contents.get(artifact.name)!)).toBe(artifact.sha256);
      expect(artifact.bytes).toBe(contents.get(artifact.name)!.length);
    }
  });
});
