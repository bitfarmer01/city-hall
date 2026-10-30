// The three version stamps every rendered answer carries (spec D5/D7):
// any displayed claim is replayable against the pinned data it came from.

export interface VersionStampProps {
  versions: {
    catalogVersion: string;
    crosswalkVersion: string;
    embeddingModelVersion: string;
  };
}

export function VersionStamp({ versions }: VersionStampProps) {
  return (
    <p
      data-testid="version-stamp"
      className="mt-10 border-t border-line pt-4 font-mono text-xs text-ink-faint"
    >
      catalog {versions.catalogVersion} · crosswalk {versions.crosswalkVersion} · embeddings{" "}
      {versions.embeddingModelVersion}
    </p>
  );
}
