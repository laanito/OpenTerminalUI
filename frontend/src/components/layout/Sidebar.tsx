import { NavLink } from "react-router-dom";
import { useStockStore } from "../../store/stockStore";
import logo from "../../assets/logo.png";
import { useAlertsStore } from "../../store/alertsStore";
import { PRIMARY_NAV_ITEMS } from "./navigation";
import { UserAccountPanel } from "./UserAccountPanel";

export function Sidebar() {
  const ticker = useStockStore((s) => s.ticker);
  const unreadCount = useAlertsStore((s) => s.unreadCount);
  return (
    <aside className="relative z-30 flex h-full w-48 shrink-0 flex-col border-r border-terminal-border bg-terminal-panel p-0">
      <div className="border-b border-terminal-border bg-terminal-panel px-3 py-2">
        <img src={logo} alt="OpenTerminalUI" className="h-8 w-auto object-contain" />
      </div>
      <div className="border-b border-terminal-border px-3 py-2 text-[11px] text-terminal-muted">
        EQUITY ANALYTICS
      </div>
      <div className="space-y-1 border-b border-terminal-border p-2 text-xs">
        <NavLink to="/" className="block rounded px-2 py-2 text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text">
          Home
        </NavLink>
        <NavLink
          to={`/fno?symbol=${encodeURIComponent((ticker || "SPY").toUpperCase())}`}
          className="block rounded px-2 py-2 text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text"
        >
          Switch To F&O {"->"}
        </NavLink>
      </div>
      <nav className="flex-1 space-y-1 overflow-auto p-2 text-xs">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            title={item.configuration?.detail}
            aria-label={item.configuration ? `${item.label}. Configuration: ${item.configuration.detail}` : item.label}
            className={({ isActive }) =>
              `flex cursor-pointer items-center justify-between rounded px-2 py-2 ${
                isActive
                  ? "bg-terminal-accent/20 text-terminal-accent"
                  : "text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text"
              }`
            }
          >
            <div className="flex flex-col">
              <span>{item.label}</span>
              {item.hint && <span className="text-[8px] text-terminal-accent/70 -mt-0.5 uppercase">{item.hint}</span>}
            </div>
            <div className="flex flex-col items-end gap-0.5 text-[10px]">
              <span>{item.path === "/equity/alerts" && unreadCount > 0 ? `${unreadCount}` : item.key}</span>
              {item.configuration ? (
                <span className="text-[8px] uppercase text-terminal-warn">{item.configuration.label}</span>
              ) : null}
            </div>
          </NavLink>
        ))}
      </nav>
      <UserAccountPanel />
    </aside>
  );
}
