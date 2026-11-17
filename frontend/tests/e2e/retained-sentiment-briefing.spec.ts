import { expect, test } from "@playwright/test";
import fixture from "../../src/__tests__/fixtures/retainedSentimentBriefing.json" with { type: "json" };

for (const width of [1440, 390]) {
  test(`@smoke Deep retained sentiment selection, citation inspection and offline saved child at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let sourcePresent = true, childPresent = false, interpretations = 0, otherGenerations = 0, snapshotReads = 0;
    const { content: _parentContent, ...parentSummary } = fixture.source;
    const { content: _childContent, ...childSummary } = fixture.child;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith(`/${fixture.source.id}/sentiment-briefing/stream`)) {
        interpretations++;
        expect(route.request().postDataJSON()).toEqual({ snapshot_ids: [fixture.headlines[0].id] });
        childPresent = true;
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "start", deadlines: { evidence_seconds: 45, context_seconds: 40, model_seconds: 240 } },
          { type: "progress", phase: "generating" }, { type: "progress", phase: "saving_capture" }, { type: "result", result: fixture.child },
        ].map(event => JSON.stringify(event)).join("\n") + "\n" }); return;
      }
      if (path.endsWith(`/briefing-captures/${fixture.source.id}`)) {
        if (route.request().method() === "DELETE") { sourcePresent = false; await route.fulfill({ status: 204 }); }
        else await route.fulfill(sourcePresent ? { json: fixture.source } : { status: 404, json: { detail: "Not found" } });
        return;
      }
      if (path.endsWith(`/briefing-captures/${fixture.child.id}`)) { await route.fulfill({ json: fixture.child }); return; }
      if (path.endsWith("/briefing-captures")) { await route.fulfill({ json: [...(childPresent ? [childSummary] : []), ...(sourcePresent ? [parentSummary] : [])] }); return; }
      if (path.endsWith(`/${fixture.source.id}/sentiment`) || path === "/api/news/evidence") { await route.fulfill({ json: fixture.headlines }); return; }
      if (path.endsWith(`/${fixture.child.id}/sentiment`)) { await route.fulfill({ json: [] }); return; }
      if (path.startsWith("/api/news/evidence/")) snapshotReads++;
      if (path.endsWith("/stream")) otherGenerations++;
      await route.fulfill({ json: path.endsWith("/market-context/compare")
        ? { anchor: "AAPL", period: "1M", retrieved_at: "2026-11-17T10:00:00Z", comparisons: [] } : { items: [] } });
    });
    await page.goto("/equity/market-context?symbol=AAPL&proxies=SPY&period=1M");
    await page.getByRole("button", { name: "Review saved briefings", exact: true }).click();
    await page.getByRole("button", { name: /Open saved AAPL vs SPY/ }).click();
    const sentiment = page.getByRole("region", { name: "Headline sentiment", exact: true });
    await sentiment.getByRole("button", { name: "Review retained headline assessments", exact: true }).click();
    await sentiment.getByRole("checkbox", { name: /Use .* in Deep interpretation/ }).check();
    expect(interpretations).toBe(0);
    await sentiment.getByRole("button", { name: "Interpret selected sentiment and save (1/5)", exact: true }).click();
    const review = page.getByRole("region", { name: "Saved briefing review", exact: true });
    await expect(review).toContainText("Retained-sentiment interpretation");
    await expect(review).toContainText("Deep profile");
    await review.getByRole("button", { name: "Inspect R2 for possible context 2", exact: true }).click();
    const evidence = review.getByRole("region", { name: "R2 evidence", exact: true });
    await expect(evidence).toBeFocused(); await expect(evidence).toContainText("fixture-fast");
    await expect(evidence).toContainText("Originally scored");
    await review.getByText("Inspect retained sentiment inputs", { exact: true }).click();
    const retained = review.getByRole("region", { name: `Retained headline ${fixture.headlines[0].id}`, exact: true });
    await retained.getByText("Inspect scoring inputs", { exact: true }).click();
    await expect(retained.locator("pre")).toContainText("<script>untrusted retained input</script>");
    await expect(retained.locator("script")).toHaveCount(0);
    expect(interpretations).toBe(1); expect(snapshotReads).toBe(0);
    await review.getByRole("button", { name: "Open source saved run", exact: true }).click();
    await review.getByRole("button", { name: "Delete saved briefing", exact: true }).click();
    await review.getByRole("button", { name: "Confirm deletion", exact: true }).click();
    await expect(review).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "Review saved briefings", exact: true }).click();
    await page.getByRole("button", { name: /Open saved AAPL vs SPY/ }).click();
    await expect(review).toContainText("Retained-sentiment interpretation");
    await review.getByText("Inspect retained sentiment inputs", { exact: true }).click();
    await expect(retained).toContainText("fixture-fast");
    expect(interpretations).toBe(1); expect(otherGenerations).toBe(0); expect(snapshotReads).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
