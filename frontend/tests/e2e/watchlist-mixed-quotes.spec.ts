import { expect, test } from "@playwright/test";

const instruments = [
  { symbol: "AAPL", quote_symbol: "AAPL", market: "NASDAQ", currency: "USD", price: 201 },
  { symbol: "MWRE.DE", quote_symbol: "MWRE.DE", market: "EU", currency: "EUR", price: 12 },
  { symbol: "MIGA.MU", quote_symbol: "MIGA.MU", market: "EU", currency: "EUR", price: 7 },
  { symbol: "SAP.DE", quote_symbol: "SAP.DE", market: "EU", currency: "EUR", price: 170 },
  { symbol: "BTC-USD", quote_symbol: "BTC-USD", market: "CRYPTO", currency: "USD", price: 90000 },
  { symbol: "BTC-EUR", quote_symbol: "BTC-EUR", market: "CRYPTO", currency: "EUR", price: 83000 },
  { symbol: "RELIANCE.NS", quote_symbol: "RELIANCE", market: "NSE", currency: "INR", price: 3000 },
  { symbol: "III.L", quote_symbol: "III.L", market: "EU", currency: "GBP", quote_currency: "GBp", price: 153 },
  { symbol: "TCS", quote_symbol: "TCS", market: "NSE", currency: "INR", price: 3500 },
];
for (const width of [1440, 390]) {
  test(`@smoke Mixed Watchlist quotes use per-symbol identity under EU and crypto selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => localStorage.setItem("ui-settings", JSON.stringify({ state: { selectedCountry: "EU", selectedMarket: "EU", displayCurrency: "EUR" }, version: 0 })));
    const tokens = new Set<string>(); let exported: any[] = [];
    await page.routeWebSocket("**/api/ws/**", socket => socket.onMessage(message => {
      const data = JSON.parse(String(message)); if (data.op !== "subscribe") return;
      for (const token of data.symbols || []) {
        tokens.add(token); const instrument = instruments.find(item => `${item.market}:${item.quote_symbol}` === token);
        if (instrument) socket.send(JSON.stringify({ type: "tick", symbol: token, ltp: instrument.price, change: 1, change_pct: 1, currency: instrument.quote_currency || instrument.currency, volume: 100, ts: new Date().toISOString() }));
      }
    }));
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/watchlists") return route.fulfill({ json: [{ id: "mixed", name: "Mixed native listings", symbols: [...instruments.map(item => item.symbol), "AMBIG"], quote_routes: {
        ...Object.fromEntries(instruments.map(item => [item.symbol, { symbol: item.symbol, quote_symbol: item.quote_symbol, market: item.market, currency: item.currency, status: "resolved" }])),
        AMBIG: { symbol: "AMBIG", quote_symbol: "AMBIG", market: null, currency: null, status: "ambiguous" },
      }, column_config: {}, created_at: "2026-11-23T12:00:00Z" }] });
      if (path === "/api/export/csv") { exported = route.request().postDataJSON().data; return route.fulfill({ contentType: "text/csv", headers: { "content-disposition": "attachment; filename=mixed.csv" }, body: "symbol,currency\nAAPL,USD\n" }); }
      return route.fulfill({ json: { items: [], results: [], quotes: [] } });
    });
    await page.goto("/equity/watchlist");
    const main = page.getByRole("main", { name: "Watchlist research", exact: true }), table = main.getByRole("region", { name: "Watchlist quotes", exact: true });
    for (const instrument of instruments) {
      const row = table.getByRole("row").filter({ has: page.getByRole("cell", { name: instrument.symbol, exact: true }) });
      await expect(row.getByRole("cell", { name: instrument.price.toFixed(2), exact: true })).toBeVisible(); await expect(row.getByRole("cell", { name: instrument.quote_currency || instrument.currency, exact: true })).toBeVisible();
      expect(tokens.has(`${instrument.market}:${instrument.quote_symbol}`)).toBe(true);
    }
    expect(tokens.has("EU:AAPL")).toBe(false); expect(tokens.has("EU:BTC-USD")).toBe(false); expect(tokens.has("NASDAQ:AMBIG")).toBe(false);
    await expect(main.getByRole("status")).toContainText("AMBIG");
    const region = page.getByRole("combobox", { name: "Market region", exact: true });
    if (!await region.isVisible()) await page.getByRole("button", { name: /^Market controls/ }).click();
    await region.selectOption("CRYPTO");
    await expect(main.getByText("Find a symbol to add · CRYPTO", { exact: true })).toBeVisible();
    for (const instrument of instruments) await expect(table.getByRole("row").filter({ has: page.getByRole("cell", { name: instrument.symbol, exact: true }) })).toContainText(instrument.price.toFixed(2));
    await main.getByRole("button", { name: "Export", exact: true }).click();
    const download = page.waitForEvent("download"); await main.getByRole("button", { name: "Export to CSV", exact: true }).click(); await download;
    expect(exported.find(row => row.symbol === "MWRE.DE")).toMatchObject({ market: "EU", currency: "EUR", price: 12 });
    expect(exported.find(row => row.symbol === "III.L")).toMatchObject({ currency: "GBp", price: 153 });
    expect(exported.find(row => row.symbol === "BTC-USD")).toMatchObject({ market: "CRYPTO", currency: "USD", price: 90000 });
    await main.getByRole("combobox", { name: "Watchlist view", exact: true }).selectOption("heatmap");
    await expect(main.locator('[aria-label="Watchlist heatmap"]').getByRole("link")).toHaveCount(instruments.length);
    expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
}
