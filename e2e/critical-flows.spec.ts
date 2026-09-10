import { expect, test } from "@playwright/test";

test.describe("Simulator: perfect green wave end-to-end", () => {
  test("play the Perfect Green Wave scenario and see a legal, catching recommendation", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/simulator", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("combobox")).toBeVisible();

    // Default scenario is already "Perfect Green Wave".
    await page.getByRole("button", { name: /play/i }).click();
    await page.waitForTimeout(3000);

    // A recommended speed is shown and never exceeds the posted limit (25).
    const speedText = await page.locator("span.font-mono").first().textContent();
    const speed = Number(speedText);
    expect(Number.isFinite(speed)).toBe(true);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThanOrEqual(25);

    await expect(page.getByText(/GREEN WAVE/i).first()).toBeVisible();
    await expect(page.getByText("GREENS", { exact: true })).toBeVisible();

    // Baseline vs. green-wave comparison produces real numbers.
    await page.getByRole("button", { name: /run comparison/i }).click();
    await expect(page.getByText("Greens caught")).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Corridor Drive Mode: graceful degradation without GPS", () => {
  test.use({ permissions: [] });

  test("shows the location prompt and falls back cleanly when access is denied", async ({ page, context }) => {
    await context.clearPermissions();
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // The manual-corridor drive mode (secondary flow) lives at /drive/corridor —
    // /drive itself is now the primary destination-based flow (see route-drive-journey.spec.ts).
    await page.goto("/drive/corridor", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /enable location/i })).toBeVisible();

    await page.getByRole("button", { name: /enable location/i }).click();
    await expect(page.getByText(/location access was denied|geolocation isn.t supported/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("link", { name: /open simulator/i })).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});

test.describe("Calibration editor", () => {
  test("loads all demo intersections and rejects an inconsistent plan", async ({ page }) => {
    await page.goto("/calibration", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Elm St")).toBeVisible();
    await expect(page.getByText("Willow St")).toBeVisible();

    // Elm St is the first intersection card; its "Green (s)" field is the first on the page.
    // Retry the fill: a fresh navigation can briefly have the (server-rendered,
    // already-editable) input in the DOM before React finishes hydrating and
    // attaching its onChange handler, so the very first fill can race hydration.
    const greenField = page.getByLabel("Green (s)").first();
    await expect(async () => {
      await greenField.fill("999");
      await expect(page.getByText(/must equal cycle length/i).first()).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
  });
});
