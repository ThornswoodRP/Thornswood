'use strict';
// Actual page -> bridge -> queued whole gamemode -> saved posting -> actual owner script.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const standIn=require('../../tests/stand-in-server'),makePage=require('../../tests/fixtures/panel-page');
const {attachScenarioReservation}=require('../../tests/fixtures/pack-first');
const t=standIn.checks(),yes=t.yes,root=path.join(__dirname,'../..');
const w=standIn.world({name:'6869-page',settings:{thornswoodServer:'main'}});
const cell='1691d:Skyrim.esm',pos=[134265.1,35842.3,-12397.5];
w.record('593b:Thornswood-Content.esp','ACTI');w.ref(w.idOf('23592:Skyrim.esm'),{base:'1a2b3:Skyrim.esm',cell,pos:[pos[0]+876,pos[1],pos[2]]});
const sender=w.person(0xff006869,{profileId:1000,name:'Brenna',cell,pos,inventory:{entries:[{baseId:15,count:10000}]}});
let clock=0;
function feed(p,value){
 const owner=w.propertyDefinition('thornswoodSocialView');
 const data=value||w.box().__thornswoodSocial.view(sender);data.at=++clock;
 new Function('ctx',owner.updateOwner)({value:data,state:p.ownerState,sp:{browser:{executeJavaScript:s=>p.run('owner-delivery',s)}}});
 p.prepare();return data;
}
function page(){
 const p=makePage();p.ownerState={};p.win.crypto={getRandomValues:a=>crypto.randomFillSync(a)};
 for(const f of ['bridge','board'])p.run(f,fs.readFileSync(path.join(root,'game/ui/thornswood-'+f+'.js'),'utf8'));
 p.field=id=>p.doc.getElementById('ts-board-'+id);
 p.prepare=()=>{for(const f of p.doc.querySelectorAll('input,select'))if(!f.setCustomValidity){f.validationMessage='';f.validity={customError:false};f.setCustomValidity=s=>{f.validationMessage=String(s);f.validity.customError=!!s;};f.reportValidity=()=>!f.validity.customError;}};
 feed(p);p.win.thornswoodBoard.open();p.prepare();
 p.press=kind=>{const b=p.doc.querySelector('[data-do="'+kind+'"]');const e=p.fire(b,'click','');if(!e.defaultPrevented&&b.onclick)b.onclick.call(b,e);};
 p.fill=(kind,values,events)=>{for(const [id,value]of Object.entries(values)){p.field(id).value=value;if(events)p.fire(p.field(id),id==='dest'?'change':'input');}};
 p.values=kind=>(kind==='letter'?['to','letter']:['pay','dest','haul']).map(id=>p.field(id)?.value);
 p.flush=()=>{for(const line of p.sent.splice(0))w.say(sender,line);w.run(2200);};
 return p;
}
try{
 yes('whole gamemode loads',w.boot());if(w.loaded()){
  attachScenarioReservation(w);w.arrive(sender);w.run(30000);
  for(const kind of ['letter','haul']){
   const p=page();p.fill(kind,kind==='letter'?{to:'Lydia "Red" Stone',letter:'SEALED-PAGE-6869'}:{pay:' 25 ',dest:'whiterun',haul:' Full crates  with "labels" '});
   const before=p.values(kind);w.holdSaves(true);p.press(kind);
   yes(kind+' uses one private correlated request with the exact board hold',p.sent.length===1&&p.sent[0].startsWith('/board-submit-v1 ')&&JSON.parse(p.sent[0].slice('/board-submit-v1 '.length))[2]==='windhelm');
   yes(kind+' invoking send preserves the complete raw draft',JSON.stringify(p.values(kind))===JSON.stringify(before));
   p.flush();feed(p);
   yes(kind+' pending live debit or saved intent cannot clear the draft',JSON.stringify(p.values(kind))===JSON.stringify(before));
   w.holdSaves(false);w.run(4000);feed(p);
   yes(kind+' only the saved posting clears its submitted fields',kind==='letter'?p.values(kind).every(v=>v===''):p.values(kind)[0]===''&&p.values(kind)[2]==='');
   const posted=w.readPrivate('property.json').notices.windhelm.at(-1);
   yes(kind+' keeps its canonical fee and stored content',kind==='letter'?posted.to==='Lydia "Red" Stone'&&posted.text==='SEALED-PAGE-6869':posted.pay===25&&posted.dest==='whiterun'&&posted.text==='Full crates with "labels"');
  }
  const actual=()=>w.box().__thornswoodSocial.view(sender);
  const copy=value=>JSON.parse(JSON.stringify(value));
  const receiptOnly=(value,id)=>{const next=copy(value);next.boardSubmissions.results=next.boardSubmissions.results.filter(r=>r.id===id);return next;};
  const request=p=>JSON.parse(p.sent.at(-1).slice('/board-submit-v1 '.length));
  function ready(body){const p=page();p.fill('letter',{to:'Lydia',letter:body});return p;}
  for(const mode of ['edit','aba','direct']){
   const p=ready('Original '+mode);p.press('letter');p.flush();
   if(mode==='aba'){p.fill('letter',{letter:'Away'},true);p.fill('letter',{letter:'Original '+mode},true);}
   else p.fill('letter',{letter:'Newer '+mode},mode==='edit');
   const before=p.values('letter');feed(p);
   yes(mode+' newer draft survives a real earlier committed result',JSON.stringify(p.values('letter'))===JSON.stringify(before));
   feed(p);yes(mode+' duplicate owner results cannot clear a retired draft',JSON.stringify(p.values('letter'))===JSON.stringify(before));
  }
  {
   const p=ready('Closed pending');p.press('letter');p.flush();p.win.thornswoodBoard.close();feed(p);p.win.thornswoodBoard.open();p.prepare();
   yes('a committed response while closed clears the exact hidden draft before reopen',p.values('letter').every(v=>v===''));
  }
  {
   const p=ready('While composing');p.press('letter');p.flush();p.press('compose');
   p.field('title').value='Another notice';p.fire(p.field('title'),'input');p.field('text').value='Unsaved notice text';p.fire(p.field('text'),'input');feed(p);
   yes('a letter receipt never clears another composing notice',p.field('title').value==='Another notice'&&p.field('text').value==='Unsaved notice text');
   p.press('back');yes('returning from composer reveals only the acknowledged letter cleared',p.values('letter').every(v=>v===''));
  }
  {
   const p=ready('Board context');p.press('letter');p.flush();const receipt=actual();
   const away=copy(receipt);away.board=null;away.boardSubmissions.results=[];feed(p,away);
   const back=copy(receipt);back.boardSubmissions.results=[];feed(p,back);feed(p,receipt);
   yes('board away and back cannot revive the old submission context',p.field('letter').value==='Board context');
  }
  {
   const p=ready('Runtime ownership');p.press('letter');p.flush();const old=actual(),mp=w.mp(),native=mp.getActorRuntimeIdentity;
   try{
    mp.getActorRuntimeIdentity=actor=>actor===sender?'999991':native.call(mp,actor);feed(p);
    yes('unchanged profile and descriptor with a new native runtime preserve the draft',p.field('letter').value==='Runtime ownership');
   }finally{mp.getActorRuntimeIdentity=native;}
   feed(p,old);yes('a delayed old owner tuple cannot revive retired correlations',p.field('letter').value==='Runtime ownership');
  }
  for(const malformed of ['missing','wrong-profile','wrong-runtime']){
   const p=ready('Identity '+malformed);p.press('letter');p.flush();const good=actual(),bad=copy(good);
   if(malformed==='missing')bad.boardSubmissions=null;
   if(malformed==='wrong-profile')bad.boardSubmissions.owner.profileId=1001;
   if(malformed==='wrong-runtime')bad.boardSubmissions.owner.runtime='0';
   feed(p,bad);feed(p,good);
   yes(malformed+' owner evidence cannot clear or later revive the draft',p.field('letter').value==='Identity '+malformed);
  }
  {
   const p=ready('Validate results');p.press('letter');const id=request(p)[1];p.flush();const good=actual(),bad=copy(good);
   bad.boardSubmissions.results=[{id,kind:'haul',hold:'windhelm',status:'posted'},{id,kind:'letter',hold:'riften',status:'posted'},{id,kind:'letter',hold:'windhelm',status:'pending'},{id:'not-a-token',kind:'letter',hold:'windhelm',status:'posted'}];
   feed(p,bad);yes('malformed foreign-kind hold and pending results never clear a draft',p.field('letter').value==='Validate results');
   feed(p,receiptOnly(good,id));yes('ignoring malformed results still permits its later real committed result',p.values('letter').every(v=>v===''));
   const fresh=page();fresh.fill('letter',{to:'Lydia',letter:'Fresh page draft'},true);feed(fresh,good);
   yes('a new page instance ignores historical committed results',fresh.field('letter').value==='Fresh page draft');
  }
  {
   const p=ready('First request');p.press('letter');const first=request(p)[1];p.flush();
   p.fill('letter',{letter:'Second request'},true);p.press('letter');const second=request(p)[1];p.flush();const both=actual();
   feed(p,receiptOnly(both,first));yes('an earlier result cannot erase the later pending edit',p.field('letter').value==='Second request');
   feed(p,receiptOnly(both,second));yes('the current matching result clears after out-of-order delivery',p.values('letter').every(v=>v===''));
   p.fill('letter',{to:'Lydia',letter:'Second request'},true);feed(p,both);
   yes('duplicate results never clear newly typed identical content',p.field('letter').value==='Second request');
  }
  {
   const p=ready('Two forms');p.fill('haul',{pay:'15',dest:'whiterun',haul:'A second form'});
   p.press('letter');p.flush();p.press('haul');p.flush();feed(p);
   yes('letter and haul requests can coexist and clear only their matching forms',p.values('letter').every(v=>v==='')&&p.field('pay').value===''&&p.field('haul').value==='');
  }
  {
   const p=ready('Two identical posts');p.press('letter');p.flush();p.press('letter');p.flush();feed(p);
   yes('identical successful requests clear once without claiming an empty newer draft was kept',p.values('letter').every(v=>v==='')&&!/newer draft/.test(p.field('action-status').textContent));
  }
  for(const delivery of ['queued','throws']){
   const p=ready('Uncertain '+delivery);let calls=0;
   p.win.thornswoodNet.say=line=>{calls++;p.sent.push(line);if(delivery==='throws')throw Error('after queue');return false;};
   p.press('letter');yes(delivery+' delivery retains prose and sends once without success claim',calls===1&&p.field('letter').value==='Uncertain '+delivery&&/unconfirmed/.test(p.field('action-status').textContent));
   p.flush();feed(p);yes(delivery+' delivery can still be followed by a real committed acknowledgement',calls===1&&p.values('letter').every(v=>v===''));
  }
  {
   const p=ready('Reentrant result');let calls=0;const before=w.count(sender,15);
   p.win.thornswoodNet.say=line=>{calls++;p.sent.push(line);p.flush();feed(p);throw Error('after real commit');};
   p.press('letter');yes('a synchronous real owner result is correlated before a later send exception',calls===1&&w.count(sender,15)===before-35&&p.values('letter').every(v=>v==='')&&/post was saved/.test(p.field('action-status').textContent));
  }
  {
   const p=ready('Bounded pending'),ids=[];let firstResult;
   for(let i=0;i<17;i++){p.press('letter');ids.push(request(p)[1]);p.flush();if(i===0)firstResult=receiptOnly(actual(),ids[0]);}
   yes('seventeen explicit sends all proceed once with distinct secure request identities',ids.length===17&&new Set(ids).size===17);
   feed(p,firstResult);yes('an evicted correlation cannot clear a later identical draft',p.field('letter').value==='Bounded pending');
   yes('retiring an old correlation has a persistent mounted unconfirmed notice',/earlier send is still unconfirmed/.test(p.field('action-status').textContent));
   feed(p,receiptOnly(actual(),ids[16]));yes('the newest matching result still clears after pending eviction',p.values('letter').every(v=>v===''));
  }
  {
   const p=ready('No crypto');p.win.crypto=null;p.press('letter');yes('missing secure random source keeps the draft with no fallback or send',p.sent.length===0&&p.field('letter').value==='No crypto');
   const q=ready('Overlong '+ 'x'.repeat(8300));q.press('letter');yes('an oversized private request is refused whole without truncating the draft',q.sent.length===0&&q.field('letter').value.length>8300);
  }
  for(const field of ['to','letter'])for(const invalid of ['bad\ud800text','bad\udc00text']){
   const p=ready('Valid body');p.fill('letter',{[field]:invalid});const values=p.values('letter');p.press('letter');
   yes(field+' unpaired UTF16 keeps the mounted refusal and raw draft',p.sent.length===0&&JSON.stringify(p.values('letter'))===JSON.stringify(values)&&/invalid text/.test(p.field('letter-reason').textContent));
  }
  {
   const p=page();p.fill('haul',{pay:'15'+'x'.repeat(8300),dest:'whiterun',haul:'Snapshot bound'});const before=p.values('haul');p.press('haul');
   const sent=p.sent.length===1&&JSON.parse(p.sent[0].slice('/board-submit-v1 '.length));p.flush();feed(p);
   yes('oversized raw snapshot sends valid derived pay once untracked and retains its draft',!!sent&&sent[3]==='15'&&JSON.stringify(p.values('haul'))===JSON.stringify(before)&&/unconfirmed/.test(p.field('action-status').textContent));
   p.fill('haul',{pay:'15',haul:'Normal tracking resumes'},true);p.press('haul');p.flush();feed(p);
   yes('normal correlation tracking still works after oversized raw input is corrected',p.field('pay').value===''&&p.field('haul').value==='');
  }
 }
}finally{t.done(w);}
