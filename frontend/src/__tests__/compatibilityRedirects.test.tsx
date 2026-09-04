import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CompatibilityRedirect } from "../components/CompatibilityRedirect";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</div>;
}

function renderRedirect(initialPath: string, from: string, to: string) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path={`${from}/*`} element={<CompatibilityRedirect from={from} to={to} />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("legacy route redirects", () => {
  it("redirects a base alias without requiring a trailing slash", async () => {
    renderRedirect("/model-lab?market=US", "/model-lab", "/backtesting/model-lab");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/backtesting/model-lab?market=US",
    );
  });

  it("preserves Model Lab child paths, queries, and hashes", async () => {
    renderRedirect(
      "/model-lab/runs/run-1?view=metrics#drawdown",
      "/model-lab",
      "/backtesting/model-lab",
    );

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/backtesting/model-lab/runs/run-1?view=metrics#drawdown",
    );
  });

  it("preserves Portfolio Lab child paths and queries", async () => {
    renderRedirect(
      "/portfolio-lab/portfolios/pf-1?tab=holdings",
      "/portfolio-lab",
      "/equity/portfolio/lab",
    );

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/equity/portfolio/lab/portfolios/pf-1?tab=holdings",
    );
  });
});
