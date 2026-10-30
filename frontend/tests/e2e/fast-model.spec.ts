import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`@smoke Fast sentiment, emotion and query identity at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => localStorage.setItem("stock-state", JSON.stringify({ state: { ticker: "AAPL", interval: "1d", range: "1y" }, version: 0 })));
    const profile = { requested_profile: "fast", resolved_profile: "fast", model: "fast-model" };
    const metadata = { model: "fast-model", model_profile: profile };
    const calls: string[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/notes") {
        await route.fulfill({ contentType: "application/json", body: "[]" });
        return;
      }
      let result: unknown;
      if (path.endsWith("/ai/news-sentiment/stream")) {
        calls.push("sentiment");
        result = { engine: "llm", ...metadata, items: route.request().postDataJSON().items.map((item: { id: string }) => ({
          id: item.id, engine: "llm", label: "Bullish", score: 0.5, confidence: 0.8, rationale: "The supplied report describes improved profits.",
        })) };
      } else if (path.endsWith("/sentiment/emotion/stream")) {
        calls.push("emotion");
        result = { ticker: "AAPL", engine: "llm", ...metadata, average_score: 0.5, dominant_emotion: "optimism",
          emotion_index: 60, emotion_index_label: "Greed", articles_analyzed: 1, period_days: 7,
          sentiment_label: "Bullish", sentiment_score: 0.5, confidence: 0.8, articles: [] };
      } else if (path.endsWith("/ai/query/stream")) {
        calls.push("query");
        result = { type: "text_answer", data: "Classified", explanation: "Fast classification completed.", ...metadata };
      }
      if (result) {
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "start", phase: "queued", model_profile: profile, deadlines: { operation_seconds: 660 } },
          { type: "result", result },
        ].map((value) => JSON.stringify(value)).join("\n") + "\n" });
        return;
      }
      if (path === "/api/news/sentiment/AAPL") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ticker: "AAPL", period_days: 7, average_score: 0,
          bullish_pct: 0, bearish_pct: 0, neutral_pct: 100, overall_label: "Neutral", total_articles: 1, daily_sentiment: [] }) });
        return;
      }
      const items = path.endsWith("/news/latest") || path.includes("/news/by-ticker/") ? [{ id: "article-1", title: "AAPL profit improves", summary: "AAPL reported improved profits.",
        source: "Wire", url: "https://example.com/aapl", published_at: new Date().toISOString(), tickers: ["AAPL"] }] : [];
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items }) });
    });
    await page.goto("/equity/news");
    await page.getByRole("button", { name: /^AI sentiment ·/ }).click();
    await expect(page.getByText(/Fast profile · fast-model · 1\/1/)).toBeVisible();
    await page.getByRole("button", { name: "Ticker · AAPL", exact: true }).click();
    const emotion = page.getByText("Emotion Indicator", { exact: true }).locator("xpath=ancestor::section[1]");
    await expect(emotion).toContainText("Fast profile · fast-model");
    const command = page.getByPlaceholder(/Type ticker, command, or search/i);
    await command.fill("what's happening in the market?"); await command.press("Enter");
    await expect(page.getByText("Fast classification completed.", { exact: true })).toBeVisible();
    await expect(page.locator("p").filter({ hasText: /^Fast profile · fast-model$/ }).last()).toBeVisible();
    expect(calls).toEqual(["sentiment", "emotion", "query"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
