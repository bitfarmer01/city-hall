// RequiredDocument — one entry in a service's required-documents catalog
// (deliverable 5). Every entry is required by definition; the record carries
// where that requirement comes from (sourceRefs), never a boolean guess.
//
// `id` adopts the catalog's FORM_ID_PATTERN (panel S1-S2): document identity
// is owned by D4's Form records, so a required document keys as
// `form:{agency}:{formNumber}v{revision}` — non-form documents get a
// form-shaped catalog ID at link time.

import { z } from "zod";

import { FORM_ID_PATTERN } from "../catalog/ids";

import { HttpsUrlSchema, ServiceIdSchema, SnapshotRefSchema } from "./primitives";

export const RequiredDocumentSchema = z.strictObject({
  /** `form:{agency}:{formNumber}v{revision}` — D4's Form record identity. */
  id: z.string().regex(FORM_ID_PATTERN, "document id must match form:{agency}:{formNumber}[v{revision}]"),
  serviceId: ServiceIdSchema,
  name: z.string().min(1),
  /** What the document must show, when the source states it. */
  description: z.string().min(1).optional(),
  formNumber: z.string().min(1).optional(),
  sourceUrl: HttpsUrlSchema.optional(),
  /** SourceSnapshot refs — at least one, per the provenance bar. */
  sourceRefs: z.array(SnapshotRefSchema).min(1),
});
export type RequiredDocument = z.infer<typeof RequiredDocumentSchema>;
