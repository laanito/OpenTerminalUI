import { expect, test } from "@playwright/test";
import { researchInsight } from "../../src/__tests__/fixtures/researchTechnicalContext";

for (const width of [1440, 390]) {
  test(`@smoke instrument research technical evidence and degradation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => localStorage.setItem("stock-state", JSON.stringify({
      state: { ticker: "BTC-USD", interval: "1d", range: "1y" }, version: 0,
    })));
    const calls: string[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/ai/insights/stream")) {
        const request = route.request().postDataJSON();
        expect(request.payload.ticker).toBe("BTC-USD"); calls.push(request.kind);
        const result = researchInsight(calls.length === 2 ? "cryptoPartial" : calls.length === 3 ? "cryptoUnavailable" : "crypto");
        if (calls.length === 1) result.sections[1].points = ["A competing interpretation uses this input [TECH1]."];
        if (request.kind === "interrogate") Object.assign(result, { note_count: 2, related_count: 1 });
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "start", model_profile: result.model_profile, deadlines: { operation_seconds: 300 } },
          { type: "result", result },
        ].map((event) => JSON.stringify(event)).join("\n") + "\n" });
      } else await route.fulfill({ contentType: "application/json", body: JSON.stringify(path === "/api/notes" ? [] : { items: [] }) });
    });
    await page.goto("/equity/stocks");
    const briefing = page.getByText("AI Investment Briefing", { exact: true }).locator("xpath=ancestor::section[1]");
    await expect(briefing).toBeVisible(); expect(calls).toEqual([]);
    await briefing.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(briefing).toContainText("Technical context supplied for BTC-USD: three available observations");
    const citations = briefing.getByRole("button", { name: "Inspect TECH1 technical evidence", exact: true });
    await citations.first().click();
    const metric = briefing.getByRole("region", { name: "TECH1 technical evidence", exact: true });
    await expect(metric).toBeFocused(); await expect(metric).toContainText("20-close moving-average gap");
    await expect(briefing).toContainText("bar completion are unverified");
    await briefing.getByText("Supporting adjusted closes (21)", { exact: true }).click();
    await expect(briefing.getByRole("table", { name: "BTC-USD technical supporting closes" })).toBeVisible();
    await briefing.getByText("Inspect technical evidence", { exact: true }).click();
    await citations.last().click(); await expect(metric).toBeFocused(); await expect(metric).toBeVisible();
    expect(await briefing.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("research-technical.png"), fullPage: true });
    await briefing.getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(briefing).toContainText("partial observations");
    await briefing.getByText("Inspect technical evidence", { exact: true }).click();
    await expect(briefing.getByRole("region", { name: "TECH2 technical evidence", exact: true })).toContainText("Requires 21 closes; 20 available");
    await briefing.getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(briefing).toContainText("Technical context supplied for BTC-USD: unavailable");
    await expect(briefing).toContainText("other supplied facts remain useful");
    await expect(briefing.getByRole("button", { name: "Inspect TECH1 technical evidence" })).toHaveCount(0);
    const interrogate = page.getByText("Interrogate this Coin", { exact: true }).locator("xpath=ancestor::section[1]");
    await interrogate.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(interrogate).toContainText("Grounded in 2 of your notes");
    await interrogate.getByRole("button", { name: "Inspect TECH1 technical evidence", exact: true }).click();
    await expect(interrogate.getByRole("region", { name: "TECH1 technical evidence", exact: true })).toBeFocused();
    expect(calls).toEqual(["briefing", "briefing", "briefing", "interrogate"]);
  });
}
