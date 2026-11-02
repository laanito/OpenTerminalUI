import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`@smoke longer shared insights survive browser validation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => localStorage.setItem("stock-state", JSON.stringify({
      state: { ticker: "BTC-USD", interval: "1d", range: "1y" }, version: 0,
    })));
    const profile = { requested_profile: "deep", resolved_profile: "deep", model: "fixture-deep-model" };
    const summary = "The supplied evidence supports a conditional interpretation, with important uncertainty still unresolved. ".repeat(10).trim();
    const point = "Recent observations may support the thesis, but cannot establish its mechanism or predict the next price movement. ".repeat(8).trim();
    const calls: string[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/ai/insights/stream")) {
        calls.push(route.request().postDataJSON().kind);
        const result = {
          engine: "llm", model: profile.model, model_profile: profile, summary,
          sections: [
            { title: "Observed evidence and the limits of its possible interpretation", tone: "neutral", points: [calls.length === 2 ? "x".repeat(2001) : point] },
            { title: "Risks", tone: "negative", points: ["Important evidence remains unavailable."] },
          ],
        };
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "start", model_profile: profile, deadlines: { operation_seconds: 300 } },
          { type: "result", result },
        ].map((event) => JSON.stringify(event)).join("\n") + "\n" });
      } else {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(path === "/api/notes" ? [] : { items: [] }) });
      }
    });
    await page.goto("/equity/stocks");
    const briefing = page.getByText("AI Investment Briefing", { exact: true }).locator("xpath=ancestor::section[1]");
    await expect(briefing).toBeVisible(); expect(calls).toEqual([]);
    await briefing.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(briefing.getByText(summary, { exact: true })).toBeVisible();
    await expect(briefing.getByText(point, { exact: true })).toBeVisible();
    await expect(briefing).toContainText("Deep profile · fixture-deep-model");
    await expect(briefing).not.toContainText("Could not generate AI analysis");
    expect(await briefing.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await briefing.getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(briefing).toContainText("Could not generate AI analysis");
    await expect(briefing.getByText(summary, { exact: true })).toHaveCount(0);
    expect(calls).toEqual(["briefing", "briefing"]);
    await briefing.getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(briefing.getByText(point, { exact: true })).toBeVisible();
    const interrogation = page.getByText("Interrogate this Coin", { exact: true }).locator("xpath=ancestor::section[1]");
    await interrogation.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(interrogation.getByText(point, { exact: true })).toBeVisible();
    expect(calls).toEqual(["briefing", "briefing", "briefing", "interrogate"]);
  });
}
