// Check A runner — the committed script the build spec's first
// definition-of-done check executes (art_RVpFZFo1, D10; harness design
// art_wJiwwN0o §4a): sample 100 NYC311 A-to-Z articles with a fixed seed from
// the STORED index snapshot, fetch each live page, classify with the
// deterministic rules, resolve through the crosswalk, and write the committed
// report. Gate: >=95% resolve to a service record or an explicit
// out-of-scope entry; zero validity breaches.
//
// Usage:
//   npm run check:a                          # live fetch of the 100 sampled pages
//   npm run check:a -- --fixture-dir=<dir>   # replay from <dir>/KA-#####.html
//       [--snapshot=<path>] [--out=<dir>] [--timeout-ms=<n>]
//   npm run check:a -- --sample-only         # verify the committed sample
//       matches a fresh fixed-seed derivation — no fetch, no harness run;
//       the CI step for pull requests (fast, deterministic)
//
// Capture policy (locked decision #10): public boundaries only; one fetch
// attempt per article — login walls, anti-bot challenges, and rate limits
// are stop conditions, never bypassed, never retried. A mass of dead pages
// trips the harness's stop-condition breach instead of passing silently.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractArticlePageFacts } from "../src/lib/validation/article-facts";
import {
  deriveSampleRecord,
  diffSampleRecord,
  runCheckA,
  type CheckASampleRecord,
  type PageSource,
} from "../src/lib/validation/check-a";
import {
  CHECK_A_SAMPLE_SIZE,
  CHECK_A_SEED,
  sampleArticles,
} from "../src/lib/validation/sample";
import { courtesyDelay, fetchArticlePage } from "../src/lib/inventory/fetch-nyc311";
import { parseSnapshotJson } from "../src/lib/inventory/build-snapshot";
import { loadCatalogBundle } from "../src/lib/resolver/catalog-source";
import { renderCheckAJson, renderCheckAMarkdown } from "../src/lib/validation/report";

interface CheckArgs {
  fixtureDir: string | null;
  snapshotPath: string;
  outDir: string;
  timeoutMs: number;
  courtesyDelayMs: number;
  sampleOnly: boolean;
}

const DEFAULT_SNAPSHOT = "data/snapshots/nyc311-index/2026-10-30.json";
const DEFAULT_OUT_DIR = "data/reports/check-a";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_COURTESY_DELAY_MS = 1000;

function parseArgs(argv: readonly string[]): CheckArgs {
  const args: CheckArgs = {
    fixtureDir: null,
    snapshotPath: DEFAULT_SNAPSHOT,
    outDir: DEFAULT_OUT_DIR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    courtesyDelayMs: DEFAULT_COURTESY_DELAY_MS,
    sampleOnly: false,
  };
  for (const arg of argv) {
    const [flag, ...rest] = arg.split("=");
    const value = rest.join("=");
    switch (flag) {
      case "--fixture-dir":
        args.fixtureDir = value;
        break;
      case "--snapshot":
        args.snapshotPath = value;
        break;
      case "--out":
        args.outDir = value;
        break;
      case "--timeout-ms":
        args.timeoutMs = Number.parseInt(value, 10);
        if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0) {
          throw new Error(`--timeout-ms must be a positive integer, got "${value}"`);
        }
        break;
      case "--courtesy-delay-ms":
        args.courtesyDelayMs = Number.parseInt(value, 10);
        if (!Number.isInteger(args.courtesyDelayMs) || args.courtesyDelayMs < 0) {
          throw new Error(`--courtesy-delay-ms must be a non-negative integer, got "${value}"`);
        }
        break;
      case "--sample-only":
        args.sampleOnly = true;
        break;
      default:
        throw new Error(`unknown argument "${arg}"`);
    }
  }
  return args;
}

