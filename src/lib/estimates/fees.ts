// Tier-1 fee extraction — build spec D6. Fees come verbatim from the
// catalog envelope's schema.org Offers, each of which already carries
// x:sourceRefs + x:capturedAt (the catalog build refuses unsourced fees).
// The extractor resolves those refs to SourceSnapshot records and composes
// the display citation from structured snapshot data — it never parses a
// fee amount out of prose, and it refuses an offer whose provenance is
// missing, dangling, or date-inconsistent with its snapshot.

import { SNAPSHOT_ID_PATTERN } from "@/lib/catalog/ids";
import type { ServiceEnvelope, SourceSnapshotRecord } from "@/lib/catalog/types";

import { EstimatesError, ISO_DATE_PATTERN, type FeeEstimate } from "./types";

/**
 * Split the fee's display label off the seed's description. The seed
 * convention (data/catalog/seed) composes an offer description as
 * "<fee text>. Source: <article>, captured <date>." — the source tail is
 * presentation prose; the structured provenance lives on the offer itself
 * and is recomposed from snapshots below.
 */
export function splitFeeLabel(description: string): string {
  const cutoff = description.indexOf(" Source: ");
  const label = cutoff >= 0 ? description.slice(0, cutoff) : description;
  return label.trim();
}

/** Deterministic USD presentation of a stored price — never a parsed one. */
export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

/**
 * The offer's capturedAt and its snapshot's capturedAt may differ in
 * precision (date vs datetime); agreement means the same calendar day.
 */
export function capturedAtDatesAgree(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

export type SnapshotsById = ReadonlyMap<string, SourceSnapshotRecord>;

export function snapshotsById(snapshots: readonly SourceSnapshotRecord[]): SnapshotsById {
  return new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
}

/**
 * Map every envelope offer to a tier-1 FeeEstimate. Refuses the whole
 * batch when any offer would render without source + as-of — the D6
 * assertion ("every displayed fee carries source + as-of") holds by
 * construction, not by renderer discipline.
 */
export function buildFeeEstimates(envelope: ServiceEnvelope, snapshots: SnapshotsById): FeeEstimate[] {
  const violations: string[] = [];

  const estimates = envelope.offers.map((offer) => {
    const refs = offer["x:sourceRefs"];
    const capturedAt = offer["x:capturedAt"];

    if (refs.length === 0) {
      violations.push(`fee ${offer.identifier} has no sourceRefs — an unsourced fee must not display`);
    }
    if (!ISO_DATE_PATTERN.test(capturedAt)) {
      violations.push(`fee ${offer.identifier} capturedAt ${JSON.stringify(capturedAt)} is not an ISO yyyy-mm-dd date`);
    }

    const primary = refs[0];
    if (primary !== undefined) {
      if (!SNAPSHOT_ID_PATTERN.test(primary)) {
        violations.push(`fee ${offer.identifier} sourceRef ${JSON.stringify(primary)} is not a snap:{sha256-12} id`);
      } else {
        const snapshot = snapshots.get(primary);
        if (snapshot === undefined) {
          violations.push(`fee ${offer.identifier} sourceRef ${primary} resolves to no snapshot in this bundle`);
        } else {
          if (!snapshot.url.startsWith("https://")) {
            violations.push(`fee ${offer.identifier} snapshot ${primary} url is not https:// — ${snapshot.url}`);
          }
          if (!capturedAtDatesAgree(capturedAt, snapshot.capturedAt)) {
            violations.push(
              `fee ${offer.identifier} capturedAt ${capturedAt} disagrees with snapshot ${primary} capturedAt ${snapshot.capturedAt}`,
            );
          }
        }
      }
    }

    const label = splitFeeLabel(offer.description);
    if (label.length === 0) {
      violations.push(`fee ${offer.identifier} has an empty description — no display label`);
    }

    const fee: FeeEstimate = {
      tier: 1,
      label,
      amountText: formatUsd(offer.price),
      ...(offer.price > 0 ? { amountValue: offer.price } : {}),
      currency: offer.priceCurrency,
      sourceCitation: citations(refs, snapshots),
      sourceUrl: snapshotUrl(primary, snapshots),
      capturedAt,
    };
    return fee;
  });

  if (violations.length > 0) {
    throw new EstimatesError(violations);
  }
  return estimates;
}

/**
 * Citation text from the primary snapshot: url + the offer's own as-of.
 * Additional snapshots corroborate the fee in the catalog; the display
 * cites the primary capture.
 */
function citations(refs: readonly string[], snapshots: SnapshotsById): string {
  const primary = refs[0];
  const snapshot = primary !== undefined ? snapshots.get(primary) : undefined;
  if (snapshot === undefined) {
    // A dangling ref is reported as a violation; the citation stays empty
    // rather than improvised — this fee cannot render.
    return "";
  }
  return `${snapshot.url} (captured ${snapshot.capturedAt.slice(0, 10)})`;
}

function snapshotUrl(primary: string | undefined, snapshots: SnapshotsById): string {
  const snapshot = primary !== undefined ? snapshots.get(primary) : undefined;
  return snapshot?.url ?? "";
}
