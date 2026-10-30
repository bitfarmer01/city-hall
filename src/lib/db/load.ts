// Catalog → Postgres loader (D4). Mirrors every CatalogBundle record into
// the schema in schema.sql inside one transaction: a failed load leaves the
// database untouched. The DDL is applied fresh on every load (drop + create),
// so a load is always a full replace of the catalog.

import { bundleSha256 as catalogBundleSha256 } from "../catalog/link";
import type { CatalogBundle } from "../catalog/types";

/**
 * Structural subset of node-postgres' Pool/Client used by the loader —
 * keeps the module runnable against any conforming client.
 */
export interface QueryClient {
  query(sql: string, values?: unknown[]): Promise<{ rowCount: number | null }>;
}

const DROP_TABLES = [
  "catalog_meta",
  "crosswalks",
  "service_forms",
  "steps",
  "services",
  "form_fields",
  "forms",
  "source_snapshots",
  "portals",
  "agencies",
]
  .map((table) => `DROP TABLE IF EXISTS ${table} CASCADE;`)
  .join("\n");

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function jsonArray(value: unknown): string {
  return JSON.stringify(value ?? []);
}

async function insertAgencies(client: QueryClient, bundle: CatalogBundle): Promise<number> {
  let count = 0;
  for (const agency of bundle.agencies) {
    await client.query(
      "INSERT INTO agencies (id, name, abbreviation, level, urls, schema_org) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)",
      [
        agency.id,
        agency.name,
        agency.abbreviation,
        agency.level,
        jsonArray(agency.urls),
        json(agency.schemaOrg),
      ],
    );
    count += 1;
  }
  return count;
}

async function insertPortals(client: QueryClient, bundle: CatalogBundle): Promise<number> {
  let count = 0;
  for (const portal of bundle.portals) {
    await client.query(
      "INSERT INTO portals (id, agency_id, name, url, auth, capture_policy, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [portal.id, portal.agencyId, portal.name, portal.url, portal.auth, portal.capturePolicy, portal.notes ?? null],
    );
    count += 1;
  }
  return count;
}

async function insertSnapshots(client: QueryClient, bundle: CatalogBundle): Promise<number> {
  let count = 0;
  for (const snapshot of bundle.snapshots) {
    await client.query(
      `INSERT INTO source_snapshots (id, url, captured_at, method, sha256, http_status, storage_path, resolved_url, capture_mode, stopped_at, notes, artifacts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [
        snapshot.id,
        snapshot.url,
        snapshot.capturedAt,
        snapshot.method,
        snapshot.sha256,
        snapshot.httpStatus ?? null,
        snapshot.storagePath ?? null,
        snapshot.resolvedUrl ?? null,
        snapshot.captureMode ?? null,
        snapshot.stoppedAt ?? null,
        snapshot.notes ?? null,
        json(snapshot.artifacts ?? null),
      ],
    );
    count += 1;
  }
  return count;
}

async function insertForms(client: QueryClient, bundle: CatalogBundle): Promise<number> {
  let count = 0;
  for (const form of bundle.forms) {
    await client.query(
      `INSERT INTO forms (id, agency_id, agency_slug, form_number, title, source_url, sha256, pages, fillable_class, revision_date, snapshot_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        form.id,
        `nyc-${form.agency}`,
        form.agency,
        form.formNumber,
        form.title,
        form.sourceUrl,
        form.sha256,
        form.pages,
        form.fillableClass,
        form.revisionDate ?? null,
        form.snapshotId ?? null,
        form.notes ?? null,
      ],
    );
    count += 1;
  }
  return count;
}

async function insertFormFields(client: QueryClient, bundle: CatalogBundle): Promise<number> {
  let count = 0;
  for (const field of bundle.formFields) {
    await client.query(
      `INSERT INTO form_fields (id, form_id, native_name, visible_label, field_type, semantic_type, options, required_status, requirement_level, provenance, label_provenance, bbox, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13)`,
      [
        field.id,
        field.formId,
        field.nativeName,
        field.visibleLabel,
        field.fieldType,
        field.semanticType ?? null,
        jsonArray(field.options ?? []),
        field.requiredStatus,
        field.requirementLevel ?? null,
        json(field.provenance),
        json(field.labelProvenance ?? null),
        json(field.bbox ?? null),
        field.notes ?? null,
      ],
    );
    count += 1;
  }
  return count;
}