function readCommittedSample(path: string): CheckASampleRecord | null {
  if (!existsSync(path)) {
    return null;
  }
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path}: committed sample record is malformed`);
  }
  return value as CheckASampleRecord;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const snapshot = parseSnapshotJson(readFileSync(args.snapshotPath, "utf8"));
  const bundle = loadCatalogBundle();
  console.log(
    `snapshot ${args.snapshotPath}: ${snapshot.articleCount} articles ` +
      `(sha ${snapshot.sourceSha256.slice(0, 12)}); catalog ${bundle.catalogVersion}: ` +
      `${bundle.services.length} services, ${bundle.crosswalks.length} crosswalks`,
  );

  // The committed sample makes runs comparable over time; staleness is a
  // hard precondition, not a report row — the sample must be re-committed
  // deliberately (a reviewed diff), never silently redrawn.
  const freshSample = deriveSampleRecord(args.snapshotPath, snapshot, CHECK_A_SEED, CHECK_A_SAMPLE_SIZE);
  const samplePath = join(args.outDir, "sample.json");
  const committedSample = readCommittedSample(samplePath);
  if (committedSample) {
    const drift = diffSampleRecord(committedSample, freshSample);
    if (drift.length > 0) {
      for (const violation of drift) {
        console.error(`committed sample is stale: ${violation}`);
      }
      console.error("re-run this script and commit the refreshed sample.json (a reviewed diff)");
      process.exitCode = 1;
      return;
    }
  }
  if (args.sampleOnly) {
    console.log(
      committedSample
        ? "committed sample matches the fresh fixed-seed derivation"
        : "no committed sample yet — run the full check to write one",
    );
    return;
  }

  const drawn = sampleArticles(snapshot.articles, CHECK_A_SEED, CHECK_A_SAMPLE_SIZE);
  const pages = new Map<string, PageSource>();
  let fetched = 0;
  for (const entry of drawn) {
    if (args.fixtureDir) {
      const fixturePath = join(args.fixtureDir, `${entry.ka}.html`);
      pages.set(
        entry.ka,
        existsSync(fixturePath)
          ? { html: readFileSync(fixturePath, "utf8") }
          : { error: `fixture missing: ${fixturePath}` },
      );
      continue;
    }
    try {
      const html = await fetchArticlePage(entry.ka, args.timeoutMs);
      pages.set(entry.ka, { html });
      fetched += 1;
      const facts = extractArticlePageFacts(html);
      console.log(
        `${entry.ka} fetched (${fetched}/${drawn.length})` +
          `${facts.kaContentPresent ? "" : " — NO ka-content (dead page)"}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pages.set(entry.ka, { error: message });
      console.error(`${entry.ka} fetch failed: ${message}`);
    }
    if (args.courtesyDelayMs > 0) {
      await courtesyDelay(args.courtesyDelayMs);
    }
  }

  const run = await runCheckA({
    snapshotPath: args.snapshotPath,
    snapshot,
    bundle,
    pages,
    seed: CHECK_A_SEED,
    sampleSize: CHECK_A_SAMPLE_SIZE,
  });

  mkdirSync(args.outDir, { recursive: true });
  writeFileSync(samplePath, `${JSON.stringify(freshSample, null, 2)}\n`, "utf8");
  const jsonPath = join(args.outDir, "latest.json");
  writeFileSync(jsonPath, renderCheckAJson(run), "utf8");
  const mdPath = join(args.outDir, "latest.md");
  writeFileSync(mdPath, renderCheckAMarkdown(run), "utf8");

  const { summary } = run;
  console.log("");
  console.log(
    `Check A ${summary.passed ? "PASS" : "FAIL"}: ${summary.resolvedCount}/${summary.total} ` +
      `(${(summary.resolvedFraction * 100).toFixed(0)}%) resolved — ` +
      `${summary.serviceRecords} service records, ${summary.outOfScope} out-of-scope, ` +
      `${summary.failures} failures, ${summary.breaches} breach(es), ${summary.deadPages} dead page(s)`,
  );
  console.log(`reports written: ${samplePath}, ${jsonPath}, ${mdPath}`);
  for (const breach of run.breaches) {
    console.error(`breach: ${breach}`);
  }
  if (!summary.passed) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
