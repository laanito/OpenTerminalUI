import type { Page } from "@playwright/test";
import { portfolioReportFixture } from "./portfolio-fixtures";

export const longAccount = "Core · " + "Documented-long-term-multi-market-mandate-".repeat(3);
export const longSymbol = "LONG-LISTING-IDENTITY-".repeat(4);
export const longRationale = "Research context and uncertainty. ".repeat(18) + "https://example.test/" + "evidence-path-".repeat(18);
export async function portfolioAcceptanceRoutes(page: Page) {
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (route.request().method() !== "GET") return route.fulfill({ status: 405, json: { detail: "Acceptance fixture blocks writes and model calls" } });
    if (path === "/api/portfolios") return route.fulfill({ json: { items: [{ id: "p1", name: longAccount, currency: "USD", description: longRationale }, { id: "p2", name: "Europe", currency: "EUR" }] } });
    if (path === "/api/portfolios/report") {
      const report: any = portfolioReportFixture(url.searchParams.get("portfolio_id") || "all", url.searchParams.get("reporting_currency") || "USD");
      report.portfolios.forEach((member: any) => { if (member.portfolio_id === "p1") member.name = longAccount; });
      const original = report.positions[0], templates = original.lots;
      const lot = (index: number, symbol: string) => {
        const template = templates[index % templates.length], shares = (index + 1) / 100000;
        const factor = report.reporting_currency === "EUR" ? .9 : 1;
        return { ...template, symbol, holding_id: `${symbol}-h-${index}`, lot_id: `lot-${index}`, shares,
          notes: longRationale, portfolio_name: template.portfolio_id === "p1" ? longAccount : "Europe",
          accounting: { ...template.accounting, cost_basis_native: { amount: 150 * shares, currency: "USD" },
            cost_basis_base: 150 * shares * factor, market_value_native: { amount: 200 * shares, currency: "USD" },
            market_value_base: 200 * shares * factor, unrealized_pnl_base: 50 * shares * factor } };
      };
      const position = (symbol: string, count: number) => {
        const lots = Array.from({ length: count }, (_, index) => lot(index, symbol));
        const metric = (field: string) => ({ value: lots.reduce((sum: number, row: any) => sum + row.accounting[field], 0),
          known_value: lots.reduce((sum: number, row: any) => sum + row.accounting[field], 0), complete_items: count, total_items: count, unit: "lot", status: "complete" });
        return { ...original, symbol, lots, shares: lots.reduce((sum: number, row: any) => sum + row.shares, 0),
          metrics: { market_value: metric("market_value_base"), cost_basis: metric("cost_basis_base"), unrealized_pnl: metric("unrealized_pnl_base") } };
      };
      report.positions = [position("AAPL", 80), ...Array.from({ length: 24 }, (_, index) => position(index === 0 ? longSymbol : `TEST-${index}`, 1))];
      for (const key of ["market_value", "cost_basis", "unrealized_pnl"]) {
        const value = report.positions.reduce((sum: number, row: any) => sum + row.metrics[key].value, 0);
        Object.assign(report.metrics[key], { value, known_value: value, complete_items: 104, total_items: 104 });
      }
      report.portfolios.forEach((member: any) => {
        const value = report.positions.flatMap((row: any) => row.lots).filter((row: any) => row.portfolio_id === member.portfolio_id).reduce((sum: number, row: any) => sum + row.accounting.market_value_base, 0);
        member.accounting.allocation_by_sector = [{ name: "Technology", value }];
      });
      report.metrics.net_liquidation_value.value = report.metrics.cash_balance.value + report.metrics.market_value.value;
      return route.fulfill({ json: report });
    }
    if (path.endsWith("/transactions")) return route.fulfill({ json: { items: Array.from({ length: 80 }, (_, index) => ({ id: `tx-${index}`, symbol: "AAPL", type: "buy", shares: .000001, price: 150, currency: "USD", fees: 0, date: "2026-11-10", notes: `${index}: ${longRationale}` })) } });
    if (path.includes("/analytics/") || path.endsWith("/attribution")) return route.fulfill({ status: 503, json: { detail: "Optional analytics unavailable in acceptance fixture" } });
    if (path.endsWith("/analytics")) return route.fulfill({ json: { annualized_return: null, allocation_by_sector: [] } });
    if (path.endsWith("/notes")) return route.fulfill({ json: [{ id: "n1", title: "Dated holding research", body: longRationale, symbol: "AAPL", context: "holding", tags: ["long-term"], created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" }] });
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
}

/** Measured sRGB text contrast for the pilot's visible labels/controls. */
export async function portfolioContrast(page: Page) {
  return page.locator('[aria-label="Portfolio scope"] h2, [aria-label="Portfolio scope"] button:enabled, [aria-label="AAPL lots"] button:enabled, [aria-label="AAPL lots"] [role="gridcell"] > div, [data-terminal-modal] label > span').evaluateAll(elements => {
    const rgba = (value: string) => (value.match(/[\d.]+/g) || []).map(Number);
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    return elements.filter(element => element.getClientRects().length && element.textContent?.trim()).map(element => {
      const backgrounds: number[][] = [];
      for (let node: Element | null = element; node; node = node.parentElement) backgrounds.unshift(rgba(getComputedStyle(node).backgroundColor));
      const background = backgrounds.reduce((base, color) => { const alpha = color[3] ?? 1; return base.map((channel, index) => (color[index] || 0) * alpha + channel * (1 - alpha)); }, [255, 255, 255]);
      const text = rgba(getComputedStyle(element).color), first = luminance(text), second = luminance(background);
      return { text: element.textContent!.trim().slice(0, 60), ratio: (Math.max(first, second) + .05) / (Math.min(first, second) + .05) };
    });
  });
}
