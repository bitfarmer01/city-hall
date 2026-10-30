import { articleUrlFor } from "./ka";
import type { KaNumber } from "./types";

// The only network edge in the inventory pipeline. Capture policy (locked
// decision #10): public boundaries only; the portal's robots.txt disallows
// only /knowledgebase/article/ — none of the paths below.

export const NYC311_PORTAL_BASE = "https://portal.311.nyc.gov";
export const ALL_ARTICLES_URL = `${NYC311_PORTAL_BASE}/all-articles/`;
export const INVENTORY_USER_AGENT =
  "city-hall-inventory/0.1 (+https://github.com/bitfarmer01/city-hall)";

export async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": INVENTORY_USER_AGENT } });
  if (!response.ok) {
    throw new Error(`GET ${url} returned HTTP ${response.status}`);
  }
  return response.text();
}

export const fetchIndexPage = (): Promise<string> => fetchPage(ALL_ARTICLES_URL);

export const fetchArticlePage = (ka: KaNumber): Promise<string> =>
  fetchPage(articleUrlFor(ka));

export const fetchSearchPage = (query: string): Promise<string> =>
  fetchPage(`${NYC311_PORTAL_BASE}/search/?q=${encodeURIComponent(query)}`);

/** Courtesy delay between sequential portal fetches. */
export const courtesyDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
