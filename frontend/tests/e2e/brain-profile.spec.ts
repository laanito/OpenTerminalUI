import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`@smoke Brain Deep identity, saved provenance and interrupted stream at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let asks = 0, legacyAsks = 0;
    const sources = ["note", "journal", "portfolio", "holding", "transaction"];
    const citation = { n: 1, source: "note", title: "Current note", snippet: "Current private evidence.", ref_id: "note-1", score: 0.9 };
    const generation = { generated_at: "2026-10-29T12:00:00+00:00", llm_provider: "openai-compatible", llm_model: "deep-model",
      model_profile: { requested_profile: "deep", resolved_profile: "deep", model: "deep-model" } };
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/brain/ask/stream")) {
        asks += 1;
        expect(route.request().postDataJSON()).toMatchObject({ sources, k: 6 });
        const events = [
          { type: "queued", sources, deadlines: { operation_seconds: 720 }, ...generation },
          { type: "start", sources, citations: [citation], llm: true, ...generation },
          { type: "delta", text: asks === 1 ? "A grounded Deep answer [1]." : "Provisional interrupted text." },
          ...(asks === 1 ? [{ type: "done" }] : []),
        ];
        await route.fulfill({ contentType: "application/x-ndjson", body: events.map((event) => JSON.stringify(event)).join("\n") + "\n" });
        return;
      }
      if (path.endsWith("/brain/ask")) legacyAsks += 1;
      if (path.endsWith("/brain/memos") && route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toMatchObject({
          answer: "A grounded Deep answer [1].", llm: true, llm_model: "deep-model", llm_provider: "openai-compatible",
          sources, citations: [citation],
        });
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "saved-memo" }) });
        return;
      }
      const data = path.endsWith("/brain/status") ? { indexed_chunks: 118, source_counts: { note: 118, journal: 0, portfolio: 0, holding: 0, transaction: 0 },
        backend: "numpy", embed_model: "legacy-embedding-model" } : path.endsWith("/brain/memos") ? [] : { items: [] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto("/equity/brain");
    const input = page.getByPlaceholder(/Ask your second brain/);
    await input.fill("What changed?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("A grounded Deep answer [1].", { exact: true })).toBeVisible();
    await expect(page.getByText("Deep profile · deep-model", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved to Brain Log" })).toBeDisabled();
    await input.fill("Try another question");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText(/No answer was kept; retry manually/)).toBeVisible();
    await expect(page.getByText("Provisional interrupted text.", { exact: true })).toHaveCount(0);
    expect(asks).toBe(2); expect(legacyAsks).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
