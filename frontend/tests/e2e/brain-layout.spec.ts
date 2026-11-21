import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brainTechnicalAnswer } from "../../src/__tests__/fixtures/brainTechnicalContext";

const title = "Long-term thesis: distinguish dated guidance from current technical observations";
const sourceTitle = "Quarterly guidance, capital allocation and long-term infrastructure demand assumptions";
const questionText = "What changed in the evidence supporting my long-term thesis?";

async function brainFixture(page: Page) {
  const requests = { asks: 0, saves: 0, rechecks: 0, promotions: 0, updates: 0 };
  const result = brainTechnicalAnswer();
  result.citations[0] = { ...result.citations[0], title: sourceTitle, snippet: "The newer guidance changes the assumptions behind the original thesis; this remains dated private research, separate from captured technical history.", effective_at: "2026-09-15T12:00:00Z", route: "/equity/notes" };
  const base = { ...result, title, question: questionText, answer_preview: result.answer, symbol: "AAPL", tags: ["long-term research", "evidence review"], annotation: "", pinned: false,
    citation_count: 1, created_at: result.generated_at!, updated_at: result.generated_at! };
  const records = new Map(Array.from({ length: 12 }, (_, i) => [`memo-${i + 1}`, { ...base, id: `memo-${i + 1}`, title: i ? `Research review ${i + 1}: ${title}` : title }]));
  let currentEvidence = false, failedStatus = false;
  await page.clock.setFixedTime(new Date("2026-11-21T12:00:00Z"));
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (path.endsWith("/brain/status")) return failedStatus ? route.fulfill({ status: 503, json: { detail: "Index unavailable" } }) : route.fulfill({ json: { indexed_chunks: 142, source_counts: { note: 118, journal: 12, portfolio: 2, holding: 3, transaction: 7 }, backend: "numpy", embed_model: "embedding-model-with-a-long-descriptive-name" } });
    if (path.endsWith("/brain/ask/stream")) {
      requests.asks++;
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ question: questionText, k: 6, technical_symbols: ["AAPL", "BTC-USD"] });
      expect(body.sources).not.toContain("journal");
      const answer = { ...result, sources: body.sources };
      return route.fulfill({ contentType: "application/x-ndjson", body: [
        { type: "queued", sources: answer.sources, technical_symbols: ["AAPL", "BTC-USD"], deadlines: { operation_seconds: 300 }, generated_at: answer.generated_at, llm_model: answer.llm_model, llm_provider: answer.llm_provider, model_profile: answer.model_profile },
        { type: "start", ...answer }, { type: "delta", text: answer.answer }, { type: "result", result: answer },
      ].map(event => JSON.stringify(event)).join("\n") + "\n" });
    }
    if (path.endsWith("/brain/memos") && method === "POST") {
      requests.saves++;
      const memo = { ...base, ...route.request().postDataJSON(), id: "memo-saved", title: "Saved current answer" };
      records.set(memo.id, memo); return route.fulfill({ json: memo });
    }
    if (path.endsWith("/brain/memos")) return route.fulfill({ json: [...records.values()] });
    if (path.endsWith("/evidence-status")) {
      requests.rechecks++; return route.fulfill({ json: { status: currentEvidence ? "current" : "stale", checked_at: "2026-11-21T12:00:00Z", citations: [{ n: 1, status: currentEvidence ? "current" : "changed" }] } });
    }
    if (path.endsWith("/promote-to-note")) { requests.promotions++; return route.fulfill({ json: { id: "reviewed-note" } }); }
    const id = path.match(/\/brain\/memos\/([^/]+)$/)?.[1];
    if (id && records.has(id)) {
      if (method === "PATCH") {
        requests.updates++; const body = route.request().postDataJSON();
        expect(body.answer).toBeUndefined(); expect(body.citations).toBeUndefined();
        records.set(id, { ...records.get(id)!, ...body });
      }
      return route.fulfill({ json: records.get(id) });
    }
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return { requests, markCurrent: () => { currentEvidence = true; }, failStatus: () => { failedStatus = true; } };
}

