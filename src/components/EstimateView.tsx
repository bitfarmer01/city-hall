// Estimate rendering — the UI half of the two D6 display guarantees:
//   1. Every tier-1 fee shows its source citation and as-of date (the
//      extractor refuses unsourced fees upstream; this template makes the
//      provenance part of the fee's own line).
//   2. A tier-3 range can never render without its "Estimate (heuristic)"
//      label — the badge is hard-wired to the heuristic branch, the same
//      guarantee render.ts gives the text renderer.

import type { EstimateItemView } from "@/lib/web/views";

export function EstimateView({ items }: { items: EstimateItemView[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No fee or timeline on file yet — this page shows only what a captured
        city source states, never a guessed number.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item, index) => (
        <li key={index} className="text-sm leading-6">
          {item.kind === "fee" && (
            <>
              <span className="text-base font-semibold text-ink">{item.amountText}</span>
              <span className="text-ink-secondary"> — {item.label}</span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                Source:{" "}
                {item.sourceUrl ? (
                  <a
                    href={item.sourceUrl}
                    className="text-link underline underline-offset-2"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {item.sourceCitation}
                  </a>
                ) : (
                  item.sourceCitation
                )}{" "}
                · As of {item.capturedAt}
              </span>
            </>
          )}
          {item.kind === "timeline" && (
            <>
              <span className="font-semibold text-ink">{item.durationText}</span>
              <span className="text-ink-secondary"> — {item.label}</span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                Published by the city · Dataset: {item.dataset} · Query: {item.query}
              </span>
            </>
          )}
          {item.kind === "heuristic" && (
            <>
              <span
                data-testid="heuristic-badge"
                className="mr-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: "var(--tag-heuristic-bg)", color: "var(--tag-heuristic-fg)" }}
              >
                Estimate (heuristic)
              </span>
              <span className="font-semibold text-ink">{item.label}</span>
              <span className="text-ink-secondary">: {item.rangeText}</span>
              <span className="mt-0.5 block text-xs text-ink-muted">Basis: {item.basis}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
