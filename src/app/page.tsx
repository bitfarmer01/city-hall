// Home — the single input. One goal, typed or picked from examples;
// everything else hangs off /results.

import Link from "next/link";

import { SearchForm } from "@/components/SearchForm";
import { catalogBundle } from "@/lib/web/server-context";

const EXAMPLE_GOALS = [
  "license my dog",
  "home improvement contractor license",
  "order a birth certificate",
  "food service establishment permit",
  "water tap permit",
] as const;

export default function HomePage() {
  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">
        What do you want to do in New York City?
      </h1>
      <p className="mt-3 text-base text-ink-secondary">
        Describe a goal — opening a business, renovating a storefront, ordering a record — and get
        the services involved, what each costs, the steps in order, and the documents you need.
        Every fee cites its source and as-of date.
      </p>
      <div className="mt-8">
        <SearchForm
          action="/results"
          inputName="q"
          label="Your goal"
          placeholder="e.g. I want to open a restaurant"
          buttonLabel="Estimate this"
          examples={EXAMPLE_GOALS}
        />
      </div>
      <p className="mt-10 text-sm text-ink-muted">
        Or{" "}
        <Link href="/browse" className="text-link underline underline-offset-2">
          browse all {catalogBundle.services.length} cataloged services
        </Link>
        .
      </p>
    </div>
  );
}
