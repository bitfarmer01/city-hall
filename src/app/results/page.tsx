// Results — the core goal→answer flow. Resolution runs through the
// deterministic core (same input → same services); a single match renders
// the full answer inline, multiple matches render cards, and zero matches
// gets the designed no-match state. searchParams access is isolated in the
// async content component, Suspense-wrapped per cacheComponents rules.

import { Suspense } from "react";

import { ResultCard } from "@/components/ServiceCards";
import { NoMatchState } from "@/components/NoMatchState";
import { SearchForm } from "@/components/SearchForm";
import { ServiceDetail } from "@/components/ServiceDetail";
import { catalogBundle, resolveGoal, serviceView, versions } from "@/lib/web/server-context";
import { buildResultViews, firstParam } from "@/lib/web/views";

export default function ResultsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Resolving…</p>}>
      <ResultsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ResultsContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = firstParam(params.q);

  if (q === undefined || q.trim().length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Describe your goal</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Enter what you want to do — the results page shows matched services with estimates,
          steps, and documents.
        </p>
        <div className="mt-6">
          <SearchForm
            action="/results"
            inputName="q"
            label="Your goal"
            placeholder="e.g. I want to open a restaurant"
            buttonLabel="Estimate this"
          />
        </div>
      </div>
    );
  }

  const outcome = await resolveGoal(q);

  if (outcome.records.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Results</h1>
        <div className="mt-6">
          <SearchForm
            action="/results"
            inputName="q"
            label="Your goal"
            placeholder="e.g. I want to open a restaurant"
            buttonLabel="Estimate this"
            defaultValue={q}
          />
        </div>
        <div className="mt-8">
          <NoMatchState query={q} hasCatalogServices={catalogBundle.services.length > 0} />
        </div>
      </div>
    );
  }

  const results = buildResultViews(outcome.records, outcome.layer);

  if (outcome.records.length === 1) {
    const view = serviceView(outcome.records[0]);
    return (
      <div className="mx-auto max-w-3xl py-6">
        <p className="text-xs text-ink-faint" data-testid="match-count">
          1 service matched your goal
        </p>
        <ServiceDetail view={view} versions={versions} />
      </div>
    );
  }

  return (
    <div className="py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        {results.length} services matched your goal
      </h1>
      <p className="mt-1 text-sm text-ink-muted">for “{q}” — matched via {results[0].layerPhrase}</p>
      <div className="mt-6">
        <SearchForm
          action="/results"
          inputName="q"
          label="Your goal"
          placeholder="e.g. I want to open a restaurant"
          buttonLabel="Estimate this"
          defaultValue={q}
        />
      </div>
      <ul className="mt-8 space-y-4" data-testid="result-list">
        {results.map((result) => (
          <li key={result.catalogId}>
            <ResultCard item={result} />
          </li>
        ))}
      </ul>
    </div>
  );
}
