// Load the committed catalog into Postgres (D4).
//
//   DATABASE_URL=postgres://... npm run catalog:load
//
// Applies src/lib/db/schema.sql fresh, replaces all rows with
// data/catalog/catalog.json in one transaction, and prints a verification
// summary (per-table counts + bundle hash).

import { readFileSync } from "node:fs";
import { Pool } from "pg";

import type { CatalogBundle } from "../src/lib/catalog/types";
import { loadCatalog } from "../src/lib/db/load";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/cityhall";

async function main(): Promise<void> {
  const bundle = JSON.parse(readFileSync("data/catalog/catalog.json", "utf8")) as CatalogBundle;
  const ddl = readFileSync("src/lib/db/schema.sql", "utf8");
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const result = await loadCatalog(pool, bundle, ddl);
    const vector = await pool.query(
      "SELECT count(*) AS ok FROM pg_extension WHERE extname = 'vector'",
    );
    console.log(
      `catalog loaded: ${result.counts.agencies} agencies, ${result.counts.services} services, ` +
        `${result.counts.steps} steps, ${result.counts.forms} forms, ${result.counts.formFields} fields, ` +
        `${result.counts.snapshots} snapshots, ${result.counts.serviceForms} service-form links, ` +
        `${result.counts.crosswalks} crosswalks`,
    );
    console.log(`bundle sha256 ${result.bundleSha256}`);
    console.log(
      Number(vector.rows[0].ok) > 0
        ? "pgvector extension: present (resolver embeddings land with D5)"
        : "pgvector extension: NOT present (resolver embeddings need pgvector)",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
