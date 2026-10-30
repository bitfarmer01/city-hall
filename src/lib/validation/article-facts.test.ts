import { describe, expect, it } from "vitest";

import { extractArticlePageFacts, extractKaContentBlock } from "./article-facts";

const SERVICE_PAGE = [
  "<!doctype html><html><head><title>Home Improvement Contractor License · NYC311</title></head><body>",
  '<nav><a href="https://portal.311.nyc.gov/">311 Home</a></nav>', // portal chrome — must NOT count
  '<div class="ka-content" data-ka="KA-01808">',
  "<h2>Home Improvement Contractor License</h2>",
  "<p>Home improvement contractors must be licensed. There is a $200 fee for a two-year license.</p>",
  '<div class="card"><div class="card-header"><div class="col-md-11">How to Apply</div><div class="col-md-1"></div></div>',
  '<div class="card-body"><a href="https://a866-dcwpbp.nyc.gov/account/services">Apply online</a></div></div>',
  '<div class="card"><div class="card-header"><div class="col-md-11">Required Documents</div><div class="col-md-1"></div></div>',
  '<div class="card-body"><a href="https://www.nyc.gov/assets/dcwp/downloads/pdf/forms/hic-application.pdf">Application (PDF)</a></div></div>',
  '<div class="card"><div class="card-header"><div class="col-md-11">Related</div><div class="col-md-1"></div></div>',
  '<div class="card-body"><a href="https://www.nyc.gov/site/dcwp/index.page">DCWP home</a></div></div>', // informational nyc.gov page
  "</div>", // ka-content
  '<footer><a href="https://a866-dcwpbp.nyc.gov/footer-link">Footer</a></footer>', // chrome after the block — must NOT count
  "</body></html>",
].join("\n");

const DEAD_PAGE = [
  "<!doctype html><html><head><title>Article not found · NYC311</title></head><body>",
  '<div class="page-header">NYC311</div><p>The article you requested could not be found.</p>',
  "</body></html>",
].join("\n");

describe("extractKaContentBlock", () => {
  it("returns the balanced ka-content div, excluding page chrome", () => {
    const block = extractKaContentBlock(SERVICE_PAGE);
    expect(block).not.toBeNull();
    expect(block).toContain("Home Improvement Contractor License");
    expect(block).not.toContain("311 Home");
    expect(block).not.toContain("footer-link");
  });

  it("returns null for a page without a ka-content div (the dead-page signature)", () => {
    expect(extractKaContentBlock(DEAD_PAGE)).toBeNull();
  });

  it("terminates on an unclosed ka-content div instead of looping", () => {
    const huge = `${'<div>'.repeat(50_000)}truncated page`;
    const html = `<div class="ka-content"><p>${huge}`;
    expect(extractKaContentBlock(html)).toContain("truncated page");
  });
});

describe("extractArticlePageFacts", () => {
  it("extracts accordion titles, transactional portals, PDF forms, and fee text", () => {
    const facts = extractArticlePageFacts(SERVICE_PAGE);
    expect(facts.kaContentPresent).toBe(true);
    expect(facts.accordionSectionTitles).toEqual([
      "How to Apply",
      "Required Documents",
      "Related",
    ]);
    expect(facts.hasTransactionalPortalLink).toBe(true); // a866-dcwpbp inside ka-content
    expect(facts.hasPdfFormLink).toBe(true); // nyc.gov/assets ... .pdf inside ka-content
    expect(facts.hasFeeText).toBe(true); // "$200 fee" in the body text
  });

  it("does not count portal chrome or informational nyc.gov pages as portals", () => {
    const facts = extractArticlePageFacts(SERVICE_PAGE);
    // The ONLY transactional host in the block is a866-dcwpbp; the DCWP home
    // page and the footer link outside the block must not flip the flag.
    expect(facts.hasTransactionalPortalLink).toBe(true);
    // And a page whose only nyc.gov links are informational ones:
    const infoPage = [
      '<div class="ka-content"><p>Read more.</p>',
      '<a href="https://www.nyc.gov/site/dcwp/index.page">DCWP home</a>',
      '<a href="https://portal.311.nyc.gov/">311</a>',
      '<a href="https://api.nyc.gov/">API</a>',
      "</div>",
    ].join("");
    const infoFacts = extractArticlePageFacts(infoPage);
    expect(infoFacts.hasTransactionalPortalLink).toBe(false);
    expect(infoFacts.hasPdfFormLink).toBe(false);
  });

  it("yields the dead-page shape when ka-content is absent", () => {
    const facts = extractArticlePageFacts(DEAD_PAGE);
    expect(facts.kaContentPresent).toBe(false);
    expect(facts.accordionSectionTitles).toEqual([]);
    expect(facts.hasTransactionalPortalLink).toBe(false);
    expect(facts.hasPdfFormLink).toBe(false);
    expect(facts.hasFeeText).toBe(false);
  });

  it("does not count PDF links outside the nyc.gov family", () => {
    const html = [
      '<div class="ka-content">',
      '<a href="https://example.com/form.pdf">Some PDF</a>',
      '<a href="https://www.nyc.gov/assets/dcwp/downloads/pdf/forms/real.pdf">Real PDF</a>',
      "</div>",
    ].join("");
    expect(extractArticlePageFacts(html).hasPdfFormLink).toBe(true);

    const onlyForeign = '<div class="ka-content"><a href="https://example.com/form.pdf">x</a></div>';
    expect(extractArticlePageFacts(onlyForeign).hasPdfFormLink).toBe(false);
  });

  it("is deterministic", () => {
    expect(extractArticlePageFacts(SERVICE_PAGE)).toEqual(extractArticlePageFacts(SERVICE_PAGE));
  });
});