for (const width of [1440, 1024, 390]) {
  test(`@smoke Brain question, dated citations and full-width saved reading stay usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const fixture = await brainFixture(page); await page.goto("/equity/brain");
    const main = page.getByRole("main", { name: "Second Brain research", exact: true });
    const question = main.getByRole("textbox", { name: "Your question", exact: true });
    await expect(question).toBeVisible();
    await expect(page.getByRole("button", { name: "Load", exact: true })).toHaveCount(0);
    expect(await question.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
    expect((await question.boundingBox())!.y).toBeLessThan(600);
    expect((await main.getByRole("combobox", { name: "Add technical symbol" }).boundingBox())!.y).toBeGreaterThan((await question.boundingBox())!.y);
    await expect(main.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
    await main.getByRole("button", { name: "Journal · 12", exact: true }).click();
    for (const symbol of ["AAPL", "BTC-USD"]) {
      await main.getByRole("combobox", { name: "Add technical symbol" }).fill(symbol);
      await main.getByRole("button", { name: "Add", exact: true }).click();
    }
    await main.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("brain-question.png"), fullPage: true });
    await question.fill(questionText); await question.press("Control+Enter");
    const answer = main.getByRole("article", { name: "Brain answer", exact: true });
    await expect(answer.getByRole("button", { name: "Save answer", exact: true })).toBeVisible();
    await expect(answer.getByRole("link", { name: new RegExp(sourceTitle) })).toHaveAttribute("href", "/equity/notes");
    expect(await answer.locator("p, h3, span").evaluateAll(elements => elements.filter(el => el.getClientRects().length && el.textContent?.trim()).every(el => parseFloat(getComputedStyle(el).fontSize) >= 12 && el.scrollWidth <= el.clientWidth + 1))).toBe(true);
    await answer.getByRole("button", { name: "Inspect T2.1 technical evidence", exact: true }).click();
    await expect(answer.getByRole("region", { name: "T2.1 technical evidence", exact: true })).toBeFocused();
    await answer.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(answer.getByRole("button", { name: "Saved to Brain Log", exact: true })).toBeDisabled();
    await main.getByRole("link", { name: "Saved answers", exact: true }).click();
    const log = main.getByRole("region", { name: "Saved Brain research", exact: true });
    const list = log.getByRole("list", { name: "Saved memos", exact: true });
    await expect(list.getByRole("button")).toHaveCount(13); expect((await list.boundingBox())!.height).toBeLessThanOrEqual(322);
    const opener = list.getByRole("button").first(); await opener.click();
    const reader = log.getByRole("region", { name: "Saved memo reader", exact: true });
    await expect(reader).toBeFocused(); expect(Math.abs((await reader.boundingBox())!.width - (await list.boundingBox())!.width)).toBeLessThan(2);
    const saved = reader.getByRole("region", { name: "Saved research memo", exact: true });
    await expect(saved).toContainText("Some cited evidence changed or is unavailable");
    await expect(saved).toContainText("Source changed");
    await reader.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("brain-saved-reader.png"), fullPage: true });
    await saved.getByRole("button", { name: "Inspect T1.1 technical evidence", exact: true }).click();
    await expect(saved.getByRole("region", { name: "T1.1 technical evidence", exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("brain-saved-evidence.png"), fullPage: true });
    await saved.getByText("Organize this memo", { exact: true }).click();
    await saved.getByRole("textbox", { name: "Title", exact: true }).fill("Reviewed organization title");
    await saved.getByRole("button", { name: "Save details", exact: true }).click();
    await expect(saved.getByRole("status").filter({ hasText: "Changes saved" })).toBeVisible();
    fixture.markCurrent(); await saved.getByRole("button", { name: "Recheck", exact: true }).click();
    await expect(saved).toContainText("Cited source identities match current records");
    await saved.getByRole("button", { name: "Promote to Note", exact: true }).click();
    await expect(page.getByRole("button", { name: "Create reviewed Note", exact: true })).toBeDisabled();
    await page.getByRole("dialog", { name: "Promote to Note", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
    expect(fixture.requests.promotions).toBe(0);
    await reader.getByRole("button", { name: "Close memo", exact: true }).click(); await expect(opener).toBeFocused();
    expect(fixture.requests.asks).toBe(1); expect(fixture.requests.saves).toBe(1); expect(fixture.requests.updates).toBe(1);
    expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true); expect(errors).toEqual([]);
  });
}

test("@smoke Brain index failure does not turn unknown source counts into zero", async ({ page }) => {
  const fixture = await brainFixture(page); fixture.failStatus(); await page.goto("/equity/brain");
  await expect(page.getByRole("alert").filter({ hasText: "Private index status is unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Notes · —", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Notes · 0", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Your question", exact: true })).toBeVisible();
});

test("@smoke Brain questions and saved research reflow at actual 200% browser zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "brain-zoom-")); await mkdir(join(profile, "Default"));
  const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "brain-zoom", email: "zoom@example.test", exp: Date.parse("2026-11-22T12:00:00Z") / 1000, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await brainFixture(page); await page.goto(`${baseURL}/equity/brain`);
    const main = page.getByRole("main", { name: "Second Brain research", exact: true });
    await expect(main.getByRole("textbox", { name: "Your question", exact: true })).toBeVisible();
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, dpr: devicePixelRatio, visualScale: visualViewport?.scale }));
    await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1);
    await main.getByRole("link", { name: "Saved answers", exact: true }).click();
    await main.getByRole("list", { name: "Saved memos", exact: true }).getByRole("button").first().click();
    await expect(main.getByRole("region", { name: "Saved memo reader", exact: true })).toBeFocused();
    expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true }); if (await dismiss.isVisible()) await dismiss.click();
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(testInfo.outputPath("brain-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
