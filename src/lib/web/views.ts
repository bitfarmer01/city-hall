// View-model builders for the web surfaces (D7). Pure functions over the
// catalog bundle, the estimate context, and the validated estimate
// registries — no React, no Next, no I/O — so presentational components
// stay trivial and every mapping rule is unit-testable without a server.
//
// The D7 display contract each ServiceView carries:
//   - estimate items, tier-1 fees with per-fee source citation + as-of
//   - ordered steps, each with responsible agency, fulfillment method,
//     upload format + verified size limit, and fee notes (surcharges)
//   - dependencies labeled by agency level (non-NYC stays distinct —
//     locked decision #3)
//   - the required-documents list with the 4-value requiredStatus enum
//     preserved per form (locked decision #6)

import type {
  AgencyLevel,
  AgencyRecord,
  FormFieldRecord,
  FormRecord,
  FulfillmentMethod,
  ServiceEnvelope,
  ServiceRecord,
  StepDependency,
} from "@/lib/catalog/types";
import {
  buildEstimateBlock,
  formatUsd,
  formatDuration,
  parseIsoDuration,
  renderStepFeeNotes,
  type EstimateContext,
  type EstimateTier,
} from "@/lib/estimates";
import { canonicalize } from "@/lib/resolver/canonicalize";

import {
  AGENCY_LEVEL_LABELS,
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  domainLabel,
  fulfillmentLabel,
  uploadLimitText,
} from "./display";

// ---------------------------------------------------------------------------
// Estimate item views
// ---------------------------------------------------------------------------

export interface FeeItemView {
  kind: "fee";
  label: string;
  amountText: string;
  /** Snapshot-composed citation, e.g. "https://… (captured 2026-10-30)". */
  sourceCitation: string;
  sourceUrl: string;
  /** The as-of date every tier-1 fee displays. */
  capturedAt: string;
}

export interface TimelineItemView {
  kind: "timeline";
  label: string;
  durationText: string;
  dataset: string;
  query: string;
  sourceUrl?: string;
}

export interface HeuristicItemView {
  kind: "heuristic";
  label: string;
  rangeText: string;
  basis: string;
}

export type EstimateItemView = FeeItemView | TimelineItemView | HeuristicItemView;

/** Map an estimate tier to its display shape — 1:1, provenance preserved. */
export function estimateItemView(item: EstimateTier): EstimateItemView {
  switch (item.tier) {
    case 1:
      return {
        kind: "fee",
        label: item.label,
        amountText: item.amountText,
        sourceCitation: item.sourceCitation,
        sourceUrl: item.sourceUrl,
        capturedAt: item.capturedAt,
      };
    case 2:
      return {
        kind: "timeline",
        label: item.label,
        durationText: item.durationText,
        dataset: item.dataset,
        query: item.query,
        ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
      };
    case 3:
      return { kind: "heuristic", label: item.label, rangeText: item.rangeText, basis: item.basis };
  }
  item satisfies never;
  throw new Error("unreachable: unknown estimate tier");
}

// ---------------------------------------------------------------------------
// Step views
// ---------------------------------------------------------------------------

export interface UploadView {
  acceptedFormats: string[];
  /** Composed honest text, e.g. "no size limit stated (not verified)". */
  limitText: string;
  sizeLimitVerified: boolean;
  portalUrl?: string;
  portalName?: string;
  multipleAllowed?: boolean;
}

/** Agency levels plus the unresolved-dependency case (no agency on record). */
export type DependencyLevel = AgencyLevel | "external";

export interface DependencyView {
  label: string;
  note?: string;
  agencyId?: string;
  agencyName?: string;
  level: DependencyLevel;
  levelLabel: string;
}

export interface StepView {
  id: string;
  sequence: number;
  phase?: string;
  requirement: string;
  fulfillmentMethod: FulfillmentMethod;
  fulfillmentLabel: string;
  agencyId: string;
  agencyName: string;
  /** Agency level when the agency is in the bundle; "unknown" otherwise. */
  agencyLevel: AgencyLevel | "unknown";
  administeredByName?: string;
  issuedByName?: string;
  upload?: UploadView;
  /** Curated surcharge/contingent-fee notes — rendered in the step, never the headline. */
  feeNotes: string[];
  dependencies: DependencyView[];
  notes?: string;
}

