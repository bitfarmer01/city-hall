// Catalog build (D4): merges classifier output, PDF extraction records, and
// portal capture snapshots into one validated, versioned CatalogBundle.
//
//   npm run catalog:build            → build + verify against the committed file
//   npm run catalog:build -- --write → rebuild data/catalog/catalog.json
//
// Guarantees:
//  - Snapshot JSON is loaded ONLY through parseSnapshotJson with a pinned
//    SNAPSHOT_SCHEMA_VERSION value (PR #6 panel review, finding 1: the
//    classifier's test loader raw-casts; shape drift must fail loudly, not
//    silently classify everything informational).
//  - Coverage-domain tags are only coverage-meaningful for disposition ===
//    "service" (panel review, finding 2): every seed article must classify
//    as a service, and the seed's domain must equal the tagger's, or the
//    build fails.
//  - No classifier ruleIds or evidence spans are persisted (panel review,
//    finding 3): the evidence field shape changes in fix/classifier-fidelity.
//    Only the disposition assertion and pinned versions are recorded.
//  - Determinism: same seeds + same snapshot → byte-identical catalog.json.

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { bundleSha256, sha256Hex } from "../src/lib/capture/hash";
import { readSnapshot } from "../src/lib/capture/store";
import { parseExtractedForm } from "../src/lib/catalog/forms";
import { snapshotFromEvidence, snapshotFromFixture, type EvidenceRecord } from "../src/lib/catalog/evidence";
import {
  buildServiceEnvelope,
  type ChannelInput,
  type FeeInput,
} from "../src/lib/catalog/envelope";
import type {
  AgencyRecord,
  BlueprintStepRecord,
  FormFieldRecord,
  FormRecord,
  PortalRecord,
  ServiceCatalogMeta,
  ServiceRecord,
  SourceSnapshotRecord,
} from "../src/lib/catalog/types";
import {
  bundleSha256 as catalogBundleSha256,
  linkCatalog,
  snapshotFromCapture,
  stableStringify,
  type LinkInput,
} from "../src/lib/catalog/link";
import { CLASSIFIER_RULES_VERSION, classifyArticle } from "../src/lib/inventory/classify";
import { DOMAIN_TAXONOMY_VERSION, type CoverageDomain } from "../src/lib/inventory/domain";
import { parseSnapshotJson } from "../src/lib/inventory/build-snapshot";
import { SNAPSHOT_SCHEMA_VERSION, type InventorySnapshot, type KaNumber } from "../src/lib/inventory/types";

const SEED_DIR = "data/catalog/seed";
const FORMS_DIR = "data/catalog/forms";
const INVENTORY_SNAPSHOT_FILE = "data/snapshots/nyc311-index/2026-10-30.json";
const CAPTURE_FIXTURE_DIR = "fixtures/snapshots";
const CAPTURE_FIXTURE_ID = "snap:a59b2828c958";
const ARTICLE_FIXTURE_PATH = "src/lib/inventory/__fixtures__/nyc311/article-ka-01808.html";
const PDF_FIXTURE_DIR = "python/tests/fixtures/pdfs";
const OUTPUT_FILE = "data/catalog/catalog.json";
const ALL_DOMAINS: readonly CoverageDomain[] = [
  "permits",
  "service-requests",
  "public-records",
  "licensing",
  "inspections",
];

interface SeedMeta {
  catalogVersion: string;
  generatedAt: string;
}

interface ServiceSeed {
  catalogId: string;
  ka: KaNumber;
  domain: CoverageDomain;
  serviceType: string;
  alternateNames: string[];
  serviceOutputName?: string;
  channels: ChannelInput[];
  fees: FeeInput[];
  formIds: string[];
  // Seed-boundary cast: steps arrive as untyped JSON and are validated by
  // the linker (IDs, sequences, fulfillment enums, upload honesty, agency
  // resolution). Never trust them before linkCatalog runs.
  steps: BlueprintStepRecord[];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function assertSeedMeta(value: unknown): SeedMeta {
  const record = value as Record<string, unknown>;
  if (typeof record.catalogVersion !== "string" || typeof record.generatedAt !== "string") {
    throw new Error("seed meta.json must carry catalogVersion and generatedAt strings");
  }
  return { catalogVersion: record.catalogVersion, generatedAt: record.generatedAt };
}

/**
 * The ONLY snapshot loader in this script: strict parse + pinned schema
 * version (panel review, finding 1). A schema drift throws instead of
 * silently misclassifying.
 */
function loadInventorySnapshot(path: string): InventorySnapshot {
  const snapshot = parseSnapshotJson(readFileSync(path, "utf8"));
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `inventory snapshot ${path}: schemaVersion "${snapshot.schemaVersion}" does not match the pinned "${SNAPSHOT_SCHEMA_VERSION}"`,
    );
  }
  return snapshot;
}

