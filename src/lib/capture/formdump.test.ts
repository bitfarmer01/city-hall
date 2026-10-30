import { describe, expect, it } from "vitest";

import { MAX_FIELD_OPTIONS, parseFieldDump } from "./formdump";
import { CAPTURE_SCHEMA_VERSION, PUBLIC_BOUNDARY_NOTE } from "./types";

const FIELD = {
  tag: "input",
  type: "text",
  name: "applicant_name",
  id: "f1",
  label: "Applicant full name *",
  required: true,
  requiredMarker: true,
  options: [],
  optionsTotal: 0,
  accept: null,
  multiple: false,
};

const DUMP = {
  url: "https://example.nyc.gov/form",
  capturedAt: "2026-10-30T12:00:00.000Z",
  fields: [FIELD],
  submitButtons: ["Submit application"],
};

describe("parseFieldDump", () => {
  it("round-trips a valid dump unchanged", () => {
    expect(parseFieldDump(JSON.parse(JSON.stringify(DUMP)) as unknown)).toEqual(DUMP);
  });

  it("preserves the honesty fields verbatim", () => {
    const parsed = parseFieldDump(DUMP);
    expect(parsed.fields[0].required).toBe(true);
    expect(parsed.fields[0].requiredMarker).toBe(true);
    expect(parsed.fields[0].accept).toBeNull();
    expect(Object.keys(parsed.fields[0])).not.toContain("value");
  });

  it("throws on structural garbage instead of defaulting", () => {
    expect(() => parseFieldDump("not a dump")).toThrow(/must be an object/);
    expect(() => parseFieldDump({ url: "x", capturedAt: "x", submitButtons: [] })).toThrow(/fields array/);
    expect(() => parseFieldDump({ url: "x", capturedAt: "x", fields: [] })).toThrow(/submitButtons/);
    expect(() => parseFieldDump({ ...DUMP, fields: [{ ...FIELD, tag: "canvas" }] })).toThrow(/input\|textarea\|select/);
    expect(() => parseFieldDump({ ...DUMP, fields: [{ ...FIELD, type: 42 }] })).toThrow(/field.type/);
    expect(() => parseFieldDump({ ...DUMP, fields: "nope" })).toThrow(/fields array/);
  });

  it("caps stored options while keeping the honest total", () => {
    const many = parseFieldDump({
      ...DUMP,
      fields: [
        {
          ...FIELD,
          tag: "select",
          type: "select-one",
          options: Array.from({ length: MAX_FIELD_OPTIONS + 25 }, (_, i) => `opt ${i}`),
          optionsTotal: MAX_FIELD_OPTIONS + 25,
        },
      ],
    });
    expect(many.fields[0].options).toHaveLength(MAX_FIELD_OPTIONS);
    expect(many.fields[0].optionsTotal).toBe(MAX_FIELD_OPTIONS + 25);
  });

  it("keeps the schema version and attestation constants stamped", () => {
    // These ship in meta.json next to every capture; they exist so replay can
    // pin the record schema it trusts.
    expect(CAPTURE_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PUBLIC_BOUNDARY_NOTE).toMatch(/no credentials used/);
  });
});
