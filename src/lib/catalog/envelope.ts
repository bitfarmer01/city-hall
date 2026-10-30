// Pure GovernmentService envelope builder — build spec D4. Same pinned
// inputs always produce the same envelope: no clocks, no randomness, arrays
// in declared order. The builder refuses inputs that would produce an
// dishonest record (a fee without provenance, a non-https URL), so the
// honesty rules hold by construction, not by lint alone.

import { DOMAIN_TAXONOMY_VERSION, type CoverageDomain } from "@/lib/inventory/domain";

import type { AgencyRecord, ServiceEnvelope, ServiceOffer } from "./types";

/** One channel the service is reachable through (schema.org ServiceChannel). */
export interface ChannelInput {
  name?: string;
  serviceUrl?: string;
  servicePhone?: string;
  servicePostalAddress?: string;
  /** ISO-8601 duration, e.g. "P21D". Only when a source states one. */
  processingTime?: string;
}

/** One fee with its provenance — becomes a schema.org Offer. */
export interface FeeInput {
  identifier: string;
  price: number;
  description: string;
  /** Snapshot IDs the fee was read from — never empty. */
  sourceRefs: string[];
  /** When the fee was captured (ISO-8601 date or datetime). */
  capturedAt: string;
}

export interface EnvelopeBuildInput {
  catalogId: string;
  nyc311ArticleId: string;
  nyc311ArticleUrl: string;
  title: string;
  description: string;
  alternateNames?: string[];
  serviceType: string;
  domain: CoverageDomain;
  agency: AgencyRecord;
  channels: ChannelInput[];
  fees: FeeInput[];
  /** The permit/license the service produces, when it produces one. */
  serviceOutputName?: string;
}

/** Construction refused — the message names every violated honesty rule. */
export class EnvelopeBuildError extends Error {
  constructor(readonly violations: string[]) {
    super(`envelope build rejected: ${violations.join("; ")}`);
    this.name = "EnvelopeBuildError";
  }
}

function requireHttpsUrl(url: string, what: string, violations: string[]): void {
  if (!url.startsWith("https://")) {
    violations.push(`${what} must be an https:// URL, got "${url}"`);
  }
}

/**
 * Build the JSON-LD GovernmentService envelope. `identifier` is the pair
 * [catalogId, nyc311ArticleId] (locked decision #1); the coverage domain
 * rides in the documented `x:` namespace (schema.org has no term for it,
 * and `additionalProperty` is not legal on Service — art_mcM1Ssao §1.2).
 */
export function buildServiceEnvelope(input: EnvelopeBuildInput): ServiceEnvelope {
  const violations: string[] = [];

  if (!input.agency.schemaOrg.name) {
    violations.push("provider agency is missing its name");
  }
  if (!input.title) {
    violations.push("title must not be empty");
  }

  const offers: ServiceOffer[] = input.fees.map((fee) => {
    if (!Number.isFinite(fee.price) || fee.price < 0) {
      violations.push(`fee ${fee.identifier} has a non-finite or negative price`);
    }
    if (fee.sourceRefs.length === 0) {
      violations.push(`fee ${fee.identifier} has no sourceRefs — an unsourced fee must not ship`);
    }
    if (!fee.capturedAt) {
      violations.push(`fee ${fee.identifier} has no capturedAt`);
    }
    return {
      "@type": "Offer",
      identifier: fee.identifier,
      price: fee.price,
      priceCurrency: "USD",
      description: fee.description,
      "x:sourceRefs": [...fee.sourceRefs],
      "x:capturedAt": fee.capturedAt,
    };
  });

  for (const channel of input.channels) {
    if (channel.serviceUrl !== undefined) {
      requireHttpsUrl(channel.serviceUrl, `channel ${channel.name ?? "(unnamed)"} serviceUrl`, violations);
    }
  }
  requireHttpsUrl(input.nyc311ArticleUrl, "nyc311ArticleUrl", violations);

  if (violations.length > 0) {
    throw new EnvelopeBuildError(violations);
  }

  const envelope: ServiceEnvelope = {
    "@context": "https://schema.org",
    "@type": "GovernmentService",
    identifier: [input.catalogId, input.nyc311ArticleId],
    name: input.title,
    description: input.description,
    ...(input.alternateNames && input.alternateNames.length > 0
      ? { alternateName: [...input.alternateNames] }
      : {}),
    serviceType: input.serviceType,
    provider: {
      "@type": "GovernmentOrganization",
      name: input.agency.schemaOrg.name,
      identifier: input.agency.schemaOrg.identifier,
    },
    jurisdiction: { "@type": "AdministrativeArea", name: "New York City" },
    ...(input.serviceOutputName ? { serviceOutput: { "@type": "Permit", name: input.serviceOutputName } } : {}),
    availableChannel: input.channels.map((channel) => ({
      "@type": "ServiceChannel",
      ...(channel.name !== undefined ? { name: channel.name } : {}),
      ...(channel.serviceUrl !== undefined ? { serviceUrl: channel.serviceUrl } : {}),
      ...(channel.servicePhone !== undefined ? { servicePhone: channel.servicePhone } : {}),
      ...(channel.servicePostalAddress !== undefined
        ? { servicePostalAddress: channel.servicePostalAddress }
        : {}),
      ...(channel.processingTime !== undefined ? { processingTime: channel.processingTime } : {}),
    })),
    offers,
    subjectOf: [{ "@type": "CreativeWork", url: input.nyc311ArticleUrl }],
    "x:coverageDomain": input.domain,
    "x:domainTaxonomyVersion": DOMAIN_TAXONOMY_VERSION,
  };
  return envelope;
}
