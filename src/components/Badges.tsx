// Small presentational atoms: outline chip and fulfillment badge.

export function DomainBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface-card px-2.5 py-0.5 text-xs font-medium text-ink-secondary">
      {label}
    </span>
  );
}

export function FulfillmentBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ink-secondary">
      {label}
    </span>
  );
}
