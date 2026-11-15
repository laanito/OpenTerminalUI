import { expect, test } from "@playwright/test";
import { makeCapture, makeCaptureFollowup, captureSummary } from "../../src/__tests__/fixtures/comparisonCaptures";

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

for (const width of [1440, 390]) {
  test(`@smoke frozen rerun, fresh refresh and independent lineage at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const source = makeCapture(width === 390);
    const records = new Map([[source.id, source]]);
    const actions: string[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const match = path.match(/briefing-captures\/([^/]+)(?:\/(rerun|refresh)\/stream)?$/);
      if (match) {
        const record = records.get(match[1]);
        if (!record) { await route.fulfill({ status: 404, json: { detail: "Source saved run was deleted" } }); return; }
        if (match[2]) {
          expect(route.request().postDataJSON()).toEqual({});
          const kind = match[2] as "rerun" | "refresh"; actions.push(kind);
          const child = makeCaptureFollowup(record, kind); records.set(child.id, child);
          await route.fulfill({ contentType: "application/x-ndjson", body: [
            { type: "start", deadlines: { evidence_seconds: 45, context_seconds: 40, model_seconds: 240 } },
            { type: "progress", phase: "saving_capture" }, { type: "result", result: child },
          ].map((event) => JSON.stringify(event)).join("\n") + "\n" });
        } else if (route.request().method() === "DELETE") {
          records.delete(record.id); await route.fulfill({ status: 204 });
        } else await route.fulfill({ json: record });
        return;
      }
      if (path.endsWith("/briefing-captures")) { await route.fulfill({ json: [...records.values()].map(captureSummary) }); return; }
      await route.fulfill({ json: path.endsWith("/market-context/compare")
        ? { anchor: "AAPL", period: "1M", retrieved_at: "2026-11-14T12:00:00Z", comparisons: [] } : { items: [] } });
    });
    await page.goto("/equity/market-context?symbol=AAPL&proxies=SPY&period=1M");
    await page.getByRole("button", { name: "Review saved briefings", exact: true }).click();
    await page.getByRole("button", { name: /Open saved AAPL vs SPY/ }).click();
    const review = page.getByRole("region", { name: "Saved briefing review", exact: true });
    expect(actions).toEqual([]);
    await review.getByRole("button", { name: "Re-run saved inputs", exact: true }).click();
    await expect(review.getByLabel("Saved run lineage")).toContainText("Saved-input rerun");
    await review.getByText("Inspect saved model inputs", { exact: true }).click();
    await expect(review.locator("pre")).toContainText("current-deep");
    await expect(review.locator("pre")).toContainText("original input <script>source text</script>");
    await review.getByRole("button", { name: "Open source saved run", exact: true }).click();
    await expect(review.getByLabel("Saved run lineage")).toHaveCount(0);
    await review.getByRole("button", { name: "Refresh with current data", exact: true }).click();
    await expect(review.getByLabel("Saved run lineage")).toContainText("Fresh-data refresh");
    expect(actions).toEqual(["rerun", "refresh"]);
    expect(records.get(source.id)).toEqual(source);
    records.delete(source.id);
    await review.getByRole("button", { name: "Open source saved run", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Source saved run was deleted");
    await expect(review.getByLabel("Saved run lineage")).toContainText("Fresh-data refresh");
    await review.getByRole("button", { name: "Inspect P1 for observed movement 1", exact: true }).click();
    await expect(review.getByRole("region", { name: "P1 evidence", exact: true })).toBeFocused();
    expect(actions).toEqual(["rerun", "refresh"]);
  });
}
