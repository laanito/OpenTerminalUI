import { expect, test } from "@playwright/test";
import { portfolioInsight } from "../../src/__tests__/fixtures/portfolioTechnicalContext";

for (const width of [1440, 390]) {
  test(`@smoke portfolio selected holding technical evidence and scope reset at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const portfolios = [{ id: "p1", name: "Core", currency: "USD", description: "Long-term research", total_value: 1000 }, { id: "p2", name: "Other", currency: "EUR", description: "Separate holdings", total_value: 100 }];
    const holdings = ["AAPL", "BTC-USD", "SPY", "QQQ"].map((symbol, index) => ({ id: `h${index}`, symbol, shares: 1, cost_basis_per_share: 100, cost_basis_currency: "USD", currency: "USD", purchase_date: "2026-01-01" }));
    let calls = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = { items: [] };
      if (path.endsWith("/attribution")) {
        await route.fulfill({ status: 503, json: { detail: "Attribution is outside this technical-evidence fixture." } }); return;
      }
      if (path.endsWith("/p2/analytics/risk-metrics")) {
        await route.fulfill({ status: 503, json: { detail: "Portfolio risk history unavailable in this case." } }); return;
      }
      if (path.endsWith("/ai/insights/stream")) {
        calls++;
        expect(route.request().postDataJSON()).toMatchObject({ kind: "risk", payload: { portfolio_id: "p1", technical_symbols: ["AAPL", "BTC-USD"] } });
        const result = portfolioInsight(calls === 2 ? "partial" : calls === 3 ? "unavailable" : calls === 4 ? "modelFailure" : "complete");
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "start", model_profile: result.model_profile, deadlines: { operation_seconds: 300 } }, { type: "result", result },
        ].map((event) => JSON.stringify(event)).join("\n") + "\n" }); return;
      }
      if (path === "/api/portfolios") data = { items: portfolios };
      if (/\/portfolios\/p[12]\/holdings$/.test(path)) data = { items: path.includes("/p1/") ? holdings : [holdings[2]] };
      if (/\/portfolios\/p[12]\/analytics$/.test(path)) data = { allocation_by_sector: [], total_value: 1000 };
      if (path.endsWith("/analytics/risk-metrics")) data = { sharpe_ratio: .8, max_drawdown: -.1 };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto("/equity/portfolio");
    const scope = page.getByRole("group", { name: "Optional holding technical context · up to 3 symbols" });
    await expect(scope).toBeEnabled();
    const card = page.getByText("AI Risk Assessment", { exact: true }).locator("xpath=ancestor::section[1]");
    await expect(card.getByRole("button", { name: "Generate", exact: true })).toBeEnabled(); expect(calls).toBe(0);
    await scope.getByRole("button", { name: "AAPL", exact: true }).click();
    await scope.getByRole("button", { name: "BTC-USD", exact: true }).click();
    await card.getByRole("button", { name: "Generate", exact: true }).click();
    const evidence = card.getByRole("region", { name: "Portfolio technical evidence" });
    await expect(evidence).toContainText("Selected holdings · 2 of 4 held symbols · available");
    await card.getByRole("button", { name: "Inspect H2.1 technical evidence", exact: true }).click();
    await expect(card.getByRole("region", { name: "H2.1 technical evidence", exact: true })).toBeFocused();
    await expect(evidence).toContainText("single-asset volatility is not portfolio risk");
    await evidence.getByText("Supporting adjusted closes (21)", { exact: true }).last().click();
    await expect(evidence.getByRole("table", { name: "BTC-USD technical supporting closes" })).toBeVisible();
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("portfolio-technical.png"), fullPage: true });
    await card.getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(evidence).toContainText("partial observations");
    await card.getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(evidence).toContainText("Selected holdings · 2 of 4 held symbols · unavailable");
    await card.getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(card).toContainText("No partial analysis was published");
    await expect(evidence).toContainText("Selected holdings · 2 of 4 held symbols · available");
    await scope.getByRole("button", { name: "BTC-USD", exact: true }).click();
    await expect(evidence).toHaveCount(0); expect(calls).toBe(4);
    await page.getByRole("button", { name: /^Other/ }).click();
    await expect(scope).toContainText("0 of 1 held symbols selected");
    await expect(scope.getByRole("button", { name: "AAPL", exact: true })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Generate", exact: true })).toBeDisabled();
    await scope.getByRole("button", { name: "SPY", exact: true }).click();
    await expect(card.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();
    expect(calls).toBe(4);
  });
}
