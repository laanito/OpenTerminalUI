import { beforeEach, describe, expect, it, vi } from "vitest";

import { addWatchlistItem, fetchWatchlist } from "../api/watchlist";
import type { Watchlist } from "../types";

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock("../api/base", () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

const watchlists: Watchlist[] = [
  {
    id: "default-id",
    name: "Default Watchlist",
    symbols: ["AAPL", "MSFT"],
    column_config: {},
    created_at: "2026-09-03T00:00:00Z",
  },
  {
    id: "ideas-id",
    name: "Ideas",
    symbols: ["TSLA"],
    column_config: {},
    created_at: "2026-09-03T00:00:00Z",
  },
];

describe("owner-scoped watchlist compatibility helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockResolvedValue({ data: watchlists });
    apiPostMock.mockResolvedValue({ data: watchlists[0] });
  });

  it("flattens the canonical per-user watchlists for existing UI consumers", async () => {
    await expect(fetchWatchlist()).resolves.toEqual([
      { id: "default-id:AAPL", watchlist_name: "Default Watchlist", ticker: "AAPL" },
      { id: "default-id:MSFT", watchlist_name: "Default Watchlist", ticker: "MSFT" },
      { id: "ideas-id:TSLA", watchlist_name: "Ideas", ticker: "TSLA" },
    ]);
    expect(apiGetMock).toHaveBeenCalledWith("/watchlists");
  });

  it("maps legacy-style add actions to a canonical owned watchlist", async () => {
    await addWatchlistItem({ watchlist_name: "Default", ticker: "aapl" });

    expect(apiGetMock).toHaveBeenCalledWith("/watchlists");
    expect(apiPostMock).toHaveBeenCalledWith("/watchlists/default-id/symbols", ["aapl"]);
    expect(apiPostMock).not.toHaveBeenCalledWith("/watchlists/items", expect.anything());
  });
});
