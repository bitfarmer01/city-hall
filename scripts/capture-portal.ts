#!/usr/bin/env node
/**
 * Capture one public portal page as a hashed SourceSnapshot.
 *
 *   npx tsx scripts/capture-portal.ts <url> [--root fixtures/snapshots]
 *
 * Public-boundary policy (locked decision 10): login walls, NYC.ID prompts,
 * and anti-bot signals stop the capture — they are never bypassed. A stopped
 * capture is a successful policy outcome: the snapshot records
 * authenticated_unreachable + stoppedAt and exits 0 so scheduled recaptures
 * surface the boundary instead of failing on it.
 */
import { chromium } from "playwright";

import { capturePage } from "../src/lib/capture/driver";
import { DEFAULT_SNAPSHOT_ROOT, writeSnapshot } from "../src/lib/capture/store";

interface CliArgs {
  url: string;
  root: string;
  /** false when --root was passed explicitly; true when the default corpus root kicked in. */
  rootDefaulted: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let root: string | undefined = DEFAULT_SNAPSHOT_ROOT;
  let rootDefaulted = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      const value = argv[++i];
      // A valueless --root must error, not silently keep the default: the
      // operator asked for a specific root, and capture/replay must agree
      // on where evidence lands (M11).
      if (value === undefined || value.startsWith("--")) {
        console.error("error: --root requires a value, e.g. --root fixtures/snapshots");
        process.exit(2);
      }
      root = value;
      rootDefaulted = false;
    } else {
      positional.push(argv[i]);
    }
  }
  const url = positional[0];
  if (!url) {
    console.error(`usage: npx tsx scripts/capture-portal.ts <url> [--root ${DEFAULT_SNAPSHOT_ROOT}]`);
    process.exit(2);
  }
  return { url, root, rootDefaulted };
}

async function main(): Promise<void> {
  const { url, root, rootDefaulted } = parseArgs(process.argv.slice(2));

  // Loud, not silent: the default root IS the committed evidence corpus — a
  // scratch capture without --root lands in the reviewed fixtures where the
  // replay gate and the catalog pipeline read it (S2 follow-up). stderr,
  // so the stdout JSON record stays pipeable.
  if (rootDefaulted) {
    console.error(
      `WARNING: no --root given — defaulting to the committed evidence corpus (${DEFAULT_SNAPSHOT_ROOT}). ` +
        "Every capture lands in the reviewed fixture set; pass --root to write scratch captures elsewhere.",
    );
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(); // incognito: no cookies, no storage state
    const page = await context.newPage();
    const result = await capturePage(page, url);
    const dir = await writeSnapshot(root, result);

    const { snapshot } = result;
    console.log(
      JSON.stringify(
        {
          snapshotId: snapshot.id,
          dir,
          url: snapshot.url,
          resolvedUrl: snapshot.resolvedUrl,
          httpStatus: snapshot.httpStatus,
          captureMode: snapshot.captureMode,
          stoppedAt: snapshot.stoppedAt,
          boundarySignals: snapshot.boundarySignals,
          fields: JSON.parse(result.contents.get("fields.json")!.toString("utf8")).fields.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
