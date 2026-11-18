/* Review-only interaction model. All values below are synthetic; no network/storage. */
const $=id=>document.getElementById(id);
const names={all:'All portfolios',core:'Core',europe:'Europe'};
const lots=[
 {symbol:'AAPL',name:'Apple',scope:'core',quantity:10,price:200,currency:'USD',value:2000,cost:1700,date:'2026-10-02'},
 {symbol:'AAPL',name:'Apple',scope:'europe',quantity:5,price:200,currency:'USD',value:1000,cost:900,date:'2026-10-08'},
 {symbol:'BTC-USD',name:'Bitcoin · USD quote',scope:'core',quantity:.05,price:80000,currency:'USD',value:4000,cost:3500,date:'2026-10-04'},
 {symbol:'SAP.DE',name:'SAP · Xetra',scope:'europe',quantity:5,price:250,currency:'EUR',value:1375,cost:1210,date:'2026-10-01'},
];
let scope='all',kind='buy';
const money=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const quantity=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:8});
function selectedLots(){return lots.filter(l=>scope==='all'||l.scope===scope);}
function groups(){const map=new Map();for(const lot of selectedLots()){
 let row=map.get(lot.symbol);if(!row){row={symbol:lot.symbol,name:lot.name,quantity:0,value:0,cost:0,currency:lot.currency,price:lot.price,lots:[]};map.set(lot.symbol,row);}
 row.quantity+=lot.quantity;row.value+=lot.value;row.cost+=lot.cost;row.lots.push(lot);
}return [...map.values()];}
function render(){
 const scenario=$('scenario').value,partial=scenario==='partial',empty=scenario==='empty',error=scenario==='error';
 $('scope-button').textContent=names[scope]+' ▾';$('scope-label').textContent=(scope==='all'?'2 portfolios':names[scope]+' portfolio')+' · reporting USD';
 $('state-message').className=partial?'notice':error?'notice':'';
 $('state-message').textContent=partial?'FX or cost evidence is missing for SAP.DE. Complete totals are withheld; known components remain inspectable.':error?'Portfolio retrieval failed. No previous balances are shown. Retry in production; this scenario is illustrative.':'';
 const rows=groups(),known=rows.filter(r=>!(partial&&r.symbol==='SAP.DE')),value=known.reduce((s,r)=>s+r.value,0),cost=known.reduce((s,r)=>s+r.cost,0),cash=scope==='all'?2050:scope==='core'?1500:550;
 const cells=[['Net value',empty?'0.00 USD':error||partial?'Unavailable':money(value+cash)+' USD',partial?'Known components '+money(value+cash)+' USD':'Positions + cash'],['Positions',error?'Unavailable':empty?'0':String(rows.length),empty?'Record an operation to begin':'Consolidated instruments'],['Cash',error?'Unavailable':empty?'0.00 USD':money(cash)+' USD','Ledger cash · reporting USD'],['Unrealized P&L',error||partial?'Unavailable':empty?'—':(value-cost>=0?'+':'')+money(value-cost)+' USD',partial?'Cost / FX coverage incomplete':'On current positions · reporting USD']];
 $('metrics').innerHTML=cells.map(([label,val,note])=>`<article class="metric"><span class="muted">${label}</span><div class="value">${val}</div><small>${note}</small></article>`).join('');
 if(empty||error){$('position-list').innerHTML=`<div class="empty"><h3>${error?'Positions unavailable':'Your first position starts with an operation'}</h3><p>${error?'A failed request must never look like an empty portfolio.':'Record a buy, or add a position you already own without recording a purchase.'}</p>${error?'':'<button data-operation="receipt">Add an existing position</button>'}</div>`;return;}
 const filter=$('filter').value.toLowerCase();const filtered=rows.filter(r=>(r.symbol+' '+r.name).toLowerCase().includes(filter));
 if(!filtered.length){$('position-list').innerHTML='<div class="empty">No positions match this filter.</div>';return;}
 const valueFor=r=>partial&&r.symbol==='SAP.DE'?'Needs FX':money(r.value)+' USD';
 const gainFor=r=>partial&&r.symbol==='SAP.DE'?'Basis unknown':'+'+money(r.value-r.cost)+' USD';
 $('position-list').innerHTML=`<div class="table-wrap" tabindex="0" role="region" aria-label="Positions table"><table><thead><tr><th>Instrument</th><th class="numeric">Quantity</th><th class="numeric">Last / native</th><th class="numeric">Value / USD</th><th class="numeric">Unrealized / USD</th><th>Held in</th></tr></thead><tbody>${filtered.map(r=>`<tr><td><button class="symbol-button" data-position="${r.symbol}">${r.symbol}</button><small>${r.name}</small></td><td class="numeric">${quantity(r.quantity)}<small>${r.lots.length} lot${r.lots.length>1?'s':''}</small></td><td class="numeric">${money(r.price)} ${r.currency}</td><td class="numeric">${valueFor(r)}</td><td class="numeric ${partial&&r.symbol==='SAP.DE'?'':'positive'}">${gainFor(r)}</td><td>${[...new Set(r.lots.map(l=>names[l.scope]))].join(' · ')}</td></tr>`).join('')}</tbody></table></div><div class="position-cards">${filtered.map(r=>`<article class="position-card"><div class="card-top"><div><button class="symbol-button" data-position="${r.symbol}">${r.symbol}</button><p>${r.name}</p></div><div class="numeric">${valueFor(r)}<p>${quantity(r.quantity)} · ${r.lots.length} lot${r.lots.length>1?'s':''}</p></div></div><div class="card-bottom"><span>${money(r.price)} ${r.currency}</span><span class="positive">${gainFor(r)}</span></div></article>`).join('')}</div>`;
}
function chooseScope(next){scope=next;$('scope-dialog').close();render();}
function startOperation(next='buy',symbol){kind=next;$('operation-result').textContent='';$('target').value=scope==='all'?'':scope;if(symbol)$('instrument').value=symbol;updateOperation();$('operation-dialog').showModal();}
function updateOperation(){
 const receipt=kind==='receipt',unknown=receipt&&$('basis').value==='unknown';
 document.querySelectorAll('[data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===kind)));
 $('basis-label').hidden=!receipt;$('price-caption').textContent=receipt?'Documented unit cost':'Unit execution price';
 $('price-label').hidden=unknown;$('currency-label').hidden=unknown;$('price').required=!unknown;$('price').disabled=unknown;$('currency').disabled=unknown;
 $('acquired-label').hidden=!receipt;$('receipt-source-label').hidden=!receipt;
 for(const label of document.querySelectorAll('.fee-field'))label.hidden=receipt;
 $('fees').required=!receipt;$('fees').disabled=receipt;$('fee-currency').disabled=receipt;
 $('operation-hint').textContent=receipt?'Records an opening position / external receipt. No purchase or cash movement is inferred. Capital-flow valuation must be tracked separately; unknown basis keeps P&L unavailable.':kind==='sell'?'Choose the portfolio that owns the position. Review available quantity and lot allocation before confirming; no implicit short position.':'Creates an execution and its position/cash effects together. Fee currency is explicit; this study does not convert currencies.';
 $('operation-form').hidden=false;$('review').hidden=true;
 $('operation-date').parentNode.firstChild.textContent=receipt?'Position present as of':'Operation date';
}
function openPosition(symbol){
 const row=groups().find(r=>r.symbol===symbol);if(!row)return;
 $('position-title').textContent=row.symbol+' · '+quantity(row.quantity);
 $('position-detail').innerHTML=`<p class="muted">${row.name} · native quote ${row.currency} · reporting USD</p>${row.lots.map(l=>`<article class="lot"><b>${names[l.scope]} · ${quantity(l.quantity)} units</b><p>Acquired ${l.date} · current value ${money(l.value)} USD</p><p>Recorded cost ${$('scenario').value==='partial'&&l.symbol==='SAP.DE'?'unknown':money(l.cost)+' USD'} · provenance retained per lot.</p><button data-sell="${l.scope}" data-symbol="${l.symbol}">Sell from ${names[l.scope]}</button></article>`).join('')}<p class="footnote">Production: expose original cost currency, dated FX evidence and lot selection here; do not combine unknown basis into an invented average cost.</p>`;
 $('position-dialog').showModal();
}
$('scenario').addEventListener('change',render);$('filter').addEventListener('input',render);
$('scope-button').onclick=()=>$('scope-dialog').showModal();$('analytics-scope').onclick=()=>$('scope-dialog').showModal();$('record').onclick=()=>startOperation();
document.addEventListener('click',event=>{
 const b=event.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-close'))b.closest('dialog').close();
 if(b.dataset.scope)chooseScope(b.dataset.scope);
 if(b.dataset.kind){kind=b.dataset.kind;updateOperation();}
 if(b.dataset.operation)startOperation(b.dataset.operation);
 if(b.dataset.position)openPosition(b.dataset.position);
 if(b.dataset.sell){$('position-dialog').close();startOperation('sell',b.dataset.symbol);$('target').value=b.dataset.sell;}
 if(b.dataset.tab){for(const panel of document.querySelectorAll('.tab-panel'))panel.hidden=panel.id!==b.dataset.tab;for(const tab of document.querySelectorAll('[data-tab]')){tab.removeAttribute('aria-current');}b.setAttribute('aria-current','page');}
});
$('basis').onchange=updateOperation;
$('operation-form').onsubmit=event=>{
 event.preventDefault();$('quantity').setCustomValidity('');
 const n=Number($('quantity').value),target=$('target').value,symbol=$('instrument').value;
 if(kind==='sell'){
  const available=lots.filter(l=>l.scope===target&&l.symbol===symbol).reduce((sum,l)=>sum+l.quantity,0);
  if(n>available){$('quantity').setCustomValidity('Available in '+names[target]+': '+quantity(available));$('quantity').reportValidity();return;}
 }
 const receipt=kind==='receipt',unknown=receipt&&$('basis').value==='unknown',price=Number($('price').value),fees=Number($('fees').value);
 const lines=[`${kind==='receipt'?'Existing position':kind==='sell'?'Sell':'Buy'} · ${symbol} · ${quantity(n)} units`,`${names[target]} · ${$('operation-date').value}`];
 if(receipt)lines.push('Cash effect: none. No buy transaction or deposit is invented.',unknown?'Cost basis unknown · cost-dependent P&L unavailable.':'Documented cost: '+money(n*price)+' '+$('currency').value+'. Original acquisition: '+($('acquired').value||'unknown')+'.','Capital-flow valuation must be recorded separately for historical performance.');
 else{lines.push('Trade cash leg: '+(kind==='buy'?'−':'+')+money(n*price)+' '+$('currency').value,'Fee cash leg: −'+money(fees)+' '+$('fee-currency').value,kind==='sell'?'Lot allocation: oldest first in the chosen portfolio (review/override required in production).':'Creates a new acquisition lot.');}
 if($('rationale').value.trim())lines.push('Operation rationale: '+$('rationale').value.trim());
 if(receipt&&$('receipt-source').value.trim())lines.push('Source: '+$('receipt-source').value.trim());
 $('review-body').replaceChildren(...lines.map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));
 $('operation-form').hidden=true;$('review').hidden=false;$('confirm').disabled=false;$('confirm').focus();
};
$('quantity').addEventListener('input',()=>$('quantity').setCustomValidity(''));
$('target').addEventListener('change',()=>$('quantity').setCustomValidity(''));
$('instrument').addEventListener('change',()=>$('quantity').setCustomValidity(''));
$('edit-operation').onclick=()=>{$('operation-form').hidden=false;$('review').hidden=true;$('target').focus();};
$('confirm').onclick=()=>{$('operation-result').textContent='Prototype review complete. Nothing was saved; portfolio balances and ledger are unchanged.';$('confirm').disabled=true;};
render();
