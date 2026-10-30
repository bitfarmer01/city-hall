import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Test helper: reads committed capture fixtures — real portal HTML fetched
// 2026-10-30 (public boundary, single polite requests).
export const INDEX_FIXTURE = "all-articles.html";
export const SEARCH_PERMIT_FIXTURE = "search-permit.html";
export const ARTICLE_KA_01808_FIXTURE = "article-ka-01808.html";
export const ARTICLE_DEAD_KA_01044_FIXTURE = "article-dead-ka-01044.html";

export function readFixture(name: string): string {
  const path = fileURLToPath(new URL(`./__fixtures__/nyc311/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}
