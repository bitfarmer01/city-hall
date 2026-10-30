// ServiceSummary — the view shape the web app and adapters render from a
// GovernmentService record (deliverable 2). Carries the classifier's
// disposition provenance so a rendered card can always answer "why is this
// in the catalog" (spec D2b evidence trail).

import { z } from "zod";

import {
  AgencyRefSchema,
  CoverageDomainSchema,
  DispositionSchema,
  ServiceIdSchema,
  ServiceSubtypeSchema,
} from "./primitives";

export const DispositionProvenanceSchema = z.strictObject({
  disposition: DispositionSchema,
  /** Only when disposition is "service" (classifier convention). */
  subtype: ServiceSubtypeSchema.optional(),
  /** Machine-readable reason code, e.g. "action:apply". */
  reason: z.string().min(1),
  /** The rule that fired — what Check A reports per article. */
  ruleId: z.string().min(1),
  /** Classifier rules version pinned at classification time. */
  classifierVersion: z.string().min(1),
});
export type DispositionProvenance = z.infer<typeof DispositionProvenanceSchema>;

export const ServiceSummarySchema = z.strictObject({
  id: ServiceIdSchema,
  title: z.string().min(1),
  agency: AgencyRefSchema,
  domain: CoverageDomainSchema,
  disposition: DispositionProvenanceSchema,
});
export type ServiceSummary = z.infer<typeof ServiceSummarySchema>;
