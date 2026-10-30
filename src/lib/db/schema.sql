-- city-hall catalog schema (D4) — Postgres + pgvector.
--
-- One table per catalog record; the GovernmentService JSON-LD envelope is
-- stored verbatim in services.envelope so displayed claims always trace to
-- the exact artifact that was validated. Enums mirror the TypeScript types
-- in src/lib/catalog/types.ts; a drift fails the CHECK, which is the point.
-- field_type mirrors the D3a extraction pipeline's normalized vocabulary
-- (the pipeline owns that enum; a new value must be added here too, loudly).
--
-- Embeddings: introduced with the resolver (D5). The vector column's
-- dimension is set by the pinned embedding model, and inventing a dimension
-- before that model is chosen would violate the honesty rules. The pgvector
-- extension itself is enabled here so the CI service verifies it.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE agencies (
  id           text PRIMARY KEY,          -- nyc-dcwp
  name         text NOT NULL,
  abbreviation text NOT NULL,
  level        text NOT NULL CHECK (level IN ('nyc', 'nys', 'federal', 'utility')),
  urls         jsonb NOT NULL DEFAULT '[]'::jsonb,
  schema_org   jsonb NOT NULL
);

CREATE TABLE portals (
  id             text PRIMARY KEY,        -- portal:dep:paris
  agency_id      text NOT NULL REFERENCES agencies(id),
  name           text NOT NULL,
  url            text NOT NULL,
  auth           text NOT NULL CHECK (auth IN ('none', 'nyc_id', 'agency_account', 'unknown')),
  capture_policy text NOT NULL CHECK (capture_policy IN ('html_snapshot', 'headless', 'manual', 'forbidden')),
  notes          text
);

CREATE TABLE source_snapshots (
  id           text PRIMARY KEY,          -- snap:{sha256-12}
  url          text NOT NULL,
  captured_at  text NOT NULL,             -- ISO 8601, verbatim from the pipeline
  method       text NOT NULL CHECK (method IN ('http_fetch', 'headless', 'manual')),
  sha256       text NOT NULL,
  http_status  integer,
  storage_path text,
  resolved_url text,
  capture_mode text CHECK (capture_mode IN ('public_reachable', 'authenticated_unreachable')),
  stopped_at   text,
  notes        text,
  artifacts    jsonb
);

CREATE TABLE forms (
  id             text PRIMARY KEY,        -- form:{agency}:{number}v{revision}
  agency_id      text NOT NULL REFERENCES agencies(id),
  agency_slug    text NOT NULL,           -- extraction-pipeline slug (e.g. "dohmh")
  form_number    text,
  title          text NOT NULL,
  source_url     text NOT NULL,
  sha256         text NOT NULL,
  pages          integer NOT NULL,
  fillable_class text NOT NULL CHECK (fillable_class IN ('acroform', 'xfa', 'hybrid', 'flattened', 'scanned')),
  revision_date  text,
  snapshot_id    text REFERENCES source_snapshots(id),
  notes          text
);

CREATE TABLE form_fields (
  id                text PRIMARY KEY,     -- fld:{formId}:{hash8}
  form_id           text NOT NULL REFERENCES forms(id),
  native_name       text,
  visible_label     text,
  field_type        text NOT NULL CHECK (field_type IN ('text', 'checkbox', 'radio', 'numeric', 'date')),
  semantic_type     text,
  options           jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_status   text NOT NULL CHECK (required_status IN ('author_declared_required', 'not_marked_required', 'inferred_required', 'unknown')),
  requirement_level text,
  provenance        jsonb NOT NULL,
  label_provenance  jsonb,
  bbox              jsonb,
  notes             text
);

CREATE TABLE services (
  catalog_id               text PRIMARY KEY, -- svc:dcwp:home-improvement-contractor-license
  nyc311_article_id        text NOT NULL,    -- nyc311-KA-01808
  nyc311_article_url       text NOT NULL,
  name                     text NOT NULL,
  description              text NOT NULL,
  domain                   text NOT NULL CHECK (domain IN ('permits', 'service-requests', 'public-records', 'licensing', 'inspections')),
  service_subtype          text NOT NULL,
  classified_disposition   text NOT NULL DEFAULT 'service' CHECK (classified_disposition = 'service'),
  classifier_rules_version text NOT NULL,
  domain_taxonomy_version  text NOT NULL,
  envelope                 jsonb NOT NULL    -- GovernmentService JSON-LD, verbatim
);

CREATE TABLE steps (
  id                       text PRIMARY KEY, -- stp:{serviceId}:{seq3}
  service_id               text NOT NULL REFERENCES services(catalog_id) ON DELETE CASCADE,
  sequence                 integer NOT NULL CHECK (sequence >= 1),
  phase                    text,
  requirement              text NOT NULL,
  fulfillment_method       text NOT NULL CHECK (fulfillment_method IN ('site_visit', 'in_person_appearance', 'notarized_wet_signature', 'document_upload', 'online_submission', 'mail_in')),
  responsible_agency_id    text NOT NULL REFERENCES agencies(id),
  administered_by_agency_id text REFERENCES agencies(id),
  issued_by_agency_id      text REFERENCES agencies(id),
  upload                   jsonb,
  fee_ref                  text,
  dependencies             jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes                    text,
  source_refs              jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (service_id, sequence)
);

CREATE TABLE service_forms (
  service_id text NOT NULL REFERENCES services(catalog_id) ON DELETE CASCADE,
  form_id    text NOT NULL REFERENCES forms(id),
  PRIMARY KEY (service_id, form_id)
);

CREATE TABLE crosswalks (
  id                   text PRIMARY KEY,  -- xw:{goalSlug}
  utterances           jsonb NOT NULL,
  service_ids          jsonb NOT NULL,    -- ordered; jsonb arrays preserve order
  excluded_service_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  test_cases           jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE catalog_meta (
  singleton                boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_version           text NOT NULL,
  catalog_version          text NOT NULL,
  generated_at             text NOT NULL,
  snapshot_id              text NOT NULL,
  snapshot_sha256          text NOT NULL,
  article_count            integer NOT NULL,
  bundle_sha256            text NOT NULL
);
