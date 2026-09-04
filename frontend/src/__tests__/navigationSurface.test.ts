import { describe, expect, it } from "vitest";

import { HIDDEN_COMPATIBILITY_ROUTES, PRIMARY_NAV_ITEMS } from "../components/layout/navigation";

describe("primary navigation surface", () => {
  it("does not advertise routes whose production data contract is empty", () => {
    const visible = new Set(PRIMARY_NAV_ITEMS.map((item) => item.path));

    for (const route of HIDDEN_COMPATIBILITY_ROUTES) {
      expect(visible.has(route.path), route.path).toBe(false);
      expect(route.reason.length).toBeGreaterThan(20);
    }
  });

  it("keeps useful configuration-gated alternatives visible", () => {
    const byPath = new Map(PRIMARY_NAV_ITEMS.map((item) => [item.path, item]));

    expect(byPath.get("/equity/yield-curve")?.state).toBe("configuration-gated");
    expect(byPath.get("/equity/dom")?.state).toBe("configuration-gated");
    expect(byPath.get("/equity/commodities")?.state).toBe("configuration-gated");
    expect(byPath.get("/equity/economics")?.state).toBe("configuration-gated");
    expect(
      PRIMARY_NAV_ITEMS.filter((item) => item.state === "configuration-gated").every(
        (item) => item.configuration?.label && item.configuration.detail.length > 30,
      ),
    ).toBe(true);
  });

  it("publishes no unresolved experimental destinations", () => {
    const byPath = new Map(PRIMARY_NAV_ITEMS.map((item) => [item.path, item]));

    expect(PRIMARY_NAV_ITEMS.every((item) => item.state === "supported" || item.state === "configuration-gated")).toBe(true);
    expect(byPath.get("/equity/etf-analytics")?.state).toBe("supported");
    expect(byPath.get("/equity/stat-lab")?.state).toBe("supported");
    expect(byPath.get("/equity/pair-trading")?.state).toBe("supported");
    expect(PRIMARY_NAV_ITEMS.some((item) => item.path.includes("model-lab"))).toBe(false);
    expect(PRIMARY_NAV_ITEMS.some((item) => item.path.includes("portfolio/lab"))).toBe(false);
  });

  it("uses unique paths", () => {
    const paths = PRIMARY_NAV_ITEMS.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
