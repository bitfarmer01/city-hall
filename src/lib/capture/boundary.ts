import type { BoundaryKind } from "./types";

/**
 * Pure public-boundary classifier. Decides where a capture must stop — the
 * single policy gate for the whole harness (locked decision 10: public
 * boundaries only; NYC.ID never automated; anti-bot signals are stop
 * conditions, never obstacles). Inputs are evidence the driver already has;
 * no browser needed to test this.
 *
 * Deliberate trade-off: a false login_wall detection loses a capture (safe —
 * an operator can look manually); a false public detection would produce a
 * misleading snapshot (unsafe). When in doubt, stop.
 */
export interface BoundaryInput {
  httpStatus: number;
  /** Post-redirect URL of the loaded document. */
  finalUrl: string;
  html: string;
  /** Lowercased header names, as Playwright reports them. */
  headers: Record<string, string>;
}

export interface BoundaryVerdict {
  /** "none" when the public page was reached. */
  kind: BoundaryKind;
  signals: string[];
}

const ANTI_BOT_HTML_MARKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/_cf_chl_opt|cf-challenge|challenge-platform|cdn-cgi\/challenge-platform/i, "cloudflare_challenge_marker"],
  [/id=["']challenge-(?:running|form|error)["']/i, "cloudflare_challenge_marker"],
  [/px-captcha|_pxhd|perimeterx/i, "perimeterx_marker"],
  [/datadome|geo-captcha/i, "datadome_marker"],
  [
    /<title>[^<]*(?:just a moment|attention required|access denied|security check|verify you are human)[^<]*<\/title>/i,
    "challenge_title",
  ],
];

/** Hosts that are NYC.ID sign-in surfaces — never automated, per policy. */
const NYC_ID_HOSTS: ReadonlySet<string> = new Set([
  "nycid.nyc.gov",
  "secure.nyc.gov",
  "accounts.nyc.gov",
]);

export function classifyBoundary(input: BoundaryInput): BoundaryVerdict {
  const signals: string[] = [];

  // 1. Rate limits — never retried by the harness.
  if (input.httpStatus === 429) {
    return { kind: "rate_limited", signals: ["http_429"] };
  }
  if (input.httpStatus === 503 && "retry-after" in input.headers) {
    return { kind: "rate_limited", signals: ["http_503_retry_after"] };
  }

  // 2. Anti-bot challenges (header signal beats HTML heuristics).
  if (input.headers["cf-mitigated"] === "challenge") {
    return { kind: "anti_bot", signals: ["cf_mitigated_challenge_header"] };
  }
  for (const [marker, signal] of ANTI_BOT_HTML_MARKERS) {
    if (marker.test(input.html)) {
      signals.push(signal);
      return { kind: "anti_bot", signals };
    }
  }

  // 3. NYC.ID — host alone is decisive; the marker corroborates.
  const host = hostOf(input.finalUrl);
  if (host !== null && NYC_ID_HOSTS.has(host)) {
    signals.push(`nyc_id_host:${host}`);
    return { kind: "nyc_id", signals };
  }
  if (/NYC\.ID/.test(input.html) && passwordFieldCount(input.html) > 0) {
    signals.push("nyc_id_marker_with_password_field");
    return { kind: "nyc_id", signals };
  }

  // 4. Generic login wall. A public form never needs a password; a page that
  // is mostly a password form is a boundary. A page that has both a login box
  // and a substantial public form is captured, with the coexistence recorded —
  // stopping there would lose every portal that decorates pages with a
  // sign-in widget.
  const passwordCount = passwordFieldCount(input.html);
  if (passwordCount > 0) {
    const publicFields = publicFieldCount(input.html);
    if (publicFields < 3) {
      signals.push("password_field_present_without_public_form");
      return { kind: "login_wall", signals };
    }
    signals.push("login_form_present_on_public_page");
  }

  // 5. Plain HTTP errors — dead or broken pages are stop conditions too.
  if (input.httpStatus >= 400) {
    return { kind: "error", signals: [`http_${input.httpStatus}`] };
  }

  return { kind: "none", signals };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function passwordFieldCount(html: string): number {
  return countMatches(html, /<input\b[^>]*type=["']password["']/gi);
}

function publicFieldCount(html: string): number {
  return (
    countMatches(html, /<input\b(?![^>]*type=["'](?:password|hidden|submit|button|image)["'])[^>]*>/gi) +
    countMatches(html, /<select\b/gi) +
    countMatches(html, /<textarea\b/gi)
  );
}

function countMatches(text: string, re: RegExp): number {
  return [...text.matchAll(re)].length;
}