function loadEvidenceRecords(): EvidenceRecord[] {
  const dir = join(SEED_DIR, "evidence");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as EvidenceRecord);
}

function loadServiceSeeds(): ServiceSeed[] {
  const dir = join(SEED_DIR, "services");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as ServiceSeed)
    .map((seed) => {
      if (!/^KA-\d{5}$/.test(seed.ka)) {
        throw new Error(`service ${seed.catalogId}: ka "${seed.ka}" is not a KA-##### number`);
      }
      return { ...seed, ka: seed.ka as KaNumber };
    });
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const meta = assertSeedMeta(readJson(join(SEED_DIR, "meta.json")));
  const agencies = readJson(join(SEED_DIR, "agencies.json")) as AgencyRecord[];
  const portals = readJson(join(SEED_DIR, "portals.json")) as PortalRecord[];

  // ---- Source snapshots ----------------------------------------------------
  const snapshots: SourceSnapshotRecord[] = [];

  const inventory = loadInventorySnapshot(INVENTORY_SNAPSHOT_FILE);
  snapshots.push({
    id: `snap:${inventory.sourceSha256.slice(0, 12)}`,
    url: inventory.sourceUrl,
    capturedAt: inventory.capturedAt,
    method: "http_fetch" as const,
    sha256: inventory.sourceSha256,
    storagePath: INVENTORY_SNAPSHOT_FILE,
  });

  const articleFixtureBytes = readFileSync(ARTICLE_FIXTURE_PATH);
  snapshots.push(
    snapshotFromFixture(
      "https://portal.311.nyc.gov/article/?kanumber=KA-01808",
      sha256Hex(articleFixtureBytes),
      ARTICLE_FIXTURE_PATH,
      "2026-10-30",
      "Committed D2b article fixture (full page HTML).",
    ),
  );

  const capture = await readSnapshot(CAPTURE_FIXTURE_DIR, CAPTURE_FIXTURE_ID);
  const captureFullSha = bundleSha256(capture.snapshot.artifacts);
  if (capture.snapshot.id !== `snap:${captureFullSha.slice(0, 12)}`) {
    throw new Error(
      `capture fixture ${CAPTURE_FIXTURE_ID}: bundle hash ${captureFullSha.slice(0, 12)} does not match the snapshot id`,
    );
  }
  snapshots.push(snapshotFromCapture(capture.snapshot, captureFullSha));

  for (const evidence of loadEvidenceRecords()) {
    const storagePath = join(SEED_DIR, "evidence", `${evidence.id}.json`);
    snapshots.push(snapshotFromEvidence(evidence, sha256Hex(readFileSync(storagePath)), storagePath));
  }

  // ---- Forms + fields from the Python extraction pipeline ------------------
  const forms: FormRecord[] = [];
  const formFields: FormFieldRecord[] = [];
  for (const name of readdirSync(FORMS_DIR).filter((n) => n.endsWith(".catalog.json"))) {
    const extracted = parseExtractedForm(readJson(join(FORMS_DIR, name)));
    const pdfPath = join(PDF_FIXTURE_DIR, `${name.replace(".catalog.json", "")}.pdf`);
    const pdfSha = sha256Hex(readFileSync(pdfPath));
    if (pdfSha !== extracted.form.sha256) {
      throw new Error(
        `form ${extracted.form.id}: committed PDF ${pdfPath} hashes to ${pdfSha.slice(0, 12)}, record says ${extracted.form.sha256.slice(0, 12)}`,
      );
    }
    forms.push({ ...extracted.form, snapshotId: extracted.snapshot.id });
    formFields.push(...extracted.fields);
    snapshots.push({ ...extracted.snapshot, storagePath: pdfPath });
  }

  // ---- Services: classifier output merged into envelopes --------------------
  const entriesByKa = new Map(inventory.articles.map((entry) => [entry.ka, entry]));
  const services: ServiceRecord[] = [];
  for (const seed of loadServiceSeeds()) {
    const entry = entriesByKa.get(seed.ka);
    if (!entry) {
      throw new Error(`service ${seed.catalogId}: article ${seed.ka} is not in the inventory snapshot`);
    }
    const articleId = entry.id;

    // Panel review, finding 2: a domain tag is only coverage-meaningful for
    // disposition === "service". Fail loudly rather than green-lighting
    // coverage on a non-service.
    const classified = classifyArticle({ entry });
    if (classified.classification.disposition !== "service") {
      throw new Error(
        `service ${seed.catalogId}: article ${seed.ka} classifies as "${classified.classification.disposition}", not "service" — seed disagrees with the classifier`,
      );
    }
    if (classified.domain.domain !== seed.domain) {
      throw new Error(
        `service ${seed.catalogId}: seed domain "${seed.domain}" does not match the classifier tag "${classified.domain.domain}"`,
      );
    }

    const agencySlug = seed.catalogId.split(":")[1] ?? "";
    const agency = agencies.find((a) => a.id === `nyc-${agencySlug}`);
    if (!agency) {
      throw new Error(`service ${seed.catalogId}: agency nyc-${agencySlug} is not in the seed agencies`);
    }

    const articleUrl = `https://portal.311.nyc.gov/article/?kanumber=${seed.ka}`;
    const envelope = buildServiceEnvelope({
      catalogId: seed.catalogId,
      nyc311ArticleId: articleId,
      nyc311ArticleUrl: articleUrl,
      title: entry.title,
      description: entry.description,
      alternateNames: seed.alternateNames.length > 0 ? seed.alternateNames : undefined,
      serviceType: seed.serviceType,
      domain: seed.domain,
      agency,
      channels: seed.channels,
      fees: seed.fees,
      serviceOutputName: seed.serviceOutputName,
    });

    const serviceMeta: ServiceCatalogMeta = {
      catalogId: seed.catalogId,
      nyc311ArticleId: articleId,
      nyc311ArticleUrl: articleUrl,
      domain: seed.domain,
      serviceSubtype: classified.classification.serviceSubtype ?? "unknown",
      classifiedDisposition: "service",
      classifierRulesVersion: CLASSIFIER_RULES_VERSION,
      domainTaxonomyVersion: DOMAIN_TAXONOMY_VERSION,
    };

    services.push({
      envelope,
      meta: serviceMeta,
      steps: [...seed.steps].sort((a, b) => a.sequence - b.sequence),
      formIds: seed.formIds,
    });
  }

  // ---- Link + coverage guard ------------------------------------------------
  const input: LinkInput = {
    catalogVersion: meta.catalogVersion,
    generatedAt: meta.generatedAt,
    sourceInventory: {
      snapshotId: `snap:${inventory.sourceSha256.slice(0, 12)}`,
      capturedAt: inventory.capturedAt,
      sha256: inventory.sourceSha256,
      articleCount: inventory.articleCount,
    },
    agencies,
    services,
    portals,
    forms,
    formFields,
    snapshots,
    crosswalks: [],
  };
  const bundle = linkCatalog(input);

  const covered = new Set(services.map((service) => service.meta.domain));
  const missing = ALL_DOMAINS.filter((domain) => !covered.has(domain));
  if (missing.length > 0) {
    throw new Error(`catalog does not cover the required domains: ${missing.join(", ")}`);
  }

  // ---- Output ----------------------------------------------------------------
  const canonical = stableStringify(bundle);
  const stepCount = bundle.services.reduce((count, service) => count + service.steps.length, 0);
  if (write) {
    writeFileSync(OUTPUT_FILE, canonical);
    writeFileSync("data/catalog/catalog.sha256", `${catalogBundleSha256(bundle)}\n`);
    console.log(
      `wrote ${OUTPUT_FILE}: ${bundle.services.length} services, ${stepCount} steps, ${bundle.forms.length} forms, ${bundle.formFields.length} fields, ${bundle.snapshots.length} snapshots, sha256 ${catalogBundleSha256(bundle).slice(0, 12)}`,
    );
  } else {
    if (!existsSync(OUTPUT_FILE)) {
      throw new Error(`${OUTPUT_FILE} does not exist — run with --write first`);
    }
    const current = readFileSync(OUTPUT_FILE, "utf8");
    if (current !== canonical) {
      throw new Error(
        `${OUTPUT_FILE} is not byte-identical to a fresh build — rerun with --write and review the diff`,
      );
    }
    console.log(
      `catalog verified: byte-identical to a fresh build (${bundle.services.length} services, ${bundle.snapshots.length} snapshots)`,
    );
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
