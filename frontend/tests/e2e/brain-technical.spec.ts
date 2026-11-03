import { expect, test } from "@playwright/test";
import { brainTechnicalAnswer } from "../../src/__tests__/fixtures/brainTechnicalContext";

for (const width of [1440, 390]) {
  test(`@smoke Brain opt-in technical evidence, saved inspection and reviewed promotion at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const sources = ["note", "journal", "portfolio", "holding", "transaction"];
    const result = { ...brainTechnicalAnswer(), sources };
    const memo = { ...result, id: "memo-technical", title: "Dated claim and current observations", question: "Does my dated thesis still hold?",
      answer_preview: result.answer, symbol: null, tags: [], annotation: "", pinned: false, citation_count: 1,
      created_at: result.generated_at, updated_at: result.generated_at };
    let asks = 0, saves = 0, rechecks = 0, promotions = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      let data: unknown = { items: [] };
      if (path.endsWith("/brain/ask/stream")) {
        asks++;
        expect(route.request().postDataJSON()).toMatchObject({ technical_symbols: ["AAPL", "BTC-USD"], sources });
        const answer = { ...brainTechnicalAnswer(asks === 2 ? "partial" : asks === 3 ? "unavailable" : "complete"), sources };
        await route.fulfill({ contentType: "application/x-ndjson", body: [
          { type: "queued", sources, technical_symbols: ["AAPL", "BTC-USD"], deadlines: { operation_seconds: 300 }, ...{
            generated_at: answer.generated_at, llm_model: answer.llm_model, llm_provider: answer.llm_provider, model_profile: answer.model_profile } },
          { type: "start", ...answer }, { type: "delta", text: answer.answer }, { type: "result", result: answer },
        ].map((event) => JSON.stringify(event)).join("\n") + "\n" }); return;
      }
      if (path.endsWith("/brain/status")) data = { indexed_chunks: 118, source_counts: { note: 118, journal: 0, portfolio: 0, holding: 0, transaction: 0 }, backend: "numpy", embed_model: "fixture-embed" };
      if (path.endsWith("/brain/memos") && method === "GET") data = saves ? [memo] : [];
      if (path.endsWith("/brain/memos") && method === "POST") {
        saves++; expect(route.request().postDataJSON()).toMatchObject({ answer: result.answer, technical_context: result.technical_context }); data = memo;
      }
      if (path.endsWith("/brain/memos/memo-technical")) data = memo;
      if (path.endsWith("/evidence-status")) {
        rechecks++; data = { status: "current", checked_at: "2026-09-25T12:10:00Z", citations: [{ n: 1, status: "current" }] };
      }
      if (path.endsWith("/promote-to-note")) {
        promotions++;
        const body = route.request().postDataJSON().body;
        expect(body).toContain("(captured T1.1)"); expect(body).toContain(result.technical_context!.groups[0].snapshot_id);
        expect(body).not.toContain("[T1.1]"); data = { id: "reviewed-note" };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto("/equity/brain");
    expect(asks).toBe(0);
    const input = page.getByRole("combobox", { name: "Add technical symbol" });
    await input.fill("AAPL"); await page.getByRole("button", { name: "Add", exact: true }).click();
    await input.fill("BTC-USD"); await page.getByRole("button", { name: "Add", exact: true }).click();
    const question = page.getByPlaceholder(/Ask your second brain/);
    await question.fill(memo.question); await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("Dated private thesis")).toBeVisible();
    await page.getByRole("button", { name: "Inspect T2.1 technical evidence", exact: true }).click();
    await expect(page.getByRole("region", { name: "T2.1 technical evidence", exact: true })).toBeFocused();
    const evidence = page.getByRole("region", { name: "Brain technical evidence" });
    await expect(evidence).toContainText("not automatically indexed");
    await evidence.getByText("Supporting adjusted closes (21)", { exact: true }).last().click();
    await expect(evidence.getByRole("table", { name: "BTC-USD technical supporting closes" })).toBeVisible();
    expect(await evidence.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("brain-technical.png"), fullPage: true });
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved to Brain Log" })).toBeDisabled();
    await page.getByRole("button", { name: /Dated claim and current observations/ }).click();
    const saved = page.getByRole("region", { name: "Saved research memo" });
    await expect(saved).toContainText("Saved market snapshots are shown as captured");
    await saved.getByRole("button", { name: "Inspect T1.1 technical evidence", exact: true }).click();
    await expect(saved.getByRole("region", { name: "T1.1 technical evidence", exact: true })).toBeFocused();
    await expect(saved).toContainText("Cited source identities match current records");
    await saved.getByRole("button", { name: "Recheck", exact: true }).click();
    await expect.poll(() => rechecks).toBe(2); expect(asks).toBe(1);
    await saved.getByRole("button", { name: "Promote to Note", exact: true }).click();
    await expect(page.getByRole("button", { name: "Create reviewed Note" })).toBeDisabled(); expect(promotions).toBe(0);
    await expect(page.getByLabel(/Reviewed note text/)).toHaveValue(/Captured T2.1/);
    await page.getByLabel(/I reviewed this text/).check();
    await page.getByRole("button", { name: "Create reviewed Note" }).click();
    await expect(page.getByText(/Reviewed Note created/)).toBeVisible(); expect(promotions).toBe(1);
    await question.fill("What about partial coverage?"); await page.getByRole("button", { name: "Ask", exact: true }).click();
    const latest = page.getByRole("region", { name: "Brain technical evidence" }).first();
    await expect(latest).toContainText("partial observations");
    await question.fill("What if history is unavailable?"); await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("region", { name: "Brain technical evidence" }).first()).toContainText("unavailable");
    expect(asks).toBe(3); expect(saves).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
