// Check A report rendering (build spec D10: "The committed report shows
// per-article disposition, matched service IDs, and the layer that fired —
// broken down per coverage domain ... so a gap in any one domain is
// visible"). Two artifacts from one run: machine-readable JSON for diffs
// and tooling, markdown for humans reviewing the PR.

import type { CheckARun } from "./check-a";

/** Machine-readable report — stable key order, sorted rows, no floats in the gate math. */
export function renderCheckAJson(run: CheckARun): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}

const DOMAIN_LABELS: Readonly<Record<string, string>> = {
  permits: "Permits",
  "service-requests": "311 service requests",
  "public-records": "Public records",
  licensing: "Licensing",
  inspections: "Inspections",
  other: "Other (untagged)",
};

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

/** Human-readable report — the per-domain table is the gap-visibility surface. */
export function renderCheckAMarkdown(run: CheckARun): string {
  const { summary, versions, snapshot } = run;
  const lines: string[] = [];

  lines.push("# Check A — catalog coverage sample report");
  lines.push("");
  lines.push(
    `Run ${run.ranAt} · fixed seed \`${run.seed}\` · sample ${run.sampleSize} of ` +
      `${snapshot.articleCount.toLocaleString("en-US")} articles ` +
      `(snapshot \`${snapshot.path}\`, sha \`${snapshot.sha256.slice(0, 12)}\`, captured ${snapshot.capturedAt}).`,
  );
  lines.push("");
  lines.push(
    `Versions: catalog \`${versions.catalog}\` · crosswalk rules \`${versions.crosswalkRules}\` · ` +
      `classifier \`${versions.classifierRules}\` · domain taxonomy \`${versions.domainTaxonomy}\` · ` +
      `retriever \`${versions.embeddingModel}\`.`,
  );
  lines.push("");

  const verdict = summary.passed
    ? "PASS"
    : summary.validityPassed
      ? "FAIL (coverage gate)"
      : "FAIL (validity)";
  lines.push(
    `**Gate ${verdict}** — ${summary.resolvedCount}/${summary.total} (${pct(summary.resolvedFraction)}) ` +
      `resolved to a service record or an explicit out-of-scope entry ` +
      `(threshold ${pct(summary.gateThreshold)}); ${summary.serviceRecords} service records, ` +
      `${summary.outOfScope} out-of-scope, ${summary.failures} failures, ` +
      `${summary.breaches} validity breach(es), ${summary.deadPages} dead page(s).`,
  );
  lines.push("");

  if (run.breaches.length > 0) {
    lines.push("## Validity breaches");
    lines.push("");
    for (const breach of run.breaches) {
      lines.push(`- ${breach}`);
    }
    lines.push("");
  }

  lines.push("## Per coverage domain");
  lines.push("");
  lines.push(
    "| Domain | Sampled | Service records | Matched own catalog service | Matched sibling service | No catalog match (gap) | Out-of-scope | Failures |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const domain of run.domains) {
    lines.push(
      `| ${DOMAIN_LABELS[domain.domain] ?? domain.domain} | ${domain.sampled} | ${domain.serviceRecords} | ` +
        `${domain.catalogedSelf} | ${domain.siblingMatch} | ${domain.noMatch} | ${domain.outOfScope} | ${domain.failures} |`,
    );
  }
  lines.push("");
  lines.push(
    `_No catalog match_ counts service-classified articles whose crosswalk resolution returned no ` +
      `catalog service — the visible catalog-coverage gap; it narrows as the catalog grows.`,
  );
  lines.push("");

  lines.push("## Per-article results");
  lines.push("");
  lines.push("| KA | Title | Domain | Disposition | Outcome | Matched service IDs | Layer |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const result of run.results) {
    const disposition = result.disposition ?? "—";
    const matched = result.matchedServiceIds.length > 0 ? result.matchedServiceIds.join(", ") : "—";
    const layer = result.resolutionLayer ?? "—";
    const outcome =
      result.outcome === "fail" ? `fail (${result.problem ?? "unknown"})` : result.outcome;
    lines.push(
      `| ${result.ka} | ${result.title} | ${result.domain} | ${disposition} | ${outcome} | ${matched} | ${layer} |`,
    );
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}
