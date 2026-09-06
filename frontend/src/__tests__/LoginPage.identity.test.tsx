import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "../pages/LoginPage";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ login: vi.fn(), isLoading: false }),
}));

vi.mock("../components/MarketTicker", () => ({ MarketTicker: () => null }));
vi.mock("../components/StatusBar", () => ({ StatusBar: () => null }));

describe("LoginPage project identity", () => {
  beforeEach(() => {
    vi.stubGlobal("__APP_VERSION__", "1.5.7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the build version and canonical fork repository", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/v1\.5\.7/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "github.com/laanito/OpenTerminalUI" })).toHaveAttribute(
      "href",
      "https://github.com/laanito/OpenTerminalUI",
    );
  });
});
