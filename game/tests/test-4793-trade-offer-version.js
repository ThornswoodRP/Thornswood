'use strict';
// Actual trade page/front bridge -> queued wire -> whole gamemode. A click
// identifies exactly its drawn offer, including when another edit crosses it.
const fs=require('fs'),path=require('path');
const makePage=require('../../tests/fixtures/panel-page');
const standIn=require('../../tests/stand-in-server');
const root=path.join(__dirname,'../..'),t=standIn.checks(),yes=t.yes;
const w=standIn.world({name:'4793-trade-version',settings:{thornswoodServer:'main'}});
const SWORD='12eb7:Skyrim.esm',ORE='71cf3:Skyrim.esm';
w.record(SWORD,'WEAP',{editorId:'IronSword'});w.record(ORE,'MISC',{editorId:'IronOre'});
const a=w.person(0xff004790,{profileId:1000,name:'Brenna',cell:'3c:Skyrim.esm',pos:[0,0,0],inventory:{entries:[{baseId:w.idOf(SWORD),count:2},{baseId:15,count:100}]}});
const b=w.person(0xff004791,{profileId:1001,name:'Corvin',cell:'3c:Skyrim.esm',pos:[100,0,0],inventory:{entries:[{baseId:w.idOf(ORE),count:5},{baseId:15,count:100}]}});
const c=w.person(0xff004792,{profileId:1002,name:'Dagny',cell:'3c:Skyrim.esm',pos:[200,0,0]});
const view=id=>w.prop(id,'thornswoodTrade')||{},trade=()=>w.box().__thornswoodTrade;
function say(id,line){w.say(id,line);w.run(2100);return w.heard(id).at(-1)||'';}
function packs(){return JSON.stringify([w.row(a).inventory,w.row(b).inventory]);}
function writes(){return w.did.filter(row=>row[2]==='set'&&row[3]==='inventory').length;}
function begin(){if(trade().tradeOf(a))trade().cancel(a);yes('a fresh trade opens',trade().begin(a,b)==='');}
function ui(v){const p=makePage();p.run('bridge',fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8'));p.run('trade',fs.readFileSync(process.env.TRADE_UI||path.join(root,'game/ui/thornswood-trade.js'),'utf8'));p.win.thornswoodTrade.setData(v);return p;}
function click(p){p.doc.getElementById('ts-trade-ok').click();return p.sent.at(-1)||'';}
yes('the whole gamemode loads',w.boot());
if(w.loaded()){
  [a,b,c].forEach(w.arrive);w.run(30000);
  begin();const initial=view(a).offerVersion;
  yes('both owner views receive the same bounded opaque offer version',typeof initial==='string'&&/^[0-9a-f]{48}$/.test(initial)&&initial===view(b).offerVersion);
  say(a,'/trade add '+w.idOf(SWORD).toString(16)+' 1');
  const p=ui(view(a)),old=view(a).offerVersion,oldClick=click(p);
  yes('the actual Agree button sends its drawn offer version',typeof old==='string'&&oldClick==='/trade agree '+old);
  const before=packs(),beforeWrites=writes();
  w.say(b,'/trade gold 10');w.say(a,oldClick);w.run(3000);
  yes('an edit crossing a queued Agree is refused before either agreement flag',!trade().tradeOf(a).okA&&!trade().tradeOf(a).okB);
  yes('crossed Agree neither writes inventories nor changes items or gold',packs()===before&&writes()===beforeWrites);
  yes('stale refusal refreshes the caller to the current offer with a clear retry message',view(a).offerVersion!==old&&/offer|trade/i.test(w.heard(a).at(-1)||'')&&/again|read/i.test(w.heard(a).at(-1)||''));
  const changed=view(a).offerVersion;
  for(const suffix of ['', ' ', 'bad', 'a'.repeat(200), changed+' extra', changed+' '+changed]){
    const snapshot=packs(),count=writes();say(a,'/trade agree'+(suffix?' '+suffix:''));
    yes('missing/malformed/extra version is refused '+JSON.stringify(suffix).slice(0,45),!trade().tradeOf(a).okA&&!trade().tradeOf(a).okB&&packs()===snapshot&&writes()===count);
  }
  for(const suffix of ['', ' '+changed, ' '+changed+' extra']){
    const snapshot=packs(), count=writes(), drawnAt=view(a).at;
    const answer=say(a,'/trade ok'+suffix);
    yes('a legacy click always refreshes without recording an agreement',
      /out of date/i.test(answer)&&/close the game/i.test(answer)&&/launcher update/i.test(answer)&&view(a).at>drawnAt&&view(a).offerVersion===changed&&
      !trade().tradeOf(a).okA&&!trade().tradeOf(a).okB&&packs()===snapshot&&writes()===count);
  }
  say(c,'/trade agree '+changed);yes('a version never substitutes for membership in the trade',!trade().tradeOf(c)&&!trade().tradeOf(a).okA);
  const refreshed=view(a).offerVersion;say(a,'/trade refresh');say(b,'/trade refresh');
  yes('mere owner refreshes preserve the offer version',view(a).offerVersion===refreshed&&view(b).offerVersion===refreshed);
  const p2=ui(view(a)),cached=p2.doc.getElementById('ts-trade-ok').onclick;
  say(a,'/trade gold 5');p2.win.thornswoodTrade.setData(view(a));cached();
  yes('a previously drawn click handler cannot borrow a newer view version',p2.sent.at(-1)==='/trade agree '+refreshed);
  const own=view(a).offerVersion;say(a,'/trade remove '+w.idOf(SWORD).toString(16));
  yes('removing an offered piece advances the shared version',view(a).offerVersion!==own&&view(a).offerVersion===view(b).offerVersion);
  const own2=view(a).offerVersion;say(a,'/trade add '+w.idOf(SWORD).toString(16)+' 1');
  yes('adding an offered piece advances the shared version',view(a).offerVersion!==own2);
  const validApproval=view(a).offerVersion;say(a,'/trade agree '+validApproval);say(b,'/trade agree '+own2);
  yes('a stale request cannot clear or replace another valid approval',trade().tradeOf(a).okA&&!trade().tradeOf(a).okB&&view(a).offerVersion===validApproval);
  const property=w.box().__thornswoodProperty,company=property.inCompany;
  property.inCompany=pid=>pid===1001;
  const ordinary=view(a).offerVersion;say(b,'/trade sale');
  yes('company-sale mode advances the same shared offer version',!!view(a).sale&&view(a).offerVersion!==ordinary);
  const companyApi=w.box().__thornswoodCompany,terms=companyApi.terms(),soldVersion=view(a).offerVersion;
  say(a,'/trade agree '+soldVersion);
  yes('a first company-sale approval records the payout actually shown',trade().tradeOf(a).okA&&!trade().tradeOf(a).okB);
  const changedTerms=companyApi.propose({...terms,saleWorkerPercent:20},'Fixture staff');
  yes('the actual company terms can change during a live sale',changedTerms.ok&&companyApi.confirm(changedTerms.pending.at,'Fixture reviewer').ok);
  const beforeTermsPacks=packs(),beforeTermsWrites=writes();say(b,'/trade agree '+soldVersion);
  yes('a changed canonical payout invalidates the old offer before recording agreement',!trade().tradeOf(a).okA&&!trade().tradeOf(a).okB&&view(a).offerVersion!==soldVersion&&packs()===beforeTermsPacks&&writes()===beforeTermsWrites);
  yes('the refreshed sale preview uses the canonical changed payout',view(a).sale.cut===companyApi.saleCuts(10).worker&&view(a).sale.seller===companyApi.saleCuts(10).seller);
  const zeroWorker=ui({...view(a),sale:{...view(a).sale,available:true,price:10,cut:0,gone:2,seller:8}});
  yes('the actual sale page shows a remaining fee even when the worker cut is zero',/you receive 8/.test(zeroWorker.doc.getElementById('ts-trade-mine').innerHTML)&&/2 leaves the world/.test(zeroWorker.doc.getElementById('ts-trade-mine').innerHTML));
  const noFees=ui({...view(a),sale:{...view(a).sale,available:true,price:50,cut:0,gone:0,seller:50}});
  yes('a configured fee-free payout does not invent the old price threshold',/whole 50/.test(noFees.doc.getElementById('ts-trade-mine').innerHTML)&&!/Under 10/.test(noFees.doc.getElementById('ts-trade-mine').innerHTML));
  const samePayout=view(a).offerVersion;
  const unrelatedTerms=companyApi.propose({...companyApi.terms(),haulFee:terms.haulFee+1},'Fixture staff');
  yes('an unrelated canonical term can change without altering the payout',unrelatedTerms.ok&&companyApi.confirm(unrelatedTerms.pending.at,'Fixture reviewer').ok);
  say(a,'/trade agree '+samePayout);
  yes('an unchanged effective payout keeps its observed version valid',trade().tradeOf(a).okA&&view(a).offerVersion===samePayout);
  say(a,'/trade gold 0');const beforeFinalPayout=view(a).offerVersion;say(a,'/trade agree '+beforeFinalPayout);
  const cutsAtBoundary=property.saleCuts;let cutReads=0;
  property.saleCuts=price=>{const cuts=cutsAtBoundary(price);return ++cutReads===1?cuts:{...cuts,worker:cuts.worker+1,seller:cuts.seller-1};};
  const finalPacks=packs(),finalWrites=writes();
  try{say(b,'/trade agree '+beforeFinalPayout);}finally{property.saleCuts=cutsAtBoundary;}
  yes('the final sale boundary rechecks the same payout before touching either pack',cutReads>=2&&!trade().tradeOf(a).okA&&!trade().tradeOf(a).okB&&view(a).offerVersion!==beforeFinalPayout&&packs()===finalPacks&&writes()===finalWrites);
  say(b,'/trade gold 0');const zero=view(a).offerVersion;say(a,'/trade agree '+zero);
  yes('a zero-price sale refuses before either approval',!trade().tradeOf(a).okA&&!trade().tradeOf(a).okB);
  say(b,'/trade gold 10');const canonicalCuts=property.saleCuts;
  property.saleCuts=()=>null;say(b,'/trade gold 10');const unavailable=view(a).offerVersion;say(a,'/trade agree '+unavailable);
  yes('unknown company terms refuse before either approval and expose unavailable values',!trade().tradeOf(a).okA&&!trade().tradeOf(a).okB&&view(a).sale.available===false&&view(a).sale.seller===null);
  const unavailableUi=ui(view(b));click(unavailableUi);
  yes('the real page cannot approve a sale with an unavailable payout',unavailableUi.sent.length===0&&unavailableUi.doc.getElementById('ts-trade-ok').disabled===true);
  property.saleCuts=canonicalCuts;
  const saleVersion=view(a).offerVersion;say(b,'/trade sale');
  yes('leaving company-sale mode also advances its version',!view(a).sale&&view(a).offerVersion!==saleVersion);
  property.inCompany=company;
  const pa=ui(view(a)),pb=ui(view(b)),version=view(a).offerVersion;
  const lineA=click(pa),lineB=click(pb);const exchangeWrites=writes();
  say(a,lineA);yes('one valid agreement preserves the version for the other viewer',view(b).offerVersion===version&&view(b).theyAgreed===true);
  say(b,lineB);yes('two valid agreements swap exactly once',!trade().tradeOf(a)&&writes()===exchangeWrites+2);
  const exchanged=packs();say(a,lineA);say(b,lineB);
  yes('replaying completed agreements cannot swap again',packs()===exchanged&&writes()===exchangeWrites+2);
  begin();const session=view(a).offerVersion;trade().cancel(a);begin();
  const reopened=view(a).offerVersion;say(a,'/trade agree '+session);
  yes('an agreement from a cancelled session is refused after reopening',reopened!==session&&!trade().tradeOf(a).okA);
  trade().cancel(a);const beforeReload=reopened;yes('a hot reload succeeds',w.reload());begin();
  const reloaded=view(a).offerVersion;say(a,'/trade agree '+beforeReload);
  yes('hot reload cannot reuse an old session version',reloaded!==beforeReload&&!trade().tradeOf(a).okA);
  trade().cancel(a);yes('a fresh server process starts',w.restart().loaded);[a,b,c].forEach(w.arrive);w.run(30000);begin();
  const restarted=view(a).offerVersion;say(a,'/trade agree '+reloaded);
  yes('restart cannot reuse the previous process version',restarted!==reloaded&&!trade().tradeOf(a).okA);
  say(a,'/trade gold 10');const failedVersion=view(a).offerVersion;say(a,'/trade agree '+failedVersion);
  w.row(a).inventory.entries=w.row(a).inventory.entries.filter(row=>row.baseId!==15);
  const beforeRefusal=writes();say(b,'/trade agree '+failedVersion);
  yes('a rejected swap invalidates both approvals and the observed revision',!!trade().tradeOf(a)&&!trade().tradeOf(a).okA&&!trade().tradeOf(a).okB&&view(a).offerVersion!==failedVersion&&writes()===beforeRefusal);
  const unknown=ui({...view(a),offerVersion:undefined});click(unknown);
  yes('a view with no server-issued version cannot send Agree',unknown.sent.length===0&&unknown.doc.getElementById('ts-trade-ok').disabled===true);
  const malformedUi=ui({...view(a),offerVersion:'not-a-version'});click(malformedUi);
  yes('a malformed view version cannot send Agree either',malformedUi.sent.length===0&&malformedUi.doc.getElementById('ts-trade-ok').disabled===true);
  const direct=trade().confirm(a,view(a).offerVersion,'extra');
  yes('the internal confirmation API also refuses extra arguments before flags',/again/.test(direct)&&!trade().tradeOf(a).okA);
  const tokenBeforeFailure=view(a).offerVersion;
  trade().confirm(a,tokenBeforeFailure);
  const crypto=require('crypto'),randomBytes=crypto.randomBytes;let failed=false;
  crypto.randomBytes=()=>{throw Error('fixture entropy unavailable');};
  try{trade().gold(b,20);}catch(error){failed=/entropy/.test(error.message);}finally{crypto.randomBytes=randomBytes;}
  yes('entropy failure during an offer edit clears approvals and its old version',failed&&!trade().tradeOf(a).okA&&!trade().tradeOf(a).okB&&trade().tradeOf(a).offerVersion==='');
  const failedPacks=packs(),failedWrites=writes();say(b,'/trade agree '+tokenBeforeFailure);
  yes('an old valid token cannot approve an edit whose version mint failed',!trade().tradeOf(a).okB&&packs()===failedPacks&&writes()===failedWrites);
  trade().cancel(a);failed=false;
  crypto.randomBytes=()=>{throw Error('fixture entropy unavailable');};
  try{trade().begin(a,b);}catch(error){failed=/entropy/.test(error.message);}finally{crypto.randomBytes=randomBytes;}
  yes('entropy unavailable at session creation fails closed without opening a trade',failed&&!trade().tradeOf(a)&&!trade().tradeOf(b));
  const finalCompany=w.box().__thornswoodCompany,finalProperty=w.box().__thornswoodProperty,normalMembership=finalProperty.inCompany;
  finalProperty.inCompany=pid=>pid===1001;
  const allCuts=finalCompany.propose({...finalCompany.terms(),saleWorkerPercent:20,saleGonePercent:80},'Fixture staff');
  yes('canonical company terms explicitly accept a hundred-percent total cut',allCuts.ok&&finalCompany.confirm(allCuts.pending.at,'Fixture reviewer').ok&&finalCompany.saleCuts(50).seller===0);
  w.row(a).inventory.entries.push({baseId:15,count:7,name:'Kept coin stack'});
  begin();say(a,'/trade add '+w.idOf(SWORD).toString(16)+' 1');say(b,'/trade gold 50');say(b,'/trade sale');
  const zeroSellerView=view(a),zeroSellerA=ui(zeroSellerView),zeroSellerB=ui(view(b));
  yes('the actual page displays and permits an explicitly offered zero seller share',zeroSellerView.sale.available===true&&zeroSellerView.sale.seller===0&&/you receive 0/.test(zeroSellerA.doc.getElementById('ts-trade-mine').innerHTML)&&!zeroSellerA.doc.getElementById('ts-trade-ok').disabled);
  const sellerGold=w.count(a,15),workerGold=w.count(b,15),sellerItems=w.count(a,w.idOf(SWORD)),workerItems=w.count(b,w.idOf(SWORD)),zeroWrites=writes();
  const zeroAgreeA=click(zeroSellerA),zeroAgreeB=click(zeroSellerB);say(a,zeroAgreeA);say(b,zeroAgreeB);
  yes('two explicit approvals commit canonical zero proceeds without minting a zero-count gold row',!trade().tradeOf(a)&&writes()===zeroWrites+2&&w.count(a,15)===sellerGold&&w.row(a).inventory.entries.some(row=>row.baseId===15&&row.name==='Kept coin stack'&&row.count===7)&&w.count(b,15)===workerGold-40&&w.count(a,w.idOf(SWORD))===sellerItems-1&&w.count(b,w.idOf(SWORD))===workerItems&&[a,b].every(id=>w.row(id).inventory.entries.every(row=>row.count>0)));
  const fullCommission=finalCompany.propose({...finalCompany.terms(),saleWorkerPercent:100,saleGonePercent:0},'Fixture staff');
  yes('canonical terms also permit a full worker commission with zero net cost',fullCommission.ok&&finalCompany.confirm(fullCommission.pending.at,'Fixture reviewer').ok&&finalCompany.saleCuts(50).worker===50&&finalCompany.saleCuts(50).seller===0);
  w.row(a).inventory.entries.push({baseId:w.idOf(SWORD),count:1,name:'Another sample'});
  w.row(b).inventory.entries.find(row=>row.baseId===15).name='Worker coin metadata';
  begin();say(a,'/trade add '+w.idOf(SWORD).toString(16)+' 1');say(b,'/trade gold 50');say(b,'/trade sale');
  const commissionA=ui(view(a)),commissionB=ui(view(b)),workerPack=JSON.stringify(w.row(b).inventory),sellerGoldNow=w.count(a,15),commissionWrites=writes();
  yes('the full-commission offer is displayed and can be explicitly approved',view(a).sale.available===true&&view(a).sale.cut===50&&view(a).sale.gone===0&&view(a).sale.seller===0&&!commissionA.doc.getElementById('ts-trade-ok').disabled);
  const commissionAgreeA=click(commissionA),commissionAgreeB=click(commissionB);say(a,commissionAgreeA);say(b,commissionAgreeB);
  yes('a zero debit preserves the worker pack and its exact coin metadata',!trade().tradeOf(a)&&writes()===commissionWrites+2&&JSON.stringify(w.row(b).inventory)===workerPack&&w.count(a,15)===sellerGoldNow&&w.count(a,w.idOf(SWORD))===0);
  finalProperty.inCompany=normalMembership;
}
t.done(w);
