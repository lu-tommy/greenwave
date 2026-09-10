import { expect, test, type Page } from "@playwright/test";

/**
 * Fills the destination search box and waits for a result, retrying the
 * fill itself: right after navigation the server-rendered input is already
 * visible and actionable, but React can still be a beat behind attaching
 * its onChange handler — a single fill() can land in that gap and be lost.
 */
async function selectDestination(page: Page, searchTerm: string, resultText: string) {
  const searchInput = page.getByPlaceholder("Search destination…");
  await expect(searchInput).toBeVisible({ timeout: 10_000 });
  await expect(async () => {
    await searchInput.fill(searchTerm);
    await expect(page.getByText(resultText).first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.getByText(resultText).first().click();
}

/**
 * Drives the full destination -> route -> discovery -> active drive ->
 * summary journey against MOCKED network responses (no live OSRM,
 * Nominatim, or Overpass access needed), per the project's requirement
 * that this flow be testable without network access. Geolocation is simulated via
 * Playwright's CDP-backed context.setGeolocation(), which pushes real
 * updates to the page's navigator.geolocation.watchPosition callback.
 */

const ORIGIN = { lat: 39.7392, lng: -104.9903 };
const METERS_PER_DEG_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

function pointAtDistanceM(distanceM: number) {
  return { lat: ORIGIN.lat, lng: ORIGIN.lng + distanceM / METERS_PER_DEG_LNG };
}

const ROUTE_DISTANCE_M = 400;
const ROUTE_POINTS_M = [0, 50, 100, 150, 200, 250, 300, 350, 400];
const SIGNAL_DISTANCES_M = [100, 200, 300];

function buildMockDirectionsResponse() {
  const coordinates = ROUTE_POINTS_M.map((d) => {
    const p = pointAtDistanceM(d);
    return [p.lng, p.lat];
  });
  const destination = pointAtDistanceM(ROUTE_DISTANCE_M);
  return {
    route: {
      geometry: { type: "LineString", coordinates },
      distance: ROUTE_DISTANCE_M,
      duration: 90,
      legs: [
        {
          steps: [
            {
              maneuver: { type: "depart", instruction: "Head east on Mock Ave", location: coordinates[0] },
              distance: ROUTE_DISTANCE_M,
              duration: 90,
              geometry: { type: "LineString", coordinates },
              name: "Mock Ave",
            },
            {
              maneuver: { type: "arrive", instruction: "Arrive at destination", location: [destination.lng, destination.lat] },
              distance: 0,
              duration: 0,
              geometry: { type: "LineString", coordinates: [[destination.lng, destination.lat]] },
            },
          ],
        },
      ],
    },
  };
}

function buildMockSignalsResponse() {
  const signals = SIGNAL_DISTANCES_M.map((d, idx) => {
    const p = pointAtDistanceM(d);
    return { osmId: 1000 + idx, lat: p.lat, lng: p.lng, tags: { highway: "traffic_signals" } };
  });
  return { signals };
}

test.describe("Route Drive: mocked first-drive journey", () => {
  test("destination search -> route preview -> active drive -> summary -> debug export", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ORIGIN.lat, longitude: ORIGIN.lng });

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.route("**/api/routing/search**", (route) =>
      route.fulfill({
        json: {
          candidates: [
            { id: "mock-1", name: "Mock Destination", description: "123 Mock Ave, Testville", location: pointAtDistanceM(ROUTE_DISTANCE_M) },
          ],
        },
      }),
    );
    await page.route("**/api/routing/directions**", (route) => route.fulfill({ json: buildMockDirectionsResponse() }));
    await page.route("**/api/signals/discover**", (route) => route.fulfill({ json: buildMockSignalsResponse() }));

    await page.goto("/drive", { waitUntil: "domcontentloaded" });

    // Destination search.
    await selectDestination(page, "Mock", "Mock Destination");

    // Route preview: signal counts should appear (all "LEARNING" — untagged mock signals have no timing model yet).
    await expect(page.getByText(/traffic signal/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("LEARNING", { exact: true }).first()).toBeVisible();

    const startButton = page.getByRole("button", { name: /start (learning )?drive/i });
    await expect(startButton).toBeEnabled({ timeout: 10_000 });
    await startButton.click();

    // Active drive screen.
    await expect(page.getByText("MPH", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Upcoming Lights")).toBeVisible();

    // Step simulated GPS along the route.
    for (const d of [50, 150, 250, 350]) {
      const p = pointAtDistanceM(d);
      await context.setGeolocation({ latitude: p.lat, longitude: p.lng });
      await page.waitForTimeout(700);
    }

    // Should not have gone off-route while following the route line.
    await expect(page.getByText("OFF ROUTE")).not.toBeVisible();

    // Arrive.
    const dest = pointAtDistanceM(ROUTE_DISTANCE_M);
    await context.setGeolocation({ latitude: dest.lat, longitude: dest.lng });
    await expect(page.getByText("DRIVE COMPLETE")).toBeVisible({ timeout: 15_000 });

    // Debug export.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /export drive debug json/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^greenwave-drive-.*\.json$/);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });

  test("zero signals found still allows a drive (fully unknown route)", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ORIGIN.lat, longitude: ORIGIN.lng });

    await page.route("**/api/routing/search**", (route) =>
      route.fulfill({ json: { candidates: [{ id: "mock-2", name: "Empty Route Dest", description: "Nowhere", location: pointAtDistanceM(ROUTE_DISTANCE_M) }] } }),
    );
    await page.route("**/api/routing/directions**", (route) => route.fulfill({ json: buildMockDirectionsResponse() }));
    await page.route("**/api/signals/discover**", (route) => route.fulfill({ json: { signals: [] } }));

    await page.goto("/drive", { waitUntil: "domcontentloaded" });
    await selectDestination(page, "Empty", "Empty Route Dest");

    await expect(page.getByText("0 traffic signals on route")).toBeVisible({ timeout: 10_000 });
    const startButton = page.getByRole("button", { name: /start (learning )?drive/i });
    await expect(startButton).toBeEnabled({ timeout: 10_000 });
    await startButton.click();
    await expect(page.getByText("MPH", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("routing unavailable (upstream error) shows a clear message, not a crash", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ORIGIN.lat, longitude: ORIGIN.lng });

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.route("**/api/routing/search**", (route) =>
      route.fulfill({ json: { candidates: [{ id: "mock-3", name: "Unreachable Dest", description: "x", location: pointAtDistanceM(ROUTE_DISTANCE_M) }] } }),
    );
    await page.route("**/api/routing/directions**", (route) =>
      route.fulfill({ status: 503, json: { error: "Routing server busy, try again shortly" } }),
    );

    await page.goto("/drive", { waitUntil: "domcontentloaded" });
    await selectDestination(page, "Unreachable", "Unreachable Dest");

    await expect(page.getByText(/routing server busy/i)).toBeVisible({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });
});
