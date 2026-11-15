import { expect, test } from "@playwright/test";
import { makeCapture, captureSummary } from "../../src/__tests__/fixtures/comparisonCaptures";
import { makeRetainedHeadline } from "../../src/__tests__/fixtures/headlineSentiment";

for (const width of [1440, 390]) {
  test(`@smoke retained headline selection, cache/failure inspection and deleted-source history at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const source = makeCapture(true);
    let saved = true, scores = 0, otherGenerations = 0;
    const history: ReturnType<typeof makeRetainedHeadline>[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/saved-1/sentiment/stream")) {
        scores++;
        expect(route.request().postDataJSON()).toEqual({ headlines: [{ citation_id: "C1G1H1", target_symbol: "AAPL" }] });
        const row = makeRetainedHeadline(source);
        if (scores === 2) {
          row.id = "snapshot-cached"; row.captured_at = "2026-11-15T11:01:00Z";
          row.assessments[1].payload.reused_from_cache = true; row.assessments[1].recorded_at = "2026-11-15T11:01:01Z";
        } else if (scores === 3) {
          row.id = "snapshot-failed";
          Object.assign(row.assessments[1].payload, { status: "failed", score: null, label: null, rationale: null, failure_code: "timeout" });
        }
        history.unshift(row);
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "start", deadlines: { evidence_seconds: 45, model_seconds: 240 } },
          { type: "progress", phase: "generating" }, { type: "progress", phase: "saving_capture" }, { type: "result", result: [row] },
        ].map((event) => JSON.stringify(event)).join("\n") + "\n" }); return;
      }
      if (path.endsWith("/saved-1/sentiment") || path === "/api/news/evidence") { await route.fulfill({ json: history }); return; }
      if (path.startsWith("/api/news/evidence/")) {
        const record = history.find((row) => row.id === path.split("/").pop());
        await route.fulfill(record ? { json: record } : { status: 404, json: { detail: "News evidence not found" } }); return;
      }
      if (path.endsWith("/briefing-captures/saved-1")) {
        if (route.request().method() === "DELETE") { saved = false; await route.fulfill({ status: 204 }); }
        else await route.fulfill({ json: source });
        return;
      }
      if (path.endsWith("/briefing-captures")) { await route.fulfill({ json: saved ? [captureSummary(source)] : [] }); return; }
      if (path.endsWith("/stream")) otherGenerations++;
      await route.fulfill({ json: path.endsWith("/market-context/compare")
        ? { anchor: "AAPL", period: "1M", retrieved_at: "2026-11-14T12:00:00Z", comparisons: [] } : { items: [] } });
    });
    const visit = async () => {
      await page.goto("/equity/market-context?symbol=AAPL&proxies=SPY&period=1M");
      await page.getByRole("button", { name: "Review saved briefings", exact: true }).click();
    };
    await visit();
    await page.getByRole("button", { name: /Open saved AAPL vs SPY/ }).click();
    const panel = page.getByRole("region", { name: "Headline sentiment", exact: true });
    const assess = async () => {
      await panel.getByRole("checkbox", { name: /AAPL · C1G1H1/ }).check();
      await panel.getByRole("button", { name: "Assess and retain selected headlines", exact: true }).click();
      await expect(panel.getByText("Saved 1 headline observation from 1 selected reference.", { exact: true })).toBeVisible();
    };
    expect(scores).toBe(0);
    await expect(panel.getByRole("button", { name: "Assess and retain selected headlines", exact: true })).toBeDisabled();
    await assess();
    const original = panel.getByRole("region", { name: "Retained headline snapshot-1", exact: true });
    await expect(original).toBeFocused();
    await expect(original).toContainText("Headline only; full article not read");
    await original.getByText("Inspect scoring inputs", { exact: true }).click();
    await expect(original.locator("pre")).toContainText("fast-sentiment");
    await expect(original.locator("pre")).toContainText("<script>source data</script>");
    await expect(original.locator("script")).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "Review saved briefings", exact: true }).click();
    await page.getByRole("button", { name: /Open saved AAPL vs SPY/ }).click();
    await panel.getByRole("button", { name: "Review retained headline assessments", exact: true }).click();
    await panel.getByRole("button", { name: /Inspect retained headline snapshot-1 ·/ }).click();
    await expect(original).toBeFocused(); expect(scores).toBe(1);
    await assess();
    const cached = panel.getByRole("region", { name: "Retained headline snapshot-cached", exact: true });
    await expect(cached).toContainText("reused from cache; scoring time preserved");
    expect(history[0].assessments[1].payload.scored_at).toBe(history[1].assessments[1].payload.scored_at);
    await assess();
    const failed = panel.getByRole("article", { name: "Asset implication assessment asset-1", exact: true });
    await expect(failed).toContainText("Not assessed · timeout");
    await expect(failed).not.toContainText("Neutral");
    const review = page.getByRole("region", { name: "Saved briefing review", exact: true });
    await review.getByRole("button", { name: "Delete saved briefing", exact: true }).click();
    await expect(review.getByRole("group", { name: "Confirm saved briefing deletion" })).toContainText("Independent headline assessments remain in retained history");
    await review.getByRole("button", { name: "Confirm deletion", exact: true }).click();
    await expect(page.getByText("No saved briefings yet.", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Review saved briefings", exact: true }).click();
    await panel.getByRole("button", { name: "Review retained headline assessments", exact: true }).click();
    await panel.getByRole("button", { name: /Inspect retained headline snapshot-cached ·/ }).click();
    await expect(cached).toBeFocused(); await expect(cached).toContainText("Source saved run saved-1");
    expect(scores).toBe(3); expect(otherGenerations).toBe(0); expect(history).toHaveLength(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
