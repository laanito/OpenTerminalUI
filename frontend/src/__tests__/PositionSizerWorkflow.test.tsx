import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PositionSizerPage } from "../pages/PositionSizerPage";
import { useSettingsStore } from "../store/settingsStore";
beforeEach(() => useSettingsStore.setState({ selectedCountry: "US", displayCurrency: "USD" }));
describe("Readable position sizing", () => {
  it("keeps all four existing calculations available through the labelled method control", () => {
    render(<PositionSizerPage />);
    expect(screen.getByTestId("position-sizer-shares")).toHaveTextContent("200");
    fireEvent.change(screen.getByLabelText("Position sizing method"), { target: { value: "kelly" } });
    expect(screen.getByTestId("position-sizer-shares")).toHaveTextContent("6,500");
    fireEvent.change(screen.getByLabelText("Position sizing method"), { target: { value: "atr" } });
    fireEvent.change(screen.getByLabelText("ATR Value"), { target: { value: "25" } });
    expect(screen.getByTestId("position-sizer-shares")).toHaveTextContent("200");
    fireEvent.change(screen.getByLabelText("Position sizing method"), { target: { value: "volatility" } });
    expect(screen.getByTestId("position-sizer-shares")).toHaveTextContent("240");
  });
  it("exposes calculation errors and preserves typed inputs while invalid", () => {
    render(<PositionSizerPage />); fireEvent.change(screen.getByLabelText("Stop Loss Price"), { target: { value: "2500" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Stop loss must differ from entry."); expect(screen.getByLabelText("Stop Loss Price")).toHaveValue(2500);
    expect(screen.getByTestId("position-sizer-shares")).toHaveTextContent("0");
    fireEvent.change(screen.getByLabelText("Stop Loss Price"), { target: { value: "2450" } }); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("names the existing currency assumption and focuses detailed results on request", () => {
    useSettingsStore.setState({ selectedCountry: "EU", displayCurrency: "EUR" }); render(<PositionSizerPage />);
    expect(screen.getByText(/Amounts use EUR/)).toBeInTheDocument(); expect(screen.getByLabelText("Calculated position size")).toHaveTextContent("€");
    fireEvent.click(screen.getByRole("link", { name: "View sizing results" })); expect(screen.getByRole("region", { name: "Sizing results" })).toHaveFocus();
  });
});
