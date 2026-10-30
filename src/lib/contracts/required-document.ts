// RequiredDocument — one entry in a service's required-documents catalog
// (deliverable 5). Every entry is required by definition; the record carries
// where that requirement comes from (sourceRefs), never a boolean guess.

import { z } from "zod";

import { ServiceIdSchema } from "./primitives";

export const RequiredDocumentSchema = z.strictObject({
  /**
   * `form:{agency}:{formNumber}v{revision}` when the document is a form;
   * free-form `doc:{agency}:{slug}` otherwise (the spec's Form record only
   * covers numbered forms).
   */
  id: z.string().min(1),
  serviceId: ServiceIdSchema,
  name: z.string().min(1),
  /** What the document must show, when the source states it. */
  description: z.string().min(1).optional(),
  formNumber: z.string().min(1).optional(),
  sourceUrl: z.url().optional(),
  /** SourceSnapshot refs — at least one, per the provenance bar. */
  sourceRefs: z.array(z.string().min(1)).min(1),
});
export type RequiredDocument = z.infer<typeof RequiredDocumentSchema>;
