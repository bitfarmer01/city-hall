import { readFile } from "node:fs/promises";
import { z } from "zod";

import type { GoldenCatalogIndex } from "./check";

/**
 * Loads the committed catalog bundle into the index the Check B gate needs:
 * catalogVersion, serviceId → domain, and the set of services whose steps
 * claim in-person fulfillment. The bundle is D4's output; here we validate
 * only the parts this harness consumes, strictly — a bundle the gate cannot
 * read must throw, not silently shrink the gate.
 */

const BundleSchema = z.object({
  catalogVersion: z.string().min(1),
  services: z.array(
    z.object({
      meta: z.object({
        catalogId: z.string().min(1),
        domain: z.string().min(1),
      }),
      steps: z.array(
        z.object({
          fulfillmentMethod: z.string(),
        }),
      ),
    }),
  ),
});

export async function loadCatalogIndex(bundlePath: string): Promise<GoldenCatalogIndex> {
  const raw = JSON.parse(await readFile(bundlePath, "utf8")) as unknown;
  const bundle = BundleSchema.parse(raw);
  const domains = new Map<string, string>();
  const inPersonClaimed = new Set<string>();
  for (const service of bundle.services) {
    domains.set(service.meta.catalogId, service.meta.domain);
    if (
      service.steps.some(
        (s) => s.fulfillmentMethod === "in_person_appearance" || s.fulfillmentMethod === "site_visit",
      )
    ) {
      inPersonClaimed.add(service.meta.catalogId);
    }
  }
  return { version: bundle.catalogVersion, domains, inPersonClaimed };
}
