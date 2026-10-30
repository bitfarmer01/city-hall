// /browse — the catalog grid with five-domain filters and search. Filter
// chips are plain GET links (state in the URL, zero client JS); the count
// line stays truthful ("N of M services"); an empty filtered result gets
// the designed no-match state.

import { Suspense } from "react";

import { BrowseCard } from "@/components/ServiceCards";
import { NoMatchState } from "@/components/NoMatchState";
import { SearchForm } from "@/components/SearchForm";
import { catalogBundle } from "@/lib/web/server-context";
import { buildBrowseCards, domainCounts, filterBrowseCards, firstParam } from "@/lib/web/views";

export default function BrowsePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
      <BrowseContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function BrowseContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = firstParam(params.q) ?? "";
  const domain = firstParam(params.domain) ?? "";

  const allCards = buildBrowseCards(catalogBundle.services);
  const filtered = filterBrowseCards(allCards, { q, domain });
  const counts = domainCounts(allCards);

  const chipHref = (nextDomain: string) => {
    const sp = new URLSearchParams();
    if (q.length > 0) sp.set("q", q);
    if (nextDomain.length > 0) sp.set("domain", nextDomain);
    const qs = sp.toString();
    return qs.length > 0 ? `/browse?${qs}` : "/browse";
  };

  return (
    <div className="py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Browse services</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Every service in the catalog build — {catalogBundle.services.length} total, each grounded
        in captured NYC311 sources.
      </p>

      <div className="mt-6 max-w-2xl">
        <SearchForm
          action="/browse"
          inputName="q"
          label="Search the catalog"
          placeholder="e.g. dog license"
          buttonLabel="Search"
          defaultValue={q}
          hidden={domain.length > 0 ? { domain } : undefined}
        />
      </div>

      <nav aria-label="Filter by domain" className="mt-5 flex flex-wrap gap-2" data-testid="domain-filters">
        <a
          href={chipHref("")}
          aria-current={domain.length === 0 ? "true" : undefined}
          className={`rounded-full px-3 py-1 text-sm ${
            domain.length === 0
              ? "bg-accent text-accent-fg font-medium"
              : "bg-surface-card text-ink-secondary shadow-card hover:bg-surface-hover"
          }`}
        >
          All ({allCards.length})
        </a>
        {counts.map((count) => (
          <a
            key={count.domain}
            href={chipHref(count.domain)}
            aria-current={domain === count.domain ? "true" : undefined}
            className={`rounded-full px-3 py-1 text-sm ${
              domain === count.domain
                ? "bg-accent text-accent-fg font-medium"
                : "bg-surface-card text-ink-secondary shadow-card hover:bg-surface-hover"
            }`}
          >
            {count.label} ({count.count})
          </a>
        ))}
      </nav>

      <p className="mt-6 text-sm text-ink-muted" data-testid="browse-count" role="status">
        Showing {filtered.length} of {allCards.length} services
      </p>

      {filtered.length === 0 ? (
        <div className="mt-6">
          <NoMatchState
            query={q.length > 0 ? q : undefined}
            domain={domain.length > 0 ? domain : undefined}
            hasCatalogServices={allCards.length > 0}
          />
        </div>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2" data-testid="browse-grid">
          {filtered.map((card) => (
            <li key={card.catalogId}>
              <BrowseCard card={card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
