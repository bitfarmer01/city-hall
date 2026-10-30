#!/usr/bin/env node
// CI smoke: /api/health must answer 200 with ok status and version stamps.
// Retries until the server accepts connections or the deadline passes, so CI
// step ordering stays simple (start server in background, run this, kill it).

const url = process.argv[2] ?? "http://localhost:3000/api/health";
const timeoutMs = 60_000;
const deadline = Date.now() + timeoutMs;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let response;
for (;;) {
  try {
    response = await fetch(url);
    if (response.ok) break;
    console.error(`smoke: ${url} answered HTTP ${response.status}`);
  } catch {
    // server not accepting connections yet
  }
  if (Date.now() > deadline) {
    console.error(`smoke: giving up on ${url} after ${timeoutMs}ms`);
    process.exit(1);
  }
  await sleep(500);
}

const body = await response.json();
const problems = [];
if (body?.status !== "ok") {
  problems.push(`status is ${JSON.stringify(body?.status)}, expected "ok"`);
}
if (typeof body?.app?.version !== "string" || body.app.version === "") {
  problems.push("app.version stamp missing");
}
if (typeof body?.schema?.version !== "string" || body.schema.version === "") {
  problems.push("schema.version stamp missing");
}

if (problems.length > 0) {
  console.error(`smoke failed: ${problems.join("; ")}`);
  console.error(`payload: ${JSON.stringify(body)}`);
  process.exit(1);
}

console.log(
  `smoke ok: ${url} -> status=${body.status} app=${body.app.version} schema=${body.schema.version}`,
);
