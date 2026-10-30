import { describe, expect, it } from "vitest";

import { collapseWhitespace, decodeHtmlEntities } from "./html-text";

describe("decodeHtmlEntities", () => {
  it("decodes the named entities the index uses", () => {
    expect(decodeHtmlEntities("Learn &amp; Earn Program")).toBe("Learn & Earn Program");
    expect(decodeHtmlEntities("housing &amp; neighborhood data")).toBe(
      "housing & neighborhood data",
    );
    expect(decodeHtmlEntities("&lt;tag&gt; &quot;quoted&quot;")).toBe('<tag> "quoted"');
  });

  it("decodes numeric entities", () => {
    expect(decodeHtmlEntities("&#39;")).toBe("'");
    expect(decodeHtmlEntities("&#x27;")).toBe("'");
    expect(decodeHtmlEntities("&#8217;")).toBe("\u2019");
  });

  it("leaves unknown entities verbatim instead of corrupting text", () => {
    expect(decodeHtmlEntities("&weird;")).toBe("&weird;");
  });

  it("does not double-decode", () => {
    expect(decodeHtmlEntities("&amp;#39;")).toBe("&#39;");
  });
});

describe("collapseWhitespace", () => {
  it("collapses whitespace runs including CR/LF soup", () => {
    expect(collapseWhitespace("  a \r\n  b\r ")).toBe("a b");
  });

  it("trims to empty for whitespace-only input", () => {
    expect(collapseWhitespace(" \r\r ")).toBe("");
  });
});
