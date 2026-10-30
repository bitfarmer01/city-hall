// Ordered blueprint steps — the heart of the results page. Every step
// carries the spec contract: responsible agency, fulfillment method, and —
// for upload steps — the portal, accepted formats, and the honest verified
// size limit. Non-NYC dependencies render level-tagged (owner decision,
// 2026-10-30).

import type { StepView } from "@/lib/web/views";

import { DependencyTag } from "./DependencyTag";
import { FulfillmentBadge } from "./Badges";

export function StepsView({ steps }: { steps: StepView[] }) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-ink-muted">No step breakdown captured for this service yet.</p>
    );
  }

  return (
    <ol className="space-y-4">
      {steps.map((step) => (
        <li
          key={step.sequence}
          data-testid="step-item"
          className="rounded-xl border border-line bg-surface-card p-4 shadow-card"
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-ink-secondary"
            >
              {step.sequence}
            </span>
            <p className="font-medium text-ink">{step.requirement}</p>
            <FulfillmentBadge label={step.fulfillmentLabel} />
          </div>

          <p className="mt-1.5 pl-8 text-xs text-ink-muted">
            Agency: {step.agencyName}
            {step.administeredByName !== undefined && <span> · administered by {step.administeredByName}</span>}
          </p>

          {step.notes !== undefined && <p className="mt-2 pl-8 text-sm text-ink-secondary">{step.notes}</p>}

          {step.feeNotes.length > 0 && (
            <div className="mt-2 ml-8 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-secondary">
              {step.feeNotes.map((note, index) => (
                <p key={index}>{note}</p>
              ))}
            </div>
          )}

          {step.upload !== undefined && (
            <div className="mt-2 ml-8 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-secondary">
              <p>
                Upload via{" "}
                <a
                  href={step.upload.portalUrl}
                  className="text-link underline underline-offset-2"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {step.upload.portalName}
                </a>
              </p>
              <p className="mt-0.5">
                Accepted: {step.upload.acceptedFormats.join(", ")} · Size: {step.upload.limitText}
              </p>
            </div>
          )}

          {step.dependencies.length > 0 && (
            <div className="mt-2 pl-8">
              <p className="text-xs text-ink-muted">Depends on:</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {step.dependencies.map((dep, index) => (
                  <li key={index}>
                    <DependencyTag levelLabel={dep.levelLabel} text={`${dep.levelLabel} — ${dep.label}`} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
