import { expect, test } from "@playwright/test";
import { makeFilingBriefing, filingSelection } from "../../src/__tests__/fixtures/filingBriefing";

for (const width of [1440, 390]) {
  test(`@smoke filing briefing selection, exact citations and failures at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    let requests = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/market-context/briefing-context/stream")) {
        requests++;
        expect(route.request().postDataJSON()).toEqual({ ...filingSelection, context: { news: false, macro_regions: [], fundamentals: true } });
        const result = makeFilingBriefing(requests === 1 ? "complete" : requests === 2 ? "conflict" : requests === 3 ? "configuration_required" : requests === 4 ? "model_failure" : "complete");
        if (requests === 5 && result.evidence?.sections[0].kind === "fundamentals") {
          result.evidence.sections[0].assets[0].group_citations.F1 = "C1A2F1";
        }
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "start", deadlines: { evidence_seconds: 45, context_seconds: 40, model_seconds: 240 } },
          { type: "progress", phase: "generating" }, { type: "result", result },
        ].map((item) => JSON.stringify(item) + "\n").join("") });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(path.endsWith("/market-context/compare")
        ? { anchor: "AAPL", period: "1M", retrieved_at: "2026-10-22T12:00:00Z", comparisons: [] } : { items: [] }) });
    });
    await page.goto("/equity/market-context?symbol=AAPL&proxies=SPY&period=1M");
    const choice = page.getByRole("checkbox", { name: "SEC filing facts", exact: true });
    await expect(choice).not.toBeChecked(); expect(requests).toBe(0);
    await choice.check(); expect(requests).toBe(0);
    await page.getByRole("button", { name: "Generate briefing", exact: true }).click();
    await expect(page.getByText(/model fixture-deep-model/)).toContainText("Deep profile");
    await page.getByRole("button", { name: "Inspect C1A1F1 for possible context 1", exact: true }).click();
    const group = page.getByRole("region", { name: "C1A1F1 evidence", exact: true });
    await expect(group).toBeFocused();
    await expect(group).toContainText("100 USD"); await expect(group).toContainText("us-gaap:Revenues");
    await expect(group).toContainText("Fiscal period: 2026-06-01 to 2026-08-31");
    await expect(group).toContainText("filed 2026-09-15");
    await expect(group.getByRole("link", { name: "Open SEC filing index" }).first()).toHaveAttribute("href",
      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000002/0000320193-26-000002-index.html");
    await page.getByRole("button", { name: "Inspect C1A1F1 for possible context 2", exact: true }).click();
    await expect(group).toBeFocused();
    await expect(page.getByRole("region", { name: "C1A1 evidence", exact: true })).toContainText("Terminal retrieval:");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("filing-evidence.png"), fullPage: true });
    await choice.uncheck();
    await expect(page.getByRole("region", { name: "Possible context", exact: true })).toHaveCount(0);
    expect(requests).toBe(1);
    await choice.check(); await page.getByRole("button", { name: "Generate briefing", exact: true }).click();
    await page.getByRole("button", { name: /^Inspect C1A1F1 for evidence limitations/ }).click();
    await expect(group).toBeFocused(); await expect(group).toContainText("Value withheld");
    await expect(group).not.toContainText("100 USD"); await expect(group).not.toContainText("120 USD");
    await page.getByRole("button", { name: "Generate new briefing", exact: true }).click();
    await page.getByRole("button", { name: "Inspect C1 coverage", exact: true }).click();
    await expect(page.getByRole("region", { name: "C1A1 evidence", exact: true })).toContainText("SEC_USER_AGENT is not configured");
    await expect(page.getByRole("region", { name: "Observed movement", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Generate new briefing", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Could not produce a checked briefing");
    await page.getByRole("button", { name: "Inspect C1 coverage", exact: true }).click();
    await expect(group).toContainText("100 USD");
    await page.getByRole("button", { name: "Retry briefing", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("incomplete");
    await expect(page.getByRole("region", { name: "Possible context", exact: true })).toHaveCount(0);
    expect(requests).toBe(5);
  });
}
