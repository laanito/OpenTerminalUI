import { expect, test } from "@playwright/test";
import { makeTechnicalBriefing, technicalSelection } from "../../src/__tests__/fixtures/technicalBriefing";

for (const width of [1440, 390]) {
  test(`@smoke technical briefing selection and exact evidence at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    let requests = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/market-context/briefing-context/stream")) {
        requests++;
        expect(route.request().postDataJSON()).toEqual({ ...technicalSelection, context: { news: false, macro_regions: [], technical: true } });
        const result = makeTechnicalBriefing(requests === 1 ? "complete" : requests === 2 ? "partial" : "unavailable");
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "start", model_profile: result.model_profile, deadlines: { evidence_seconds: 45, context_seconds: 40, model_seconds: 240 } },
          { type: "progress", phase: "generating" }, { type: "result", result },
        ].map((item) => JSON.stringify(item) + "\n").join("") });
        return;
      }
      const data = path.endsWith("/market-context/compare")
        ? { anchor: "AAPL", period: "1M", retrieved_at: "2026-11-01T12:00:00Z", comparisons: [] }
        : { items: [] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto("/equity/market-context?symbol=AAPL&proxies=BTC-USD&period=1M");
    const technical = page.getByRole("checkbox", { name: "Technical observations", exact: true });
    await expect(technical).not.toBeChecked(); expect(requests).toBe(0);
    await technical.check(); expect(requests).toBe(0);
    await page.getByRole("button", { name: "Generate briefing", exact: true }).click();
    await expect(page.getByText(/model fixture-deep-model/)).toContainText("Deep profile");
    await page.getByRole("button", { name: "Inspect C1A1T1 for possible context 1", exact: true }).click();
    const metric = page.getByRole("region", { name: "C1A1T1 evidence", exact: true });
    await expect(metric).toBeFocused();
    await expect(metric).toContainText("20-close moving-average gap");
    await expect(metric).toContainText("20 own dated closes");
    await page.getByRole("button", { name: "Inspect C1A1T1 for possible context 2", exact: true }).click();
    await expect(metric).toBeFocused();
    const asset = page.getByRole("region", { name: "C1A1 evidence", exact: true });
    await expect(asset).toContainText("Stale source history");
    await expect(asset).toContainText("bar completion have not been independently verified");
    await asset.getByText("Supporting adjusted closes (21)", { exact: true }).click();
    await expect(asset.getByRole("table", { name: "AAPL supporting adjusted closes" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("technical-evidence.png"), fullPage: true });
    await technical.uncheck();
    await expect(page.getByRole("region", { name: "Possible context", exact: true })).toHaveCount(0);
    expect(requests).toBe(1);
    await technical.check(); await page.getByRole("button", { name: "Generate briefing", exact: true }).click();
    await page.getByRole("button", { name: /^Inspect C1A1T2 for evidence limitations/ }).click();
    const missing = page.getByRole("region", { name: "C1A1T2 evidence", exact: true });
    await expect(missing).toBeFocused(); await expect(missing).toContainText("Requires 21 closes; 20 available");
    await expect(missing).toContainText("No zero value is implied");
    await page.getByRole("button", { name: "Generate new briefing", exact: true }).click();
    await expect(page.getByRole("region", { name: "Selected context coverage", exact: true })).toContainText("No eligible technical observations");
    await expect(page.getByRole("region", { name: "Observed movement", exact: true })).toBeVisible();
    expect(requests).toBe(3);
  });
}
