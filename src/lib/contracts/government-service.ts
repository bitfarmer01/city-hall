// Canonical GovernmentService JSON-LD envelope — a zod mirror of the merged
// D4 catalog's `ServiceEnvelope` (src/lib/catalog/types.ts, PR #9). D4's
// `buildServiceEnvelope` is the producer; this schema is the parse gate for
// consumers (resolver, surfaces, adapters). The conformance test parses a
// record built by D4's own builder from a real seed record, so the two
// cannot drift silently.
//
// Shape (panel B1):
//  - `identifier` is the tuple [catalogId, nyc311ArticleId] — locked
//    decision #1 keeps the NYC311 article alongside the catalog ID.
//  - `description` is required (D4 always emits it).
//  - Catalog facts schema.org has no term for ride in the documented `x:`
//    namespace — `additionalProperty` is not legal on Service
//    (art_mcM1Ssao §1.2).
//  - Offers carry their provenance: identifier, x:sourceRefs, x:capturedAt.
//  - `ServiceIdSchema` stays reserved for sidecar keys; the envelope's
//    catalogId half uses the same imported pattern.

import { z } from "zod";

import { FEE_ID_PATTERN, NYC311_ARTICLE_ID_PATTERN, SERVICE_ID_PATTERN } from "../catalog/ids";
import { CATALOG_SCHEMA_VERSION } from "../catalog/types";

import {
  CoverageDomainSchema,
  HttpsUrlSchema,
  SemverVersionSchema,
  SnapshotRefSchema,
} from "./primitives";

export const GovernmentServiceSchema = z
  .strictObject({
    "@context": z.literal("https://schema.org"),
    "@type": z.literal("GovernmentService"),
    /** [catalogId, nyc311ArticleId] — locked decision #1. */
    identifier: z.tuple([
      z.string().regex(SERVICE_ID_PATTERN, "catalog id must match svc:{agency}:{slug}"),
      z.string().regex(NYC311_ARTICLE_ID_PATTERN, "article id must match nyc311-KA-#####"),
    ]),
    name: z.string().min(1),
    description: z.string().min(1),
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
        "@type": z.enum(["Permit", "Thing"]),
        name: z.string().min(1),
      })
      .optional(),
    availableChannel: z.array(
      z.strictObject({
        "@type": z.literal("ServiceChannel"),
        name: z.string().min(1).optional(),
        serviceUrl: HttpsUrlSchema.optional(),
        servicePhone: z.string().min(1).optional(),
        servicePostalAddress: z.string().min(1).optional(),
        /** ISO-8601 duration, e.g. "P21D". */
        processingTime: z
          .string()
          .regex(
            /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/,
            "processingTime must be an ISO-8601 duration",
          )
          .optional(),
      }),
    ),
    /** Fees. Every fee carries its provenance in the x: namespace (D4). */
    offers: z.array(
      z.strictObject({
        "@type": z.literal("Offer"),
        identifier: z.string().regex(FEE_ID_PATTERN, "fee id must match fee:{agency}:{slug}:{part}"),
        price: z.number().min(0),
        priceCurrency: z.literal("USD"),
        description: z.string().min(1),
        "x:sourceRefs": z.array(SnapshotRefSchema).min(1),
        "x:capturedAt": z.string().min(1),
      }),
    ),
    /** The source article (D4 emits exactly this entry). */
    subjectOf: z.array(
      z.strictObject({
        "@type": z.literal("CreativeWork"),
        url: HttpsUrlSchema,
      }),
    ),
    "x:coverageDomain": CoverageDomainSchema,
    "x:domainTaxonomyVersion": SemverVersionSchema,
    /**
     * Catalog schema version, when the producer embeds it (panel S4-M2).
     * D4's envelopes do not carry it yet — the version lives on
     * `CatalogBundle` — so it stays optional; when present it must equal the
     * imported `CATALOG_SCHEMA_VERSION`, making a newer record read by an
     * older parser loudly detectable instead of silently shape-shifting.
     */
    schemaVersion: SemverVersionSchema.optional(),
  })
  .superRefine((envelope, ctx) => {
    if (envelope.schemaVersion !== undefined && envelope.schemaVersion !== CATALOG_SCHEMA_VERSION) {
      ctx.addIssue({
        code: "custom",
        path: ["schemaVersion"],
        message: `schemaVersion ${envelope.schemaVersion} does not match this contract's pinned catalog schema version ${CATALOG_SCHEMA_VERSION}`,
      });
    }
  });
export type GovernmentService = z.infer<typeof GovernmentServiceSchema>;
