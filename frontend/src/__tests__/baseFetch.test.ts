import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchApi, setAccessTokenGetter, setRefreshHandler } from "../api/base";

describe("fetchApi", () => {
  afterEach(() => {
    setAccessTokenGetter(null);
    setRefreshHandler(null);
    vi.unstubAllGlobals();
  });

  it("uses bearer auth and retries once with a refreshed token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    setAccessTokenGetter(() => "expired-token");
    setRefreshHandler(async () => "fresh-token");

    const response = await fetchApi("/brain/ask/stream", { method: "POST" });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.get("Authorization")).toBe(
      "Bearer expired-token",
    );
    expect(fetchMock.mock.calls[1][1].headers.get("Authorization")).toBe(
      "Bearer fresh-token",
    );
  });
});
