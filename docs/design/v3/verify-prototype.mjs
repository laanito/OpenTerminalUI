// Browser review checklist for the standalone design study; not application CI.
import {chromium} from '../../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
const origin='http://127.0.0.1:4186';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[];
try{for(const width of [1440,1024,390]){
 const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin+'/portfolio.html');
 assert.match(await page.locator('#metrics').innerText(),/10,425.00 USD/);
 assert(await page.getByRole('button',{name:'AAPL',exact:true}).isVisible());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:fileURLToPath(new URL(`./evidence/portfolio-proposed-${width}.jpg`,import.meta.url)),type:'jpeg',quality:75});
 await page.locator('#scope-button').click();await page.locator('[data-scope=core]').click();
 assert.match(await page.locator('#scope-label').innerText(),/Core/);
 assert.match(await page.locator('#position-list').innerText(),/10/);
 await page.locator('#scope-button').click();for(let i=0;i<8;i++)await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement.closest('dialog')?.id==='scope-dialog'));await page.keyboard.press('Escape');
 assert(await page.locator('#scope-button').evaluate(el=>el===document.activeElement));
 await page.locator('#scope-button').click();await page.locator('[data-scope=all]').click();
 await page.getByRole('button',{name:'AAPL',exact:true}).click();
 assert.match(await page.locator('#position-detail').innerText(),/Core/);assert.match(await page.locator('#position-detail').innerText(),/Europe/);
 await page.keyboard.press('Escape');
 await page.locator('#record').click();await page.locator('#operation-form button[type=submit]').click();assert(await page.locator('#review').isHidden());
 await page.locator('#target').selectOption('core');await page.locator('#fee-currency').selectOption('EUR');
 await page.locator('#rationale').fill('Reviewable operation rationale');await page.locator('#operation-form button[type=submit]').click();
 assert.match(await page.locator('#review-body').innerText(),/−200.00 USD/);assert.match(await page.locator('#review-body').innerText(),/−2.00 EUR/);
 await page.locator('#confirm').click();assert.match(await page.locator('#operation-result').innerText(),/Nothing was saved/);await page.keyboard.press('Escape');
 await page.locator('#record').click();await page.locator('[data-kind=sell]').click();await page.locator('#target').selectOption('core');await page.locator('#quantity').fill('11');await page.locator('#operation-form button[type=submit]').click();assert(await page.locator('#review').isHidden());assert.equal(await page.locator('#quantity').evaluate(el=>el.validity.valid),false);
 await page.locator('#quantity').fill('1');await page.locator('[data-kind=receipt]').click();await page.locator('#basis').selectOption('unknown');assert(await page.locator('#price').isHidden());
 await page.locator('#operation-form button[type=submit]').click();assert.match(await page.locator('#review-body').innerText(),/Cost basis unknown/);assert.match(await page.locator('#review-body').innerText(),/Cash effect: none/);
 await page.screenshot({path:fileURLToPath(new URL(`./evidence/operation-proposed-${width}.jpg`,import.meta.url)),type:'jpeg',quality:75});
 await page.keyboard.press('Escape');await page.locator('#scenario').selectOption('partial');assert.match(await page.locator('#metrics').innerText(),/Unavailable/);assert.match(await page.locator('#position-list').innerText(),/Needs FX/);
 for(const scenario of ['empty','error']){await page.locator('#scenario').selectOption(scenario);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 for(const section of ['activity','research','analytics','manage']){await page.locator(`[data-tab=${section}]`).click();assert(await page.locator('#'+section).isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 assert.deepEqual(errors,[]);results.push({width,status:'passed',checks:['summary/scope','no page overflow','position/lot drill-down','dialog Escape/focus return','required target','separate fee currency legs','no persistence','oversell rejection','unknown-basis non-cash review','partial/empty/error states','section navigation']});
 await page.close();console.log(width,'prototype review passed');
}}finally{await browser.close();}
await fs.writeFile(new URL('./evidence/prototype-review.json',import.meta.url),JSON.stringify({synthetic:true,applicationRegressionTest:false,results},null,2)+'\n');
