<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# city-hall — engineering guide

NYC Service Estimation Assistant: turns "I want to build X" into cost estimates, ordered steps, and required documents for NYC government services. Build spec: Obvious blueprint `art_RVpFZFo1`.

## Stack

- **TypeScript / Next.js 16 (App Router)** — app, core API, agent adapters, and harnesses. Strict mode; `src/` layout; `@/*` → `src/*` alias.
- **Postgres + pgvector** — catalog storage. CI runs a pgvector service container (`DATABASE_URL` is provided there); schema and migrations land with the catalog milestone.
- **Python 3.11** — PDF extraction pipeline only; emits catalog JSON consumed by TypeScript. Dependencies pinned in `python/requirements.txt`.

## Commands

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| TS tests | `npm test` |
| Build | `npm run build` |
| Health smoke (server running) | `node scripts/smoke-health.mjs http://localhost:3000/api/health` |
| Python deps | `python3 -m venv .venv && .venv/bin/pip install -r python/requirements.txt` |
| Python tests | `.venv/bin/python -m pytest python/tests -q` |

Run lint, typecheck, test, and build locally before every push; CI (`.github/workflows/ci.yml`) is the final gate on every PR.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `test:`, `refactor:`). Branches: `feat/<scope>`, `fix/<scope>`.
- Pure logic lives in `src/lib`, tested without Next imports; route handlers stay thin.
- Every API response carries version stamps (`app.version`, `schema.version`; later `catalog_version`, `crosswalk_version`, `embedding_model_version`) — reproducibility means replaying with pinned versions. See `src/lib/health.ts`.
- Honesty fields are non-negotiable: no invented data, `requiredStatus` stays a 4-value enum, upload limits carry `sizeLimitVerified`.
- Python deps: edit `python/requirements.in`, then regenerate `python/requirements.txt` with pip-compile. Never hand-edit the lockfile.
- Captures of nyc.gov surfaces are public-boundary only; NYC.ID sign-in is never automated.
