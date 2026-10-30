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
