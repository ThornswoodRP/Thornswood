'use strict';
// Whole queued command path over the stand-in server. The token is correlation
// metadata only; the ordinary gold/rent transaction remains authoritative.
const standIn=require('../../tests/stand-in-server.js');
const fs=require('fs'),path=require('path');
const makePage=require('../../tests/fixtures/panel-page.js');
const t=standIn.checks(),yes=t.yes;
const w=standIn.world({name:'dropbox-receipt'});
const city='1691d:Skyrim.esm',spot=[134265.1,35842.3,-12397.5];
w.record('593b:Thornswood-Content.esp','ACTI');
w.record('154d0:Thornswood-Content.esp','CONT');
w.ref(w.idOf('23592:Skyrim.esm'),{base:'1a2b3:Skyrim.esm',cell:city,pos:[spot[0]+876,spot[1],spot[2]]});
const actor=w.person(0xff000800,{profileId:1000,name:'Brenna',town:'windhelm',cell:city,pos:spot,
  inventory:{entries:[{baseId:0xf,count:100}]}});
yes('the whole gamemode boots',w.boot());if(!w.loaded())t.done(w);
w.arrive(actor);w.run(30000);
function view(){return w.prop(actor,'thornswoodBoxView');}
w.say(actor,'/dropbox gold 10 box-request-a');
yes('accepted gold echoes its exact token at the current box',view().goldRequest==='box-request-a'&&view().hold==='windhelm');
yes('accepted gold uses the ordinary single transaction',w.count(actor,0xf)===90&&view().mineGold===10&&/put 10 gold/.test(view().said));
w.say(actor,'/dropbox gold 999 box-request-b');
yes('a refused gold action echoes its own token and explanation',view().goldRequest==='box-request-b'&&/do not have/.test(view().said));
yes('a refused action moves no gold',w.count(actor,0xf)===90&&view().mineGold===10);
w.say(actor,'/dropbox open');
yes('an unrelated open carries no gold receipt',!Object.hasOwn(view(),'goldRequest'));
w.say(actor,'/dropbox gold 5');
yes('legacy callers without tokens retain ordinary deposit behavior',w.count(actor,0xf)===85&&view().mineGold===15&&!Object.hasOwn(view(),'goldRequest'));
w.say(actor,'/dropbox gold wrong box-request-invalid');
yes('invalid amounts still return their matching refusal receipt',view().goldRequest==='box-request-invalid'&&/whole number/.test(view().said)&&w.count(actor,0xf)===85);
w.say(actor,'/dropbox gold 1 '+'a'.repeat(80));
yes('the exact maximum token length is accepted',view().goldRequest==='a'.repeat(80)&&w.count(actor,0xf)===84);
w.say(actor,'/dropbox records box-request-records');
yes('another action cannot acquire a gold receipt',!Object.hasOwn(view(),'goldRequest'));
for(const token of ['bad_token','a'.repeat(81),'bad<markup>']){
  w.say(actor,'/dropbox gold 1 '+token);
  yes('malformed or overlong tokens are never reflected: '+token.slice(0,12),!Object.hasOwn(view(),'goldRequest'));
}
const before=w.count(actor,0xf);
w.moveTo(actor,city,[spot[0]+10000,spot[1],spot[2]]);
w.say(actor,'/dropbox gold 1 box-request-away');
yes('out-of-reach refusal closes the stale panel with the exact receipt',view().open===false&&view().goldRequest==='box-request-away');
yes('out-of-reach refusal moves no gold',w.count(actor,0xf)===before);
// The actual page's single send now crosses the whole command queue, then
// receives that command's owner view. Delivery is delayed until after clicks.
w.moveTo(actor,city,spot);w.say(actor,'/dropbox open');
const page=makePage(),queued=[];
page.win.thornswoodNet.say=line=>{queued.push(line);return true;};
for(const file of ['thornswood-bridge.js','thornswood-box.js'])page.run(file,fs.readFileSync(path.join(__dirname,'../ui',file),'utf8'));
const panel=page.win.thornswoodBox;panel.setData(view());
page.doc.getElementById('ts-box-gold').value='7';
const button=page.doc.querySelector('[data-do="gold"]');
button.onclick.call(button);button.onclick.call(button);
yes('two actual page clicks queue one real deposit',queued.length===1);
const carried=w.count(actor,0xf);
for(const line of queued)w.say(actor,line);
yes('the queued page press removes the requested gold once',w.count(actor,0xf)===carried-7);
panel.setData(view());
yes('its actual authoritative owner view restores the page control',!page.doc.querySelector('[data-do="gold"]').hasAttribute('disabled'));
t.done(w);
