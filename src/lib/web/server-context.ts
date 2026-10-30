// Server-side data layer for the web app — the "API/state wiring" half of
// D7's UI-first sequencing. All inputs are committed files and all
// functions here are pure over them: same files, same views, same
// resolution. No request data flows through this module, so it is safe at
// module scope under cacheComponents.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ServiceRecord } from "@/lib/catalog/types";
import {
  buildEstimateBlock,
  parseHeuristicRows,
  parseOpenDataTimelineRows,
  parseSurchargeRows,
  snapshotsById,
  surchargeNotesByStepId,
  type EstimateContext,
} from "@/lib/estimates";
import { loadCatalogBundle } from "@/lib/resolver/catalog-source";
import { createResolver, type Resolver } from "@/lib/resolver/resolver";
import { buildServiceView, type ServiceViewDeps } from "@/lib/web/views";
import type { CatalogBundle } from "@/lib/catalog/types";

// Static paths (no variables) so Turbopack can scope file tracing to the
// data directory instead of the whole project.
const TIMELINES_FILE = join(process.cwd(), "data/estimates/timelines.json");
const HEURISTICS_FILE = join(process.cwd(), "data/estimates/heuristics.json");
const SURCHARGES_FILE = join(process.cwd(), "data/estimates/surcharges.json");

const bundle: CatalogBundle = loadCatalogBundle();

const estimateContext: EstimateContext = {
  snapshots: bundle.snapshots,
  openDataTimelineRows: parseOpenDataTimelineRows(JSON.parse(readFileSync(TIMELINES_FILE, "utf8"))),
  heuristicRows: parseHeuristicRows(JSON.parse(readFileSync(HEURISTICS_FILE, "utf8"))),
};

// Step fee notes come from the surcharge registry joined to bundle snapshots.
const surchargeNotes = surchargeNotesByStepId(
  parseSurchargeRows(JSON.parse(readFileSync(SURCHARGES_FILE, "utf8")), snapshotsById(bundle.snapshots)),
);

const deps: ServiceViewDeps = {
  estimateContext,
  agenciesById: new Map(bundle.agencies.map((agency) => [agency.id, agency])),
  formsById: new Map(bundle.forms.map((form) => [form.id, form])),
  fieldsByFormId: bundle.formFields.reduce<Map<string, typeof bundle.formFields>>((acc, field) => {
    const fields = acc.get(field.formId) ?? [];
    fields.push(field);
    acc.set(field.formId, fields);
    return acc;
  }, new Map()),
  surchargeNotes,
};

// The web app never injects llm_assist: a deterministic no-match stands as
// the answer (spec D7 — the same core guarantee the API adapters carry).
const resolver: Resolver = createResolver(bundle);

export const catalogBundle = bundle;
export const versions = resolver.versions;

export function serviceById(catalogId: string): ServiceRecord | undefined {
  return bundle.services.find((service) => service.meta.catalogId === catalogId);
}

export function serviceView(record: ServiceRecord) {
  return buildServiceView(record, deps);
}

export interface GoalOutcome {
  records: ServiceRecord[];
  layer: string;
}

/** Resolve a goal utterance to records through the deterministic core. */
export async function resolveGoal(raw: string): Promise<GoalOutcome> {
  const resolution = await resolver.resolve(raw);
  return {
    records: resolution.serviceIds
      .map((catalogId) => serviceById(catalogId))
      .filter((record): record is ServiceRecord => record !== undefined),
    layer: resolution.resolutionLayer,
  };
}

export { buildEstimateBlock };
