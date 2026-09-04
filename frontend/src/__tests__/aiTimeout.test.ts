import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/base";
import { fetchCollectionBriefing } from "../api/sentiment";

vi.mock("../api/base", () => ({
  api: { post: vi.fn() },
}));

describe("AI request deadlines", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockResolvedValue({ data: { engine: "llm", summary: "ok", sections: [] } });
  });

  it("keeps collection briefings alive beyond the backend model timeout", async () => {
    const facts = [{ symbol: "SPY", price: 6500, change_pct: 0.2 }];
    await fetchCollectionBriefing(["SPY", "QQQ"], "global markets", facts);

    expect(api.post).toHaveBeenCalledWith(
      "/ai/collection-briefing",
      { symbols: ["SPY", "QQQ"], scope: "global markets", facts },
      { timeout: 300_000 },
    );
  });
});
