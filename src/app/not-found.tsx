// Designed 404 — a deep link to an unknown service ID or a mistyped path
// lands here with a way out, never a blank error.

import Link from "next/link";

import { SearchForm } from "@/components/SearchForm";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl py-10" role="status" data-testid="not-found-state">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-ink-muted">
        This page — or the service ID in it — is not in the loaded catalog build. The catalog
        covers only what has been captured and verified so far.
      </p>
      <div className="mt-6">
        <SearchForm
          action="/results"
          inputName="q"
          label="Search for a goal instead"
          placeholder="e.g. I want to open a restaurant"
          buttonLabel="Estimate this"
        />
      </div>
      <p className="mt-4 text-sm">
        <Link href="/browse" className="text-link underline underline-offset-2">
          Browse all cataloged services
        </Link>
      </p>
    </div>
  );
}
