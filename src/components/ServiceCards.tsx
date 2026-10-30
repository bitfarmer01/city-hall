// Result cards for the goal→results page (richer) and browse grid
// (lighter). Both are presentational: they render the view models and a
// plain <a href>, so nothing here knows how data was fetched.

import type { BrowseCardView, ResultItemView } from "@/lib/web/views";

import { DomainBadge } from "./Badges";

export function ResultCard({ item }: { item: ResultItemView }) {
  return (
    <article className="rounded-xl bg-surface-card p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <DomainBadge label={item.domainLabel} />
        <span className="text-xs text-ink-faint">{item.catalogId}</span>
      </div>
      <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink">
        <a href={item.href} className="text-ink underline-offset-4 hover:underline">
          {item.name}
        </a>
      </h3>
      <p className="mt-1 text-sm text-ink-secondary">{item.agencyName}</p>
      {item.summary !== undefined && <p className="mt-2 text-sm text-ink-secondary">{item.summary}</p>}
      <p className="mt-3 text-xs text-ink-muted">Matched via {item.layerPhrase}</p>
    </article>
  );
}

export function BrowseCard({ card }: { card: BrowseCardView }) {
  return (
    <article className="rounded-xl bg-surface-card p-5 shadow-card transition-shadow hover:shadow-lifted">
      <div className="flex flex-wrap items-center gap-2">
        <DomainBadge label={card.domainLabel} />
        {card.feeFromText !== undefined && (
          <span className="text-xs font-medium text-ink-secondary">{card.feeFromText}</span>
        )}
      </div>
      <h3 className="mt-2 text-base font-semibold tracking-tight text-ink">
        <a href={card.href} className="text-ink underline-offset-4 hover:underline">
          {card.name}
        </a>
      </h3>
      <p className="mt-1 text-sm text-ink-muted">{card.agencyName}</p>
      {card.summary !== undefined && <p className="mt-2 line-clamp-2 text-sm text-ink-secondary">{card.summary}</p>}
    </article>
  );
}
