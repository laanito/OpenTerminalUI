import { expect, it } from "vitest";
import { portfolioAllocation } from "../components/portfolio/PortfolioAllocation";
import type { ConsolidatedPortfolioReport } from "../api/client";
import { portfolioReportFixture } from "../../tests/e2e/portfolio-fixtures";
const report = () => portfolioReportFixture("all", "EUR") as unknown as ConsolidatedPortfolioReport;

it("uses the selected report currency and current value instead of quantities or native sums", () => {
  const data = report();
  const allocation = portfolioAllocation(data);
  expect(allocation.holdings).toEqual([{ name: "AAPL · NASDAQ · USD", value: 900 }]);
  expect(allocation.sectors).toEqual([{ name: "Technology", value: 900 }]);
});

it("does not normalize known components into a misleading full pie", () => {
  const data = report(); data.metrics.market_value.value = null;
  expect(portfolioAllocation(data)).toMatchObject({ sectors: null, holdings: [], reason: expect.stringContaining("No partial") });
});

it("retains usable holdings allocation when sector coverage or currency is inconsistent", () => {
  const data = report(); data.portfolios[0].accounting.base_currency = "USD";
  expect(portfolioAllocation(data)).toMatchObject({ sectors: null, holdings: [{ value: 900 }] });
  data.portfolios[0].accounting.base_currency = "EUR";
  data.portfolios[0].accounting.allocation_by_sector = [];
  expect(portfolioAllocation(data).sectors).toBeNull();
});

it("can show current allocation with unavailable cost and keeps Unknown sectors explicit", () => {
  const data = report(); data.metrics.cost_basis.value = null;
  data.portfolios.forEach(p => { p.accounting.allocation_by_sector[0].name = "Unknown"; });
  expect(portfolioAllocation(data).sectors).toEqual([{ name: "Unknown", value: 900 }]);
});
