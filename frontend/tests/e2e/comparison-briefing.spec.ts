import { expect, test } from "@playwright/test";
import { makeBriefing, makeContextBriefing } from "../../src/__tests__/fixtures/comparisonBriefing";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`@smoke comparison briefing citations and retry at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    let requests = 0;
    await page.route("**/api/**", async (route) => {
      if (new URL(route.request().url()).pathname.endsWith("/market-context/briefing/stream")) {
        requests += 1;
        expect(route.request().postDataJSON()).toEqual({ anchor: "AAPL", comparisons: ["SPY"], period: "1M" });
        const result = makeBriefing();
        if (requests > 1) {
          result.status = "unavailable"; result.engine = "unavailable";
          result.observations = []; result.hypotheses = []; result.limitations = []; result.unknowns = [];
          result.failure = { code: "provider_unavailable", message: "The model could not be reached.", retryable: true };
          result.evidence!.packet_id = "b".repeat(64);
        }
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "start", phase: "queued", deadlines: { evidence_seconds: 45, model_seconds: 240 } },
          { type: "progress", phase: "generating" }, { type: "result", result },
        ].map((event) => JSON.stringify(event) + "\n").join("") });
        return;
      }
      const data = new URL(route.request().url()).pathname.endsWith("/market-context/compare")
        ? { anchor: "AAPL", period: "1M", retrieved_at: "2026-10-20T12:00:00Z", comparisons: [] }
        : { items: [] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto("/equity/market-context?symbol=AAPL&proxies=SPY&period=1M&currency=EUR");
    const generate = page.getByRole("button", { name: "Generate briefing", exact: true });
    await expect(generate).toBeVisible(); expect(requests).toBe(0);
    await generate.click();
    const observation = page.getByText(makeBriefing().observations[0].text, { exact: true });
    await expect(observation).toBeVisible();
    await expect(page.getByRole("region", { name: "Interpretations to investigate" })).toContainText("Competing explanation:");
    await page.getByRole("button", { name: "Inspect P1 for hypothesis 1" }).click();
    await expect(page.getByRole("region", { name: "P1 evidence", exact: true })).toBeFocused();
    await expect(page.getByLabel("Mandatory evidence caveats")).toBeVisible();
    await page.getByRole("button", { name: "Inspect P1 for observed movement 1" }).click();
    const pair = page.getByRole("region", { name: "P1 evidence", exact: true });
    await expect(pair).toBeFocused(); await expect(pair).toContainText("1.2345%");
    await expect(pair).toContainText("2026-09-20 to 2026-10-20");
    await page.screenshot({ path: testInfo.outputPath("briefing-evidence.png"), fullPage: true });
    await page.getByRole("button", { name: "Generate new briefing" }).click();
    await expect(observation).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: "The model could not be reached" })).toBeVisible();
    await page.getByText(/Inspect briefing evidence snapshot/).click();
    await expect(page.getByText(`Snapshot ID: ${"b".repeat(64)}`, { exact: true })).toBeVisible();
    await page.getByLabel("Window", { exact: true }).selectOption("3M");
    await expect(page.getByRole("button", { name: "Generate briefing", exact: true })).toBeDisabled();
    await expect(page.getByText(/Snapshot ID:/)).toHaveCount(0);
    expect(requests).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`@smoke context briefing selection and exact source inspection at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    let requests = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/market-context/briefing-context/stream")) {
        requests += 1;
        const context = { news: requests === 1, macro_regions: ["us", "euro_area"] as ("us" | "euro_area")[] };
        expect(route.request().postDataJSON()).toEqual({ anchor: "AAPL", comparisons: ["SPY"], period: "1M", context });
        const result = makeContextBriefing(context);
        if (requests > 1) {
          const section = result.evidence!.sections[0];
          if (section.kind === "macro") section.series = [];
          section.status = "unavailable"; section.reason = "missing_api_key";
          result.possible_context = result.possible_context.filter((item) => !item.citation_ids.some((ref) => ref.startsWith("C1S")));
          for (const point of result.limitations) point.citation_ids = point.citation_ids.filter((ref) => !ref.startsWith("C1S"));
        }
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "start", deadlines: { evidence_seconds: 45, context_seconds: 40, model_seconds: 240 } },
          { type: "progress", phase: "collecting_context" }, { type: "result", result },
        ].map((event) => JSON.stringify(event) + "\n").join("") });
        return;
      }
      const data = path.endsWith("/market-context/compare")
        ? { anchor: "AAPL", period: "1M", retrieved_at: "2026-10-20T12:00:00Z", comparisons: [] } : { items: [] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto("/equity/market-context?symbol=AAPL&proxies=SPY&period=1M");
    for (const label of ["Dated news headlines", "US macro (FRED)", "Euro-area macro (Eurostat/ECB)"]) {
      await expect(page.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
      await page.getByRole("checkbox", { name: label, exact: true }).check();
    }
    expect(requests).toBe(0);
    await page.getByRole("button", { name: "Generate briefing", exact: true }).click();
    await expect(page.getByRole("region", { name: "Possible context", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Inspect C1G1H1 for possible context 1" }).click();
    const headline = page.getByRole("region", { name: "C1G1H1 evidence", exact: true });
    await expect(headline).toBeFocused();
    await expect(headline).toContainText("Dated source report for AAPL");
    await expect(headline.getByRole("link")).toHaveAttribute("href", "https://example.com/AAPL");
    await page.getByRole("button", { name: "Inspect C3S1 for possible context 3" }).click();
    const series = page.getByRole("region", { name: "C3S1 evidence", exact: true });
    await expect(series).toBeFocused(); await expect(series).toContainText("source flag p");
    await page.screenshot({ path: testInfo.outputPath("context-evidence.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("checkbox", { name: "Dated news headlines", exact: true }).uncheck();
    await expect(page.getByRole("region", { name: "Possible context", exact: true })).toHaveCount(0);
    await expect(page.getByText(/Snapshot ID:/)).toHaveCount(0);
    expect(requests).toBe(1);
    await page.getByRole("button", { name: "Generate briefing", exact: true }).click();
    const coverage = page.getByRole("region", { name: "Selected context coverage", exact: true });
    await expect(coverage).toContainText("Provider key not configured");
    await expect(page.getByRole("region", { name: "Observed movement", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Inspect C1 coverage" }).click();
    await expect(page.getByRole("region", { name: "C1 evidence", exact: true })).toBeFocused();
    expect(requests).toBe(2);
  });
}
