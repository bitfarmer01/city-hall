// Layer 2a — curated alias table. Keys are canonical TOKEN sequences
// (filler dropped, stemmed, synonyms applied — canonicalize().tokens joined
// by spaces); a lookup is an exact match on that key. Filler words must
// not hide a hit: "I want to get a HIC license" and the utterance "HIC
// license" collapse to the same key. Two seed sources, in collision
// priority order:
//
//   1. crosswalk utterances — curated goal phrases with ORDERED serviceIds
//      (the only source that can express multi-service goals);
//   2. the service's own names — envelope `name` and `alternateName`.
//
// The table is a pure function of the catalog bundle: same bundle, same
// table. Deterministic because a single pass in a fixed order resolves
// every key collision by source priority (crosswalk > alternate > name).

import { canonicalize } from "./canonicalize";
import type { CatalogBundle } from "../catalog/types";

export type AliasSource = "crosswalk-utterance" | "alternate-name" | "service-name";

export interface AliasEntry {
  serviceIds: string[];
  source: AliasSource;
}

const SOURCE_PRIORITY: Record<AliasSource, number> = {
  "crosswalk-utterance": 0,
  "alternate-name": 1,
  "service-name": 2,
};

export type AliasIndex = Map<string, AliasEntry>;

function insertIfHigherPriority(index: AliasIndex, tokens: readonly string[], entry: AliasEntry): void {
  if (tokens.length === 0) {
    return;
  }
  const key = tokens.join(" ");
  const existing = index.get(key);
  if (!existing || SOURCE_PRIORITY[entry.source] < SOURCE_PRIORITY[existing.source]) {
    index.set(key, entry);
  }
}

export function buildAliasIndex(bundle: CatalogBundle): AliasIndex {
  const index: AliasIndex = new Map();

  // Pass 1 (lowest priority): service names, then alternate names.
  for (const service of bundle.services) {
    const id = service.meta.catalogId;
    insertIfHigherPriority(index, canonicalize(service.envelope.name).tokens, {
      serviceIds: [id],
      source: "service-name",
    });
    for (const alt of service.envelope.alternateName ?? []) {
      insertIfHigherPriority(index, canonicalize(alt).tokens, {
        serviceIds: [id],
        source: "alternate-name",
      });
    }
  }

  // Pass 2 (highest priority): curated crosswalk utterances, with their
  // ordered service IDs — the crosswalk is the review artifact for what a
  // goal phrase must resolve to.
  for (const crosswalk of bundle.crosswalks) {
    for (const utterance of crosswalk.utterances) {
      insertIfHigherPriority(index, canonicalize(utterance).tokens, {
        serviceIds: [...crosswalk.serviceIds],
        source: "crosswalk-utterance",
      });
    }
  }

  return index;
}

export function lookupAlias(tokens: readonly string[], index: AliasIndex): AliasEntry | null {
  if (tokens.length === 0) {
    return null;
  }
  return index.get(tokens.join(" ")) ?? null;
}
