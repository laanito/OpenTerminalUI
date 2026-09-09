import fs from "node:fs";
import path from "node:path";

import { expect, test, type Route } from "@playwright/test";

type BacktestFixture = {
  submit: Record<string, unknown>;
  status: Record<string, unknown>;
  result: Record<string, unknown>;
  analytics: Record<string, unknown>;
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "*",
};

async function fulfillJson(route: Route, body: unknown) {
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  await route.fulfill({
    status: 200,
    headers: corsHeaders,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("@smoke backtesting submits a deterministic job and loads result analytics", async ({ page }) => {
  const fixturePath = path.resolve(process.cwd(), "tests/e2e/fixtures/backtest-result.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as BacktestFixture;
  let submittedPayload: Record<string, unknown> | null = null;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (request.method() === "OPTIONS") {
      await fulfillJson(route, {});
    } else if (pathname.endsWith("/data/version/active")) {
      await fulfillJson(route, { id: "e2e-data-version", name: "E2E snapshot" });
    } else if (pathname.endsWith("/v1/backtest/submit")) {
      submittedPayload = request.postDataJSON() as Record<string, unknown>;
      await fulfillJson(route, fixture.submit);
    } else if (pathname.includes("/v1/backtest/status/")) {
      await fulfillJson(route, fixture.status);
    } else if (pathname.includes("/v1/backtest/result/")) {
      await fulfillJson(route, fixture.result);
    } else if (pathname.includes("/backtests/") && pathname.endsWith("/analytics")) {
      await fulfillJson(route, fixture.analytics);
    } else if (pathname.endsWith("/v1/backtest/validate/walkforward")) {
      await fulfillJson(route, { validation: { windows: [] } });
    } else if (pathname.endsWith("/v1/backtest/optimize")) {
      await fulfillJson(route, { optimization: { trials: [] } });
    } else if (pathname.endsWith("/search")) {
      await fulfillJson(route, { results: [] });
    } else {
      await fulfillJson(route, { items: [] });
    }
  });

  await page.goto("/backtesting", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Run a backtest to load charts and result analytics.")).toBeVisible();
  await page.getByRole("combobox", { name: "Model", exact: true }).selectOption("premarket_orb_breakout");
  await page.getByRole("button", { name: "Run", exact: true }).click();

  await expect.poll(() => submittedPayload).toMatchObject({
    symbol: "AAPL",
    market: "NASDAQ",
    strategy: "example:premarket_orb_breakout",
  });
  await expect(page.getByText("Status: DONE")).toBeVisible();
  await expect(page.getByText("12.00%", { exact: true }).first()).toBeVisible();

  const vizPanel = page
    .locator("section")
    .filter({ has: page.locator(".ot-type-panel-title", { hasText: "Backtest Visualizations" }) })
    .first();
  await expect(vizPanel.getByRole("button", { name: /^Equity Curve$/ })).toBeVisible();
  await vizPanel.getByRole("button", { name: /^Equity Curve$/ }).click();
  await expect(vizPanel.locator("svg").first()).toBeVisible();

  await vizPanel.getByRole("button", { name: /^Trade Analysis$/ }).click();
  await expect(vizPanel.getByText("Win Rate: 100.00%", { exact: true })).toBeVisible();
  await expect(page.getByText("Return Distribution", { exact: true })).toBeVisible();
  await expect(page.getByText("Run a backtest to load charts and result analytics.")).toHaveCount(0);
});