function dependencyView(dep: StepDependency, agenciesById: ReadonlyMap<string, AgencyRecord>): DependencyView {
  const agency = dep.agencyId !== undefined ? agenciesById.get(dep.agencyId) : undefined;
  const level: DependencyLevel = agency?.level ?? "external";
  return {
    label: dep.label,
    ...(dep.note !== undefined ? { note: dep.note } : {}),
    ...(dep.agencyId !== undefined ? { agencyId: dep.agencyId } : {}),
    ...(agency !== undefined ? { agencyName: agency.name } : {}),
    level,
    levelLabel: level === "external" ? "External" : AGENCY_LEVEL_LABELS[level],
  };
}

function uploadView(upload: NonNullable<BlueprintStepUpload>): UploadView {
  return {
    acceptedFormats: [...(upload.acceptedFormats ?? [])],
    limitText: uploadLimitText(upload),
    sizeLimitVerified: upload.sizeLimitVerified,
    ...(upload.portalUrl !== undefined ? { portalUrl: upload.portalUrl } : {}),
    ...(upload.portalId !== undefined ? { portalName: upload.portalId } : {}),
    ...(upload.multipleAllowed !== undefined ? { multipleAllowed: upload.multipleAllowed } : {}),
  };
}

type BlueprintStepUpload = NonNullable<import("@/lib/catalog/types").BlueprintStepRecord["upload"]>;

// ---------------------------------------------------------------------------
// Document views
// ---------------------------------------------------------------------------

export interface DocumentView {
  id: string;
  title: string;
  formNumber: string | null;
  sourceUrl: string;
  pages: number;
  fillableClass: string;
  fieldCounts: {
    total: number;
    /** All four requiredStatus values, never collapsed to a boolean. */
    byStatus: Record<import("@/lib/catalog/types").RequiredStatus, number>;
  };
}

function documentView(form: FormRecord, fields: readonly FormFieldRecord[] | undefined): DocumentView {
  const byStatus: DocumentView["fieldCounts"]["byStatus"] = {
    author_declared_required: 0,
    not_marked_required: 0,
    inferred_required: 0,
    unknown: 0,
  };
  let total = 0;
  for (const field of fields ?? []) {
    byStatus[field.requiredStatus] += 1;
    total += 1;
  }
  return {
    id: form.id,
    title: form.title,
    formNumber: form.formNumber,
    sourceUrl: form.sourceUrl,
    pages: form.pages,
    fillableClass: form.fillableClass,
    fieldCounts: { total, byStatus },
  };
}

// ---------------------------------------------------------------------------
// Service view
// ---------------------------------------------------------------------------

export interface ChannelView {
  name?: string;
  url?: string;
  phone?: string;
  address?: string;
  /** Display-formatted duration ("21 days"), or the raw string if unparseable. */
  processingTime?: string;
}

function formatChannelProcessingTime(iso: string): string {
  try {
    return formatDuration(parseIsoDuration(iso));
  } catch (error) {
    // Surface, never silently swallow: the catalog build should have
    // rejected a non-ISO duration, so reaching this means catalog data
    // is malformed. Render the raw value rather than breaking the page.
    console.error("malformed processingTime in catalog", iso, error);
    return iso;
  }
}

export interface ServiceView {
  catalogId: string;
  articleId: string;
  articleUrl: string;
  name: string;
  description: string;
  domain: string;
  domainLabel: string;
  serviceType: string;
  agencyId: string;
  agencyName: string;
  estimateItems: EstimateItemView[];
  steps: StepView[];
  documents: DocumentView[];
  channels: ChannelView[];
}

/** Everything buildServiceView needs beyond the record — all versioned data. */
export interface ServiceViewDeps {
  estimateContext: EstimateContext;
  agenciesById: ReadonlyMap<string, AgencyRecord>;
  formsById: ReadonlyMap<string, FormRecord>;
  fieldsByFormId: ReadonlyMap<string, FormFieldRecord[]>;
  /** Validated surcharge notes keyed by step ID. */
  surchargeNotes: ReadonlyMap<string, string[]>;
}

