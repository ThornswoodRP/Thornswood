'use strict';
// Whole gamemode owns session identity; the real page and bridge consume it.
const fs=require('fs'),path=require('path');
const standIn=require('../../tests/stand-in-server'),makePage=require('../../tests/fixtures/panel-page');
const root=path.join(__dirname,'../..'),t=standIn.checks(),yes=t.yes;
const w=standIn.world({name:'4769-session',settings:{thornswoodServer:'main'}});
const SWORD='12eb7:Skyrim.esm';w.record(SWORD,'WEAP',{editorId:'IronSword'});
const a=w.person(0xff004769,{profileId:1000,name:'Brenna',cell:'3c:Skyrim.esm',pos:[0,0,0],inventory:{entries:[{baseId:w.idOf(SWORD),count:2},{baseId:15,count:100}]}});
const b=w.person(0xff00476a,{profileId:1001,name:'Aldis',cell:'3c:Skyrim.esm',pos:[50,0,0],inventory:{entries:[{baseId:15,count:100}]}});
const c=w.person(0xff00476b,{profileId:1002,name:'Aldis',cell:'3c:Skyrim.esm',pos:[100,0,0]});
const api=()=>w.box().__thornswoodTrade,view=id=>w.prop(id,'thornswoodTrade')||{};
function say(id,line){w.say(id,line);w.run(2100);return w.heard(id).at(-1)||'';}
yes('the whole gamemode loads',w.boot());
if(w.loaded()){
 [a,b,c].forEach(w.arrive);w.run(30000);api().begin(a,b);
 const first=view(a).sessionId;
 yes('both owner views share one bounded immutable public session identity',typeof first==='string'&&/^[a-f0-9]{48}$/.test(first)&&view(b).sessionId===first);
 yes('opening reuses its already minted offer identity without another generator',first===view(a).offerVersion);
 const version=view(a).offerVersion;say(a,'/trade gold 10');
 yes('editing rotates the offer version while retaining the session identity',typeof first==='string'&&view(a).sessionId===first&&view(a).offerVersion!==version);
 const answerForSession=api().confirm(a,first);
 yes('the public session identity cannot approve a changed offer',/again/.test(answerForSession)&&!api().tradeOf(a).okA&&!api().tradeOf(a).okB);
 say(a,'/trade add 12eb7 1');say(a,'/trade remove 12eb7');say(b,'/trade refresh');
 yes('add remove and owner refresh all retain this same session',typeof first==='string'&&view(a).sessionId===first&&view(b).sessionId===first);
 const membership=w.box().__thornswoodProperty.inCompany;w.box().__thornswoodProperty.inCompany=pid=>pid===1001;
 say(b,'/trade sale');say(b,'/trade sale');w.box().__thornswoodProperty.inCompany=membership;
 yes('company-sale mode changes never change the session identity',typeof first==='string'&&view(a).sessionId===first);
 const p=makePage();p.run('bridge',fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8'));p.run('trade',fs.readFileSync(path.join(root,'game/ui/thornswood-trade.js'),'utf8'));
 // A native parsed input starts with its value attribute as its live value.
 const panel=p.doc.getElementById('ts-trade'),query=panel.querySelector;
 panel.querySelector=function(selector){const node=query.call(this,selector);if(node&&node.tagName==='INPUT'&&!node._nativeValue){node.value=node.getAttribute('value')||'';node._nativeValue=true;}return node;};
 const field=()=>p.doc.getElementById('ts-trade-gold');
 const value=()=>field().getAttribute('value');
 const type=raw=>{field().value=raw;if(field().oninput)field().oninput.call(field());};
 const update=()=>p.win.thornswoodTrade.setData(view(a));
 update();type('37');say(b,'/trade gold 5');update();
 yes('an actual other-pile update preserves the page unsent gold',value()==='37');
 p.doc.querySelector('[data-do="gold"]').click();say(a,p.sent.at(-1));update();
 yes('the actual queued Set uses the draft then shows the accepted authoritative amount',view(a).myGold===37&&value()==='37');
 type('999');p.doc.querySelector('[data-do="gold"]').click();const answer=say(a,p.sent.at(-1));
 say(a,'/trade refresh');update();
 yes('a real server refusal never changes the offer and later authority owns submitted text',/only have/.test(answer)&&view(a).myGold===37&&value()==='37');
 type('24');api().cancel(a);api().begin(a,b);update();
 yes('same-partner reopening has a different identity and resets drafts even if close was coalesced',view(a).sessionId!==first&&value()==='0');
 const reopened=view(a).sessionId;type('19');api().cancel(a);api().begin(a,c);update();
 yes('a different same-named partner has a distinct session and no inherited draft',view(a).sessionId!==reopened&&value()==='0');
 const beforeReload=view(a).sessionId;api().cancel(a);w.reload();api().begin(a,b);
 yes('reload cannot recycle a previous session identity',view(a).sessionId!==beforeReload&&typeof view(a).sessionId==='string');
 yes('the queued path and timers have no uncaught faults',w.faults.length===0&&w.threw.length===0);
}
t.done(w);
