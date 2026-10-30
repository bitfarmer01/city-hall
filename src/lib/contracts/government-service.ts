// Canonical GovernmentService JSON-LD envelope — build spec data model
// (art_RVpFZFo1, representative-record example).
//
// CANONICAL UNTIL D4 LANDS: the catalog milestone owns this envelope, but its
// types are not on main yet, so the contracts define it (task todo_O2keBBqw).
// The D4 catalog worker reconciles onto THIS file at PR time; downstream
// builds treat this module as the single definition. The schema.org envelope
// stays pure — resolver/step/document machinery lives in sidecar contracts,
// keyed by the stable IDs in this record.

import { z } from "zod";

import { ServiceIdSchema } from "./primitives";

/**
 * Envelope version — bump on breaking shape changes. Deliberately separate
 * from the D4 catalog's own version: this pins the wire shape, not the data.
 */
export const GOVERNMENT_SERVICE_SCHEMA_VERSION = "0.1.0";

export const GovernmentServiceSchema = z.strictObject({
  "@context": z.literal("https://schema.org"),
  "@type": z.literal("GovernmentService"),
  identifier: ServiceIdSchema,
  name: z.string().min(1),
  alternateName: z.array(z.string().min(1)).optional(),
  serviceType: z.string().min(1),
  provider: z.strictObject({
    "@type": z.literal("GovernmentOrganization"),
    name: z.string().min(1),
    identifier: z.string().min(1),
  }),
  jurisdiction: z.strictObject({
    "@type": z.literal("AdministrativeArea"),
    name: z.string().min(1),
  }),
  serviceOutput: z
    .strictObject({
      "@type": z.string().min(1),
      name: z.string().min(1),
    })
    .optional(),
  availableChannel: z
    .array(
      z.strictObject({
        "@type": z.literal("ServiceChannel"),
        name: z.string().min(1).optional(),
        serviceUrl: z.url().optional(),
        /** ISO-8601 duration, e.g. "P21D". */
        processingTime: z.string().min(1).optional(),
        servicePostalAddress: z.string().min(1).optional(),
      }),
    )
    .optional(),
  /** Fees. Every fee carries its source in `description` (spec D6 tier 1). */
  offers: z
    .array(
      z.strictObject({
        "@type": z.literal("Offer"),
        price: z.number(),
        priceCurrency: z.string().length(3),
        description: z.string().min(1),
      }),
    )
    .optional(),
  /** Sidecar contracts, the source article, and related links. */
  subjectOf: z
    .array(
      z.strictObject({
        "@type": z.string().min(1).optional(),
        url: z.string().min(1),
      }),
    )
    .optional(),
});
export type GovernmentService = z.infer<typeof GovernmentServiceSchema>;
