import { describe, expect, it } from "vitest";

import { diffLiveMinusCatalog, fieldKey, hasBlockingFailures, normalizeKey, parseExpectation } from "./golden";
import type { FormFieldDump } from "./types";

function dump(fields: FormFieldDump["fields"]): FormFieldDump {
  return { url: "https://example.nyc.gov/form", capturedAt: "2026-10-30T00:00:00.000Z", fields, submitButtons: ["Submit"] };
}

const LIVE = dump([
  { tag: "input", type: "text", name: "name", id: "name", label: "Applicant full name *", required: true, requiredMarker: true, options: [], optionsTotal: 0, accept: null, multiple: false },
  { tag: "select", type: "select-one", name: "borough", id: "borough", label: "Borough", required: true, requiredMarker: false, options: ["Manhattan"], optionsTotal: 1, accept: null, multiple: false },
  { tag: "input", type: "file", name: "doc", id: "doc", label: "Supporting document", required: false, requiredMarker: false, options: [], optionsTotal: 0, accept: ".pdf", multiple: true },
]);

const EXPECTED = {
  serviceId: "svc:test:form",
  label: "Test form",
  sourceUrl: "https://example.nyc.gov/form",
  expectedFields: [
    { label: "Applicant full name *", type: "text", required: true },
    { label: "Borough", type: "select", required: true },
  ],
  expectedDocuments: ["Supporting document"],
};

describe("diffLiveMinusCatalog", () => {
  it("passes when every required live field and document slot is cataloged", () => {
    const diff = diffLiveMinusCatalog(LIVE, EXPECTED);
    expect(diff.failures).toEqual([]);
    expect(hasBlockingFailures(diff)).toBe(false);
  });

  it("fails when the live form has a required field the catalog lacks (injected defect)", () => {
    const doctored = {
      ...EXPECTED,
      expectedFields: EXPECTED.expectedFields.filter((f) => f.label !== "Borough"),
    };
    const diff = diffLiveMinusCatalog(LIVE, doctored);
    expect(hasBlockingFailures(diff)).toBe(true);
    expect(diff.failures[0].reason).toBe("live_only_required");
    expect(diff.failures[0].key).toBe(fieldKey({ label: "Borough", type: "select-one" }));
  });

  it("escapes control characters from labels inside finding details (log-injection hardening)", () => {
    // A hostile page can plant ANSI escapes / newlines in a form label; the
    // dump records them faithfully and the finding detail quotes the label —
    // the detail must not become a forged log line.
    const evil = dump([
      { tag: "input", type: "text", name: "evil", id: "evil", label: "Name\u001b[31m\nINJECTED", required: true, requiredMarker: false, options: [], optionsTotal: 0, accept: null, multiple: false },
    ]);
    const diff = diffLiveMinusCatalog(evil, { ...EXPECTED, expectedFields: [] });

    expect(diff.failures).toHaveLength(1);
    expect(diff.failures[0].detail).toContain("\\u001b");
    expect(diff.failures[0].detail).toContain("\\u000a");
    expect(diff.failures[0].detail).not.toMatch(/[\u0000-\u001f]/);
    // Matching keys are display-untouched: normalization still collapses
    // whitespace for the key, only the printed detail is escaped.
    expect(diff.failures[0].key).toBe(fieldKey({ label: "Name\u001b[31m\nINJECTED", type: "text" }));
  });

  it("warns (not fails) on optional live-only fields", () => {
    const withOptional = dump([
      ...LIVE.fields,
      { tag: "input", type: "text", name: "apt", id: "apt", label: "Apartment number", required: false, requiredMarker: false, options: [], optionsTotal: 0, accept: null, multiple: false },
    ]);
    const diff = diffLiveMinusCatalog(withOptional, EXPECTED);
    expect(diff.failures).toEqual([]);
    expect(diff.warnings.map((w) => w.reason)).toContain("live_only_optional");
  });

  it("warns on catalog entries absent from the live dump (form drift)", () => {
    const doctored = {
      ...EXPECTED,
      expectedFields: [
        ...EXPECTED.expectedFields,
        { label: "Gone from live form", type: "text", required: true },
      ],
    };
    const diff = diffLiveMinusCatalog(LIVE, doctored);
    expect(diff.failures).toEqual([]);
    expect(diff.warnings.map((w) => w.reason)).toContain("catalog_only");
  });

  it("does not warn for a document whose upload slot exists on the live form", () => {
    const diff = diffLiveMinusCatalog(LIVE, EXPECTED);
    expect(diff.warnings.filter((w) => w.kind === "document")).toEqual([]);
  });

  it("warns when a cataloged document has no live upload slot", () => {
    const diff = diffLiveMinusCatalog(LIVE, {
      ...EXPECTED,
      expectedDocuments: ["Supporting document", "Proof of insurance"],
    });
    expect(diff.warnings.some((w) => w.kind === "document" && w.key === "proof of insurance")).toBe(true);
  });
});

describe("parseExpectation", () => {
  it("parses a well-formed expectation", () => {
    const parsed = parseExpectation(EXPECTED);
    expect(parsed.serviceId).toBe("svc:test:form");
    expect(parsed.expectedFields).toHaveLength(2);
  });

  it("throws on missing arrays instead of silently ungoverning a snapshot", () => {
    expect(() => parseExpectation({ serviceId: "x", label: "x", sourceUrl: "x" })).toThrow(/expectedFields/);
    expect(() => parseExpectation({ serviceId: "x", label: "x", sourceUrl: "x", expectedFields: [] })).toThrow(
      /expectedDocuments/,
    );
  });
});

describe("normalizeKey", () => {
  it("collapses case, whitespace, and required markers", () => {
    expect(normalizeKey("  Applicant FULL   Name *")).toBe("applicant full name");
    expect(normalizeKey("Borough:")).toBe("borough");
    expect(normalizeKey("*Required")).toBe("Required".toLowerCase());
  });

  it("keys survive the select/select-one type alias", () => {
    expect(fieldKey({ label: "Borough", type: "select-one" })).toBe(
      fieldKey({ label: "Borough", type: "select" }),
    );
  });
});
