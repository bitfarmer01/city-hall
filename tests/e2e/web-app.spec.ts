// E2E for the D7 web app. Coverage pinned by the task's verification
// criteria: the core goal→results flow, a11y smoke (keyboard + labels),
// and the no-match / empty states. Assertions reference the spec contract
// visible to users — sourced fees, ordered steps, dependency levels,
// document field counts — not implementation details.

import { expect } from "@playwright/test";
import { test } from "@playwright/test";

test.describe("core goal→results flow", () => {
  test("single match renders the full answer: fee with source + as-of, ordered steps, version stamps", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Your goal").fill("home improvement contractor license");
    await page.getByRole("button", { name: "Estimate this" }).click();

    await expect(page).toHaveURL(/\/results\?q=/);
    await expect(page.getByTestId("match-count")).toHaveText("1 service matched your goal");

    const detail = page.getByTestId("service-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("heading", { level: 1 })).toHaveText("Home Improvement Contractor License");

    // Estimate: the captured fee carries its source citation and as-of date
    // on the fee's own line (a tier-1 fee can never render unsourced).
    const estimate = detail.locator("section", { has: page.getByRole("heading", { name: "Estimate" }) });
    await expect(estimate.getByText("$200.00")).toBeVisible();
    await expect(estimate.getByText(/Source:.*KA-01808/)).toBeVisible();
    await expect(estimate.getByText(/As of 2026-10-30/)).toBeVisible();

    // Steps: ordered list items, each with an agency line.
    const steps = detail.getByTestId("step-item");
    const stepCount = await steps.count();
    expect(stepCount).toBeGreaterThanOrEqual(1);
    await expect(steps.first().getByText(/^Agency:/)).toBeVisible();

    // Version stamps: the answer is replayable.
    const stamp = page.getByTestId("version-stamp");
    await expect(stamp).toContainText("catalog");
    await expect(stamp).toContainText("crosswalk");
    await expect(stamp).toContainText("embeddings");
  });

  test("multi-match goal renders result cards with the layer explanation", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Your goal").fill("renovate my apartment");
    await page.getByRole("button", { name: "Estimate this" }).click();

    await expect(page).toHaveURL(/\/results\?q=/);
    const list = page.getByTestId("result-list");
    await expect(list).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText(/Matched via known-goal match/).first()).toBeVisible();
    await expect(page.getByText(/for “renovate my apartment”/)).toBeVisible();
  });

  test("results page without a query prompts for the goal", async ({ page }) => {
    await page.goto("/results");
    await expect(page.getByRole("heading", { name: "Describe your goal" })).toBeVisible();
    await expect(page.getByLabel("Your goal")).toBeVisible();
  });
});

