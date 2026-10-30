# city-hall

NYC Service Estimation Assistant — turns "I want to build X" into an estimate, ordered steps, and required documents for any requirement completed through a New York City government service.

> Early scaffold. The service catalog, resolver, and product surfaces land in upcoming milestones (see the approved build spec).

## Quickstart

```bash
npm ci
npm run dev        # http://localhost:3000
```

Health endpoint: `GET /api/health` returns `status`, `app.version`, and `schema.version` stamps.

```bash
npm run build && npm start
node scripts/smoke-health.mjs http://localhost:3000/api/health
```

## Python extraction toolchain

Extraction is Python 3.11 with a pinned dependency graph; everything downstream is TypeScript.

```bash
python3 -m venv .venv
.venv/bin/pip install -r python/requirements.txt
.venv/bin/python -m pytest python/tests -q
```

## Portal capture harness (D3b)

Playwright-based capture of live portal form pages as hashed SourceSnapshots: rendered HTML, full-page screenshot, and a DOM form-field dump (labels, options, required markers, upload slots) as the primary evidence. Every artifact — including `meta-bound.json`, a canonical serialization of every meta field (provenance and governance: `url`, `resolvedUrl`, `capturedAt`, `method`, `httpStatus`, `captureMode`, `stoppedAt`, `boundarySignals`, `notes`) except the self-hashing artifact list and the derived `id` — is SHA-256-hashed, and the snapshot id (`snap:<sha256-12>`) is derived from all of them. Tampering with captured bytes, with `meta.json` (any field), or with `meta-bound.json` fails verification loudly: editing a field in `meta.json` alone breaks the `meta-bound.json` binding, and editing it in both places breaks the bundle digest.

Capture policy is public-boundary only: login walls, NYC.ID sign-in pages, anti-bot challenges, and rate-limit responses are **stop conditions** — the capture records `capture_mode: authenticated_unreachable`, the stop reason, and the observed signals, and never submits credentials, never retries, and never bypasses a boundary. A rate-limited response is never re-fetched.

```bash
npm run capture -- "https://portal.311.nyc.gov/article/?kanumber=KA-01808" --root fixtures/snapshots
npm run replay -- --root fixtures/snapshots   # offline: hash verify + field-dump parse, zero network
```

Stored snapshots under `fixtures/snapshots/` drive the golden-diff harness offline (`src/lib/capture/replay.ts` re-reads every snapshot with full hash and governance verification before classifying it — ungoverned and boundary-stopped rows included). The replay fails closed: an unreadable or empty snapshot root exits non-zero, as does any tampered snapshot, and CI runs `npm run replay` on every PR. Boundary semantics live in `src/lib/capture/boundary.ts` — a pure classifier; when in doubt, stop.

## CI

`.github/workflows/ci.yml` runs on every PR and pushes to `main`:

- **app** — lint, typecheck, test (vitest), build, and a live smoke test of `/api/health`, with Postgres + pgvector (`pgvector/pgvector:pg16`) as a service container (extension smoke included).
- **python** — Python 3.11 installs `python/requirements.txt` and runs the toolchain smoke tests.

## Layout

```
src/app            App Router routes (web + core API)
src/lib            Framework-free logic and version stamps
python/            Extraction toolchain (requirements.in → pip-compile → requirements.txt)
scripts/           Operational scripts (health smoke)
.github/workflows  CI pipeline
```
