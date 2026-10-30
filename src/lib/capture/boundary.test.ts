import { describe, expect, it } from "vitest";

import { classifyBoundary, type BoundaryInput } from "./boundary";

function input(overrides: Partial<BoundaryInput> = {}): BoundaryInput {
  return {
    httpStatus: 200,
    finalUrl: "https://portal.example.nyc.gov/form",
    html: "<html><body><form><input type=text name=q></form></body></html>",
    headers: {},
    ...overrides,
  };
}

const PUBLIC_FORM = `
<html><head><title>Apply for a permit — NYC</title></head><body>
<form action="/apply" method="post">
  <input id="a" type="text" name="applicant" required>
  <input id="b" type="email" name="email">
  <select id="c" name="borough"><option>Manhattan</option></select>
  <textarea id="d" name="description"></textarea>
  <input id="e" type="file" name="doc" accept=".pdf">
  <input type="submit" value="Submit">
</form></body></html>`;

const LOGIN_WALL = `
<html><head><title>Member sign in — City Portal</title></head><body>
<form action="/signin" method="post">
  <input id="u" type="email" name="email" required>
  <input id="p" type="password" name="password" required>
  <input type="submit" value="Sign in">
</form></body></html>`;

const MIXED_PAGE = `${PUBLIC_FORM}
<footer><form action="/signin"><input type="email" name="em"><input type="password" name="pw"><button>Sign in</button></form></footer>`;

describe("classifyBoundary", () => {
  it("passes a public form through with kind none", () => {
    expect(classifyBoundary(input({ html: PUBLIC_FORM }))).toEqual({
      kind: "none",
      signals: [],
    });
  });

  it("stops at a bare login wall", () => {
    const verdict = classifyBoundary(input({ html: LOGIN_WALL }));
    expect(verdict.kind).toBe("login_wall");
    expect(verdict.signals).toContain("password_field_present_without_public_form");
  });

  it("captures a public page that also carries a sign-in widget, and records the coexistence", () => {
    const verdict = classifyBoundary(input({ html: MIXED_PAGE }));
    expect(verdict.kind).toBe("none");
    expect(verdict.signals).toContain("login_form_present_on_public_page");
  });

  it("stops on the NYC.ID host alone", () => {
    const verdict = classifyBoundary(
      input({ finalUrl: "https://nycid.nyc.gov/account/login", html: "<html><body>Sign in</body></html>" }),
    );
    expect(verdict.kind).toBe("nyc_id");
    expect(verdict.signals[0]).toMatch(/^nyc_id_host:/);
  });

  it("stops on NYC.ID marker plus a password field even on an unknown host", () => {
    const nycIdWall = LOGIN_WALL.replace("Member sign in — City Portal", "Sign in with NYC.ID");
    expect(classifyBoundary(input({ html: nycIdWall })).kind).toBe("nyc_id");
  });

  it("stops on the cf-mitigated challenge header", () => {
    const verdict = classifyBoundary(
      input({ html: PUBLIC_FORM, headers: { "cf-mitigated": "challenge" } }),
    );
    expect(verdict.kind).toBe("anti_bot");
    expect(verdict.signals).toEqual(["cf_mitigated_challenge_header"]);
  });

  it.each([
    ["cloudflare challenge script", "<script>window._cf_chl_opt={}</script>"],
    ["cloudflare challenge id", '<div id="challenge-running">Checking…</div>'],
    ["perimeterx marker", '<div class="px-captcha">Press &amp; Hold</div>'],
    ["datadome marker", '<div id="datadome-iframe"></div>'],
  ])("stops on anti-bot HTML: %s", (_name, html) => {
    const verdict = classifyBoundary(input({ html }));
    expect(verdict.kind).toBe("anti_bot");
  });

  it("stops on a challenge page title", () => {
    const verdict = classifyBoundary(
      input({ html: "<html><head><title>Just a moment...</title></head><body></body></html>" }),
    );
    expect(verdict.kind).toBe("anti_bot");
    expect(verdict.signals).toContain("challenge_title");
  });

  it("does not treat an embedded captcha widget on a real form as a stop", () => {
    const withWidget = PUBLIC_FORM.replace("</form>", '<div class="g-recaptcha" data-sitekey="x"></div></form>');
    expect(classifyBoundary(input({ html: withWidget })).kind).toBe("none");
  });

  it("stops on HTTP 429 without touching the HTML", () => {
    const verdict = classifyBoundary(input({ httpStatus: 429, html: PUBLIC_FORM }));
    expect(verdict.kind).toBe("rate_limited");
    expect(verdict.signals).toEqual(["http_429"]);
  });

  it("classifies 503s: retry-after is a rate limit, a plain 503 is an error stop", () => {
    expect(classifyBoundary(input({ httpStatus: 503, headers: { "retry-after": "30" } })).kind).toBe("rate_limited");
    // A plain 503 page is not the real form — capturing it would poison the
    // snapshot with a non-page, so it stops as an error.
    const plain = classifyBoundary(input({ httpStatus: 503 }));
    expect(plain.kind).toBe("error");
    expect(plain.signals).toEqual(["http_503"]);
  });

  it("records plain HTTP errors as stop conditions", () => {
    const verdict = classifyBoundary(input({ httpStatus: 404, html: "<html><body>Not found</body></html>" }));
    expect(verdict.kind).toBe("error");
    expect(verdict.signals).toEqual(["http_404"]);
  });

  it("treats an unparseable final URL as hostless, not fatal", () => {
    const verdict = classifyBoundary(input({ finalUrl: "not a url", html: PUBLIC_FORM }));
    expect(verdict.kind).toBe("none");
  });
});
