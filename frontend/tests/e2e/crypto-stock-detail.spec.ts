import { expect, test } from "@playwright/test";

test("@smoke crypto stock detail keeps crypto feeds and a single Deep briefing lifecycle", async ({ page }) => {
  const subscribed: string[] = [];
  const snapshotMarkets: string[] = [];
  let insights = 0;
  await page.addInitScript(() => {
    localStorage.setItem("stock-state", JSON.stringify({
      state: { ticker: "BTC-USD", interval: "1d", range: "1y" }, version: 0,
    }));
  });
  await page.routeWebSocket(/\/api\/ws\//, (socket) => {
    socket.onMessage((message) => {
      const payload = JSON.parse(String(message));
      if (payload.op !== "subscribe") return;
      for (const token of payload.symbols ?? []) {
        subscribed.push(token);
        if (!token.endsWith(":BTC-USD")) continue;
        const valid = token === "CRYPTO:BTC-USD";
        socket.send(JSON.stringify({ type: "tick", symbol: token,
          ltp: valid ? 82521.45 : 0, change: valid ? 535.14 : 0,
          change_pct: valid ? 0.65 : 0, ts: new Date().toISOString(),
        }));
      }
    });
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/ai/insights/stream")) {
      insights += 1;
      // Research preserves the selected market hint; the backend classifies
      // BTC-USD as crypto regardless of that default hint.
      expect(route.request().postDataJSON()).toEqual({ kind: "briefing", payload: { ticker: "BTC-USD", market: "NASDAQ", refresh: insights > 1 } });
      const model_profile = { requested_profile: "deep", resolved_profile: "deep", model: "deep-test-model" };
      const start = JSON.stringify({ type: "start", phase: "queued", deadlines: { operation_seconds: 660 }, model_profile });
      const result = { engine: "llm", model: "deep-test-model", model_profile, summary: "A completed crypto briefing.", sections: [
        { title: "Evidence", tone: "neutral", points: ["Supplied observations only"] },
        { title: "Limits", tone: "negative", points: ["Incomplete evidence"] },
      ] };
      // The second request closes before its result: the UI must offer manual
      // retry rather than silently run another inference through the GET API.
      await route.fulfill({ contentType: "application/x-ndjson", body: start + "\n" + (insights === 1 ? JSON.stringify({ type: "result", result }) + "\n" : "") });
      return;
    }
    let data: unknown = { items: [] };
    if (url.pathname.endsWith("/quotes") && url.searchParams.get("symbols")?.includes("BTC-USD")) {
      snapshotMarkets.push(url.searchParams.get("market")!);
      data = { market: "CRYPTO", quotes: [{ symbol: "BTC-USD", last: 82500, change: 500, changePct: 0.6 }] };
    } else if (url.pathname.endsWith("/crypto/candles")) {
      data = { ticker: "BTC-USD", currency: "USD", interval: "1d", data: [
        { t: 1792432800, o: 81000, h: 83000, l: 80000, c: 82000, v: 10 },
        { t: 1792519200, o: 82000, h: 83000, l: 81000, c: 82500, v: 12 },
      ] };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/equity/stocks");
  const latest = page.getByText("Latest Price", { exact: true }).locator("xpath=ancestor::section[1]");
  await expect(latest).toContainText("82,521.45");
  await expect(latest).toContainText("+535.14");
  await expect(latest).toContainText("+0.65%");
  await expect(latest).not.toContainText("$0.00");
  await expect.poll(() => snapshotMarkets).toContain("CRYPTO");
  expect(snapshotMarkets).not.toContain("NASDAQ");
  expect(subscribed).toContain("CRYPTO:BTC-USD");
  expect(subscribed).not.toContain("NASDAQ:BTC-USD");
  const briefing = page.getByText("AI Investment Briefing", { exact: true }).locator("xpath=ancestor::section[1]");
  await briefing.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(briefing).toContainText("Deep profile · deep-test-model");
  await expect(briefing).toContainText("A completed crypto briefing.");
  await briefing.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect(briefing).toContainText("retry manually");
  await expect(briefing).not.toContainText("A completed crypto briefing.");
  expect(insights).toBe(2);
});

// Keep the real chart and toolbar mounted together: checking only the refresh
// hook misses a second latest-OHLCV prop overriding the crosshair's OHLC.
test("@smoke BTC hourly candle inspection updates OHLCV and restores the latest candle on leave", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const now = new Date();
  await page.clock.setFixedTime(now);
  const hour = Math.floor(now.getTime() / 3600000) * 3600;
  await page.addInitScript(() => {
    localStorage.setItem("stock-state", JSON.stringify({ state: { ticker: "BTC-USD", interval: "1h", range: "3mo" }, version: 0 }));
  });
  await page.routeWebSocket(/\/api\/ws\//, (socket) => {
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (request.op === "subscribe" && request.symbols?.includes("CRYPTO:BTC-USD")) {
        socket.send(JSON.stringify({ type: "tick", symbol: "CRYPTO:BTC-USD", ltp: 67110, change: 10, change_pct: 0.01, ts: now.toISOString() }));
      }
    });
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = { items: [] };
    if (url.pathname.endsWith("/crypto/candles")) {
      expect(url.searchParams.get("interval")).toBe("1h");
      data = { ticker: "BTC-USD", interval: "1h", currency: "USD", data: [
        // Fill the fitted viewport with known historical candles, so a point
        // inside the plot selects real data independent of platform bar spacing.
        ...Array.from({ length: 39 }, (_, index) => ({
          t: hour - (39 - index) * 3600, o: 65000, h: 67000, l: 64000, c: 66000, v: 100,
        })),
        { t: hour, o: 66944, h: 67500, l: 66500, c: 67110, v: 300 },
      ] };
    } else if (url.pathname.endsWith("/quotes")) {
      data = { market: "CRYPTO", quotes: [{ symbol: "BTC-USD", last: 67110, change: 10, changePct: 0.01 }] };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/equity/stocks");
  const values = page.getByRole("group", { name: "Candle values" });
  await expect(values).toContainText("O:66944.00");
  // Lightweight Charts stacks an interaction canvas above its rendering
  // canvas. Target the upper layer that actually receives pointer events.
  const canvas = page.locator(".tv-lightweight-charts").first().locator("canvas").nth(1);
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await canvas.hover({ position: { x: Math.floor(box.width * 0.4), y: Math.floor(box.height * 0.4) } });
  // Mouse dispatch is not a React/rendering barrier. Retry the observable result
  // rather than sampling innerText immediately during a moving pixel scan.
  await expect(values).toContainText("O:65000.00");
  await expect(values).toContainText("H:67000.00");
  await expect(values).toContainText("L:64000.00");
  await expect(values).toContainText("C:66000.00");
  await expect(values).toContainText("V:100");
  const latest = page.getByText("Latest Price", { exact: true }).locator("xpath=ancestor::section[1]");
  await expect(latest).toContainText("67,110.00");
  await page.mouse.move(5, 5);
  await expect(values).toContainText("O:66944.00");
  await expect(values).toContainText("C:67110.00");
  await expect(values).toContainText("V:300");
});
