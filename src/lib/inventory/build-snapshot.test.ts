import { describe, expect, it } from "vitest";

import { buildInventorySnapshot, parseSnapshotJson } from "./build-snapshot";
import { ALL_ARTICLES_URL } from "./fetch-nyc311";
import { parseIndexPage } from "./parse-index";
import { INDEX_FIXTURE, readFixture } from "./read-fixture";

const INDEX_FIXTURE_SHA256 =
  "63aff11a928c09993690f8410a6c27507b3856666802e05199b51345c52b003a";

describe("buildInventorySnapshot", () => {
  const html = readFixture(INDEX_FIXTURE);
  const snapshot = buildInventorySnapshot({
    entries: parseIndexPage(html),
    html,
    sourceUrl: ALL_ARTICLES_URL,
    capturedAt: "2026-10-30T17:11:43.820Z",
    searchProbe: { query: "permit", totalResults: 345 },
  });

  it("stamps schema version, capture time, source hash, and count", () => {
    expect(snapshot.schemaVersion).toBe("0.1.0");
    expect(snapshot.capturedAt).toBe("2026-10-30T17:11:43.820Z");
    expect(snapshot.sourceSha256).toBe(INDEX_FIXTURE_SHA256);
    expect(snapshot.articleCount).toBe(2093);
    expect(snapshot.articles).toHaveLength(snapshot.articleCount);
  });

  it("carries (KA, title, description) triples sorted by KA", () => {
    expect(snapshot.articles[0].ka).toBe("KA-01011");
    expect(snapshot.articles[snapshot.articles.length - 1].ka).toBe("KA-03752");
    for (let i = 1; i < snapshot.articles.length; i += 1) {
      expect(snapshot.articles[i - 1].ka < snapshot.articles[i].ka).toBe(true);
    }
  });

  it("records the search-probe verification channel", () => {
    expect(snapshot.verification.searchProbe).toEqual({
      query: "permit",
      totalResults: 345,
    });
  });
});

describe("parseSnapshotJson", () => {
  const html = readFixture(INDEX_FIXTURE);
  const snapshot = buildInventorySnapshot({
    entries: parseIndexPage(html),
    html,
    sourceUrl: ALL_ARTICLES_URL,
    capturedAt: "2026-10-30T17:11:43.820Z",
    searchProbe: { query: "permit", totalResults: 345 },
  });

  it("round-trips a snapshot through JSON", () => {
    expect(parseSnapshotJson(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("rejects non-snapshot payloads with an honest error", () => {
    expect(() => parseSnapshotJson("[]")).toThrow(/not an inventory snapshot/);
    expect(() => parseSnapshotJson('{"schemaVersion":"0.1.0"}')).toThrow(
      /not an inventory snapshot/,
    );
  });
});
