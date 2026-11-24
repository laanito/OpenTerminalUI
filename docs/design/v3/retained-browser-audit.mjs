// Initial-view probes only. No product actions, model calls or live data access.
// Start a local frontend preview, then run with AUDIT_APP_URL and installed Chrome.
import { chromium } from '../../../frontend/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const base = process.env.AUDIT_APP_URL || 'http://127.0.0.1:4185';
const origin = new URL(base);
if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(origin.hostname) || origin.username || origin.password) throw Error('Only an unauthenticated local HTTP preview is allowed');
const out = new URL('./evidence/', import.meta.url);
const probes = [
  ['forex', '/equity/forex', 'Synthetic cross rates, dated bank entries and pair candles'],
  ['commodities', '/equity/commodities', 'Intentional unavailable API; existing labelled frontend fallback'],
  ['economics', '/equity/economics', 'Intentional unavailable API; initial configuration/loading state'],
  ['dividends', '/equity/dividends', 'Synthetic dividend calendar'],
  ['position-sizer', '/equity/position-sizer', 'Existing local calculator defaults; no execution'],
  ['paper', '/equity/paper', 'Synthetic portfolio, position and empty order/trade lists; no execution'],
  ['risk', '/equity/risk', 'Intentional unavailable analytics; initial read state'],
  ['backtesting', '/backtesting', 'Initial setup with unavailable services; no submitted run'],
  ['fno', '/fno', 'Initial shell with unavailable services; no contract/provider acceptance'],
  ['account', '/account', 'Fresh browser account defaults and synthetic JWT; no changes'],
  ['login', '/login', 'Initial form; no submitted credentials'],
  ['register', '/register', 'Initial form; no registration'],
  ['forgot-access', '/forgot-access', 'Initial form; no submitted reset'],
];
const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'INR'];
const rates = [1, .92, .78, 150, .88, 1.5, 1.35, 83];
const cases = [];
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  for (const width of [1440, 1024, 390]) for (const [name, routePath, state] of probes) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), pageErrors = [], unavailable = new Set(), blocked = new Set(), blockedWrites = new Set();
    await context.addInitScript(() => { const token = `x.${btoa(JSON.stringify({ sub: 'retained-audit', email: 'audit@example.test', role: 'trader', exp: 4102444800 }))}.y`; localStorage.setItem('ot-access-token', token); localStorage.setItem('ot-refresh-token', token); });
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), p = url.pathname;
      if (!p.includes('/api/')) { if (url.origin === origin.origin) return route.continue(); blocked.add(url.origin); return route.abort(); }
      if (route.request().method() !== 'GET') { blockedWrites.add(p); return route.fulfill({ status: 405, json: { detail: 'Audit blocks all writes and model calls' } }); }
      let data;
      if (p === '/api/forex/cross-rates') data = { currencies, matrix: rates.map(baseRate => rates.map(quoteRate => quoteRate / baseRate)) };
      else if (p === '/api/forex/central-banks') data = { banks: currencies.map(currency => ({ currency, bank: `${currency} synthetic monetary policy research institution with a long descriptive name`, policy_rate: 2.5, last_decision_date: '2026-11-01', next_decision_date: '2026-12-01', last_action: 'Hold', last_change_bps: 0, days_since_last_decision: 23, days_until_next_decision: 7, decision_cycle: 'Synthetic dated observation' })) };
      else if (p.startsWith('/api/forex/pairs/')) data = { pair: 'EURUSD', current_rate: 1.08, candles: Array.from({ length: 40 }, (_, i) => ({ t: Date.parse('2026-11-01T12:00:00Z') / 1000 + i * 3600, o: 1.08, h: 1.09, l: 1.07, c: 1.08 + i / 10000, v: 100 })) };
      else if (p === '/api/dividends/calendar') data = ['AAPL', 'SAP.DE', 'MSFT'].map(symbol => ({ symbol, ex_date: '2026-12-01', amount: .25, type: 'Ordinary cash dividend from synthetic audit data' }));
      else if (p === '/api/paper/portfolios') data = { items: [{ id: 'audit', name: 'Long-term worldwide paper research with independent simulated capital', initial_capital: 100000, current_cash: 99000 }] };
      else if (p === '/api/paper/portfolios/audit/positions') data = { items: [{ id: 'position', symbol: 'AAPL', quantity: 5, avg_entry_price: 190, mark_price: 200, unrealized_pnl: 50 }] };
      else if (/\/paper\/portfolios\/audit\/(orders|trades)$/.test(p)) data = { items: [] };
      else if (p === '/api/paper/portfolios/audit/performance') data = { portfolio_id: 'audit', equity: 100050, pnl: 50, cumulative_return: .0005, daily_pnl_curve: [], sharpe_ratio: 0, max_drawdown: 0, win_rate: 0, avg_win_loss_ratio: 0, profit_factor: 0, trade_count: 0 };
      else if (p.endsWith('/watchlists') || p.endsWith('/settings/api-keys')) data = [];
      else if (p.endsWith('/alerts')) data = { alerts: [] };
      else { unavailable.add(p); return route.fulfill({ status: 503, json: { detail: 'Intentional audit unavailable state; no live service contacted' } }); }
      return route.fulfill({ json: data });
    });
    page.on('pageerror', error => pageErrors.push({ name: error.name, message: error.message.slice(0, 350) }));
    try {
      await page.goto(base + routePath, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500); // Fixed initial-view observation, not a readiness/acceptance assertion.
      const measurements = await page.evaluate(() => {
        const root = document.querySelector('.terminal-content') || document.body;
        const visible = element => { const r = element.getBoundingClientRect(); const s = getComputedStyle(element); return element.getClientRects().length && r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0 && s.visibility !== 'hidden'; };
        const describe = element => ({ tag: element.tagName.toLowerCase(), text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 130), className: String(element.className?.baseVal ?? element.className).slice(0, 180) });
        const elements = [...root.querySelectorAll('*')].filter(visible);
        const smallLabels = elements.filter(element => /^(LABEL|BUTTON|H[1-4]|TH|SUMMARY|A|P|SPAN|DIV)$/.test(element.tagName) && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && /[A-Za-z]{3}/.test(node.textContent)) && parseFloat(getComputedStyle(element).fontSize) < 12).map(element => ({ ...describe(element), fontSize: getComputedStyle(element).fontSize }));
        const overflows = elements.filter(element => element.clientWidth > 80 && element.scrollWidth > element.clientWidth + 3).map(element => ({ ...describe(element), width: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX, role: element.getAttribute('role'), name: element.getAttribute('aria-label') }));
        const unlabelledInputs = elements.filter(element => /^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName) && !['hidden', 'submit', 'button'].includes(element.type) && !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.title).map(element => ({ tag: element.tagName.toLowerCase(), type: element.type, placeholder: element.getAttribute('placeholder') }));
        return { documentWidth: document.documentElement.scrollWidth, initialText: root.innerText.slice(0, 550), smallLabelCount: smallLabels.length, smallLabels: smallLabels.slice(0, 20), overflowCandidateCount: overflows.length, overflowCandidates: overflows.slice(0, 18), unlabelledInputCount: unlabelledInputs.length, unlabelledInputs: unlabelledInputs.slice(0, 18) };
      });
      if (['forex', 'paper'].includes(name) && [1440, 390].includes(width) || ['position-sizer', 'backtesting'].includes(name) && width === 390) await page.screenshot({ path: new URL(`retained-${name}-${width}.png`, out).pathname, fullPage: true, animations: 'disabled' });
      cases.push({ name, path: routePath, observedPath: new URL(page.url()).pathname, width, height: 1000, state, ...measurements, pageErrors, unavailablePaths: [...unavailable].sort(), blockedOrigins: [...blocked].sort(), blockedWritePaths: [...blockedWrites].sort() });
      console.log(name, width, measurements.smallLabelCount, 'small-label candidates,', measurements.unlabelledInputCount, 'unlabelled controls,', pageErrors.length, 'page errors');
    } catch (error) { cases.push({ name, path: routePath, width, state, probeError: error.message, pageErrors }); }
    finally { await context.close(); }
  }
} finally { await browser.close(); }
await fs.writeFile(new URL('retained-browser-audit.json', out), JSON.stringify({ method: 'Installed Chrome, fixed initial-view probes after 1500ms. Fresh synthetic JWT/profile and selected typed read fixtures; every other API read intentionally 503, all writes/models/WebSockets/external origins blocked. Visible viewport candidates only; small numbers, clipped selectors and local scrollers can be intentional. Not populated acceptance, zoom, accessibility or live-provider certification.', cases }, null, 2) + '\n');
