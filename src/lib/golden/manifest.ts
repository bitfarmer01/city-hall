import { readFile } from "node:fs/promises";
import path from "node:path";

import { tagCoverageDomain } from "../inventory/domain";
import type { IndexArticleEntry } from "../inventory/types";
import { parseGoldenExpectation } from "./expectation";
import type { GoldenExpectation } from "./expectation";
import { GOLDEN_DOMAINS, GOLDEN_SET_SCHEMA_VERSION, GOLDEN_SET_SIZE } from "./types";
import type { GoldenDomain, GoldenService, GoldenSet, GoldenTarget } from "./types";

/**
 * Golden-set manifest parse + grounding checks (Check B, art_wJiwwN0o §4b).
 * Strict by construction: a manifest that miscounts services, hides a domain,
 * or cites evidence that cannot exist fails here — never mid-gate, and never
 * by silently governing fewer services than the spec requires.
 */

const EVIDENCE_KINDS = ["article_page", "portal_form", "pdf_checklist"] as const;
const CAPTURE_MODES = ["public_reachable", "authenticated_unreachable"] as const;

const SNAPSHOT_ID_PATTERN = /^snap:[0-9a-f]{12}$/;
const KA_PATTERN = /^KA-\d{5}$/;
const EXPECTATION_PATH_PATTERN = /^data\/golden\/expectations\/[A-Za-z0-9._-]+\.json$/;
const REPO_PATH_PATTERN = /^[A-Za-z0-9/._-]+$/;

/**
 * Repo-relative data paths must not escape the checkout: no absolute paths,
 * no `..` segments. (The character class alone would admit both.)
 */
function assertRepoRelative(p: string, what: string): void {
  if (!REPO_PATH_PATTERN.test(p)) fail(`${what}: suspicious characters in path "${p}"`);
  if (p.startsWith("/")) fail(`${what}: path must be repo-relative, got absolute "${p}"`);
  if (p.split("/").includes("..")) fail(`${what}: path must not traverse upward, got "${p}"`);
}

export class ManifestError extends Error {}

