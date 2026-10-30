// ServiceSummary — the view shape the web app and adapters render from a
// GovernmentService record (deliverable 2), plus the classification
// provenance D4 persists in `ServiceCatalogMeta`.
//
// Field names mirror the PRODUCERS exactly (panel B3/S3-F1): the classifier
// emits `serviceSubtype` and `rulesVersion`; the catalog persists
// `classifierRulesVersion` — so does this contract. The classifier's
// `reason`/`ruleId`/evidence are deliberately NOT persisted by D4 (PR #6
// panel decision: rule IDs and evidence shapes churn with rule edits), so
// they are optional here — persist-when-present, never required, never
// invented. The structured `{ kind, span }` evidence shape mirrors the
// classifier-fidelity split (PR #8); the conflated evidence string never
// enters the contract.

import { z } from "zod";

import {
  AgencyRefSchema,
  CoverageDomainSchema,
  DispositionSchema,
  DomainSourceSchema,
  SemverVersionSchema,
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
   * `page-signal` — a page-level fact signal (e.g. "fee-text" — a boolean
   * fact has no source span, so the signal's label stands in).
   */
  kind: z.enum(["index-text", "page-accordion", "page-signal"]),
  /** The exact text that fired the rule. */
  span: z.string().min(1),
});
export type ClassifierEvidence = z.infer<typeof ClassifierEvidenceSchema>;

export const DispositionProvenanceSchema = z.strictObject({
  disposition: DispositionSchema,
  /** Only when disposition is "service" (refined below — panel S4-M3). */
  serviceSubtype: ServiceSubtypeSchema.optional(),
  /** Machine-readable reason code, e.g. "action:apply" — when persisted. */
  reason: z.string().min(1).optional(),
  /** The rule that fired, e.g. "R006-service-action" — when persisted. */
  ruleId: z.string().min(1).optional(),
  /** Classifier rules version pinned at classification time (D4 persists it). */
  classifierRulesVersion: SemverVersionSchema,
  /** Structured evidence for the disposition — when persisted. */
  evidence: ClassifierEvidenceSchema.optional(),
});
export type DispositionProvenance = z.infer<typeof DispositionProvenanceSchema>;

export const ServiceSummarySchema = z
  .strictObject({
    id: ServiceIdSchema,
    title: z.string().min(1),
    agency: AgencyRefSchema,
    domain: CoverageDomainSchema,
    /** How the tag was assigned — `fallback` means no domain rule matched. */
    domainSource: DomainSourceSchema,
    /**
     * Domain tags are coverage-meaningful only for services (PR #6 panel):
     * Check A counts per-domain coverage over disposition === "service"
     * rows. The refinement below keeps this from drifting from the
     * disposition.
     */
    domainAppliesToCatalog: z.boolean(),
    /** Domain taxonomy version pinned when the tag was assigned (panel S1-M3). */
    domainTaxonomyVersion: SemverVersionSchema.optional(),
    disposition: DispositionProvenanceSchema,
  })
  .superRefine((summary, ctx) => {
    // Three invariants, one refinement (the PR body's "one superRefine,
    // three rules" — the earlier "two schema refinements" claim was wrong):
    if (summary.domainAppliesToCatalog !== (summary.disposition.disposition === "service")) {
      ctx.addIssue({
        code: "custom",
        path: ["domainAppliesToCatalog"],
        message:
          'domainAppliesToCatalog must be true exactly when disposition is "service" — domain tags are coverage-meaningful only for services',
      });
    }
    // `fallback` means no rule matched, so the tag can only be the catch-all.
    if (summary.domainSource === "fallback" && summary.domain !== "other") {
      ctx.addIssue({
        code: "custom",
        path: ["domain"],
        message: 'domainSource "fallback" is only valid with the "other" catch-all domain',
      });
    }
    // Subtypes describe services; an informational article has no service
    // subtype (panel S4-M3).
    if (summary.disposition.disposition !== "service" && summary.disposition.serviceSubtype !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["disposition", "serviceSubtype"],
        message: 'serviceSubtype is only valid when disposition is "service"',
      });
    }
  });
export type ServiceSummary = z.infer<typeof ServiceSummarySchema>;
