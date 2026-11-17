import { expect, test } from "@playwright/test";
import { makeCapture, captureSummary } from "../../src/__tests__/fixtures/comparisonCaptures";
import { makeRetainedHeadline } from "../../src/__tests__/fixtures/headlineSentiment";
import type { RetainedHeadline } from "../../src/api/headlineSentiment";

for (const width of [1440, 390]) {
  test(`@smoke retained evidence expiry, protected deletion and owner confirmation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const source = makeCapture(true);
    const make = (identity: string, pinned: boolean): RetainedHeadline => ({ ...makeRetainedHeadline(source), id: identity,
      retention: pinned ? "pinned_by_saved_analysis" : "unreferenced_retention_window",
      lifecycle: { state: pinned ? "pinned" : "unreferenced", retention_days: 90,
        expires_at: pinned ? null : "2027-02-13T10:01:02Z", referencing_capture_ids: pinned ? ["saved-child"] : [], references_truncated: false } });
    const rows = [make("protected-record", true), make("raced-record", false), make("free-record", false)];
    let deletions = 0, modelCalls = 0;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/briefing-captures")) { await route.fulfill({ json: [captureSummary(source)] }); return; }
      if (path.endsWith(`/briefing-captures/${source.id}`)) { await route.fulfill({ json: source }); return; }
      if (path.endsWith(`/${source.id}/sentiment`) || path === "/api/news/evidence") { await route.fulfill({ json: rows }); return; }
      if (path.startsWith("/api/news/evidence/")) {
        const identity = path.split("/").pop(), index = rows.findIndex(row => row.id === identity);
        if (route.request().method() === "DELETE") {
          deletions++;
          if (identity === "raced-record") {
            rows[index] = make(identity, true);
            await route.fulfill({ status: 409, json: { detail: "Saved briefings use this evidence. Delete those runs first." } });
          } else { rows.splice(index, 1); await route.fulfill({ status: 204 }); }
        } else await route.fulfill(index >= 0 ? { json: rows[index] } : { status: 404, json: { detail: "News evidence not found" } });
        return;
      }
      if (path.endsWith("/stream")) modelCalls++;
      await route.fulfill({ json: path.endsWith("/market-context/compare")
        ? { anchor: "AAPL", period: "1M", retrieved_at: "2026-11-17T10:00:00Z", comparisons: [] } : { items: [] } });
    });
    await page.goto("/equity/market-context?symbol=AAPL&proxies=SPY&period=1M");
    await page.getByRole("button", { name: "Review saved briefings", exact: true }).click();
    await page.getByRole("button", { name: /Open saved AAPL vs SPY/ }).click();
    const panel = page.getByRole("region", { name: "Headline sentiment", exact: true });
    await panel.getByRole("button", { name: "Review retained headline assessments", exact: true }).click();
    await panel.getByRole("button", { name: /Inspect retained headline protected-record ·/ }).click();
    await expect(panel).toContainText("Protected by 1 saved run(s)");
    await expect(panel.getByRole("button", { name: "Delete retained headline", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: /Inspect retained headline raced-record ·/ }).click();
    await expect(panel).toContainText("Eligible for cleanup after");
    await panel.getByRole("button", { name: "Delete retained headline", exact: true }).click();
    expect(deletions).toBe(0);
    await panel.getByRole("button", { name: "Confirm evidence deletion", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Saved briefings use this evidence");
    await panel.getByRole("button", { name: /Inspect retained headline raced-record ·/ }).click();
    await expect(panel).toContainText("Protected by 1 saved run(s)");
    await panel.getByRole("button", { name: /Inspect retained headline free-record ·/ }).click();
    await panel.getByRole("button", { name: "Delete retained headline", exact: true }).click();
    await panel.getByRole("button", { name: "Confirm evidence deletion", exact: true }).click();
    await expect(panel).toContainText("Retained headline and its assessments deleted");
    await expect(panel.getByRole("button", { name: /Inspect retained headline free-record ·/ })).toHaveCount(0);
    expect(deletions).toBe(2); expect(modelCalls).toBe(0); expect(rows).toHaveLength(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
