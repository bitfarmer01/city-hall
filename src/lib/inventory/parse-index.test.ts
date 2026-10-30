import { describe, expect, it } from "vitest";

import { sha256Hex } from "./hash";
import { articleServiceId, articleUrlFor } from "./ka";
import { IndexParseError, parseIndexPage } from "./parse-index";
import { INDEX_FIXTURE, readFixture } from "./read-fixture";
import type { IndexArticleEntry, KaNumber } from "./types";

// Fixture pinned by hash — a silent fixture edit would change what every
// parser test below actually tests.
const INDEX_FIXTURE_SHA256 =
  "63aff11a928c09993690f8410a6c27507b3856666802e05199b51345c52b003a";

// The 10 articles verified article-by-article during inventory research
// (art_TMXzOIRU §3), with their index titles as captured 2026-10-30.
const RESEARCH_VERIFIED_TITLES: ReadonlyArray<readonly [KaNumber, string]> = [
  ["KA-01012", "Birth Certificate Order"],
  ["KA-01074", "Apartment Maintenance Complaint"],
  ["KA-01236", "Bed Bug Complaint"],
  ["KA-01786", "Sidewalk Construction Permit"],
  ["KA-01808", "Home Improvement Contractor License"],
  ["KA-01890", "Dog License"],
  ["KA-01969", "Bulk Item Disposal"],
  ["KA-02104", "Building Construction or Alteration Permit"],
  ["KA-02555", "Alcohol License"],
  ["KA-03685", "Bin Reimbursement"],
];

describe("parseIndexPage", () => {
  it("pins the fixture bytes by sha256", () => {
    expect(sha256Hex(readFixture(INDEX_FIXTURE))).toBe(INDEX_FIXTURE_SHA256);
  });

  it("parses all 2,093 articles from the pinned index fixture", () => {
    expect(parseIndexPage(readFixture(INDEX_FIXTURE))).toHaveLength(2093);
  });

  it("sorts entries by KA and stamps the locked service-ID scheme", () => {
    const entries = parseIndexPage(readFixture(INDEX_FIXTURE));
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i - 1].ka < entries[i].ka).toBe(true);
    }
    expect(entries[0]).toEqual({
      id: "nyc311-KA-01011",
      ka: "KA-01011",
      title: "Alternate Side Parking and Street Cleaning",
      description:
        "Learn about Alternate Side Parking (ASP) suspensions, rules, and change requests.",
    });
    expect(articleServiceId(entries[0].ka)).toBe(entries[0].id);
    expect(articleUrlFor(entries[0].ka)).toBe(
      "https://portal.311.nyc.gov/article/?kanumber=KA-01011",
    );
  });

  it("parses every research-verified article with its captured title", () => {
    const byKa = new Map<KaNumber, IndexArticleEntry>(
      parseIndexPage(readFixture(INDEX_FIXTURE)).map((e) => [e.ka, e] as const),
    );
    for (const [ka, title] of RESEARCH_VERIFIED_TITLES) {
      const entry = byKa.get(ka);
      expect(entry, ka).toBeDefined();
      expect(entry?.title).toBe(title);
      expect(entry?.description.length).toBeGreaterThan(0);
    }
  });

  it("decodes HTML entities and collapses whitespace in titles", () => {
    const entries = parseIndexPage(readFixture(INDEX_FIXTURE));
    expect(entries.some((e) => e.title === "Learn & Earn Program")).toBe(true);
    expect(entries.some((e) => e.title.includes("&amp;"))).toBe(false);
    expect(entries.some((e) => /\s{2,}/.test(e.title))).toBe(false);
  });

  it("keeps non-Latin-script titles intact", () => {
    const entries = parseIndexPage(readFixture(INDEX_FIXTURE));
    const nonAscii = entries.filter((e) => /[^\u0000-\u007f]/.test(e.title));
    expect(nonAscii).toHaveLength(11);
    expect(nonAscii.map((e) => e.title)).toContain(
      "Обратитесь за помощью в NYC311 на русском языке",
    );
  });

  it("throws listing violations when the all-az-kas list is missing", () => {
    expect(() => parseIndexPage("<html><body>redesigned page</body></html>")).toThrow(
      IndexParseError,
    );
  });

  it("throws when an entry loses its description span", () => {
    const html = readFixture(INDEX_FIXTURE).replace("<span>Report bed bugs.</span>", "");
    expect(() => parseIndexPage(html)).toThrow(IndexParseError);
  });

  it("throws when an entry title is empty", () => {
    // Strip the title text inside the KA-01236 anchor (the title sits on its
    // own line in the fixture, so the mutation is scoped to that anchor).
    const html = readFixture(INDEX_FIXTURE).replace(
      /(kanumber=KA-01236">)[^<]*(<\/a>)/,
      "$1$2",
    );
    expect(() => parseIndexPage(html)).toThrow(/empty title/);
  });

  it("throws on duplicate KA entries", () => {
    const html = readFixture(INDEX_FIXTURE).replace(
      /<li>\s*<a href="[^"]*kanumber=KA-01236">[\s\S]*?<\/li>/,
      (match) => match + match,
    );
    expect(() => parseIndexPage(html)).toThrow(/duplicate article KA-01236/);
  });
});
