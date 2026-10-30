import { describe, expect, it } from "vitest";

import { sanitizeForLog } from "./sanitize";

describe("sanitizeForLog (log-injection hardening)", () => {
  it("escapes C0 control characters as visible \\uXXXX escapes", () => {
    // ANSI escape (terminal takeover / forged line prefixes).
    expect(sanitizeForLog("snap_evil\u001b[31m")).toBe("snap_evil\\u001b[31m");
    // Newline + carriage return (the classic forged-log-line vector).
    expect(sanitizeForLog("row one\nrow two\r\nthree")).toBe(
      "row one\\u000arow two\\u000d\\u000athree",
    );
    expect(sanitizeForLog("null\u0000byte")).toBe("null\\u0000byte");
  });

  it("escapes DEL and C1 bytes, leaves printable text and non-ASCII alone", () => {
    expect(sanitizeForLog("café\u007fx\u009fy")).toBe("café\\u007fx\\u009fy");
    // Legitimate non-ASCII content must survive untouched.
    expect(sanitizeForLog("snap_0123456789ab — Applicant 名前")).toBe(
      "snap_0123456789ab — Applicant 名前",
    );
  });

  it("is idempotent — already-escaped text passes through unchanged", () => {
    const once = sanitizeForLog("a\u001bb\u0000c");
    expect(sanitizeForLog(once)).toBe(once);
    expect(sanitizeForLog("plain clean text")).toBe("plain clean text");
  });
});