export function buildServiceView(record: ServiceRecord, deps: ServiceViewDeps): ServiceView {
  const envelope = record.envelope;

  const estimateBlock = buildEstimateBlock(record, deps.estimateContext);

  const steps = [...record.steps]
    .sort((a, b) => a.sequence - b.sequence)
    .map((step): StepView => {
      const agencyLevel = deps.agenciesById.get(step.responsibleAgency.id)?.level ?? "unknown";
      return {
        id: step.id,
        sequence: step.sequence,
        ...(step.phase !== undefined ? { phase: step.phase } : {}),
        requirement: step.requirement,
        fulfillmentMethod: step.fulfillmentMethod,
        fulfillmentLabel: fulfillmentLabel(step.fulfillmentMethod),
        agencyId: step.responsibleAgency.id,
        agencyName: step.responsibleAgency.name,
        agencyLevel,
        ...(step.administeredBy !== undefined ? { administeredByName: step.administeredBy.name } : {}),
        ...(step.issuedBy !== undefined ? { issuedByName: step.issuedBy.name } : {}),
        ...(step.upload !== undefined ? { upload: uploadView(step.upload) } : {}),
        feeNotes: renderStepFeeNotes(step, deps.surchargeNotes),
        dependencies: (step.dependencies ?? []).map((dep) => dependencyView(dep, deps.agenciesById)),
        ...(step.notes !== undefined ? { notes: step.notes } : {}),
      };
    });

  const documents = record.formIds
    .map((formId) => deps.formsById.get(formId))
    .filter((form): form is FormRecord => form !== undefined)
    .map((form) => documentView(form, deps.fieldsByFormId.get(form.id)));

  const channels = envelope.availableChannel.map((channel): ChannelView => ({
    ...(channel.name !== undefined ? { name: channel.name } : {}),
    ...(channel.serviceUrl !== undefined ? { url: channel.serviceUrl } : {}),
    ...(channel.servicePhone !== undefined ? { phone: channel.servicePhone } : {}),
    ...(channel.servicePostalAddress !== undefined ? { address: channel.servicePostalAddress } : {}),
    // Display-formatted ("21 days"), never raw ISO-8601; an unparseable
    // value falls back to the raw string rather than breaking the page.
    ...(channel.processingTime !== undefined ? { processingTime: formatChannelProcessingTime(channel.processingTime) } : {}),
  }));

  return {
    catalogId: record.meta.catalogId,
    articleId: record.meta.nyc311ArticleId,
    articleUrl: record.meta.nyc311ArticleUrl,
    name: envelope.name,
    description: envelope.description,
    domain: record.meta.domain,
    domainLabel: domainLabel(record.meta.domain),
    serviceType: envelope.serviceType,
    agencyId: envelope.provider.identifier,
    agencyName: envelope.provider.name,
    estimateItems: estimateBlock.tiers.map(estimateItemView),
    steps,
    documents,
    channels,
  };
}

// ---------------------------------------------------------------------------
// Browse views
// ---------------------------------------------------------------------------

export interface BrowseCardView {
  catalogId: string;
  name: string;
  description: string;
  domain: string;
  domainLabel: string;
  agencyName: string;
  articleUrl: string;
  href: string;
  /** "From $200.00" when the service carries any published fee. */
  feeFromText?: string;
  /** Shortest published processing time, display-formatted. */
  processingTimeText?: string;
  stepsCount: number;
  documentsCount: number;
  /** Lowercased search corpus — names, alternates, agency, description, IDs. */
  keywords: string;
}

/** Shortest published channel processing time, display-formatted; undefined when none. */
function shortestPublishedTime(envelope: ServiceEnvelope): string | undefined {
  const published = envelope.availableChannel
    .filter((channel) => channel.processingTime !== undefined)
    .map((channel) => parseIsoDuration(channel.processingTime as string));
  if (published.length === 0) return undefined;
  const shortest = published.reduce((a, b) =>
    (b.years * 365 + b.months * 30 + b.weeks * 7 + b.days) * 86400 + b.hours * 3600 + b.minutes * 60 + b.seconds <
    (a.years * 365 + a.months * 30 + a.weeks * 7 + a.days) * 86400 + a.hours * 3600 + a.minutes * 60 + a.seconds
      ? b
      : a,
  );
  return formatDuration(shortest);
}

