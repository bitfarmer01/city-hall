// Required-documents rendering. Each document lists the form, its filling
// method, and — when fields were extracted — the requiredStatus
// distribution over all four enum values, so the page is honest about
// what the extraction actually knows.

import type { DocumentView } from "@/lib/web/views";

export function DocumentsView({ documents }: { documents: DocumentView[] }) {
  if (documents.length === 0) {
    return <p className="text-sm text-ink-muted">No forms captured for this service yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {documents.map((doc) => (
        <li key={doc.formId} className="rounded-xl border border-line bg-surface-card p-4 shadow-card">
          <p className="font-medium text-ink">
            {doc.url !== undefined ? (
              <a href={doc.url} className="text-link underline underline-offset-2" rel="noopener noreferrer" target="_blank">
                {doc.title}
              </a>
            ) : (
              doc.title
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {doc.agencyName} · {doc.fillMethod}
            {doc.formNumber !== undefined && <span> · Form {doc.formNumber}</span>}
          </p>
          {doc.fieldCounts !== undefined && (
            <p className="mt-1.5 text-xs text-ink-muted" data-testid="field-counts">
              {doc.fieldCounts.total} fields extracted — {doc.fieldCounts.byStatus.author_declared_required} marked
              required on the form, {doc.fieldCounts.byStatus.not_marked_required} not marked,{" "}
              {doc.fieldCounts.byStatus.inferred_required} inferred, {doc.fieldCounts.byStatus.unknown} unknown
            </p>
          )}
          {doc.notes !== undefined && <p className="mt-1.5 text-sm text-ink-secondary">{doc.notes}</p>}
        </li>
      ))}
    </ul>
  );
}
