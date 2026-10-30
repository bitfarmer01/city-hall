// Inventory snapshot builder (D2a): enumerates the NYC311 All Articles index
// into a versioned snapshot behind structure assertions. Live portal fetches
// stay public-boundary only; --fixture-dir replays from committed captures.
//
// Usage:
//   npm run snapshot:build -- [--fixture-dir=<dir>] [--baseline=<file>]
//       [--out=<dir>] [--search-probe=<query>] [--sample-count=<n>]
//       [--captured-at=<iso>]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  assertArticlePageHasContent,
  assertIndexStructure,
  assertSearchTotal,
  parseSearchTotal,
  sampleIndices,
  type IndexBaseline,
} from "../src/lib/inventory/assertions";
import { buildInventorySnapshot, parseSnapshotJson } from "../src/lib/inventory/build-snapshot";
import {
  ALL_ARTICLES_URL,
  courtesyDelay,
  fetchArticlePage,
  fetchIndexPage,
  fetchSearchPage,
} from "../src/lib/inventory/fetch-nyc311";
import { parseIndexPage } from "../src/lib/inventory/parse-index";
import type { InventorySnapshot } from "../src/lib/inventory/types";

interface BuildArgs {
  fixtureDir: string | null;
  baselinePath: string | null;
  outDir: string;
  searchProbe: string;
  sampleCount: number;
  capturedAt: string | null;
}

const DEFAULT_OUT_DIR = "data/snapshots/nyc311-index";
const DEFAULT_SEARCH_PROBE = "permit";
const DEFAULT_SAMPLE_COUNT = 3;
const COURTESY_DELAY_MS = 1000;

function parseArgs(argv: readonly string[]): BuildArgs {
  const args: BuildArgs = {
    fixtureDir: null,
    baselinePath: null,
    outDir: DEFAULT_OUT_DIR,
    searchProbe: DEFAULT_SEARCH_PROBE,
    sampleCount: DEFAULT_SAMPLE_COUNT,
    capturedAt: null,
  };
  for (const arg of argv) {
    const [flag, ...rest] = arg.split("=");
    const value = rest.join("=");
    switch (flag) {
      case "--fixture-dir":
        args.fixtureDir = value;
        break;
      case "--baseline":
        args.baselinePath = value;
        break;
      case "--out":
        args.outDir = value;
        break;
      case "--search-probe":
        args.searchProbe = value;
        break;
      case "--sample-count":
        args.sampleCount = Number.parseInt(value, 10);
        if (!Number.isInteger(args.sampleCount) || args.sampleCount < 0) {
          throw new Error(`--sample-count must be a non-negative integer, got "${value}"`);
        }
        break;
      case "--captured-at":
        args.capturedAt = value;
        break;
      default:
        throw new Error(`unknown argument "${arg}"`);
    }
  }
  return args;
}

function readFixtureDirHtml(fixtureDir: string, name: string): string {
  return readFileSync(join(fixtureDir, name), "utf8");
}

function readBaseline(path: string): IndexBaseline {
  const snapshot: InventorySnapshot = parseSnapshotJson(readFileSync(path, "utf8"));
  return {
    articleCount: snapshot.articleCount,
    searchTotal: snapshot.verification.searchProbe.totalResults,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const indexHtml = args.fixtureDir
    ? readFixtureDirHtml(args.fixtureDir, "all-articles.html")
    : await fetchIndexPage();
  const entries = parseIndexPage(indexHtml);
  const baseline = args.baselinePath ? readBaseline(args.baselinePath) : null;
  assertIndexStructure(entries, baseline ?? undefined);
  console.log(`parsed ${entries.length} articles; structure assertions passed`);

  const searchFixtureName = `search-${args.searchProbe}.html`;
  const searchHtml = args.fixtureDir
    ? readFixtureDirHtml(args.fixtureDir, searchFixtureName)
    : await fetchSearchPage(args.searchProbe);
  const searchTotal = parseSearchTotal(searchHtml, args.searchProbe);
  if (baseline?.searchTotal !== undefined) {
    assertSearchTotal(searchTotal, baseline.searchTotal);
  }
  console.log(`search probe "${args.searchProbe}": ${searchTotal} results (cross-check ok)`);

  if (!args.fixtureDir && args.sampleCount > 0) {
    const sampleIdx = sampleIndices(entries.length, args.sampleCount);
    for (const index of sampleIdx) {
      const entry = entries[index];
      const articleHtml = await fetchArticlePage(entry.ka);
      assertArticlePageHasContent(entry.ka, articleHtml);
      console.log(`sampled ${entry.ka} (${entry.title}): ka-content present`);
      await courtesyDelay(COURTESY_DELAY_MS);
    }
  } else if (args.fixtureDir) {
    console.log("fixture mode: live article sampling skipped (assertions unit-tested offline)");
  }

  const capturedAt = args.capturedAt ?? new Date().toISOString();
  const snapshot = buildInventorySnapshot({
    entries,
    html: indexHtml,
    sourceUrl: ALL_ARTICLES_URL,
    capturedAt,
    searchProbe: { query: args.searchProbe, totalResults: searchTotal },
  });

  mkdirSync(args.outDir, { recursive: true });
  const outPath = join(args.outDir, `${capturedAt.slice(0, 10)}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  console.log(
    `snapshot written: ${outPath} (${snapshot.articleCount} articles, ` +
      `source sha256 ${snapshot.sourceSha256.slice(0, 12)})`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