test.describe("no-match and designed states", () => {
  test("unmatchable goal shows the designed no-match state, not an error", async ({ page }) => {
    await page.goto("/results");
    await page.getByLabel("Your goal").fill("zzzyyqq unmatchable yak shave");
    await page.getByRole("button", { name: "Estimate this" }).click();

    const noMatch = page.getByTestId("no-match-state");
    await expect(noMatch).toBeVisible();
    await expect(noMatch).toContainText("No services match");
    await expect(noMatch).toContainText("zzzyyqq unmatchable yak shave");
    await expect(noMatch.getByRole("link", { name: /Clear filters and browse everything/ })).toBeVisible();
  });

  test("deep link to an unknown service ID is a designed 404", async ({ page }) => {
    // With streamed rendering the initial status stays 200; the designed
    // not-found content is the user-visible contract.
    await page.goto("/services/svc%3Anowhere%3Anothing");
    await expect(page.getByTestId("not-found-state")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});

test.describe("browse and search", () => {
  test("browse lists the catalog with truthful counts and domain filters", async ({ page }) => {
    await page.goto("/browse");

    // Eight catalog services; every populated domain shows its count.
    await expect(page.getByTestId("browse-count")).toHaveText("Showing 8 of 8 services");
    const filters = page.getByTestId("domain-filters");
    for (const label of ["Permits", "311 service requests", "Public records", "Licensing", "Inspections"]) {
      await expect(filters.getByRole("link", { name: new RegExp(`${label} \\(\\d+\\)`) })).toBeVisible();
    }
    await expect(page.getByTestId("browse-grid").getByRole("listitem")).toHaveCount(8);
  });

  test("domain filter narrows the grid", async ({ page }) => {
    await page.goto("/browse");
    await page.getByTestId("domain-filters").getByRole("link", { name: /^Licensing/ }).click();

    await expect(page.getByTestId("browse-count")).toHaveText("Showing 2 of 8 services");
    await expect(page.getByTestId("browse-grid").getByRole("listitem")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Dog License" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Home Improvement Contractor License" })).toBeVisible();
  });

  test("catalog search narrows by query tokens", async ({ page }) => {
    await page.goto("/browse");
    await page.getByLabel("Search the catalog").fill("dog");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page).toHaveURL(/\/browse\?q=dog/);
    await expect(page.getByTestId("browse-count")).toHaveText("Showing 1 of 8 services");
  });

  test("search with a domain filter combines both constraints", async ({ page }) => {
    await page.goto("/browse?q=dog&domain=permits");
    const noMatch = page.getByTestId("no-match-state");
    await expect(noMatch).toBeVisible();
    await expect(noMatch).toContainText("No services match");
  });

  test("browse with a garbage query shows the no-match state", async ({ page }) => {
    await page.goto("/browse?q=qqqzzzyak");
    await expect(page.getByTestId("no-match-state")).toBeVisible();
  });
});

test.describe("service pages", () => {
  test("direct catalog ID renders the full detail including extracted documents", async ({ page }) => {
    await page.goto(`/services/${encodeURIComponent("svc:dohmh:dog-license")}`);
    await expect(page.getByTestId("service-detail")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dog License" })).toBeVisible();

    // The captured dog-license form's extracted field counts render.
    const documents = page.locator("section", {
      has: page.getByRole("heading", { name: /Required documents/ }),
    });
    await expect(documents.getByTestId("field-counts").first()).toBeVisible();
  });

  test("a service with no captured fee says so honestly", async ({ page }) => {
    await page.goto(`/services/${encodeURIComponent("svc:dohmh:dog-license")}`);
    const estimate = page.locator("section", { has: page.getByRole("heading", { name: "Estimate" }) });
    await expect(estimate.getByText(/No fee or timeline on file yet/)).toBeVisible();
  });
});

test.describe("a11y smoke (keyboard + labels)", () => {
  test("every form input has a visible associated label", async ({ page }) => {
    for (const path of ["/", "/results", "/browse"]) {
      await page.goto(path);
      const inputs = page.locator("input[type=search]");
      const count = await inputs.count();
      for (let i = 0; i < count; i += 1) {
        const input = inputs.nth(i);
        const id = await input.getAttribute("id");
        expect(id, `${path} input #${i} has id`).toBeTruthy();
        const label = page.locator(`label[for="${id}"]`);
        await expect(label, `${path} input #${i} labeled`).toBeVisible();
      }
    }
  });

  test("keyboard-only user can complete the goal→results flow", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Your goal").click(); // focus via click is the keyboard entry point
    await page.keyboard.type("license my dog");
    await page.keyboard.press("Enter"); // form submit from the input
    await expect(page).toHaveURL(/\/results\?q=/);
    await expect(page.getByTestId("service-detail")).toBeVisible();
  });

  test("focused interactive elements show a visible focus ring", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return null;
      const style = getComputedStyle(el);
      return { tag: el.tagName.toLowerCase(), width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline).not.toBeNull();
    expect(outline?.style).toBe("solid");
    expect(Number.parseFloat(outline?.width ?? "0")).toBeGreaterThanOrEqual(2);
  });

  test("main content has exactly one h1 and a labeled main nav", async ({ page }) => {
    await page.goto("/browse");
    // Streamed shell renders first — retrying assertions, never a raw count().
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main", exact: true })).toBeVisible();
  });
});
