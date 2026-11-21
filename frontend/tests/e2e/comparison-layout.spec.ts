import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCapture, captureSummary } from "../../src/__tests__/fixtures/comparisonCaptures";
import { makeBriefing } from "../../src/__tests__/fixtures/comparisonBriefing";

async function comparisonFixture(page: Page) {
  const requests = { compares: 0, generations: 0, writes: 0 };
  await page.clock.setFixedTime(new Date("2026-11-21T12:00:00Z"));
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith("/market-context/compare")) {
      requests.compares++;
      const requested = route.request().postDataJSON() as { comparisons: string[] };
      return route.fulfill({ json: { anchor: "AAPL", period: "1M", retrieved_at: "2026-11-21T12:00:00Z", comparisons: [
        { symbol: "SPY", status: "available", reason: null, freshness: "stale", start_date: "2026-10-20", end_date: "2026-11-19", observations: 23,
          anchor_latest_date: "2026-11-19", comparison_latest_date: "2026-11-19", anchor_return_pct: 1, comparison_return_pct: 2, relative_return_pp: -1,
          anchor_history_source: "yahoo", comparison_history_source: "yahoo", anchor_history_feed: "yahoo_chart", comparison_history_feed: "yahoo_chart",
          anchor_quote_unit: { unit: "USD", source: "yahoo_chart_meta" }, comparison_quote_unit: { unit: "USD", source: "yahoo_chart_meta" },
          anchor_reported_adjustment_basis: "unspecified", comparison_reported_adjustment_basis: "unspecified", pair_reported_basis_status: "unverified",
          points: Array.from({ length: 23 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 20 + i)).toISOString().slice(0, 10), anchor_index: 100 + i / 22, comparison_index: 100 + i / 11 })) },
        { symbol: "QQQ", status: "unavailable", reason: "provider_error", anchor_latest_date: null, comparison_latest_date: null,
          anchor_history_source: null, comparison_history_source: null, anchor_reported_adjustment_basis: null, comparison_reported_adjustment_basis: null, points: [] },
      ].filter(row => requested.comparisons.includes(row.symbol)) } });
    }
    if (path.endsWith("/market-context/briefing/stream")) {
      requests.generations++;
      return route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "start", phase: "queued", deadlines: { evidence_seconds: 45, model_seconds: 240 } }) + "\n" + JSON.stringify({ type: "result", result: (() => {
        const result = makeBriefing();
        const pair = result.evidence!.comparisons[0];
        result.evidence!.status = "partial";
        result.evidence!.comparisons.push({ ...pair, citation_id: "P2", status: "unavailable", reason: "provider_error", returns: null,
          comparison: { ...pair.comparison, symbol: "QQQ" }, pair_reported_basis_status: "unavailable",
          caveats: ["native_quote_not_fx_normalized", "utc_dates_not_simultaneous_sessions", "no_causal_or_investment_conclusion", "comparison_unavailable"] });
        result.unknowns.push({ text: "QQQ return was unavailable in this packet; no zero return is implied.", citation_ids: ["P2"] });
        return result;
      })() }) + "\n" });
    }
    if (path.endsWith("/briefing-captures")) return route.fulfill({ json: Array.from({ length: 20 }, (_, i) => ({ ...captureSummary(), id: `saved-${i + 1}` })) });
    if (path.endsWith("/briefing-captures/saved-1")) return route.fulfill({ json: makeCapture() });
    if (path.endsWith("/instruments/search")) return route.fulfill({ json: { results: [{ display_symbol: "MSFT", name: "Microsoft long-term research and technology infrastructure", exchange: "NASDAQ", type: "equity" }] } });
    if (route.request().method() !== "GET") requests.writes++;
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return requests;
}

