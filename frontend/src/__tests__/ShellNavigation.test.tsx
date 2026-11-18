import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ShellNavigation, shellNavigationGroups } from "../components/layout/ShellNavigation";
import { HIDDEN_COMPATIBILITY_ROUTES, PRIMARY_NAV_ITEMS } from "../components/layout/navigation";

describe("grouped shell navigation", () => {
  it("preserves every retained primary destination exactly once without promoting hidden routes", () => {
    const paths = shellNavigationGroups().flatMap(group => group.items.map(item => item.path));
    expect(new Set(paths).size).toBe(paths.length);
    for (const item of PRIMARY_NAV_ITEMS) expect(paths).toContain(item.path);
    for (const item of HIDDEN_COMPATIBILITY_ROUTES) expect(paths).not.toContain(item.path);
    for (const path of ["/home", "/equity/notes", "/equity/saved-views", "/account"]) expect(paths).toContain(path);
  });
  it("keeps configuration disclosures and unambiguous chart comparison links", () => {
    render(<MemoryRouter><ShellNavigation open onClose={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Chart compare" })).toHaveAttribute("href", "/equity/compare");
    expect(screen.getByRole("link", { name: /Economics.*FRED/ })).toHaveTextContent("FRED_API_KEY");
    expect(screen.getByRole("link", { name: "Notes" })).toHaveAttribute("href", "/equity/notes");
  });
});
