// Dependency-level tags — the owner's labeling decision (2026-10-30) made
// visual: state, federal, and utility requirements are colored differently
// from NYC's own gray, so "which of these steps is the City's?" reads at a
// glance. The token pairs are defined in globals.css.

const LEVEL_STYLES: Record<string, { bg: string; fg: string }> = {
  nyc: { bg: "var(--tag-nyc-bg)", fg: "var(--tag-nyc-fg)" },
  nys: { bg: "var(--tag-nys-bg)", fg: "var(--tag-nys-fg)" },
  federal: { bg: "var(--tag-federal-bg)", fg: "var(--tag-federal-fg)" },
  utility: { bg: "var(--tag-utility-bg)", fg: "var(--tag-utility-fg)" },
  external: { bg: "var(--tag-external-bg)", fg: "var(--tag-external-fg)" },
};

export function DependencyTag({ levelLabel, text }: { levelLabel: string; text: string }) {
  const style = LEVEL_STYLES[levelLabel] ?? LEVEL_STYLES.external;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: style.bg, color: style.fg }}
      data-level={levelLabel}
    >
      {text}
    </span>
  );
}
