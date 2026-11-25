import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const longName = "Worldwide programmable infrastructure and decentralised financial settlement research network";
const sectorName = "Decentralised infrastructure and programmable settlement networks";
async function fixture(page: Page) {
  const state = { failed: [] as string[], empty: false, waitSearch: "", releaseSearch: null as null | (() => void), waitWindow: "", releaseWindow: null as null | (() => void), reads: [] as string[] };
  const rows = [
    { symbol: "BTC-USD", name: "Bitcoin", price: 67000, change_24h: 0, volume_24h: 1000, market_cap: 1000000, sector: "L1" },
    { symbol: "ETH-USD", name: "Ethereum", price: 3000, change_24h: -1.1, volume_24h: 900, market_cap: 900000, sector: "L1" },
    { symbol: "UNI-USD", name: longName, price: .123456, change_24h: 2.2, volume_24h: 500, market_cap: 500000, sector: sectorName },
    { symbol: "AVAX-USD", name: "Avalanche", price: 30, change_24h: 4.4, volume_24h: 700, market_cap: 600000, sector: "L1" },
  ];
  await page.context().routeWebSocket("**/*", socket => socket.close());
  await page.context().route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const key = path.split("/").pop() || "";
    const fail = state.failed.some(part => path.includes(`/crypto/${part}`));
    if (fail) return route.fulfill({ status: 503, json: { detail: "PRIVATE_PROVIDER_CONTEXT" } });
    if (path.endsWith("/crypto/markets")) {
      const q = url.searchParams.get("q") || ""; state.reads.push(`markets:${q}:${url.searchParams.get("sector") || "all"}:${url.searchParams.get("sortBy")}:${url.searchParams.get("sortOrder")}`);
      if (q && q === state.waitSearch) await new Promise<void>(resolve => { state.releaseSearch = resolve; });
      const found = q ? rows.filter(row => `${row.symbol} ${row.name}`.toLowerCase().includes(q.toLowerCase())) : rows.slice(0,3);
      return route.fulfill({ json: { items: state.empty ? [] : found.filter(row => !url.searchParams.get("sector") || row.sector === url.searchParams.get("sector")), ts: "2026-11-25T12:00:00Z" } });
    }
    if (path.includes("/crypto/movers/")) return route.fulfill({ json: { items: state.empty ? [] : [rows[3]], ts: "2026-11-25T12:00:00Z" } });
    if (key === "dominance") return route.fulfill({ json: { btc_pct: 52, eth_pct: 18, others_pct: 30, total_market_cap: 10000000, ts: "2026-11-25T12:00:00Z" } });
    if (key === "index") return route.fulfill({ json: { index_value: 1000, index_name: "OTUI top-basket index proxy", change_24h: 0, total_market_cap: 10000000, component_count: 10, top_n: 10, ts: "2026-11-25T12:00:00Z" } });
    if (key === "sectors") return route.fulfill({ json: { items: state.empty ? [] : [{ sector: sectorName, change_24h: 2.2, market_cap: 500000, components: [{ symbol: "UNI-USD", name: longName, weight: 1 }] }], ts: "2026-11-25T12:00:00Z" } });
    if (key === "heatmap") return route.fulfill({ json: { items: state.empty ? [] : [{ ...rows[2], depth_imbalance: .14, bucket: "bullish" }], ts: "2026-11-25T12:00:00Z", degraded: { reason: "no_live_source", detail: "Fixture depth availability" } } });
    if (key === "derivatives") return route.fulfill({ json: { items: state.empty ? [] : [{ symbol: "BTC-USD", funding_rate_8h: 0, open_interest_usd: 0, long_liquidations_24h: 100000, short_liquidations_24h: 120000, liquidations_24h: 220000 }], totals: { open_interest_usd: 0, long_liquidations_24h: 100000, short_liquidations_24h: 120000, liquidations_24h: 220000 }, ts: "2026-11-25T12:00:00Z", degraded: { reason: "no_provider_data" } } });
    if (key === "defi") return route.fulfill({ json: { headline: { tvl_usd: 2000000, dex_volume_24h: 350000, lending_borrowed_usd: 250000, defi_change_24h: 1.8 }, protocols: state.empty ? [] : [{ symbol: "UNI-USD", name: longName, change_24h: 2.2, dominance_pct: 54.2, tvl_proxy_usd: 900000 }], ts: "2026-11-25T12:00:00Z" } });
    if (key === "correlation") {
      const window = url.searchParams.get("window") || "30"; state.reads.push(`correlation:${window}`);
      if (window === state.waitWindow) await new Promise<void>(resolve => { state.releaseWindow = resolve; });
      return route.fulfill({ json: { symbols: state.empty ? [] : ["BTC-USD", "ETH-USD"], matrix: window === "30" ? [[1,null],[0,1]] : [[1,Number(window)/100],[0,1]], window: Number(window), ts: "2026-11-25T12:00:00Z", degraded: { reason: "no_provider_data", detail: "Partial fixture history" } } });
    }
    return route.fulfill({ json: { items: [], results: [], quotes: [], alerts: [] } });
  });
  return state;
}
async function bounded(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const main = page.getByRole("main", { name: "Crypto workspace", exact: true });
  expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const element of await main.locator("input, select, button").all()) {
    if (!await element.isVisible() || await element.evaluate(el => Boolean(el.closest("table")))) continue;
    const box = await element.boundingBox(); if (box) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth) + 1); }
  }
  for (const region of await main.getByRole("region").all()) { const box = await region.boundingBox(); if (box) expect(box.x + box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth) + 1); }
}
for (const width of [1440,1024,390]) test(`@smoke Crypto eight-module review and readable asset context at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page);
  if (width === 1440) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  await page.goto("/equity/crypto"); const module = page.getByRole("region", { name: "Active crypto module", exact: true }); const selector = page.getByRole("combobox", { name: "Crypto module", exact: true });
  await expect(module.getByText(longName, { exact: true })).toBeVisible(); await expect(page.getByRole("heading", { name: "Crypto Command Center", exact: true })).toHaveCSS("font-size", "18px");
  await module.getByRole("button", { name: "UNI-USD", exact: true }).focus(); await page.keyboard.press("Enter"); await expect(page.getByRole("region", { name: "Focus Asset", exact: true })).toContainText(longName);
  await module.getByRole("combobox", { name: "Sort direction", exact: true }).selectOption("asc"); await expect.poll(() => state.reads.some(read => read.endsWith(":asc"))).toBe(true); await expect(page.getByRole("region", { name: "Focus Asset", exact: true })).toContainText(longName); await bounded(page); await page.screenshot({ path: info.outputPath("crypto-markets.png"), fullPage: true, animations: "disabled" });
  for (const tab of ["movers", "index", "sectors", "heatmap", "derivatives", "defi", "correlation"]) {
    await selector.selectOption(tab);
    if (tab === "movers") await expect(module.getByRole("button", { name: /AVAX-USD.*Avalanche/ })).toBeVisible();
    if (tab === "index") await expect(module.getByText("1000.00", { exact: true })).toBeVisible();
    if (tab === "sectors") await expect(module.getByText(sectorName, { exact: true })).toBeVisible();
    if (tab === "heatmap") { await expect(module.getByText(longName, { exact: true })).toBeVisible(); await expect(module.getByText("Depth 14.0%", { exact: true })).toBeVisible(); }
    if (tab === "derivatives") { await expect(module.getByRole("region", { name: "Crypto derivatives table", exact: true })).toBeVisible(); await expect(module.getByText("0.000%", { exact: true })).toBeVisible(); }
    if (tab === "defi") { await expect(module.getByText(/Modelled proxies from market cap/)).toBeVisible(); await expect(module.getByText(longName, { exact: true })).toBeVisible(); }
    if (tab === "correlation") { await expect(module.getByTestId("corr-cell-0-1")).toHaveText("Unavailable"); await expect(module.getByTestId("corr-cell-1-0")).toHaveText("0.00"); await module.getByRole("region", { name: "Crypto correlation table", exact: true }).focus(); await expect(module.getByRole("region", { name: "Crypto correlation table", exact: true })).toBeFocused(); const table = module.getByRole("region", { name: "Crypto correlation table", exact: true }); if (await table.evaluate(el => el.scrollWidth > el.clientWidth)) { await table.press("ArrowRight"); await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } }
    await bounded(page); await page.screenshot({ path: info.outputPath(`crypto-${tab}.png`), fullPage: true, animations: "disabled" });
  }
  await page.getByRole("link", { name: "View active module", exact: true }).click(); await expect(module).toBeFocused();
});
test("@smoke Crypto late search and correlation-window reads stay in their requested scope", async ({ page }) => {
  const state = await fixture(page); await page.goto("/equity/crypto"); const module = page.getByRole("region", { name: "Active crypto module", exact: true }); const search = module.getByRole("textbox", { name: "Search crypto markets", exact: true });
  state.waitSearch = "bitcoin"; await search.fill("bitcoin"); await expect.poll(() => Boolean(state.releaseSearch)).toBe(true); await search.fill("ethereum"); await expect(page.getByRole("region", { name: "Focus Asset", exact: true })).toContainText("Ethereum"); state.releaseSearch?.(); await expect(module.getByRole("button", { name: "BTC-USD", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Crypto module", exact: true }).selectOption("correlation"); state.waitWindow = "14"; const window = module.getByRole("combobox", { name: "Correlation window", exact: true }); await window.selectOption("14"); await expect.poll(() => Boolean(state.releaseWindow)).toBe(true); await window.selectOption("90"); await expect(module.getByTestId("corr-cell-0-1")).toHaveText("0.90"); state.releaseWindow?.(); await expect(module.getByText(/Returned window: 90 days/)).toBeVisible(); await expect(module.getByTestId("corr-cell-0-1")).toHaveText("0.90");
});
test("@smoke Crypto failures, empty results and failed refreshes keep honest module states", async ({ page }) => {
  const state = await fixture(page); state.failed = ["heatmap", "defi"]; await page.goto("/equity/crypto"); const module = page.getByRole("region", { name: "Active crypto module", exact: true }); const selector = page.getByRole("combobox", { name: "Crypto module", exact: true });
  for (const tab of ["heatmap","defi"]) { await selector.selectOption(tab); await expect(module.getByRole("alert")).toContainText("Could not refresh"); await expect(module.getByTestId(`crypto-${tab}-panel`)).toHaveCount(0); }
  state.failed = []; await page.getByRole("button", { name: "Refresh module", exact: true }).click(); await expect(module.getByText(longName, { exact: true })).toBeVisible(); state.failed = ["defi"]; await page.getByRole("button", { name: "Refresh module", exact: true }).click(); await expect(module.getByRole("alert")).toContainText("unrefreshed"); await expect(module.getByText(longName, { exact: true })).toBeVisible(); expect(await page.locator("body").innerText()).not.toContain("PRIVATE_PROVIDER_CONTEXT");
  state.failed = []; state.empty = true; await selector.selectOption("markets"); await page.getByRole("button", { name: "Refresh module", exact: true }).click(); await expect(module.getByText("No rows returned for this scope.", { exact: true })).toBeVisible(); await expect(page.getByText("No focus asset available for the current search and sector filter.", { exact: true })).toBeVisible();
});
test("@smoke Selecting a Crypto mover outside a filtered board resolves the intended focus", async ({ page }) => {
  const state = await fixture(page); await page.goto("/equity/crypto"); const module = page.getByRole("region", { name: "Active crypto module", exact: true }); await module.getByRole("textbox", { name: "Search crypto markets", exact: true }).fill("bitcoin"); await expect(module.getByRole("button", { name: "ETH-USD", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Crypto module", exact: true }).selectOption("movers"); await module.getByRole("button", { name: /AVAX-USD.*Avalanche/ }).click(); await expect(page.getByRole("combobox", { name: "Crypto module", exact: true })).toHaveValue("markets"); await expect(module.getByRole("textbox", { name: "Search crypto markets", exact: true })).toHaveValue("AVAX-USD"); await expect(page.getByRole("region", { name: "Focus Asset", exact: true })).toContainText("Avalanche"); expect(state.reads.some(read => read.startsWith("markets:AVAX-USD:all:"))).toBe(true);
  await page.getByRole("link", { name: "View focus asset", exact: true }).click(); await expect(page.getByRole("region", { name: "Focus Asset", exact: true })).toBeFocused();
});
test("@smoke Crypto modules reflow at actual 200% Chrome browser zoom", async ({ playwright, baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), "crypto-review-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2)/Math.log(1.2); await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try { await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "crypto-review", email: "zoom@example.test", exp: Math.floor(Date.now()/1000)+3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); }); const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/crypto`);
    for (const tab of ["markets","heatmap","derivatives","defi","correlation"]) { await page.getByRole("combobox", { name: "Crypto module", exact: true }).selectOption(tab); await expect(page.getByRole("region", { name: "Active crypto module", exact: true })).toBeVisible(); await bounded(page); }
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth/metrics.cssWidth).toBeCloseTo(2,1); expect(metrics.visualScale).toBe(1); await info.attach("native-zoom", { body: JSON.stringify(metrics), contentType: "application/json" }); const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(info.outputPath("crypto-native-zoom.png"), Buffer.from(shot.data,"base64"));
  } finally { await context.close(); }
});
