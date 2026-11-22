import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const publisher = "International Markets and Corporate Earnings Research Correspondents";
const sector = "Information technology infrastructure and communication services";
const headline = "AAPL earnings and infrastructure demand: why a longer headline needs room to remain readable";
const rationale = "The supplied headline describes stronger earnings, while the summary still flags valuation uncertainty. This is a headline assessment, separate from the original feed labels and any private research.";
async function newsFixture(page: Page) {
  const state = { scores: 0, emotions: 0, failScoring: false, failFeeds: false, empty: false, searches: [] as string[] };
  await page.clock.setFixedTime(new Date("2026-11-22T12:00:00Z"));
  await page.addInitScript(() => localStorage.setItem("stock-state", JSON.stringify({ state: { ticker: "AAPL", interval: "1d", range: "1y" }, version: 0 })));
  await page.routeWebSocket("**/*", socket => socket.close());
  const items = Array.from({ length: 25 }, (_, i) => ({ id: `article-${i}`, title: `${headline} · ${i + 1}`, source: publisher, url: `https://example.test/news/${i}`, summary: `Publisher report ${i + 1}: earnings improved, but valuation assumptions still need scrutiny. The full summary remains readable rather than clipped after two lines.`, published_at: "2026-11-22T10:00:00Z", sentiment: { label: ["Bullish", "Neutral", "Bearish"][i % 3], score: [0.6, 0, -0.5][i % 3], confidence: 0.7 } }));
  const profile = { requested_profile: "fast", resolved_profile: "fast", model: "fast-news-model" };
  const stream = (route: Parameters<Parameters<Page["route"]>[1]>[0], result: unknown) => route.fulfill({ contentType: "application/x-ndjson", body: [
    { type: "start", phase: "queued", model_profile: profile, deadlines: { operation_seconds: 660 } }, { type: "result", result },
  ].map(e => JSON.stringify(e)).join("\n") + "\n" });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith("/ai/news-sentiment/stream")) {
      state.scores++;
      if (state.failScoring) return route.fulfill({ status: 503, json: { detail: "Scoring unavailable" } });
      const batch = route.request().postDataJSON().items;
      expect(batch).toHaveLength(state.scores === 1 ? 20 : 5);
      return stream(route, { engine: "mixed", model: "fast-news-model", model_profile: profile, items: batch.map((item: { id: string }, i: number) => ({ id: item.id, label: "Bullish", score: 0.6, confidence: 0.8, rationale: `${rationale} · ${item.id}`, engine: i === 0 ? "llm" : "lexical" })) });
    }
    if (path.endsWith("/sentiment/emotion/stream")) {
      state.emotions++;
      expect(route.request().postDataJSON()).toMatchObject({ ticker: "AAPL", days: 7 });
      return stream(route, { ticker: "AAPL", engine: "llm", model: "fast-news-model", model_profile: profile, emotion_index: 60, emotion_index_label: "Greed", dominant_emotion: "optimism", period_days: 7, articles_analyzed: 1, confidence: 0.8, sentiment_label: "Bullish", sentiment_score: 0.6, narrative: rationale, emotion_distribution: [{ emotion: "optimism", count: 1, share: 1 }], articles: [{ title: `${headline} · emotion source`, url: "https://example.test/emotion-source", sentiment_label: "Bullish", sentiment_score: 0.6, emotion: "optimism", emotion_intensity: 0.7, rationale }] });
    }
    if (path === "/api/news/sentiment/market") return route.fulfill({ json: { sectors: [{ sector, avg_sentiment: 0.4, score: 0.4 }] } });
    if (path === "/api/news/sentiment/summary") return route.fulfill({ json: { top_sources: [{ source: publisher, count: 25 }] } });
    if (path === "/api/news/sentiment/AAPL") return route.fulfill({ json: { ticker: "AAPL", total_articles: 25, overall_label: "Bullish", average_score: 0.2, bullish_pct: 36, neutral_pct: 32, bearish_pct: 32, daily_sentiment: [{ date: "2026-11-22", avg_score: 0.2, count: 25 }] } });
    if (["/api/news/latest", "/api/news/search", "/api/news/by-ticker/AAPL", "/api/news/crypto"].includes(path)) {
      if (path.endsWith("/search")) state.searches.push(url.searchParams.get("q") || "");
      return state.failFeeds ? route.fulfill({ status: 503, json: { detail: "Provider unavailable" } }) : route.fulfill({ json: { items: state.empty ? [] : items } });
    }
    if (path === "/api/notes") return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return state;
}
async function bounded(page: Page) {
  const main = page.getByRole("main", { name: "News research", exact: true });
  expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await main.getByRole("article").evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
for (const width of [1440, 1024, 390]) {
  test(`@smoke News prioritizes readable headlines and keeps scoring and context distinct at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); const state = await newsFixture(page);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto("/equity/news");
    const main = page.getByRole("main", { name: "News research", exact: true });
    const feed = main.getByRole("region", { name: "Headlines", exact: true });
    const first = feed.getByRole("article").first(), context = main.getByRole("complementary", { name: "News context", exact: true });
    await expect(first.getByRole("link")).toHaveAttribute("href", "https://example.test/news/0");
    await expect(first.getByRole("link")).toHaveAttribute("target", "_blank");
    expect((await first.getByRole("link").boundingBox())!.y).toBeLessThan(900);
    expect(await first.locator("p").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
    expect(await first.locator("span, time").evaluateAll(els => els.every(el => parseFloat(getComputedStyle(el).fontSize) >= 12))).toBe(true);
    await expect(first.getByText(publisher, { exact: true })).toBeVisible(); await expect(first.locator("time")).toHaveAttribute("datetime", "2026-11-22T10:00:00Z");
    expect(state.scores).toBe(0); expect(state.emotions).toBe(0); await bounded(page);
    await page.screenshot({ path: testInfo.outputPath("news-headlines.png"), fullPage: true });
    await main.getByText(/^Feed filters ·/).click();
    await expect(main.getByLabel("Sort headlines", { exact: true })).toBeVisible(); await expect(main.getByLabel("Time window", { exact: true })).toBeVisible();
    await main.getByText(/^Feed filters ·/).click();
    await feed.getByRole("button", { name: "AI sentiment · 20", exact: true }).click();
    await expect(feed.getByText(/Fast profile · fast-news-model \+ lexical fallback · 20\/20/)).toBeVisible();
    await expect(first).toContainText(rationale); await expect(first).toContainText("AI assessment"); await expect(feed.getByRole("article").nth(1)).toContainText("Lexical fallback");
    await expect(feed.getByRole("button", { name: "Bullish · 9", exact: true })).toBeVisible();
    await feed.getByRole("button", { name: "Load more", exact: true }).click(); state.failScoring = true;
    await feed.getByRole("button", { name: "AI sentiment · 5", exact: true }).click(); await expect(feed.getByRole("alert")).toContainText("Scoring failed");
    state.failScoring = false; await feed.getByRole("button", { name: "AI sentiment · 5", exact: true }).click();
    await expect(feed.getByRole("article").last()).toContainText("article-24"); expect(state.scores).toBe(3);
    await feed.getByRole("button", { name: "Bullish · 9", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(feed.getByRole("article")).toHaveCount(9); await expect(feed.getByRole("button", { name: "Bullish · 9", exact: true })).toHaveAttribute("aria-pressed", "true");
    await feed.getByRole("button", { name: "Clear", exact: true }).click(); await expect(feed.getByRole("article")).toHaveCount(20);
    await main.getByRole("link", { name: "Sentiment and research context", exact: true }).click();
    await context.getByText("Daily sentiment values", { exact: true }).click(); await expect(context.getByText("2026-11-22", { exact: true })).toBeVisible();
    await context.getByText("Source coverage", { exact: true }).click(); await expect(context.getByText(publisher, { exact: true })).toBeVisible();
    await context.getByText("Keyword matches", { exact: true }).click(); await context.getByLabel("Keyword Alerts (comma separated)", { exact: true }).fill("earnings");
    await expect(context.getByText("Keyword matches · 8", { exact: true })).toBeVisible();
    await context.getByRole("heading", { name: "Sentiment context", exact: true }).scrollIntoViewIfNeeded(); await bounded(page);
    await page.screenshot({ path: testInfo.outputPath("news-context.png"), fullPage: true });
    await context.getByRole("button", { name: new RegExp(sector) }).click();
    await expect(main.getByLabel("Search all news", { exact: true })).toHaveValue(`${sector} sector stocks`);
    await expect.poll(() => state.searches).toContain(`${sector} sector stocks`); expect(state.scores).toBe(3);
    await main.getByRole("button", { name: "Ticker · AAPL", exact: true }).click();
    const emotion = context.getByRole("region", { name: "Emotion analysis", exact: true });
    await expect(emotion).toContainText("Fast profile · fast-news-model"); expect(state.emotions).toBe(1);
    await emotion.getByRole("button", { name: "Show per-article breakdown (1)", exact: true }).click();
    await expect(emotion.getByRole("link", { name: `${headline} · emotion source`, exact: true })).toBeVisible();
    await expect(emotion.getByRole("img", { name: "Emotion index 60 out of 100: Greed", exact: true })).toBeVisible();
    await context.getByText("Your notes on AAPL", { exact: true }).click(); await expect(context.getByLabel("New note", { exact: true })).toBeVisible();
    await emotion.getByRole("heading").scrollIntoViewIfNeeded(); await bounded(page); await page.screenshot({ path: testInfo.outputPath("news-ticker-context.png"), fullPage: true });
    await main.getByLabel("Search all news", { exact: true }).fill("macro"); await page.keyboard.type("m");
    await expect(main.getByLabel("Search all news", { exact: true })).toBeFocused(); await expect(page).toHaveURL(/\/equity\/news/);
    await expect.poll(() => state.searches).toContain("macrom");
    await main.getByRole("button", { name: "Market", exact: true }).click(); await main.getByText(/^Feed filters ·/).click(); await main.getByRole("button", { name: "Crypto", exact: true }).click();
    await expect(main.getByRole("button", { name: "Crypto", exact: true })).toHaveAttribute("aria-pressed", "true");
    await main.getByLabel("Sort headlines", { exact: true }).selectOption("sentiment"); await expect(feed.getByRole("article").first()).toContainText("· 1");
    await bounded(page); expect(errors).toEqual([]);
  });
}

test("@smoke News feed failure and empty results remain distinct from neutral sentiment", async ({ page }) => {
  const state = await newsFixture(page); state.failFeeds = true; await page.goto("/equity/news");
  const main = page.getByRole("main", { name: "News research", exact: true }), context = main.getByRole("complementary", { name: "News context", exact: true });
  await expect(main.getByRole("alert")).toContainText("News feed unavailable"); await expect(main.getByText("No news found for this view.", { exact: true })).toHaveCount(0);
  await expect(context).toContainText("No sentiment summary available for this feed."); await expect(context.getByRole("img", { name: "Daily sentiment trend", exact: true })).toHaveCount(0);
  state.failFeeds = false; await main.getByRole("button", { name: "Retry headlines", exact: true }).click(); await expect(main.getByRole("article")).toHaveCount(20);
  state.empty = true; await main.getByText(/^Feed filters ·/).click(); await main.getByRole("button", { name: "Crypto", exact: true }).click(); await expect(main.getByText("No news found for this view.", { exact: true })).toBeVisible();
  await expect(main.getByRole("alert")).toHaveCount(0); await expect(context).toContainText("No sentiment summary available for this feed."); expect(state.scores).toBe(0);
});

test("@smoke News headlines and long context reflow at actual 200% browser zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "news-zoom-")); await mkdir(join(profile, "Default"));
  const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "news-zoom", email: "zoom@example.test", exp: Date.parse("2026-11-23T12:00:00Z") / 1000, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await newsFixture(page); await page.goto(`${baseURL}/equity/news`);
    const main = page.getByRole("main", { name: "News research", exact: true }); await expect(main.getByRole("article").first()).toContainText(publisher);
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, dpr: devicePixelRatio, visualScale: visualViewport?.scale }));
    await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1); await bounded(page);
    await main.getByRole("link", { name: "Sentiment and research context", exact: true }).click();
    await main.getByRole("button", { name: "Ticker · AAPL", exact: true }).click();
    await expect(main.getByRole("region", { name: "Emotion analysis", exact: true })).toContainText("Fast profile · fast-news-model");
    await main.getByRole("region", { name: "Emotion analysis", exact: true }).scrollIntoViewIfNeeded(); await bounded(page);
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true }); if (await dismiss.isVisible()) await dismiss.click();
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(testInfo.outputPath("news-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
