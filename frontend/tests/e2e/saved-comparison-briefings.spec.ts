import { expect, test } from "@playwright/test";
import { makeCapture, captureSummary } from "../../src/__tests__/fixtures/comparisonCaptures";

for (const width of [1440, 390]) {
  test(`@smoke saved comparison generation, offline review and deletion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const context = width === 390;
    let stored: ReturnType<typeof makeCapture> | null = null;
    let generations = 0;
    let ephemeral = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/briefing-captures/stream")) {
        generations++;
        expect(route.request().postDataJSON()).toEqual({ anchor: "AAPL", comparisons: ["SPY"], period: "1M",
          context: context ? { news: true, macro_regions: ["us"] } : null });
        stored = makeCapture(context);
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "start", deadlines: { evidence_seconds: 45, context_seconds: 40, model_seconds: 240 } },
          { type: "progress", phase: "saving_capture" }, { type: "result", result: stored },
        ].map((event) => JSON.stringify(event)).join("\n") + "\n" });
        return;
      }
      if (path.endsWith("/briefing-captures/saved-1")) {
        if (route.request().method() === "DELETE") { stored = null; await route.fulfill({ status: 204 }); }
        else await route.fulfill({ contentType: "application/json", body: JSON.stringify(stored) });
        return;
      }
      if (path.endsWith("/briefing-captures")) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(stored ? [captureSummary(stored)] : []) });
        return;
      }
      if (path.includes("/briefing/stream") || path.includes("/briefing-context/stream")) ephemeral++;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(path.endsWith("/market-context/compare")
        ? { anchor: "AAPL", period: "1M", retrieved_at: "2026-11-14T12:00:00Z", comparisons: [] } : { items: [] }) });
    });
    await page.goto("/equity/market-context?symbol=AAPL&proxies=SPY&period=1M");
    if (context) {
      await page.getByRole("checkbox", { name: "Dated news headlines", exact: true }).check();
      await page.getByRole("checkbox", { name: "US macro (FRED)", exact: true }).check();
    }
    await page.getByRole("button", { name: "Generate and save briefing", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /Saved .*retained until/ })).toBeVisible();
    expect(generations).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: "Review saved briefings", exact: true }).click();
    await page.getByRole("button", { name: /Open saved AAPL vs SPY/ }).click();
    const review = page.getByRole("region", { name: "Saved briefing review", exact: true });
    await expect(review).toContainText("Saved scope: AAPL vs SPY · 1M");
    await review.getByRole("button", { name: "Inspect P1 for observed movement 1", exact: true }).click();
    await expect(review.getByRole("region", { name: "P1 evidence", exact: true })).toBeFocused();
    await review.getByText("Inspect saved model inputs", { exact: true }).click();
    await expect(review.locator("pre")).toContainText("original input <script>source text</script>");
    await expect(review.locator("script")).toHaveCount(0);
    expect(generations).toBe(1); expect(ephemeral).toBe(0);
    await review.getByRole("button", { name: "Delete saved briefing", exact: true }).click();
    await review.getByRole("button", { name: "Keep saved briefing", exact: true }).click();
    expect(stored).not.toBeNull();
    await review.getByRole("button", { name: "Delete saved briefing", exact: true }).click();
    await review.getByRole("button", { name: "Confirm deletion", exact: true }).click();
    await expect(page.getByText("No saved briefings yet.", { exact: true })).toBeVisible();
    await expect(review).toHaveCount(0);
    expect(stored).toBeNull(); expect(generations).toBe(1);
  });
}
