/**
 * One-time seeder for the Check B golden set (spec D10b).
 *
 * Curates 20 services — four per coverage domain, catalog-backed where the
 * catalog has them (8 of 20), agency-spread, public reachability first —
 * captures every page/portal target through the public-boundary driver,
 * derives baseline expectations from that evidence, and writes:
 *
 *   data/golden/golden-set.json            the manifest (with evidence ids)
 *   data/golden/expectations/*.json        one baseline per target
 *
 * PDF-checklist targets reuse the committed D3a fixtures and extraction
 * records — no live fetch. An article target that stops at a boundary is a
 * hard error (an article that cannot be reached cannot be governed); a
 * portal target that stops records the boundary per the capture policy.
 *
 * Defaults to a dry run; pass --write to persist. Re-baselining is a
 * human-reviewed operation (spec).
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";
import { z } from "zod";

import { capturePage } from "../src/lib/capture/driver";
import { writeSnapshot } from "../src/lib/capture/store";
import type { FormFieldDump } from "../src/lib/capture/types";
import { loadCatalogIndex } from "../src/lib/golden/catalog-index";
import { expectedFieldsFromExtraction, htmlToText, type ExtractionRecord } from "../src/lib/golden/evidence";
import { expectationFromCapture } from "../src/lib/golden/live";
import { parseGoldenSet } from "../src/lib/golden/manifest";
import { GOLDEN_DOMAINS } from "../src/lib/golden/types";

const ROOT = path.resolve(import.meta.dirname, "..");
const SNAPSHOTS_ROOT = path.join(ROOT, "fixtures", "snapshots");
const GOLDEN_DIR = path.join(ROOT, "data", "golden");
const EXPECTATIONS_DIR = path.join(GOLDEN_DIR, "expectations");
const INVENTORY_PATH = "data/snapshots/nyc311-index/2026-10-30.json";

// ---------------------------------------------------------------------------
// Curated selection — the one authored input. Everything else derives.
// ---------------------------------------------------------------------------

type TargetKind = "article_page" | "portal_form" | "pdf_checklist";

interface CuratedTarget {
  id: string;
  kind: TargetKind;
  url: string;
  /** PDF target only: repo-relative fixture and extraction record paths. */
  pdfPath?: string;
  extractionPath?: string;
}

interface CuratedService {
  /** Catalog id when backed; null → manifest uses the unit-of-work id nyc311-KA-#####. */
  serviceId: string | null;
  nyc311ArticleId: string; // KA-#####
  domain: (typeof GOLDEN_DOMAINS)[number];
  agencyHint: string;
  targets: CuratedTarget[];
}

const K311 = (ka: string) => `https://portal.311.nyc.gov/article/?kanumber=${ka}`;

// Locked decision 1 (spec): the unit-of-work id is nyc311-KA-##### — a service
// the catalog does not have yet still carries that id as its manifest key.
const manifestServiceId = (s: CuratedService): string => s.serviceId ?? `nyc311-${s.nyc311ArticleId}`;

