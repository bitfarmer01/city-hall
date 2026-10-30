// StepInstruction — one ordered blueprint step (deliverable 4, spec data
// model "BlueprintStep" + owner's locked decisions #3 and #5).

import { z } from "zod";

import { AgencyRefSchema } from "./primitives";

/**
 * How the requirement is satisfied — the spec's four-value fulfillment enum
 * (site visit, in-person appearance, notarized/wet signature, or upload).
 * The upload member is the only one that carries upload constraints.
 */
export const FULFILLMENT_METHODS = [
  "site_visit",
  "in_person_appearance",
  "notarized_wet_signature",
  "document_upload",
] as const;
export const FulfillmentMethodSchema = z.enum(FULFILLMENT_METHODS);
export type FulfillmentMethod = z.infer<typeof FulfillmentMethodSchema>;

/**
 * Upload constraints, stated only as far as the source states them:
 * `maxSizeBytes: null` with `sizeLimitVerified: false` means "no published
 * limit was found" — the contract refuses to invent one (locked decision #6).
 */
export const UploadSpecSchema = z.strictObject({
  portalId: z.string().min(1),
  acceptedFormats: z.array(z.string().min(1)).min(1),
  maxSizeBytes: z.number().int().positive().nullable(),
  sizeLimitVerified: z.boolean(),
});
export type UploadSpec = z.infer<typeof UploadSpecSchema>;

/**
 * Which government level runs the step. `nyc` is the default; `nys`,
 * `federal`, and `utility` mark the step as a labeled dependency, distinct
 * from NYC-run steps (locked decision #3).
 */
export const RESPONSIBLE_JURISDICTIONS = ["nyc", "nys", "federal", "utility"] as const;
export const ResponsibleJurisdictionSchema = z.enum(RESPONSIBLE_JURISDICTIONS);

export const StepInstructionSchema = z
  .strictObject({
    /** `stp:{serviceId}:{seq}` per the spec's BlueprintStep ID scheme. */
    id: z
      .string()
      .regex(/^stp:.+:\d+$/, "step id must match stp:{serviceId}:{seq}"),
    sequence: z.number().int().positive(),
    requirement: z.string().min(1),
    responsibleAgency: AgencyRefSchema,
    /** Administration vs authority are distinguished (locked decision #5). */
    administeredBy: AgencyRefSchema.optional(),
    issuedBy: AgencyRefSchema.optional(),
    fulfillmentMethod: FulfillmentMethodSchema,
    /** Required when — and only when — fulfillmentMethod is "document_upload". */
    upload: UploadSpecSchema.optional(),
    responsibleJurisdiction: ResponsibleJurisdictionSchema.default("nyc"),
    /** Why the step is a dependency, when jurisdiction is not "nyc". */
    dependencyNote: z.string().min(1).optional(),
    /**
     * Surcharges and contingent fees render here — never in the headline
     * estimate (spec D6 rule). Sources ride in the step's `sourceRefs`.
     */
    feeNotes: z.array(z.string().min(1)).optional(),
    /** SourceSnapshot refs, e.g. "snap:3f9c2a71b4d0" — at least one. */
    sourceRefs: z.array(z.string().min(1)).min(1),
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
    if (step.responsibleJurisdiction !== "nyc" && !step.dependencyNote) {
      ctx.addIssue({
        code: "custom",
        path: ["dependencyNote"],
        message: "non-NYC steps must carry a dependencyNote (locked decision #3: labeled dependencies)",
      });
    }
  });
export type StepInstruction = z.infer<typeof StepInstructionSchema>;