export interface ResultItemView {
  catalogId: string;
  name: string;
  description: string;
  domain: string;
  domainLabel: string;
  agencyName: string;
  href: string;
  /** Human phrase for the resolver layer that fired, e.g. "known-goal match". */
  layerPhrase: string;
}

/** Result cards for the goal→results page, in resolver order. */
export function buildResultViews(records: readonly ServiceRecord[], layer: string): ResultItemView[] {
  const layerPhrase = resolutionLayerPhrase(layer);
  return records.map((record) => ({
    catalogId: record.meta.catalogId,
    name: record.envelope.name,
    description: record.envelope.description,
    domain: record.meta.domain,
    domainLabel: domainLabel(record.meta.domain),
    agencyName: record.envelope.provider.name,
    href: `/services/${encodeURIComponent(record.meta.catalogId)}`,
    layerPhrase,
  }));
}

export function buildBrowseCards(services: readonly ServiceRecord[]): BrowseCardView[] {
  return services.map((service) => {
    const envelope = service.envelope;
    const prices = envelope.offers.map((offer) => offer.price);
    const minPrice = prices.length > 0 ? Math.min(...prices) : undefined;
    const processingTimeText = shortestPublishedTime(envelope);
    return {
      catalogId: service.meta.catalogId,
      name: envelope.name,
      description: envelope.description,
      domain: service.meta.domain,
      domainLabel: domainLabel(service.meta.domain),
      agencyName: envelope.provider.name,
      articleUrl: service.meta.nyc311ArticleUrl,
      href: `/services/${encodeURIComponent(service.meta.catalogId)}`,
      ...(minPrice !== undefined ? { feeFromText: `From ${formatUsd(minPrice)}` } : {}),
      ...(processingTimeText !== undefined ? { processingTimeText } : {}),
      stepsCount: service.steps.length,
      documentsCount: service.formIds.length,
      keywords: [
        envelope.name,
        ...(envelope.alternateName ?? []),
        envelope.provider.name,
        envelope.description,
        service.meta.catalogId,
        service.meta.nyc311ArticleId,
        envelope.serviceType,
      ]
        .join(" ")
        .toLowerCase(),
    };
  });
}

export interface BrowseFilter {
  q?: string;
  domain?: string;
}

/**
 * Filter browse cards. Search tokens run through the resolver's own
 * canonicalize (stopwords dropped, stems, synonyms) so typing "license my
 * dog" here behaves like resolving it as a goal; tokens are AND-composed
 * over the card's corpus. The domain filter is exact. Pure and
 * order-stable — the same cards and filter always yield the same list.
 */
export function filterBrowseCards(cards: readonly BrowseCardView[], filter: BrowseFilter): BrowseCardView[] {
  const domain = filter.domain?.trim();
  const q = filter.q?.trim();
  const tokens = q !== undefined && q.length > 0 ? canonicalize(q).tokens : [];
  return cards.filter((card) => {
    if (domain !== undefined && domain.length > 0 && card.domain !== domain) return false;
    for (const token of tokens) {
      if (!card.keywords.includes(token)) return false;
    }
    return true;
  });
}

export interface DomainCount {
  domain: string;
  label: string;
  count: number;
}

/** Counts per coverage domain, in DOMAIN_ORDER, keeping only populated domains. */
export function domainCounts(cards: readonly BrowseCardView[]): DomainCount[] {
  return DOMAIN_ORDER.map((domain) => ({
    domain,
    label: DOMAIN_LABELS[domain],
    count: cards.filter((card) => card.domain === domain).length,
  })).filter((entry) => entry.count > 0);
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** First value of a possibly-repeated query parameter. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Human phrases for the resolver layer that fired (results-page traceability). */
export const RESOLUTION_LAYER_PHRASES: Record<string, string> = {
  "exact-id": "identifier match",
  "alias-rules": "known-goal match",
  "semantic-retrieval": "similar-goal match",
  "search-fallback": "keyword match",
  llm_assist: "AI suggestion (outside the deterministic guarantee)",
};

export function resolutionLayerPhrase(layer: string): string {
  return RESOLUTION_LAYER_PHRASES[layer] ?? layer;
}
