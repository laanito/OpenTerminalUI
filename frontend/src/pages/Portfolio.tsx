import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { addMutualFundHolding, searchMutualFunds } from "../api/client";
import { MutualFundPortfolioSection } from "../components/mutualFunds/MutualFundPortfolioSection";
import { PortfolioManager } from "../components/portfolio/PortfolioManager";
import { SavedViewsControl } from "../components/savedViews/SavedViewsControl";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import type { MutualFund } from "../types";
import { consumePendingSavedView } from "../workspace/savedViewRestore";

// The equity portfolio is now the per-user Portfolio Manager (multi-portfolio,
// cash ledger, realized/unrealized P&L, ported analytics). The old global,
// shared-across-users "legacy" view and its manager|legacy toggle were retired
// in v1.1 (part C) — see PortfolioManager. This page only chooses between the
// equity Manager and the mutual-funds sub-portfolio.
export function PortfolioPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [portfolioMode, setPortfolioMode] = useState<"equity" | "mutual_funds">(
    () => (searchParams.get("mode") === "mutual_funds" ? "mutual_funds" : "equity"),
  );

  const [mfSchemeCode, setMfSchemeCode] = useState("");
  const [mfSchemeName, setMfSchemeName] = useState("");
  const [mfFundHouse, setMfFundHouse] = useState("");
  const [mfCategory, setMfCategory] = useState("");
  const [mfUnits, setMfUnits] = useState(10);
  const [mfAvgNav, setMfAvgNav] = useState(10);
  const [mfSuggestions, setMfSuggestions] = useState<MutualFund[]>([]);
  const [mfSuggestionsOpen, setMfSuggestionsOpen] = useState(false);
  const [mfRefreshToken, setMfRefreshToken] = useState(0);
  const [mfError, setMfError] = useState<string | null>(null);
  const [mfMessage, setMfMessage] = useState<string | null>(null);

  useEffect(() => {
    const payload = consumePendingSavedView(window.location.pathname);
    if (!payload) return;
    const filters = payload.filters ?? {};
    if (filters.portfolioMode === "equity" || filters.portfolioMode === "mutual_funds") setPortfolioMode(filters.portfolioMode);
  }, []);

  useEffect(() => {
    setPortfolioMode(searchParams.get("mode") === "mutual_funds" ? "mutual_funds" : "equity");
  }, [searchParams]);

  const switchPortfolioMode = useCallback((mode: "equity" | "mutual_funds") => {
    setPortfolioMode(mode);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (mode === "mutual_funds") next.set("mode", "mutual_funds");
      else next.delete("mode");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (portfolioMode !== "mutual_funds") return;
    const q = mfSchemeCode.trim();
    if (q.length < 2) {
      setMfSuggestions([]);
      setMfSuggestionsOpen(false);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const items = await searchMutualFunds(q);
        setMfSuggestions(items.slice(0, 12));
        setMfSuggestionsOpen(items.length > 0);
      } catch {
        setMfSuggestions([]);
        setMfSuggestionsOpen(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [mfSchemeCode, portfolioMode]);

  const pickMfSuggestion = (item: MutualFund) => {
    setMfSchemeCode(String(item.scheme_code));
    setMfSchemeName(item.scheme_name || "");
    setMfFundHouse(item.fund_house || "");
    setMfCategory(item.scheme_sub_category || item.scheme_category || "");
    if (Number.isFinite(Number(item.nav)) && Number(item.nav) > 0) {
      setMfAvgNav(Number(item.nav));
    }
    setMfSuggestionsOpen(false);
  };

  if (portfolioMode === "mutual_funds") {
    return (
      <div className="space-y-3 p-4">
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Portfolio</div>
            <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[11px] text-terminal-muted">
              Mode: Mutual Funds
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            <button className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted" onClick={() => switchPortfolioMode("equity")}>
              Equity
            </button>
            <button className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent">
              Mutual Funds
            </button>
            <Link className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent" to="/equity/portfolio/lab">
              Open Portfolio Lab
            </Link>
          </div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-panel p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Add Mutual Fund Holding</div>
            <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[11px] text-terminal-muted">
              Portfolio: Mutual Funds
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Scheme Code</label>
              <div className="relative">
                <TerminalInput
                  className="w-full text-xs"
                  value={mfSchemeCode}
                  onChange={(e) => setMfSchemeCode(e.target.value)}
                  onFocus={() => {
                    if (mfSuggestions.length > 0) setMfSuggestionsOpen(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => setMfSuggestionsOpen(false), 120);
                  }}
                />
                {mfSuggestionsOpen && mfSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-8 z-10 max-h-64 overflow-auto rounded-sm border border-terminal-border bg-terminal-panel shadow-lg">
                    {mfSuggestions.map((item) => (
                      <button
                        key={item.scheme_code}
                        className="block w-full border-b border-terminal-border px-2 py-1 text-left hover:bg-terminal-bg"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickMfSuggestion(item);
                        }}
                      >
                        <div className="text-xs text-terminal-text">
                          {item.scheme_code} | {item.scheme_name}
                        </div>
                        <div className="text-[10px] text-terminal-muted">
                          {item.fund_house || "Unknown Fund House"} | {item.scheme_sub_category || item.scheme_category || "Other"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Scheme Name</label>
              <TerminalInput className="w-full text-xs" value={mfSchemeName} onChange={(e) => setMfSchemeName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Fund House</label>
              <TerminalInput className="w-full text-xs" value={mfFundHouse} onChange={(e) => setMfFundHouse(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Category</label>
              <TerminalInput className="w-full text-xs" value={mfCategory} onChange={(e) => setMfCategory(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Units</label>
              <TerminalInput className="w-full text-xs" type="number" value={mfUnits} onChange={(e) => setMfUnits(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Avg NAV</label>
              <TerminalInput className="w-full text-xs" type="number" value={mfAvgNav} onChange={(e) => setMfAvgNav(Number(e.target.value))} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Action</label>
              <TerminalButton
                variant="accent"
                className="w-full justify-center"
                onClick={async () => {
                  setMfError(null);
                  setMfMessage(null);
                  if (!mfSchemeCode.trim() || !/^\d+$/.test(mfSchemeCode.trim())) {
                    setMfError("Enter a valid numeric scheme code.");
                    return;
                  }
                  if (!Number.isFinite(mfUnits) || mfUnits <= 0 || !Number.isFinite(mfAvgNav) || mfAvgNav <= 0) {
                    setMfError("Units and Avg NAV must be greater than 0.");
                    return;
                  }
                  try {
                    let resolvedName = mfSchemeName.trim();
                    let resolvedHouse = mfFundHouse.trim();
                    let resolvedCategory = mfCategory.trim();
                    let resolvedAvgNav = mfAvgNav;
                    if (!resolvedName) {
                      const lookup = await searchMutualFunds(mfSchemeCode.trim());
                      const exact = lookup.find((x) => String(x.scheme_code) === mfSchemeCode.trim()) || lookup[0];
                      if (exact) {
                        resolvedName = exact.scheme_name || resolvedName;
                        resolvedHouse = exact.fund_house || resolvedHouse;
                        resolvedCategory = exact.scheme_sub_category || exact.scheme_category || resolvedCategory;
                        if (Number.isFinite(Number(exact.nav)) && Number(exact.nav) > 0) {
                          resolvedAvgNav = Number(exact.nav);
                          setMfAvgNav(resolvedAvgNav);
                        }
                        setMfSchemeName(resolvedName);
                        setMfFundHouse(resolvedHouse);
                        setMfCategory(resolvedCategory);
                      }
                    }
                    if (!resolvedName) {
                      setMfError("Could not resolve scheme details from scheme code. Pick a suggestion first.");
                      return;
                    }
                    await addMutualFundHolding({
                      scheme_code: Number(mfSchemeCode.trim()),
                      scheme_name: resolvedName,
                      fund_house: resolvedHouse || undefined,
                      category: resolvedCategory || undefined,
                      units: mfUnits,
                      avg_nav: resolvedAvgNav,
                    });
                    setMfMessage("Mutual fund holding added.");
                    setMfRefreshToken((n) => n + 1);
                  } catch (e) {
                    setMfError(e instanceof Error ? e.message : "Failed to add mutual fund holding");
                  }
                }}
              >
                Add Holding
              </TerminalButton>
            </div>
            <div />
            <div />
            <div />
            <div />
          </div>
          {mfError && <div className="mt-2 text-xs text-terminal-neg">{mfError}</div>}
          {mfMessage && <div className="mt-2 text-xs text-terminal-pos">{mfMessage}</div>}
        </div>
        <MutualFundPortfolioSection refreshToken={mfRefreshToken} />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Portfolio</div>
          <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[11px] text-terminal-muted">
            Mode: Equity
          </span>
          <SavedViewsControl
            pageLabel="Portfolio"
            capture={() => ({
              filters: { portfolioMode },
              activeTabs: {},
              tableColumns: "portfolio-manager-default",
            })}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <button className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent">
            Equity
          </button>
          <button className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted" onClick={() => switchPortfolioMode("mutual_funds")}>
            Mutual Funds
          </button>
          <Link className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent" to="/equity/portfolio/lab">
            Open Portfolio Lab
          </Link>
        </div>
      </div>
      <PortfolioManager />
    </div>
  );
}
