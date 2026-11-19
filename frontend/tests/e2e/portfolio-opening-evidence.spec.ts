import { expect, test } from "@playwright/test";
import { portfolioCatalog, portfolioReportFixture } from "./portfolio-fixtures";

for (const width of [1440, 390]) {
  test(`@smoke unknown opening, independent entry value and audited same-repair retry at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    let created: any = null, repaired = false;
    const repairs: any[] = [];
    let evidence: any = null;
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.pathname === "/api/portfolios") return route.fulfill({ json: { items: portfolioCatalog } });
      if (url.pathname.includes("/analytics/") || url.pathname.endsWith("/attribution")) return route.fulfill({ status: 503, json: { detail: "Optional analytics unavailable" } });
      if (url.pathname === "/api/portfolios/report") {
        const report: any = portfolioReportFixture("p1");
        if (created) {
          const lot = report.positions[0].lots[0];
          lot.opening = evidence.opening; lot.opening_transaction_id = created.operation_id;
          lot.cost_basis_per_share = repaired ? 120 : null; lot.cost_basis_currency = repaired ? "USD" : null;
          if (!repaired) {
            lot.accounting.cost_basis_native.amount = null; lot.accounting.cost_basis_base = null; lot.accounting.unrealized_pnl_base = null;
            for (const metric of [report.metrics.cost_basis, report.metrics.unrealized_pnl]) Object.assign(metric, { value: null, known_value: 0, complete_items: 0, status: "unavailable" });
          }
        }
        return route.fulfill({ json: report });
      }
      if (url.pathname.endsWith("/transactions") && method === "POST") {
        created = route.request().postDataJSON();
        evidence = { transaction_id: created.operation_id, portfolio_id: "p1", symbol: "AAPL", shares: 2, observed_date: created.date,
          price: null, currency: null, opening: created.opening, evidence_revision: 0, evidence_history: [], applied_repairs: [] };
        return route.fulfill({ json: { id: created.operation_id, status: "created" } });
      }
      if (url.pathname.endsWith("/opening-evidence")) {
        expect(url.pathname).toBe(`/api/portfolios/p1/transactions/${created.operation_id}/opening-evidence`);
        if (method === "GET") return route.fulfill({ json: evidence });
        const payload = route.request().postDataJSON(); repairs.push(payload);
        if (repairs.length === 1) return route.abort("failed");
        evidence = { ...evidence, ...payload, evidence_revision: 1,
          evidence_history: [{ price: null, currency: null, opening: created.opening, revision: 0, repaired_at: "2026-11-19T10:00:00Z", reason: payload.reason }],
          applied_repairs: [{ repair_id: payload.repair_id, revision: 1, recorded_at: "2026-11-19T10:00:00Z" }] };
        repaired = true;
        return route.fulfill({ json: { id: created.operation_id, status: "updated", evidence_revision: 1 } });
      }
      if (url.pathname.endsWith("/transactions")) return route.fulfill({ json: { items: created ? [{ ...created, id: created.operation_id, operation_data: { opening: evidence.opening } }] : [] } });
      return route.fulfill({ json: { items: [], results: [] } });
    });
    await page.goto("/equity/portfolio?reporting_currency=USD");
    await page.getByRole("button", { name: "Add existing position", exact: true }).click();
    const opening = page.getByRole("dialog", { name: "Add an existing position", exact: true });
    await opening.getByLabel("Target portfolio").selectOption("p1");
    await opening.getByLabel("Symbol", { exact: true }).fill("AAPL");
    await opening.getByLabel("Quantity", { exact: true }).fill("2");
    await opening.getByLabel("Cost basis unknown", { exact: true }).check();
    await expect(opening.getByLabel("Documented cost per unit")).toHaveCount(0);
    await opening.getByLabel("Present in portfolio as of").fill("2026-11-10");
    await opening.getByLabel("Acquisition source / provenance").fill("Transfer statement; original cost pending");
    await opening.getByLabel("Total contribution value at entry (optional)").fill("400");
    await opening.getByRole("button", { name: "Review operation" }).click();
    await expect(opening).toContainText("Cost basis unknown");
    await expect(opening).toContainText("400 USD");
    await opening.getByRole("button", { name: "Confirm operation" }).click();
    await expect(opening).toHaveCount(0);
    expect(created).toMatchObject({ price: null, currency: null, opening: { basis_status: "unknown", acquisition_date: null, contribution_value: 400 } });
    await expect(page.getByRole("region", { name: "Unrealized P&L", exact: true })).toContainText("Unavailable");
    await expect(page.getByRole("region", { name: "Holdings value", exact: true })).toContainText("$400.00");
    await page.getByRole("region", { name: "Consolidated holdings", exact: true }).locator("summary").click();
    await page.getByRole("button", { name: "Opening evidence", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Opening evidence", exact: true });
    await expect(dialog.getByLabel("Cost basis unknown", { exact: true })).toBeChecked();
    await dialog.getByLabel("Cost basis unknown", { exact: true }).uncheck();
    await dialog.getByLabel("Documented cost per unit").fill("120");
    await dialog.getByRole("combobox", { name: "Cost currency", exact: true }).selectOption("USD");
    await dialog.getByLabel("Documented acquisition date").fill("2026-01-02");
    await dialog.getByLabel("Acquisition source / provenance").fill("Recovered original statement");
    await dialog.getByLabel("Repair reason").fill("Original cost records recovered");
    await page.screenshot({ path: testInfo.outputPath("opening-evidence-repair.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Review evidence repair" }).click();
    await dialog.getByRole("button", { name: "Confirm evidence repair" }).dblclick();
    await expect(dialog.getByRole("alert")).toContainText("not confirmed");
    expect(repairs).toHaveLength(1);
    await dialog.getByRole("button", { name: "Retry same repair" }).click();
    await expect(dialog).toHaveCount(0);
    expect(repairs).toHaveLength(2); expect(repairs[0]).toEqual(repairs[1]);
    expect(repairs[1]).toMatchObject({ expected_revision: 0, price: 120, currency: "USD", opening: { contribution_value: 400 } });
    await page.getByText("All movements", { exact: true }).click();
    const movements = page.getByRole("region", { name: "All movements table", exact: true });
    await movements.getByRole("button", { name: "Opening evidence", exact: true }).click();
    await expect(dialog).toContainText("revision 1");
    await dialog.getByText("Earlier evidence (1)", { exact: true }).click();
    await expect(dialog).toContainText("Unknown basis");
    await expect(dialog).toContainText("Original cost records recovered");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
