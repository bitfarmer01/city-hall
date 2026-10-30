// Required-documents rendering. Each document lists the form, its
// fillable class and page count, and — when fields were extracted — the
// requiredStatus distribution over all four enum values, so the page is
// honest about what the extraction actually knows.

import type { DocumentView } from "@/lib/web/views";

const FILLABLE_CLASS_LABELS: Record<string, string> = {
  acroform: "fillable PDF (AcroForm)",
  xfa: "fillable PDF (XFA)",
  hybrid: "fillable PDF (hybrid)",
  flattened: "flat PDF",
  scanned: "scanned PDF",
};

export function DocumentsView({ documents }: { documents: DocumentView[] }) {
  if (documents.length === 0) {
    return <p className="text-sm text-ink-muted">No forms captured for this service yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {documents.map((doc) => (
        <li key={doc.id} className="rounded-xl bg-surface-card p-4 shadow-card">
          <p className="font-medium text-ink">
            <a href={doc.sourceUrl} className="text-link underline underline-offset-2" rel="noopener noreferrer" target="_blank">
              {doc.title}
            </a>
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {doc.formNumber !== null && <span>Form {doc.formNumber} · </span>}
            {FILLABLE_CLASS_LABELS[doc.fillableClass] ?? doc.fillableClass} · {doc.pages} {doc.pages === 1 ? "page" : "pages"}
          </p>
          {doc.fieldCounts !== undefined && (
            <p className="mt-1.5 text-xs text-ink-muted" data-testid="field-counts">
              {doc.fieldCounts.total} fields extracted — {doc.fieldCounts.byStatus.author_declared_required} marked
              required on the form, {doc.fieldCounts.byStatus.not_marked_required} not marked,{" "}
              {doc.fieldCounts.byStatus.inferred_required} inferred, {doc.fieldCounts.byStatus.unknown} unknown
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