async function insertServices(client: QueryClient, bundle: CatalogBundle): Promise<number> {
  let count = 0;
  for (const service of bundle.services) {
    const { name, description } = service.envelope;
    if (!name || !description) {
      throw new Error(`service ${service.meta.catalogId}: envelope is missing name or description`);
    }
    await client.query(
      `INSERT INTO services (catalog_id, nyc311_article_id, nyc311_article_url, name, description, domain, service_subtype, classified_disposition, classifier_rules_version, domain_taxonomy_version, envelope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [
        service.meta.catalogId,
        service.meta.nyc311ArticleId,
        service.meta.nyc311ArticleUrl,
        name,
        description,
        service.meta.domain,
        service.meta.serviceSubtype,
        service.meta.classifiedDisposition,
        service.meta.classifierRulesVersion,
        service.meta.domainTaxonomyVersion,
        json(service.envelope),
      ],
    );
    count += 1;
  }
  return count;
}

async function insertSteps(client: QueryClient, bundle: CatalogBundle): Promise<number> {
  let count = 0;
  for (const service of bundle.services) {
    for (const step of service.steps) {
      await client.query(
        `INSERT INTO steps (id, service_id, sequence, phase, requirement, fulfillment_method, responsible_agency_id, administered_by_agency_id, issued_by_agency_id, upload, fee_ref, dependencies, notes, source_refs)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, $14::jsonb)`,
        [
          step.id,
          step.serviceId,
          step.sequence,
          step.phase ?? null,
          step.requirement,
          step.fulfillmentMethod,
          step.responsibleAgency.id,
          step.administeredBy?.id ?? null,
          step.issuedBy?.id ?? null,
          json(step.upload ?? null),
          step.feeRef ?? null,
          jsonArray(step.dependencies ?? []),
          step.notes ?? null,
          jsonArray(step.sourceRefs ?? []),
        ],
      );
      count += 1;
    }
  }
  return count;
}

async function insertServiceForms(client: QueryClient, bundle: CatalogBundle): Promise<number> {
  let count = 0;
  for (const service of bundle.services) {
    for (const formId of service.formIds) {
      await client.query("INSERT INTO service_forms (service_id, form_id) VALUES ($1, $2)", [
        service.meta.catalogId,
        formId,
      ]);
      count += 1;
    }
  }
  return count;
}

async function insertCrosswalks(client: QueryClient, bundle: CatalogBundle): Promise<number> {
  let count = 0;
  for (const crosswalk of bundle.crosswalks) {
    await client.query(
      "INSERT INTO crosswalks (id, utterances, service_ids, excluded_service_ids, test_cases) VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb)",
      [
        crosswalk.id,
        jsonArray(crosswalk.utterances),
        jsonArray(crosswalk.serviceIds),
        json(crosswalk.excludedServiceIds ?? []),
        json(crosswalk.testCases ?? []),
      ],
    );
    count += 1;
  }
  return count;
}

async function insertCatalogMeta(
  client: QueryClient,
  bundle: CatalogBundle,
  bundleSha: string,
): Promise<void> {
  await client.query(
    `INSERT INTO catalog_meta (singleton, schema_version, catalog_version, generated_at, snapshot_id, snapshot_sha256, article_count, bundle_sha256)
     VALUES (true, $1, $2, $3, $4, $5, $6, $7)`,
    [
      bundle.schemaVersion,
      bundle.catalogVersion,
      bundle.generatedAt,
      bundle.sourceInventory.snapshotId,
      bundle.sourceInventory.sha256,
      bundle.sourceInventory.articleCount,
      bundleSha,
    ],
  );
}

export interface LoadResult {
  bundleSha256: string;
  counts: {
    agencies: number;
    portals: number;
    snapshots: number;
    forms: number;
    formFields: number;
    services: number;
    steps: number;
    serviceForms: number;
    crosswalks: number;
  };
}

/**
 * Replace the database catalog with `bundle`, applying `ddl` (schema.sql)
 * fresh. Everything happens in one transaction.
 */
export async function loadCatalog(
  client: QueryClient,
  bundle: CatalogBundle,
  ddl: string,
): Promise<LoadResult> {
  const bundleSha = catalogBundleSha256(bundle);
  await client.query("BEGIN");
  try {
    await client.query(DROP_TABLES);
    await client.query(ddl);
    const counts = {
      agencies: await insertAgencies(client, bundle),
      portals: await insertPortals(client, bundle),
      snapshots: await insertSnapshots(client, bundle),
      forms: await insertForms(client, bundle),
      formFields: await insertFormFields(client, bundle),
      services: await insertServices(client, bundle),
      steps: await insertSteps(client, bundle),
      serviceForms: await insertServiceForms(client, bundle),
      crosswalks: await insertCrosswalks(client, bundle),
    };
    await insertCatalogMeta(client, bundle, bundleSha);
    await client.query("COMMIT");
    return { bundleSha256: bundleSha, counts };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
