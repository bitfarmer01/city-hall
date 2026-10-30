// Snapshot diff tool (D2a): reports added/removed/changed articles between
// two inventory snapshots. Exit code 1 with --fail-on-change (for CI gates).
//
// Usage:
//   npm run snapshot:diff -- <before.json> <after.json> [--fail-on-change]

import { readFileSync } from "node:fs";

import { diffIsEmpty, diffSnapshots } from "../src/lib/inventory/diff";
import { parseSnapshotJson } from "../src/lib/inventory/build-snapshot";
import type { SnapshotDiff } from "../src/lib/inventory/diff";
import type { IndexArticleEntry } from "../src/lib/inventory/types";

const PRINT_LIMIT = 50;

function describeEntry(entry: IndexArticleEntry): string {
  return `${entry.ka} ${entry.title}`;
}

function printDiff(diff: SnapshotDiff): void {
  console.log(`added: ${diff.added.length}`);
  console.log(`removed: ${diff.removed.length}`);
  console.log(`changed: ${diff.changed.length}`);

  for (const entry of diff.added.slice(0, PRINT_LIMIT)) {
    console.log(`  + ${describeEntry(entry)}`);
  }
  if (diff.added.length > PRINT_LIMIT) {
    console.log(`  … and ${diff.added.length - PRINT_LIMIT} more added`);
  }
  for (const entry of diff.removed.slice(0, PRINT_LIMIT)) {
    console.log(`  - ${describeEntry(entry)}`);
  }
  if (diff.removed.length > PRINT_LIMIT) {
    console.log(`  … and ${diff.removed.length - PRINT_LIMIT} more removed`);
  }
  for (const change of diff.changed.slice(0, PRINT_LIMIT)) {
    console.log(`  ~ ${change.ka} "${change.before.title}" -> "${change.after.title}"`);
  }
  if (diff.changed.length > PRINT_LIMIT) {
    console.log(`  … and ${diff.changed.length - PRINT_LIMIT} more changed`);
  }
}

function main(): void {
  const positional: string[] = [];
  let failOnChange = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--fail-on-change") {
      failOnChange = true;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) {
    throw new Error("usage: snapshot:diff <before.json> <after.json> [--fail-on-change]");
  }

  const before = parseSnapshotJson(readFileSync(positional[0], "utf8"));
  const after = parseSnapshotJson(readFileSync(positional[1], "utf8"));
  const diff = diffSnapshots(before, after);

  console.log(`comparing ${positional[0]} (${before.articleCount} articles)`);
  console.log(`against  ${positional[1]} (${after.articleCount} articles)`);
  printDiff(diff);

  if (diffIsEmpty(diff)) {
    console.log("no changes");
  } else if (failOnChange) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