function fail(what: string): never {
  throw new ManifestError(what);
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${what} must be a non-empty string`);
  }
  return value;
}

function parseTarget(raw: unknown, serviceId: string): GoldenTarget {
  if (typeof raw !== "object" || raw === null) fail(`${serviceId}: target must be an object`);
  const t = raw as Record<string, unknown>;
  const id = str(t.id, `${serviceId}.target.id`);
  const kind = str(t.kind, `${serviceId}.${id}.kind`);
  if (!EVIDENCE_KINDS.includes(kind as (typeof EVIDENCE_KINDS)[number])) {
    fail(`${serviceId}.${id}: unknown evidence kind "${kind}"`);
  }
  const url = str(t.url, `${serviceId}.${id}.url`);
  if (!/^https:\/\//.test(url)) fail(`${serviceId}.${id}: url must be https`);
  const captureMode = str(t.captureMode, `${serviceId}.${id}.captureMode`);
  if (!CAPTURE_MODES.includes(captureMode as (typeof CAPTURE_MODES)[number])) {
    fail(`${serviceId}.${id}: unknown captureMode "${captureMode}"`);
  }
  const expectationFile = str(t.expectationFile, `${serviceId}.${id}.expectationFile`);
  if (!EXPECTATION_PATH_PATTERN.test(expectationFile)) {
    fail(`${serviceId}.${id}: expectationFile must live under data/golden/expectations/`);
  }
  const target: GoldenTarget = {
    id,
    kind: kind as GoldenTarget["kind"],
    url,
    captureMode: captureMode as GoldenTarget["captureMode"],
    boundary: str(t.boundary, `${serviceId}.${id}.boundary`),
    expectationFile,
  };
  if (kind === "pdf_checklist") {
    if (captureMode !== "public_reachable") {
      fail(`${serviceId}.${id}: pdf checklists are public http fetches; record the boundary on the portal/article target instead`);
    }
    const pdfPath = str(t.pdfPath, `${serviceId}.${id}.pdfPath`);
    const extractionPath = str(t.extractionPath, `${serviceId}.${id}.extractionPath`);
    for (const p of [pdfPath, extractionPath]) {
      assertRepoRelative(p, `${serviceId}.${id}`);
    }
    target.pdfPath = pdfPath;
    target.extractionPath = extractionPath;
  } else {
    const snapshotId = str(t.snapshotId, `${serviceId}.${id}.snapshotId`);
    if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) {
      fail(`${serviceId}.${id}: snapshotId must look like snap:{sha256-12}`);
    }
    target.snapshotId = snapshotId;
  }
  return target;
}

function parseService(raw: unknown): GoldenService {
  if (typeof raw !== "object" || raw === null) fail("service must be an object");
  const s = raw as Record<string, unknown>;
  const serviceId = str(s.serviceId, "service.serviceId");
  const ka = str(s.nyc311ArticleId, `${serviceId}.nyc311ArticleId`);
  if (!KA_PATTERN.test(ka)) fail(`${serviceId}: nyc311ArticleId must match ${KA_PATTERN}`);
  const domain = str(s.domain, `${serviceId}.domain`);
  if (!GOLDEN_DOMAINS.includes(domain as GoldenDomain)) {
    fail(`${serviceId}: domain "${domain}" is not one of the five coverage domains`);
  }
  const targets = s.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    fail(`${serviceId}: at least one evidence target is required`);
  }
  const parsedTargets = targets.map((t) => parseTarget(t, serviceId));
  const targetIds = new Set(parsedTargets.map((t) => t.id));
  if (targetIds.size !== parsedTargets.length) fail(`${serviceId}: duplicate target ids`);
  return {
    serviceId,
    nyc311ArticleId: ka,
    title: str(s.title, `${serviceId}.title`),
    domain: domain as GoldenDomain,
    agencyHint: str(s.agencyHint, `${serviceId}.agencyHint`),
    inCatalog: s.inCatalog === true,
    targets: parsedTargets,
  };
}

export function parseGoldenSet(raw: unknown): GoldenSet {
  if (typeof raw !== "object" || raw === null) fail("golden set must be an object");
  const g = raw as Record<string, unknown>;
  const schemaVersion = str(g.schemaVersion, "goldenSet.schemaVersion");
  if (schemaVersion !== GOLDEN_SET_SCHEMA_VERSION) {
    fail(`golden set schema ${schemaVersion} != harness schema ${GOLDEN_SET_SCHEMA_VERSION}`);
  }
  str(g.seededAt, "goldenSet.seededAt");
  const inv = g.inventorySnapshot;
  if (typeof inv !== "object" || inv === null) fail("goldenSet.inventorySnapshot must be an object");
  const invRec = inv as Record<string, unknown>;
  const invPath = str(invRec.path, "inventorySnapshot.path");
  const invSha = str(invRec.sha256, "inventorySnapshot.sha256");
  if (!/^[0-9a-f]{64}$/.test(invSha)) fail("inventorySnapshot.sha256 must be 64 hex chars");
  if (typeof invRec.articleCount !== "number" || invRec.articleCount <= 0) {
    fail("inventorySnapshot.articleCount must be positive");
  }
  const rules = g.selectionRules;
  if (!Array.isArray(rules) || rules.length === 0 || rules.some((r) => typeof r !== "string")) {
    fail("goldenSet.selectionRules must be a non-empty array of strings");
  }
  if (!Array.isArray(g.services)) fail("goldenSet.services must be an array");
  const services = g.services.map(parseService);
  if (services.length !== GOLDEN_SET_SIZE) {
    fail(`golden set must hold exactly ${GOLDEN_SET_SIZE} services, got ${services.length}`);
  }
  const ids = new Set(services.map((s) => s.serviceId));
  if (ids.size !== services.length) fail("duplicate serviceId in golden set");
  const kas = new Set(services.map((s) => s.nyc311ArticleId));
  if (kas.size !== services.length) fail("duplicate nyc311ArticleId in golden set");
  return {
    schemaVersion,
    seededAt: g.seededAt as string,
    inventorySnapshot: {
      path: invPath,
      sha256: invSha,
      articleCount: invRec.articleCount as number,
    },
    selectionRules: rules as string[],
    services,
  };
}

/**
 * Domain-spread assertion (DoD): all five coverage domains must be present in
 * the golden set. Throws naming the missing domains — a set that silently
 * loses a domain would quietly ungovern that whole coverage area.
 */
export function assertDomainSpread(services: GoldenService[]): void {
  const present = new Set(services.map((s) => s.domain));
  const missing = GOLDEN_DOMAINS.filter((d) => !present.has(d));
  if (missing.length > 0) {
    fail(`domain-spread assertion failed — golden set is missing: ${missing.join(", ")}`);
  }
}

/** The manifest may only claim articles the pinned inventory snapshot contains, with titles verbatim and domains agreeing with the classifier. */
export function verifyArticleGrounding(
  services: GoldenService[],
  articles: IndexArticleEntry[],
): void {
  const byKa = new Map(articles.map((a) => [a.ka, a]));
  for (const s of services) {
    const entry = byKa.get(s.nyc311ArticleId as `KA-${string}`);
    if (!entry) {
      fail(`${s.serviceId}: ${s.nyc311ArticleId} is not in the pinned inventory snapshot`);
    }
    if (entry.title !== s.title) {
      fail(`${s.serviceId}: title "${s.title}" does not match the snapshot's "${entry.title}"`);
    }
    // Title-pass tagging must agree with the manifest's domain (the manifest
    // may only narrow to a domain the deterministic rules already claim).
    const tagged = tagCoverageDomain({ id: entry.id, ka: entry.ka, title: entry.title, description: "" });
    if (tagged.domain !== s.domain) {
      fail(
        `${s.serviceId}: manifest domain "${s.domain}" disagrees with classifier title-pass domain "${tagged.domain}" (${tagged.patternId})`,
      );
    }
  }
}

