// ServiceSummary — the view shape the web app and adapters render from a
// GovernmentService record (deliverable 2). Carries the classifier's
// disposition provenance so a rendered card can always answer "why is this
// in the catalog" (spec D2b evidence trail).

import { z } from "zod";

import {
  AgencyRefSchema,
  CoverageDomainSchema,
  DispositionSchema,
  DomainSourceSchema,
  ServiceIdSchema,
  ServiceSubtypeSchema,
} from "./primitives";

/**
 * Structured classification evidence — the split shape (PR #6 panel; the
 * classifier's conflated evidence string is being replaced in
 * fix/classifier-fidelity). Contracts carry only the structured form, so
 * downstream consumers never see the conflated string.
 */
export const ClassifierEvidenceSchema = z.strictObject({
  /**
   * Where the span lives: `index-text` — the A-to-Z index entry that fired;
   * `page-accordion` — an accordion section quoted from the article page;
   * `page-signal` — a page-level fact signal (fail-open facts, PR #8).
   */
  kind: z.enum(["index-text", "page-accordion", "page-signal"]),
  /** The exact text that fired the rule. */
  span: z.string().min(1),
});
export type ClassifierEvidence = z.infer<typeof ClassifierEvidenceSchema>;

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
  /** Structured evidence for the disposition — see ClassifierEvidenceSchema. */
  evidence: ClassifierEvidenceSchema,
});
export type DispositionProvenance = z.infer<typeof DispositionProvenanceSchema>;

export const ServiceSummarySchema = z.strictObject({
  id: ServiceIdSchema,
  title: z.string().min(1),
  agency: AgencyRefSchema,
  domain: CoverageDomainSchema,
  /** How the tag was assigned — `fallback` means no domain rule matched. */
  domainSource: DomainSourceSchema,
  /**
   * Domain tags are coverage-meaningful only for services (PR #6 panel):
   * Check A counts per-domain coverage over disposition === "service" rows.
   * The refinement below keeps this from drifting from the disposition.
   */
  domainAppliesToCatalog: z.boolean(),
  disposition: DispositionProvenanceSchema,
})
  .superRefine((summary, ctx) => {
    if (summary.domainAppliesToCatalog !== (summary.disposition.disposition === "service")) {
      ctx.addIssue({
        code: "custom",
        path: ["domainAppliesToCatalog"],
        message:
          'domainAppliesToCatalog must be true exactly when disposition is "service" — domain tags are coverage-meaningful only for services',
      });
    }
  });
export type ServiceSummary = z.infer<typeof ServiceSummarySchema>;
