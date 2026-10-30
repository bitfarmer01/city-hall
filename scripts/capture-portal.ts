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
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let root: string | undefined = DEFAULT_SNAPSHOT_ROOT;
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
    } else {
      positional.push(argv[i]);
    }
  }
  const url = positional[0];
  if (!url) {
    console.error(`usage: npx tsx scripts/capture-portal.ts <url> [--root ${DEFAULT_SNAPSHOT_ROOT}]`);
    process.exit(2);
  }
  return { url, root };
}

async function main(): Promise<void> {
  const { url, root } = parseArgs(process.argv.slice(2));

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
