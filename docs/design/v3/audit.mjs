// Discovery only: synthetic browser responses, no backend/model/provider calls.
// Run from the repository root after starting the frontend preview on port 4185.
import { chromium } from '../../../frontend/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const out=new URL('./evidence/',import.meta.url);
await fs.mkdir(out,{recursive:true});
const base=process.env.AUDIT_APP_URL||'http://127.0.0.1:4185';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Local preview only');
const long='Synthetic research: durable demand and valuation assumptions require dated source review. '.repeat(12);
const portfolios=[{id:'audit-core',name:'Core · long-term multi-market allocation',description:long,currency:'USD',benchmark_symbol:'SPY',starting_cash:5000},{id:'audit-europe',name:'European opportunities · accumulated positions',description:long,currency:'EUR',benchmark_symbol:'SPY',starting_cash:1000}];
const holdings=['AAPL','BTC-USD','SAP.DE','MSFT','BTC-USD','AAPL'].map((symbol,i)=>({id:`lot-${i}`,symbol,shares:[10,.05,3,4,.025,6][i],cost_basis_per_share:[170,70000,200,370,68000,180][i],cost_basis_currency:i===2?'EUR':'USD',currency:i===2?'EUR':'USD',current_price:[200,80000,250,400,80000,200][i],purchase_date:'2026-10-01',notes:long,lot_id:`opening-${i}`}));
const transactions=holdings.map((h,i)=>({id:`tx-${i}`,symbol:h.symbol,type:'buy',shares:h.shares,price:h.cost_basis_per_share,currency:h.cost_basis_currency,date:'2026-10-01',fees:2,fees_currency:'USD',lot_id:h.lot_id,notes:long}));
const notes=holdings.map((h,i)=>({id:`note-${i}`,symbol:h.symbol,context:'general',ref_id:null,title:'An intentionally long research title covering competing assumptions and later revisions',body:long+' https://example.test/'+ 'long-source-identity-'.repeat(8),tags:['long-term','requires-validation'],effective_at:'2026-11-01T12:00:00Z',created_at:'2026-11-02T12:00:00Z',updated_at:'2026-11-03T12:00:00Z'}));
const accounting={base_currency:'USD',status:'complete',issues:[],degraded_reasons:[],fx_rates:[{base_currency:'EUR',quote_currency:'USD',rate:1.1,source:'Synthetic audit rate',as_of_date:'2026-11-18'}],holdings:holdings.map(h=>({id:h.id,symbol:h.symbol,cost_basis_base:h.shares*h.cost_basis_per_share*(h.currency==='EUR'?1.1:1),market_value_base:h.shares*h.current_price*(h.currency==='EUR'?1.1:1),unrealized_pnl_base:h.shares*(h.current_price-h.cost_basis_per_share)*(h.currency==='EUR'?1.1:1)})),transactions:transactions.map(t=>({id:t.id,cash_delta_base:-t.shares*t.price*(t.currency==='EUR'?1.1:1)-2}))};
const value=accounting.holdings.reduce((s,h)=>s+h.market_value_base,0),cost=accounting.holdings.reduce((s,h)=>s+h.cost_basis_base,0);
const analytics={accounting,total_value:value,net_liquidation_value:value+2988,cash_balance:2988,total_cost:cost,unrealized_pnl:value-cost,realized_pnl:0,allocation_by_sector:[{sector:'Technology',value:1800},{sector:'Digital assets',value:720}]};
const headlines=notes.map((n,i)=>({id:`article-${i}`,title:n.title+' — selected headline '+i,summary:long,source:'Synthetic publisher',source_url:'https://example.test/article-'+i,url:'https://example.test/article-'+i,published_at:'2026-11-18T09:00:00Z',published_date:'2026-11-18T09:00:00Z',symbols:['AAPL']}));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const cases=[];
try{
 for(const width of (process.env.AUDIT_DEBUG?[1440]:[1440,1024,390])){
  for(const [name,path] of [['home','/'],['portfolio','/equity/portfolio'],['market-context','/equity/market-context'],['security','/equity/security/AAPL'],['brain','/equity/brain'],['notes','/equity/notes'],['journal','/equity/journal'],['news','/equity/news'],['workstation','/equity/chart-workstation']].filter(([n])=>!process.env.AUDIT_DEBUG||n==='portfolio')){
   const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
   const page=await context.newPage();const errors=[],blocked=[],unmatched=new Set();
   await page.addInitScript(()=>{const jwt=`x.${btoa(JSON.stringify({sub:'layout-audit',email:'audit@example.test',role:'trader',exp:4102444800}))}.y`;localStorage.setItem('ot-access-token',jwt);localStorage.setItem('ot-refresh-token',jwt);});
   await page.routeWebSocket('**/*',socket=>socket.close());
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url()),p=url.pathname;
    if(!p.includes('/api/')){if(url.origin===new URL(base).origin||url.protocol==='data:')return route.continue();blocked.push(url.origin);return route.abort();}
    let data;
    if(route.request().method()!=='GET'){return route.fulfill({status:405,json:{detail:'Discovery blocks all writes and model calls'}});}
    if(p==='/api/portfolios')data={items:portfolios};
    else if(/\/portfolios\/[^/]+\/holdings$/.test(p))data={items:holdings};
    else if(/\/portfolios\/[^/]+\/transactions$/.test(p))data={items:transactions};
    else if(/\/portfolios\/[^/]+\/analytics$/.test(p))data=analytics;
    else if(p.endsWith('/portfolios/primary'))data={portfolio_id:'audit-core',portfolio_name:portfolios[0].name,portfolio_currency:'USD',items:holdings,summary:analytics,accounting};
    else if(p.endsWith('/attribution'))return route.fulfill({status:503,json:{detail:'Synthetic unavailable attribution case'}});
    else if(p.includes('/analytics/'))return route.fulfill({status:503,json:{detail:'Synthetic unavailable analytics case'}});
    else if(p==='/api/notes')data=notes;
    else if(p.endsWith('/brain/status'))data={indexed_chunks:118,source_counts:{note:118},backend:'fixture',embed_model:'fixture'};
    else if(p.endsWith('/brain/memos'))data=[];
    else if(p==='/api/journal')data={entries:notes.map((n,i)=>({id:i+1,symbol:n.symbol,direction:'LONG',entry_date:n.created_at,entry_price:100,quantity:2,exit_price:null,exit_date:null,pnl:null,pnl_pct:null,strategy:'Long-term thesis with a deliberately descriptive name',setup:'Evidence review',emotion:'neutral',notes:long,rationale:long,tags:n.tags}))};
    else if(p.endsWith('/journal/calendar'))data={days:[]};
    else if(p.endsWith('/journal/equity-curve'))data={points:[]};
    else if(p.endsWith('/journal/stats'))data={total_trades:6,closed_trades:0,open_trades:6,win_rate:0,total_pnl:0};
    else if(p.includes('/news'))data={items:headlines,articles:headlines};
    else if(p.endsWith('/watchlists')||p.includes('/backtest/v1/presets'))data=[];
    else if(p.includes('/briefing-captures'))data={items:[],has_more:false};
    else{unmatched.add(p);data={items:[],results:[],data:[],quotes:[],series:[],status:'unavailable'};}
    return route.fulfill({json:data});
   });
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/TypeError|runtime error|ReferenceError/.test(m.text()))errors.push(m.text().slice(0,500));});
   await page.goto(base+path,{waitUntil:'domcontentloaded'});await page.waitForTimeout(1200);
   const measured=await page.evaluate(()=>{
    const all=[...document.querySelectorAll('body *')];
    const label=el=>el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(el.getAttribute('aria-label')?' ['+el.getAttribute('aria-label')+']':'')+'.'+String(el.className?.baseVal??el.className).split(/\s+/).slice(0,3).join('.');
    const visible=all.filter(el=>el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0);
    const overflow=visible.filter(el=>el.scrollWidth>el.clientWidth+3&&el.clientWidth>80).map(el=>({element:label(el),width:el.clientWidth,scrollWidth:el.scrollWidth,overflowX:getComputedStyle(el).overflowX,text:el.textContent.trim().slice(0,85)}));
    const regions=visible.filter(el=>['auto','scroll'].includes(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+3).map(el=>({element:label(el),height:el.clientHeight,scrollHeight:el.scrollHeight,width:el.clientWidth}));
    const holding=[...document.querySelectorAll('[role=grid]')][0];
    return{title:document.title,bodyText:document.body.innerText.slice(0,220),documentWidth:document.documentElement.scrollWidth,overflow:overflow.slice(0,24),verticalScrollRegions:regions.slice(0,12),holdingsTop:holding?Math.round(holding.getBoundingClientRect().top):null};
   });
   if(name==='portfolio')await page.screenshot({path:fileURLToPath(new URL(`portfolio-before-${width}.jpg`,out)),type:'jpeg',quality:70});
   cases.push({name,path,width,height:1000,...measured,pageErrors:errors,blockedOrigins:[...new Set(blocked)],genericFallbackPaths:[...unmatched].sort()});
   console.log(name,width,errors.length?'PAGE ERROR':'rendered',measured.overflow.length+' horizontal overflow candidates');
   await context.close();
  }
 }
}finally{await browser.close();}
await fs.writeFile(new URL('audit.json',out),JSON.stringify({baseline:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),method:'Installed Chrome; synthetic API responses; provider/model/write requests blocked. Overflow candidates include intentional table/chart scroll. Only initial views; no claim of full populated research or accessibility audit.',cases},null,2)+'\n');
