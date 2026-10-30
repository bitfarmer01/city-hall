// The full service answer — estimate, ordered steps, required documents,
// channels — rendered from one ServiceView. Shared by the results page
// (single match) and the /services/[id] page, so both surfaces present
// the same contract by construction.

import type { ServiceView } from "@/lib/web/views";

import { DomainBadge } from "./Badges";
import { DocumentsView } from "./DocumentsView";
import { EstimateView } from "./EstimateView";
import { StepsView } from "./StepsView";
import { VersionStamp } from "./VersionStamp";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold tracking-wide text-ink-muted uppercase">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ServiceDetail({
  view,
  versions,
}: {
  view: ServiceView;
  versions: { catalogVersion: string; crosswalkVersion: string; embeddingModelVersion: string };
}) {
  return (
    <article data-testid="service-detail" className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <DomainBadge label={view.domainLabel} />
        <span className="font-mono text-xs text-ink-faint">{view.catalogId}</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{view.name}</h1>
      <p className="mt-1 text-sm text-ink-secondary">
        {view.agencyName}
        {view.description !== undefined && view.description.length > 0 && <span> — {view.description}</span>}
      </p>

      <Section title="Estimate">
        <EstimateView items={view.estimateItems} />
      </Section>

      <Section title={`Steps (${view.steps.length})`}>
        <StepsView steps={view.steps} />
      </Section>

      <Section title={`Required documents (${view.documents.length})`}>
        <DocumentsView documents={view.documents} />
      </Section>

      {view.channels.length > 0 && (
        <Section title="Channels">
          <ul className="space-y-2">
            {view.channels.map((channel, index) => (
              <li key={index} className="text-sm text-ink-secondary">
                {channel.url !== undefined ? (
                  <a
                    href={channel.url}
                    className="text-link underline underline-offset-2"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {channel.name ?? channel.url}
                  </a>
                ) : (
                  channel.name
                )}
                {channel.phone !== undefined && <span> · {channel.phone}</span>}
                {channel.address !== undefined && <span> · {channel.address}</span>}
                {channel.processingTime !== undefined && <span> · processing: {channel.processingTime}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <VersionStamp versions={versions} />
    </article>
  );
}