for (const width of [1440, 1024, 390]) {
  test(`@smoke Comparison research prioritizes observations and keeps saved evidence readable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const requests = await comparisonFixture(page);
    await page.goto("/equity/market-context?symbol=AAPL&proxies=SPY,QQQ&period=1M");
    const main = page.getByRole("main", { name: "Cross-market research" });
    const observed = main.getByRole("region", { name: "Observed comparison", exact: true });
    const pair = observed.getByRole("article", { name: "AAPL vs SPY comparison", exact: true });
    const chart = pair.getByRole("img", { name: /Indexed daily-close paths/ });
    await expect(chart).toBeVisible(); await expect(pair).toContainText("Stale history");
    await expect(pair.getByText(/return difference is not confirmed like-for-like/)).toBeVisible();
    await expect(observed.getByRole("article", { name: "AAPL vs QQQ comparison" })).toContainText("History provider failed");
    const briefing = main.getByRole("complementary", { name: "Briefing and saved research" });
    if (width === 1440) {
      expect((await briefing.boundingBox())!.y).toBeGreaterThan((await observed.boundingBox())!.y + (await observed.boundingBox())!.height);
      expect(Math.abs((await briefing.boundingBox())!.width - (await observed.boundingBox())!.width)).toBeLessThan(2);
      expect((await chart.boundingBox())!.y).toBeLessThan(850);
    }
    expect(await main.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await pair.getByText("Price sources, quote units and alignment", { exact: true }).click();
    await expect(pair.getByText(/Price-history paths:/)).toBeVisible();
    await pair.getByText("Price sources, quote units and alignment", { exact: true }).click();
    await main.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("comparison-overview.png"), fullPage: true });
    await main.getByText("Find and add comparison symbols", { exact: true }).click();
    await main.getByRole("combobox", { name: "Find a proxy to add", exact: true }).fill("MSFT");
    await main.getByRole("option", { name: /MSFT/ }).click();
    await expect(main.getByRole("textbox", { name: "Comparison symbols", exact: true })).toHaveValue("SPY, QQQ, MSFT");
    expect(requests.compares).toBe(1); expect(requests.generations).toBe(0);
    await main.getByRole("textbox", { name: "Comparison symbols", exact: true }).fill("SPY,QQQ");
    await main.getByRole("link", { name: "Briefing and saved runs", exact: true }).click();
    await briefing.getByRole("button", { name: "Generate briefing", exact: true }).click();
    const observation = briefing.getByRole("region", { name: "Observed movement", exact: true });
    await expect(observation).toContainText(makeBriefing().observations[0].text);
    await briefing.getByRole("button", { name: "Inspect P1 for observed movement 1", exact: true }).click();
    await expect(briefing.getByRole("region", { name: "P1 evidence", exact: true })).toBeFocused();
    await briefing.getByRole("button", { name: "Review saved briefings", exact: true }).click();
    const list = briefing.getByRole("list", { name: "Saved briefing list", exact: true });
    await expect(list.getByRole("button")).toHaveCount(20);
    expect((await list.boundingBox())!.height).toBeLessThanOrEqual(290);
    const open = list.getByRole("button").first(); await open.click();
    const review = briefing.getByRole("region", { name: "Saved briefing review", exact: true });
    await expect(review).toBeFocused(); await expect(review).toContainText("Saved scope: AAPL vs SPY");
    await review.getByRole("button", { name: "Inspect P1 for observed movement 1", exact: true }).click();
    await expect(review.getByRole("region", { name: "P1 evidence", exact: true })).toBeFocused();
    await review.getByText("Inspect saved model inputs", { exact: true }).click();
    await expect(review.locator("pre")).toContainText("original input <script>source text</script>");
    expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("comparison-saved-evidence.png"), fullPage: true });
    await review.getByRole("button", { name: "Close saved briefing", exact: true }).click(); await expect(open).toBeFocused();
    expect(requests.generations).toBe(1); expect(requests.writes).toBe(0); expect(errors).toEqual([]);
  });
}

test("@smoke Comparison evidence and controls reflow at actual 200% browser zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "comparison-zoom-")); await mkdir(join(profile, "Default"));
  const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "comparison-zoom", email: "zoom@example.test", exp: Date.parse("2026-11-22T12:00:00Z") / 1000, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await comparisonFixture(page); await page.goto(`${baseURL}/equity/market-context?symbol=AAPL&proxies=SPY&period=1M`);
    const main = page.getByRole("main", { name: "Cross-market research", exact: true });
    await expect(main.getByRole("img", { name: /Indexed daily-close paths/ })).toBeVisible();
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, dpr: devicePixelRatio, visualScale: visualViewport?.scale }));
    await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1);
    expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await main.getByRole("link", { name: "Briefing and saved runs", exact: true }).click();
    await expect(main.getByRole("complementary", { name: "Briefing and saved research" })).toBeFocused();
    await main.getByRole("checkbox", { name: "Dated news headlines", exact: true }).check();
    await expect(main.getByRole("checkbox", { name: "Dated news headlines", exact: true })).toBeChecked();
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true }); if (await dismiss.isVisible()) await dismiss.click();
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(testInfo.outputPath("comparison-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