export interface LoadedGoldenSet {
  set: GoldenSet;
  /** Parsed expectation per expectationFile path. */
  expectations: Map<string, GoldenExpectation>;
}

/**
 * Loads the manifest from disk and re-derives every grounding fact: the
 * inventory snapshot bytes must hash to the manifest's pin, every cited
 * article must exist verbatim in it, every expectation file must parse, and
 * the domain spread must hold. Any failure is a ManifestError — the seeded
 * set is either fully coherent or loudly broken.
 */
export async function loadGoldenSet(repoRoot: string): Promise<LoadedGoldenSet> {
  const { createHash } = await import("node:crypto");
  const manifestPath = path.join(repoRoot, "data/golden/golden-set.json");
  const rawManifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  const set = parseGoldenSet(rawManifest);

  const inventoryPath = path.join(repoRoot, set.inventorySnapshot.path);
  const inventoryBytes = await readFile(inventoryPath);
  const actualSha = createHash("sha256").update(inventoryBytes).digest("hex");
  if (actualSha !== set.inventorySnapshot.sha256) {
    fail(`inventory snapshot ${set.inventorySnapshot.path} does not match its pinned sha256`);
  }
  const inventory = JSON.parse(inventoryBytes.toString("utf8")) as { articles: IndexArticleEntry[]; articleCount: number };
  if (inventory.articleCount !== set.inventorySnapshot.articleCount) {
    fail("inventorySnapshot.articleCount disagrees with the pinned snapshot");
  }

  verifyArticleGrounding(set.services, inventory.articles);
  assertDomainSpread(set.services);

  const expectations = new Map<string, GoldenExpectation>();
  for (const service of set.services) {
    for (const target of service.targets) {
      if (expectations.has(target.expectationFile)) continue;
      const rawExp = JSON.parse(
        await readFile(path.join(repoRoot, target.expectationFile), "utf8"),
      ) as unknown;
      expectations.set(target.expectationFile, parseGoldenExpectation(rawExp));
    }
  }
  return { set, expectations };
}
