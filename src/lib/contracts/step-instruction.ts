// StepInstruction — one ordered blueprint step (deliverable 4, spec data
// model "BlueprintStep" + owner's locked decisions #3, #5, #6).
//
// The fulfillment vocabulary mirrors the merged D4 catalog's FulfillmentMethod
// via type-import lockstep (panel B2): the spec's four values plus D4's two
// documented extensions — `online_submission` (311 requests, DOB NOW) and
// `mail_in` (vital-records mail service) — which the real corpus requires
// (7 of 14 seeded steps use them; 0 of 14 parse without them). `other` is
// the contract-side honest-unknown escape hatch: a step whose fulfillment
// none of the six expresses must carry a fulfillmentNote saying what it
// actually is. ⚠️ Flagged for owner ratification — see the PR body.

import { z } from "zod";

import { AGENCY_ID_PATTERN, FEE_ID_PATTERN, STEP_ID_PATTERN } from "../catalog/ids";
import type { FulfillmentMethod as CatalogFulfillmentMethod } from "../catalog/types";

import { AgencyRefSchema, AssertCovers, HttpsUrlSchema, ServiceIdSchema, SnapshotRefSchema } from "./primitives";

export const FULFILLMENT_METHODS = [
  "site_visit",
  "in_person_appearance",
  "notarized_wet_signature",
  "document_upload",
  "online_submission",
  "mail_in",
  "other",
] as const;

// Compile-time lockstep: every producer fulfillment value parses (panel B2).
const _fulfillmentLockstep: AssertCovers<CatalogFulfillmentMethod, typeof FULFILLMENT_METHODS> = true;
void _fulfillmentLockstep;

export const FulfillmentMethodSchema = z.enum(FULFILLMENT_METHODS);
export type FulfillmentMethod = z.infer<typeof FulfillmentMethodSchema>;

/**
 * Upload constraints — mirrors D4's `UploadConstraint` exactly (panel H4),
 * honest by construction: `maxSizeBytes` stays null and
 * `sizeLimitVerified` stays false unless a source states a limit (locked
 * decision #6 — no invented limits, ever). `portalId` and `portalUrl` are
 * each optional pointers (either or both may identify the portal).
 */
export const UploadSpecSchema = z
  .strictObject({
    portalId: z.string().min(1).optional(),
    portalUrl: HttpsUrlSchema.optional(),
    acceptedFormats: z.array(z.string().min(1)).optional(),
    maxSizeBytes: z.number().int().positive().nullable(),
    sizeLimitVerified: z.boolean(),
    multipleAllowed: z.boolean().optional(),
  })
  .superRefine((upload, ctx) => {
    if (upload.maxSizeBytes === null && upload.sizeLimitVerified) {
      ctx.addIssue({
        code: "custom",
        path: ["sizeLimitVerified"],
        message:
          "sizeLimitVerified cannot be true while maxSizeBytes is null — a verified limit has a value (panel S4-M6)",
      });
    }
  });
export type UploadSpec = z.infer<typeof UploadSpecSchema>;

/** Mirrors D4's StepDependency (panel S1-M4) — NYC step IDs, or agency-labeled external requirements. */
export const StepDependencySchema = z.strictObject({
  agencyId: z.string().regex(AGENCY_ID_PATTERN, "agency id must match {level}-{slug}").optional(),
  label: z.string().min(1),
  note: z.string().min(1).optional(),
});
export type StepDependency = z.infer<typeof StepDependencySchema>;

/**
 * Which government level runs the step. ABSENCE MEANS NYC, EXPLICITLY
 * (panel S1-M5≡S4-M4): the `.default("nyc")` encodes the locked-decision #3
 * invariant that a step is NYC-run unless a labeled dependency says
 * otherwise — non-NYC levels are always stated, never defaulted into.
 * Pinned by a test parsing a step with the field omitted.
 */
export const RESPONSIBLE_JURISDICTIONS = ["nyc", "nys", "federal", "utility"] as const;
export const ResponsibleJurisdictionSchema = z.enum(RESPONSIBLE_JURISDICTIONS);

export const StepInstructionSchema = z
  .strictObject({
    /** `stp:{serviceId}:{seq3}` — pattern owned by catalog/ids. */
    id: z.string().regex(STEP_ID_PATTERN, "step id must match stp:{serviceId}:{seq3}"),
    /** The owning service's catalog ID — D4 persists it on every step as the
     * referential anchor for the DB load (panel S3-M: the strict schema
     * rejected every real step without it). */
    serviceId: ServiceIdSchema,
    sequence: z.number().int().positive(),
    phase: z.string().min(1).optional(),
    requirement: z.string().min(1),
    responsibleAgency: AgencyRefSchema,
    /** Administration vs authority are distinguished (locked decision #5). */
    administeredBy: AgencyRefSchema.optional(),
    issuedBy: AgencyRefSchema.optional(),
    fulfillmentMethod: FulfillmentMethodSchema,
    /**
     * Required when — and only when — fulfillmentMethod is "document_upload".
     * Required with a note when fulfillmentMethod is "other".
     */
    fulfillmentNote: z.string().min(1).optional(),
    upload: UploadSpecSchema.optional(),
    /** Free-text step notes — D4 persists them on most steps (10 of the 11
     * seeded records carry one), so they stay optional here too (panel S3-M). */
    notes: z.string().min(1).optional(),
    responsibleJurisdiction: ResponsibleJurisdictionSchema.default("nyc"),
    /** Why the step is a dependency, when jurisdiction is not "nyc". */
    dependencyNote: z.string().min(1).optional(),
    /** Structured dependencies (panel S1-M4) — mirror of D4's StepDependency[]. */
    dependencies: z.array(StepDependencySchema).optional(),
    /** The owning service's fee Offer identifier, when the step carries a fee. */
    feeRef: z.string().regex(FEE_ID_PATTERN, "feeRef must match fee:{agency}:{slug}:{part}").optional(),
    /**
     * Surcharges and contingent fees render here — never in the headline
     * estimate (spec D6 rule). Sources ride in the step's `sourceRefs`.
     */
    feeNotes: z.array(z.string().min(1)).optional(),
    /** SourceSnapshot refs backing every factual claim — at least one. */
    sourceRefs: z.array(SnapshotRefSchema).min(1),
  })
  .superRefine((step, ctx) => {
    if (step.fulfillmentMethod === "document_upload" && !step.upload) {
      ctx.addIssue({
        code: "custom",
        path: ["upload"],
        message: "document_upload steps require an upload spec",
      });
    }
    if (step.fulfillmentMethod !== "document_upload" && step.upload) {
      ctx.addIssue({
        code: "custom",
        path: ["upload"],
        message: "upload spec is only valid on document_upload steps",
      });
    }
    if (step.fulfillmentMethod === "other" && !step.fulfillmentNote) {
      ctx.addIssue({
        code: "custom",
        path: ["fulfillmentNote"],
        message: 'fulfillmentMethod "other" requires a fulfillmentNote — say what the fulfillment actually is',
      });
    }
    if (step.responsibleJurisdiction !== "nyc" && !step.dependencyNote && !step.dependencies?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["dependencyNote"],
        message:
          'non-NYC steps must carry a dependencyNote or structured dependencies (locked decision #3: labeled dependencies)',
      });
    }
  });
export type StepInstruction = z.infer<typeof StepInstructionSchema>;