const SELECTION: CuratedService[] = [
  // permits (4)
  { serviceId: "svc:buildings:building-construction-alteration-permit", nyc311ArticleId: "KA-02104", domain: "permits", agencyHint: "DOB",
    targets: [
      { id: "article", kind: "article_page", url: K311("KA-02104") },
      { id: "portal-dob-now", kind: "portal_form", url: "https://www.nyc.gov/site/buildings/dob/use-dob-now.page" },
      { id: "pdf-pw1", kind: "pdf_checklist", url: "https://www.nyc.gov/assets/buildings/pdf/pw1.pdf",
        pdfPath: "python/tests/fixtures/pdfs/pw1.pdf", extractionPath: "data/catalog/forms/pw1.catalog.json" } ] },
  { serviceId: "svc:dep:water-tap-permit", nyc311ArticleId: "KA-02076", domain: "permits", agencyHint: "DEP",
    targets: [
      { id: "article", kind: "article_page", url: K311("KA-02076") },
      { id: "portal-paris", kind: "portal_form", url: "https://www.nyc.gov/site/dep/about/permit-and-review-information-system.page" } ] },
  { serviceId: "svc:dohmh:food-service-establishment-permit", nyc311ArticleId: "KA-01878", domain: "permits", agencyHint: "DOHMH",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01878") } ] },
  { serviceId: null, nyc311ArticleId: "KA-01786", domain: "permits", agencyHint: "DOT",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01786") } ] },

  // licensing (4)
  { serviceId: "svc:dcwp:home-improvement-contractor-license", nyc311ArticleId: "KA-01808", domain: "licensing", agencyHint: "DCWP",
    targets: [
      { id: "article", kind: "article_page", url: K311("KA-01808") },
      { id: "portal-dcwp-apply", kind: "portal_form", url: "https://www.nyc.gov/site/dca/businesses/licenses-apply.page" } ] },
  { serviceId: "svc:dohmh:dog-license", nyc311ArticleId: "KA-01890", domain: "licensing", agencyHint: "DOHMH",
    targets: [
      { id: "article", kind: "article_page", url: K311("KA-01890") },
      { id: "pdf-dog-license", kind: "pdf_checklist", url: "https://www.nyc.gov/assets/doh/downloads/pdf/vs/dog-license.pdf",
        pdfPath: "python/tests/fixtures/pdfs/dog-license.pdf", extractionPath: "data/catalog/forms/dog-license.catalog.json" } ] },
  { serviceId: null, nyc311ArticleId: "KA-01739", domain: "licensing", agencyHint: "DOB",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01739") } ] },
  { serviceId: null, nyc311ArticleId: "KA-01833", domain: "licensing", agencyHint: "DCWP",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01833") } ] },

  // inspections (4)
  { serviceId: "svc:buildings:elevator-escalator-inspection", nyc311ArticleId: "KA-02012", domain: "inspections", agencyHint: "DOB",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-02012") } ] },
  { serviceId: null, nyc311ArticleId: "KA-01782", domain: "inspections", agencyHint: "DOB",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01782") } ] },
  { serviceId: null, nyc311ArticleId: "KA-02591", domain: "inspections", agencyHint: "DOB",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-02591") } ] },
  { serviceId: null, nyc311ArticleId: "KA-02955", domain: "inspections", agencyHint: "DOHMH",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-02955") } ] },

  // public-records (4)
  { serviceId: "svc:dohmh:birth-certificate-order", nyc311ArticleId: "KA-01012", domain: "public-records", agencyHint: "DOHMH",
    targets: [
      { id: "article", kind: "article_page", url: K311("KA-01012") },
      { id: "pdf-birth1", kind: "pdf_checklist", url: "https://www.nyc.gov/assets/doh/downloads/pdf/vs/birth1.pdf",
        pdfPath: "python/tests/fixtures/pdfs/birth1.pdf", extractionPath: "data/catalog/forms/birth1.catalog.json" },
      { id: "pdf-premium-birth", kind: "pdf_checklist", url: "https://www.nyc.gov/assets/doh/downloads/pdf/vs/premium-birth.pdf",
        pdfPath: "python/tests/fixtures/pdfs/premium-birth.pdf", extractionPath: "data/catalog/forms/premium-birth.catalog.json" } ] },
  { serviceId: null, nyc311ArticleId: "KA-01028", domain: "public-records", agencyHint: "DOHMH",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01028") } ] },
  { serviceId: null, nyc311ArticleId: "KA-01021", domain: "public-records", agencyHint: "Citywide",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01021") } ] },
  { serviceId: null, nyc311ArticleId: "KA-01665", domain: "public-records", agencyHint: "DOF",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01665") } ] },

  // service-requests (4)
  { serviceId: "svc:311:noise-from-neighbor", nyc311ArticleId: "KA-01017", domain: "service-requests", agencyHint: "NYC311",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01017") } ] },
  { serviceId: null, nyc311ArticleId: "KA-01107", domain: "service-requests", agencyHint: "DSNY",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01107") } ] },
  { serviceId: null, nyc311ArticleId: "KA-01036", domain: "service-requests", agencyHint: "HPD",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01036") } ] },
  { serviceId: null, nyc311ArticleId: "KA-01095", domain: "service-requests", agencyHint: "DOT",
    targets: [ { id: "article", kind: "article_page", url: K311("KA-01095") } ] },
];

// ---------------------------------------------------------------------------
// Inventory grounding: titles and the hash pin come from the committed snapshot.
// ---------------------------------------------------------------------------

const InventoryArticle = z.object({ ka: z.string(), title: z.string(), description: z.string() });
type InventoryArticle = z.infer<typeof InventoryArticle>;

// The committed snapshot's shape (D2a output): a versioned envelope holding
// the (KA, title, description) triples and the header count.
const InventoryEnvelope = z.object({
  schemaVersion: z.string(),
  articleCount: z.number().int().positive(),
  articles: z.array(InventoryArticle),
});

async function loadInventory(): Promise<{ sha256: string; articles: InventoryArticle[] }> {
  const abs = path.join(ROOT, INVENTORY_PATH);
  const bytes = await readFile(abs);
  const envelope = InventoryEnvelope.parse(JSON.parse(bytes.toString("utf8")));
  if (envelope.articleCount !== envelope.articles.length) {
    throw new Error(`snapshot articleCount ${envelope.articleCount} != ${envelope.articles.length} parsed triples`);
  }
  return { sha256: createHash("sha256").update(bytes).digest("hex"), articles: envelope.articles };
}

function serviceSlug(serviceId: string): string {
  return serviceId.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function expectationFile(serviceId: string | null, ka: string, targetId: string): string {
  const name = serviceId ? serviceSlug(serviceId) : `catalog-pending-${ka.toLowerCase()}`;
  return `data/golden/expectations/${name}--${targetId}.json`;
}

async function main() {
  const write = process.argv.includes("--write");
  const inventory = await loadInventory();
  const byKa = new Map(inventory.articles.map((a) => [a.ka, a]));

  // Every curated KA must exist in the pinned snapshot — a typo in the
  // selection must fail the seed, not silently ungovern a service.
  for (const s of SELECTION) {
    if (!byKa.has(s.nyc311ArticleId)) {
      throw new Error(`selection KA ${s.nyc311ArticleId} is absent from inventory snapshot ${INVENTORY_PATH}`);
    }
  }
  const domainCounts = new Map<string, number>();
  for (const s of SELECTION) domainCounts.set(s.domain, (domainCounts.get(s.domain) ?? 0) + 1);
  for (const d of GOLDEN_DOMAINS) {
    if ((domainCounts.get(d) ?? 0) !== 4) throw new Error(`domain ${d} has ${domainCounts.get(d) ?? 0} services, expected 4`);
  }
  const catalogIds = SELECTION.filter((s) => s.serviceId).map((s) => s.serviceId!);
  if (new Set(catalogIds).size !== catalogIds.length) throw new Error("duplicate catalog service ids in selection");

  // Catalog cross-reference: catalog-backed ids must exist in the committed
  // bundle with the same domain.
  const catalog = await loadCatalogIndex(path.join(ROOT, "data/catalog/catalog.json"));
  for (const s of SELECTION) {
    if (!s.serviceId) continue;
    const domain = catalog.domains.get(s.serviceId);
    if (domain === undefined) throw new Error(`selection service ${s.serviceId} is absent from catalog ${catalog.version}`);
    if (domain !== s.domain) {
      throw new Error(`selection service ${s.serviceId}: domain ${s.domain} disagrees with catalog ${domain}`);
    }
  }

  await mkdir(EXPECTATIONS_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const written: string[] = [];

  try {
    const services: unknown[] = [];
    for (const s of SELECTION) {
      const article = byKa.get(s.nyc311ArticleId)!;
      const manifestTargets: unknown[] = [];

      for (const t of s.targets) {
        const file = expectationFile(manifestServiceId(s), s.nyc311ArticleId, t.id);
        const baselineServiceId = manifestServiceId(s);
        if (t.kind === "pdf_checklist") {
          // Committed fixture + extraction record; baseline derives offline.
          const record = JSON.parse(await readFile(path.join(ROOT, t.extractionPath!), "utf8")) as ExtractionRecord;
          const expectation = {
            serviceId: baselineServiceId,
            label: `${article.title} — ${t.id}`,
            sourceUrl: record.form.sourceUrl,
            expectedFields: expectedFieldsFromExtraction(record),
            expectedDocuments: [],
            inPersonSteps: [],
          };
          await writeFile(path.join(ROOT, file), `${JSON.stringify(expectation, null, 2)}\n`);
          written.push(file);
          manifestTargets.push({
            id: t.id, kind: t.kind, url: record.form.sourceUrl,
            pdfPath: t.pdfPath, extractionPath: t.extractionPath,
            captureMode: "public_reachable", boundary: "none", expectationFile: file,
          });
          continue;
        }

        const capture = await capturePage(page, t.url);
        await writeSnapshot(SNAPSHOTS_ROOT, capture);
        const { snapshot } = capture;
        console.log(`captured ${s.nyc311ArticleId}/${t.id}: ${snapshot.captureMode} (stoppedAt=${snapshot.stoppedAt}, sha=${snapshot.id.slice(5, 17)})`);

        if (t.kind === "article_page" && snapshot.captureMode !== "public_reachable") {
          throw new Error(
            `article target ${s.nyc311ArticleId}/${t.id} stopped at ${snapshot.stoppedAt} — an unreachable article cannot be governed; investigate before seeding`,
          );
        }

        let expectation;
        if (snapshot.captureMode === "public_reachable") {
          const dump = JSON.parse(capture.contents.get("fields.json")!.toString("utf8")) as FormFieldDump;
          const pageText = htmlToText(capture.contents.get("page.html")!.toString("utf8"));
          expectation = expectationFromCapture(baselineServiceId, `${article.title} — ${t.id}`, t.url, dump, pageText);
        } else {
          // Boundary-stopped portal: the baseline is the public boundary —
          // no form fields were observed, so none are claimed.
          expectation = {
            serviceId: baselineServiceId,
            label: `${article.title} — ${t.id}`,
            sourceUrl: t.url,
            expectedFields: [],
            expectedDocuments: [],
            inPersonSteps: [],
          };
        }
        await writeFile(path.join(ROOT, file), `${JSON.stringify(expectation, null, 2)}\n`);
        written.push(file);
        manifestTargets.push({
          id: t.id, kind: t.kind, url: t.url,
          snapshotId: snapshot.id,
          captureMode: snapshot.captureMode, boundary: snapshot.stoppedAt,
          expectationFile: file,
        });
        await new Promise((r) => setTimeout(r, 1000)); // polite pacing
      }

      services.push({
        serviceId: manifestServiceId(s),
        title: article.title,
        nyc311ArticleId: s.nyc311ArticleId,
        domain: s.domain,
        agencyHint: s.agencyHint,
        inCatalog: s.serviceId !== null,
        targets: manifestTargets,
      });
    }

    const manifest = {
      schemaVersion: "1.0.0",
      seededAt: new Date().toISOString(),
      inventorySnapshot: { path: INVENTORY_PATH, sha256: inventory.sha256, articleCount: inventory.articles.length },
      selectionRules: [
        "20 services, four per coverage domain (permits, licensing, inspections, public-records, service-requests)",
        `catalog-backed services from catalog ${catalog.version} first (8 of 20); remaining services catalog-pending`,
        "agency spread: DOB, DOT, DOHMH, DCWP, DEP, HPD, DSNY, DOF, citywide FOIL",
        "public reachability first; auth-walled filing portals stop at their public boundary and fall back to the committed PDF checklist",
        "PDF checklist targets reuse committed D3a fixtures (PW1, birth1, premium-birth, dog license) with hash-verified extraction records",
      ],
      services,
    };

    const manifestPath = path.join(GOLDEN_DIR, "golden-set.json");
    if (!write) {
      console.log(`\nDRY RUN — captures and ${written.length} baselines computed; re-run with --write to persist.`);
    } else {
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`\nwrote ${manifestPath} and ${written.length} expectation files`);
      // The written manifest must parse through the strict loader the gate
      // uses — a manifest only the seeder understands is worthless.
      const reparsed = parseGoldenSet(JSON.parse(await readFile(manifestPath, "utf8")));
      console.log(`strict re-parse: ${reparsed.services.length} services, ${reparsed.services.reduce((n, s) => n + s.targets.length, 0)} targets`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
