import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`@smoke saved filing provenance and lexical fallback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let mode = "deep";
    const profile = { requested_profile: "deep", resolved_profile: "deep", model: "deep-model" };
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const data = path.endsWith("/stock-picking/conviction/AAPL") ? {
        symbol: "AAPL", market: "US", source_count: 1, conviction_score: 60, summary: "Saved filing extraction.", catalysts: [],
        engine: mode === "deep" ? "llm" : mode === "legacy" ? "lmstudio" : "lexical",
        model_profile: mode === "legacy" ? null : profile,
        failure: mode === "lexical" ? { code: "timeout", message: "Model extraction timed out; lexical extraction is shown.", retryable: true } : null,
      } : { items: [] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto("/equity/security/AAPL");
    await expect(page.getByText("Model extraction · Deep profile · deep-model", { exact: true })).toBeVisible();
    mode = "legacy"; await page.reload();
    await expect(page.getByText("Legacy report · model provenance unknown", { exact: true })).toBeVisible();
    mode = "lexical"; await page.reload();
    await expect(page.getByText("The selected model did not generate this report.", { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Model extraction timed out" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
