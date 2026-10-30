// Regenerate the committed OpenAPI golden (src/lib/api/openapi.golden.json).
// Run after an intentional contract change and commit the diff — the golden
// diff IS the review artifact for a contract change. The snapshot test
// (src/lib/api/openapi.test.ts) fails when the generator output and the
// committed golden disagree.

import { writeFileSync } from "node:fs";

import { buildOpenApiDocument } from "@/lib/api/openapi";

const GOLDEN_FILE = "src/lib/api/openapi.golden.json";

writeFileSync(GOLDEN_FILE, JSON.stringify(buildOpenApiDocument(), null, 2) + "\n");
console.log(`wrote ${GOLDEN_FILE}`);
