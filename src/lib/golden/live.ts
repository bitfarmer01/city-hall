import type { Page } from "playwright";

import { capturePage } from "../capture/driver";
import { diffLiveMinusCatalog } from "../capture/golden";
import { writeSnapshot } from "../capture/store";
import type { SourceSnapshot, FormFieldDump } from "../capture/types";
import { htmlToText } from "./evidence";
import { scanInPersonSignals, normalizeSignalLabel } from "./inperson";
import type { GoldenExpectation } from "./expectation";
import { diffInPerson, mergeFindings } from "./stepdiff";
import type { CheckBRow, GoldenTarget } from "./types";

/**
 * Live capture leg of Check B — shared by the one-time seeder and the weekly
 * drift check. Captures one target through the public-boundary driver (a stop
 * is a policy outcome, never bypassed or retried), stores the hashed bundle,
 * and diffs the fresh DOM dump against the baseline expectation.
 *
 * The caller owns the browser. Bundle bytes go to the provided root — the
 * seeder writes the committed store, the weekly job writes a scratch root so
 * committed evidence stays pristine.
 */

export interface LiveTargetResult {
  row: CheckBRow;
  snapshot: SourceSnapshot | null;
  dump: FormFieldDump | null;
  pageText: string | null;
  /** Directory the bundle was written to, when stored. */
  bundleDir: string | null;
}

export async function captureAndDiffTarget(
  page: Page,
  target: GoldenTarget,
  expectation: GoldenExpectation,
  service: { serviceId: string; nyc311ArticleId: string; domain: CheckBRow["domain"] },
  snapshotsRoot: string,
): Promise<LiveTargetResult> {
  const base = {
    serviceId: service.serviceId,
    nyc311ArticleId: service.nyc311ArticleId,
    domain: service.domain,
    targetId: target.id,
    kind: target.kind,
    url: target.url,
  };

  try {
    const result = await capturePage(page, target.url);
    const bundleDir = await writeSnapshot(snapshotsRoot, result);
    const { snapshot } = result;

    if (snapshot.captureMode !== "public_reachable") {
      return {
        row: {
          ...base,
          status: "skipped_boundary",
          findings: { failures: [], warnings: [] },
          inPerson: null,
          note: `capture stopped at ${snapshot.stoppedAt} (${snapshot.boundarySignals.join(", ") || "no signals"}); public boundary recorded, never bypassed`,
        },
        snapshot,
        dump: null,
        pageText: null,
        bundleDir,
      };
    }

    const dump = JSON.parse(result.contents.get("fields.json")!.toString("utf8")) as FormFieldDump;
    const pageText = htmlToText(result.contents.get("page.html")!.toString("utf8"));
    const inPerson = target.kind === "article_page" ? diffInPerson(pageText, expectation) : null;
    const findings = mergeFindings(diffLiveMinusCatalog(dump, expectation), inPerson);
    return {
      row: {
        ...base,
        status: findings.failures.length > 0 ? "fail" : "ok",
        findings,
        inPerson,
        note: null,
      },
      snapshot,
      dump,
      pageText,
      bundleDir,
    };
  } catch (err) {
    // A capture error is not a policy stop and not a miss: the row reports
    // unverifiable so the weekly report shows the gap instead of failing the
    // gate on infrastructure noise (or worse, passing silently).
    return {
      row: {
        ...base,
        status: "unverifiable",
        findings: { failures: [], warnings: [] },
        inPerson: null,
        note: `capture failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      snapshot: null,
      dump: null,
      pageText: null,
      bundleDir: null,
    };
  }
}

/** Baseline expectation derived from a fresh capture — the seeding path. */
export function expectationFromCapture(
  serviceId: string,
  label: string,
  sourceUrl: string,
  dump: FormFieldDump,
  pageText: string,
): GoldenExpectation {
  const expectedFields = dump.fields.map((f) => ({
    label: f.label,
    type: f.type,
    required: f.required,
  }));
  const expectedDocuments = dump.fields
    .filter((f) => f.tag === "input" && f.type === "file")
    .map((f) => f.label);
  const inPersonSteps = [
    ...new Set(scanInPersonSignals(pageText).map((s) => normalizeSignalLabel(s.phrase))),
  ];
  return {
    serviceId,
    label,
    sourceUrl,
    expectedFields,
    expectedDocuments,
    inPersonSteps,
  };
}
