// Database integration tests (D4): load the committed catalog into a real
// Postgres + pgvector database and run the DoD query gates — JSON-LD
// validation, referential integrity, and the five-domain coverage query.
// Requires DATABASE_URL (CI provides one; locally: a Postgres with pgvector).

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bundleSha256 as catalogBundleSha256 } from "../catalog/link";
import type { CatalogBundle } from "../catalog/types";
import { loadCatalog } from "./load";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/cityhall";
const CATALOG_FILE = "data/catalog/catalog.json";
const SCHEMA_FILE = "src/lib/db/schema.sql";
const ALL_DOMAINS = ["inspections", "licensing", "permits", "public-records", "service-requests"];

const pool = new Pool({ connectionString: DATABASE_URL });

let bundle: CatalogBundle;
let bundleSha: string;

beforeAll(async () => {
  bundle = JSON.parse(readFileSync(CATALOG_FILE, "utf8")) as CatalogBundle;
  bundleSha = catalogBundleSha256(bundle);
  const ddl = readFileSync(SCHEMA_FILE, "utf8");
  await loadCatalog(pool, bundle, ddl);
});

afterAll(async () => {
  await pool.end();
});

async function scalar(sql: string): Promise<string> {
  const result = await pool.query(sql);
  return String(Object.values(result.rows[0] as Record<string, unknown>)[0]);
}

describe("catalog load", () => {
  it("records a bundle hash that matches the committed catalog file", async () => {
    expect(await scalar("SELECT bundle_sha256 FROM catalog_meta")).toBe(bundleSha);
  });

  it("loads every record with no drift", async () => {
    expect(await scalar("SELECT count(*) FROM services")).toBe(String(bundle.services.length));
    expect(await scalar("SELECT count(*) FROM steps")).toBe(
      String(bundle.services.reduce((n, s) => n + s.steps.length, 0)),
    );
    expect(await scalar("SELECT count(*) FROM forms")).toBe(String(bundle.forms.length));
    expect(await scalar("SELECT count(*) FROM form_fields")).toBe(String(bundle.formFields.length));
    expect(await scalar("SELECT count(*) FROM source_snapshots")).toBe(String(bundle.snapshots.length));
    expect(await scalar("SELECT count(*) FROM agencies")).toBe(String(bundle.agencies.length));
  });

  it("every service envelope is valid JSON-LD GovernmentService", async () => {
    const result = await pool.query(
      `SELECT count(*) AS bad FROM services
       WHERE envelope->>'@context' <> 'https://schema.org'
          OR envelope->>'@type' <> 'GovernmentService'
          OR jsonb_typeof(envelope->'identifier') <> 'array'
          OR envelope->'x:coverageDomain' IS NULL
          OR envelope->'provider'->>'identifier' IS NULL`,
    );
    expect(Number(result.rows[0].bad)).toBe(0);
  });

  it("every envelope identifier pair matches the meta columns", async () => {
    const result = await pool.query(
      `SELECT count(*) AS bad FROM services
       WHERE NOT (envelope->'identifier') @> to_jsonb(ARRAY[catalog_id, nyc311_article_id])`,
    );
    expect(Number(result.rows[0].bad)).toBe(0);
  });

  it("has no dangling step references", async () => {
    expect(
      await scalar(`SELECT count(*) FROM steps s
                    LEFT JOIN services svc ON svc.catalog_id = s.service_id
                    WHERE svc.catalog_id IS NULL`),
    ).toBe("0");
    expect(
      await scalar(`SELECT count(*) FROM steps s
                    LEFT JOIN agencies a ON a.id = s.responsible_agency_id
                    WHERE a.id IS NULL`),
    ).toBe("0");
    expect(
      await scalar(`SELECT count(*) FROM steps s
                    LEFT JOIN agencies a ON a.id = s.administered_by_agency_id
                    WHERE s.administered_by_agency_id IS NOT NULL AND a.id IS NULL`),
    ).toBe("0");
  });

  it("has no dangling form, field, or snapshot references", async () => {
    expect(
      await scalar(`SELECT count(*) FROM forms f
                    LEFT JOIN source_snapshots snap ON snap.id = f.snapshot_id
                    WHERE f.snapshot_id IS NOT NULL AND snap.id IS NULL`),
    ).toBe("0");
    expect(
      await scalar(`SELECT count(*) FROM form_fields ff
                    LEFT JOIN forms f ON f.id = ff.form_id
                    WHERE f.id IS NULL`),
    ).toBe("0");
    expect(
      await scalar(`SELECT count(*) FROM forms f
                    LEFT JOIN agencies a ON a.id = f.agency_id
                    WHERE a.id IS NULL`),
    ).toBe("0");
  });

  it("every service_forms link resolves on both sides", async () => {
    expect(
      await scalar(`SELECT count(*) FROM service_forms sf
                    LEFT JOIN services s ON s.catalog_id = sf.service_id
                    LEFT JOIN forms f ON f.id = sf.form_id
                    WHERE s.catalog_id IS NULL OR f.id IS NULL`),
    ).toBe("0");
  });

  it("step source_refs and crosswalk service_ids resolve", async () => {
    expect(
      await scalar(`SELECT count(*) FROM steps s, jsonb_array_elements_text(s.source_refs) ref
                    LEFT JOIN source_snapshots snap ON snap.id = ref
                    WHERE snap.id IS NULL`),
    ).toBe("0");
    expect(
      await scalar(`SELECT count(*) FROM crosswalks c, jsonb_array_elements_text(c.service_ids) sid
                    LEFT JOIN services s ON s.catalog_id = sid
                    WHERE s.catalog_id IS NULL`),
    ).toBe("0");
  });

  it("covers all five domains and nothing else", async () => {
    const result = await pool.query("SELECT DISTINCT domain FROM services ORDER BY domain");
    expect(result.rows.map((row) => row.domain)).toEqual(ALL_DOMAINS);
  });

  it("keeps requiredStatus inside the four-value enum", async () => {
    expect(
      await scalar(`SELECT count(*) FROM form_fields
                    WHERE required_status NOT IN ('author_declared_required', 'not_marked_required', 'inferred_required', 'unknown')`),
    ).toBe("0");
  });

  it("never stores an unverified upload size limit", async () => {
    expect(
      await scalar(`SELECT count(*) FROM steps
                    WHERE upload ? 'maxSizeBytes'
                      AND (upload->>'maxSizeBytes') IS NOT NULL
                      AND COALESCE(upload->>'sizeLimitVerified', 'false') <> 'true'`),
    ).toBe("0");
  });

  it("keeps the classified disposition pinned to service", async () => {
    expect(await scalar("SELECT count(*) FROM services WHERE classified_disposition <> 'service'")).toBe("0");
  });

  it("records the inventory source snapshot", async () => {
    const meta = await pool.query("SELECT snapshot_id, article_count, generated_at FROM catalog_meta");
    expect(Number(meta.rows[0].article_count)).toBe(2093);
    expect(String(meta.rows[0].snapshot_id)).toMatch(/^snap:[0-9a-f]{12}$/);
    const snap = await pool.query("SELECT id FROM source_snapshots WHERE id = $1", [
      meta.rows[0].snapshot_id,
    ]);
    expect(snap.rowCount).toBe(1);
  });

  it("reloads byte-identically (idempotent full replace)", async () => {
    const ddl = readFileSync(SCHEMA_FILE, "utf8");
    const first = await loadCatalog(pool, bundle, ddl);
    const second = await loadCatalog(pool, bundle, ddl);
    expect(second.bundleSha256).toBe(first.bundleSha256);
    expect(second.counts).toEqual(first.counts);
  });
});
