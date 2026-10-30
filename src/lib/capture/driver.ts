import type { Page } from "playwright";

import { classifyBoundary } from "./boundary";
import { EXTRACT_FIELDS_SCRIPT } from "./extract-script";
import { parseDumpBody } from "./formdump";
import { buildSourceSnapshot } from "./store";
import type { FormFieldDump, SourceSnapshot } from "./types";
import { PUBLIC_BOUNDARY_NOTE } from "./types";

/**
 * Playwright capture driver — the thin I/O layer around the pure modules.
 * Policy lives in boundary.ts; this file only drives the browser and stops.
 *
 * Deliberate shape: capturePage(page, …) receives a Page the caller owns and
 * exposes NO way to type, fill, authenticate, set storage state, or retry —
 * the type surface itself enforces "no credentials attempted". Reads only
 * attribute data; interacts with nothing.
 */

const DEFAULT_TIMEOUT_MS = 45_000;
const NETWORK_IDLE_EXTRA_MS = 3_000;
const NETWORK_LOG_LIMIT = 200;

export interface NetworkLog {
  entries: Array<{ method: string; url: string; status: number; resourceType: string }>;
  truncated: boolean;
}

export interface CapturePageOptions {
  /** Navigation timeout. Default 45s. */
  timeoutMs?: number;
  /** Injectable clock for deterministic tests. */
  capturedAt?: string;
}

export interface CapturePageResult {
  snapshot: SourceSnapshot;
  contents: Map<string, Buffer>;
}

export async function capturePage(
  page: Page,
  url: string,
  options: CapturePageOptions = {},
): Promise<CapturePageResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const capturedAt = options.capturedAt ?? new Date().toISOString();

  const network: NetworkLog = { entries: [], truncated: false };
  page.on("response", (response) => {
    if (network.entries.length >= NETWORK_LOG_LIMIT) {
      network.truncated = true;
      return;
    }
    network.entries.push({
      method: response.request().method(),
      url: response.url(),
      status: response.status(),
      resourceType: response.request().resourceType(),
    });
  });

  // Never send credentials, storage state, or cookies beyond what an
  // incognito context has by default.
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  // Give JS-driven portals a moment to settle; slow third-party assets must
  // not fail an otherwise-loaded public page, so network-idle is best-effort.
  try {
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_EXTRA_MS });
  } catch {
    // best effort only — the document is already loaded
  }

  const httpStatus = response?.status() ?? 0;
  const finalUrl = page.url();
  const headers: Record<string, string> = response ? await response.allHeaders() : {};
  const html = await page.content();

  const verdict = classifyBoundary({ httpStatus, finalUrl, html, headers });
  const captureMode = verdict.kind === "none" ? "public_reachable" : "authenticated_unreachable";

  // Evidence of the boundary itself is kept even when stopped — but nothing
  // on the page is ever operated.
  const screenshot = await page.screenshot({ fullPage: true });
  const rawDump = await page.evaluate(EXTRACT_FIELDS_SCRIPT);
  const dump: FormFieldDump = { ...parseDumpBody(rawDump), url, capturedAt };

  return buildSourceSnapshot(
    {
      url,
      resolvedUrl: finalUrl,
      capturedAt,
      method: "headless",
      httpStatus,
      captureMode,
      stoppedAt: verdict.kind,
      boundarySignals: verdict.signals,
      notes: PUBLIC_BOUNDARY_NOTE,
    },
    [
      { name: "page.html", bytes: Buffer.from(html, "utf8") },
      { name: "screenshot.png", bytes: screenshot },
      { name: "fields.json", bytes: Buffer.from(JSON.stringify(dump, null, 2) + "\n", "utf8") },
      { name: "network.json", bytes: Buffer.from(JSON.stringify(network, null, 2) + "\n", "utf8") },
    ],
  );
}
