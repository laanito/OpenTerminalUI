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
    await fetchCollectionBriefing(["SPY", "QQQ"], "global markets");

    expect(api.post).toHaveBeenCalledWith(
      "/ai/collection-briefing",
      { symbols: ["SPY", "QQQ"], scope: "global markets" },
      { timeout: 300_000 },
    );
  });
});
