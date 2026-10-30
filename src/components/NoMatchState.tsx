// The two designed states the spec calls for (D7): browse-with-filters
// that matches nothing, and an empty catalog. Neither is an afterthought —
// both name the state, own it, and hand the user a way out.

export function NoMatchState({
  query,
  domain,
  hasCatalogServices,
}: {
  query?: string;
  domain?: string;
  hasCatalogServices: boolean;
}) {
  return (
    <div
      data-testid="no-match-state"
      className="rounded-xl bg-surface-card p-8 text-center shadow-card"
      role="status"
    >
      <p className="text-base font-medium text-ink">No services match</p>
      {query !== undefined && query.length > 0 && (
        <p className="mt-1 text-sm text-ink-muted">
          Nothing in the catalog matches <span className="font-medium text-ink">“{query}”</span>
          {domain !== undefined && domain.length > 0 && <> in the selected domain</>}.
        </p>
      )}
      {domain !== undefined && domain.length > 0 && (query === undefined || query.length === 0) && (
        <p className="mt-1 text-sm text-ink-muted">No catalog services in the selected domain yet.</p>
      )}
      <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
        {hasCatalogServices
          ? "The catalog covers only what has been captured and verified so far — new services are added as their sources are captured, never guessed."
          : "The service catalog has not been loaded yet. Once a catalog build runs, matched services appear here."}
      </p>
      <p className="mt-4 text-sm">
        <a href="/browse" className="text-link underline underline-offset-2">
          Clear filters and browse everything
        </a>
      </p>
    </div>
  );
}
