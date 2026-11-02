'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),crypto=require('node:crypto');
const author=require('../game/data/merchant-quests.json'),activation=require('../game/data/merchant-quest-activation.json');
const rows=activation.killScenes.map(pin=>{
 const row=author.quests.find(row=>row.id===pin.id);
 assert.equal(pin.sha256,crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex'));
 return {...row,sourceHash:pin.sha256};
});
// Publication is an append-only persistence contract. Changes use a new ID;
// an accepted job must not silently acquire a different deed or reward.
const published={
 'q-whiterun-tailor-cloth-road':'6f6cf4c63de266dff8edfee2ab72213ed9699756c274004d62f775ec3cbfb68f',
 'q-winterhold-enchanter-coast':'518c9b2210f63ee6ec1b6b6f388c862c6f5ed9dca284dfb21b115f9350928146',
 'q-rift-tailor-northwind-work':'fcddb1a76415ade5c37bd149b28a0235a90d9a57ffb7c07176a6ccfd6a0ad239',
 'q-whiterun-enchanter-shimmermist':'402f870a3f8d330987e97d83c14a5ef54f1474fd3b3fbb644ec38e00928041f4'
};
for(const [id,hash] of Object.entries(published))assert.equal(activation.killScenes.find(row=>row.id===id)?.sha256,hash);
const mode=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8')),bundleContext={require,Buffer,Uint8Array};
vm.createContext(bundleContext);
vm.runInContext(mode.slice(mode.indexOf('// MERCHANT TRADING BUNDLE BEGIN'),mode.indexOf('// MERCHANT TRADING BUNDLE END'))+
 '\nglobalThis.rows=MERCHANT_TRADING.expandedScenes();',bundleContext);
assert.deepEqual(JSON.parse(JSON.stringify(bundleContext.rows)),rows,'the actual hot-reload bundle carries only the reviewed published rows');
const buildFile=path.join(__dirname,'../scripts/dev/Build-MerchantGamemode.js');
for(const defect of ['hash','missing','commission','duplicate','too-many']) {
 const pins=JSON.parse(JSON.stringify(activation));
 if(defect==='hash')pins.killScenes[0].sha256='0'.repeat(64);
 if(defect==='missing')pins.killScenes[0].id='q-no-such-work';
 if(defect==='commission') {
  const row=author.quests.find(row=>row.kind==='commission');pins.killScenes[0]={id:row.id,
   sha256:crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex')};
 }
 if(defect==='duplicate')pins.killScenes[1]=pins.killScenes[0];
 if(defect==='too-many')pins.killScenes.push({id:'q-extra',sha256:'0'.repeat(64)});
 const fakeFs={readFileSync(file,...args){return file.endsWith('merchant-quest-activation.json')?JSON.stringify(pins):fs.readFileSync(file,...args);},
   writeFileSync(){throw Error('activation validation must never write source');}};
 assert.throws(()=>vm.runInNewContext(fs.readFileSync(buildFile,'utf8'),{__dirname:path.dirname(buildFile),
   require:name=>name==='node:fs'?fakeFs:require(name),process:{argv:['node',buildFile,'--check']},console:{log(){}}}),
   /activation|activated|changed/i,defect);
}
const file=path.join(__dirname,'test-1621-quest-state.js'),context={require:createRequire(file),__dirname,Buffer,JSON,console:{log(){}}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(file,'utf8').split('let w = boot();')[0]+`
globalThis.fixture={boot,form,clock,fault,npcIds,npcStates,PROP,block,
 reset(){forms={};clock.now=2000000000000;fault.read=null;fault.write=false;fault.noAdd=[];fault.throwAdd=[];
 Object.values(npcStates).forEach(row=>{row.isDead=false;row.lifeGeneration=0;row.runtimeLifeIdentity='100';});}};`,context);
const fixture=context.fixture,copy=value=>JSON.parse(JSON.stringify(value));
const positions=Object.fromEntries(Object.entries(fixture.npcStates).map(([id,row])=>[id,row.pos.slice()]));
const roster=require('../game/data/merchant-roster.json').merchants;
function world(reset=true) {
 if(reset){fixture.reset();for(const [id,row] of Object.entries(fixture.npcStates))row.pos=positions[id].slice();}
 const result=fixture.boot(undefined,undefined,rows);
 assert.ok(result.svc,result.logged.join('\n'));
 result.ctx.__questRankRead=()=>({v:1,cls:'miner',prof:'warrior',ranks:{warrior:'master',mage:'master'}});
 result.ctx.__thornswoodMerchantTrade.questRole=id=>roster.find(row=>row.reference===fixture.npcStates[id]?.ref)?.role;
 result.ctx.__thornswoodMerchantTrade.questHold=id=>roster.find(row=>row.reference===fixture.npcStates[id]?.ref)?.hold;
 result.merchant=row=>fixture.npcIds[row.merchant.reference];
 result.prof=row=>{
   const profession=row.gate.profession,standing=profession==='mage'?'destruction':
     Object.keys(result.ctx.__thornswoodProgression.TABLE.professions[profession].halves)[0];
   result.ctx.__questRankRead=()=>({v:1,cls:'miner',prof:profession,schools:['destruction'],ranks:{[standing]:'master'}});
 };
 result.record=()=>copy(fixture.form(1).props[fixture.PROP]);
 result.token=row=>'@'+(fixture.form(1).props[fixture.PROP]?.sceneBudget?.held?.[row.id]?.token || 0);
 result.finish=row=>result.svc.turnIn(1,row.id,result.merchant(row),undefined,result.token(row));
 result.action=(verb,row,token)=>result.svc.act(1,verb,row.id,token || result.token(row),result.merchant(row));
 result.take=row=>{result.prof(row);return result.svc.offer(1,row.id,{traderRef:result.merchant(row)});};
 result.defeat=row=>row.targets.slice(0,row.count).forEach(target=>{
   const id=fixture.npcIds[target.ref];fixture.npcStates[id].isDead=true;
   assert.equal(result.svc.noteKill(1,id).ok,true);
 });
 return result;
}
assert.equal(rows.length,4);
for(const row of rows) {
 let w=world();const accepted=w.take(row);assert.equal(accepted.ok,true,row.id+' '+JSON.stringify(accepted)+' '+w.logged.join('\n'));
 let record=w.record();assert.equal(record.sceneBudget.held[row.id].gold,row.rewardGold);
 assert.equal(record.open[row.id].terms.gold,row.rewardGold);
 const wrong=roster.find(other=>other.role===row.merchant.role && other.hold!==row.merchant.hold);
 assert.equal(w.svc.offer(2,row.id,{traderRef:fixture.npcIds[wrong.reference]}).ok,false,'same trade in another hold cannot offer this work');
 w.defeat(row);const before=w.record();fixture.fault.write=true;
 assert.equal(w.finish(row).ok,false);
 assert.deepEqual(w.record(),before,'failed reward cannot consume progress or its reservation');
 fixture.fault.write=false;fixture.clock.now+=10;
 w=world(false);assert.equal(w.finish(row).ok,true,'accepted work survives recreation without a fresh gate');
 record=w.record();assert.equal(record.open[row.id],undefined);assert.equal(record.sceneBudget.held[row.id],undefined);
 assert.deepEqual(record.sceneBudget.paid,[[fixture.clock.now,row.rewardGold]]);
 assert.equal(fixture.form(1).inv['f:Skyrim.esm'],row.rewardGold);
 assert.equal(w.finish(row).ok,false,'cannot pay twice');
}
console.log('PASS four playable merchant scenes, source bindings, saved original terms and atomic one-time rewards');
{
 const w=world(),row=rows[0];w.prof(row);
 const role=w.ctx.__thornswoodMerchantTrade.questRole;
 w.ctx.__thornswoodMerchantTrade.questRole=()=>'';
 assert.equal(w.svc.describe(1,w.merchant(row)).some(offer=>offer.id===row.id),false,'an empty role cannot advertise an expanded job');
 assert.equal(w.take(row).ok,false,'an empty role cannot accept an expanded job');
 w.ctx.__thornswoodMerchantTrade.questRole=role;assert.equal(w.take(row).ok,true);w.defeat(row);
 w.ctx.__thornswoodMerchantTrade.questRole=()=>'';const before=w.record();
 assert.equal(w.finish(row).ok,false,'an empty role cannot pay an expanded job');
 assert.deepEqual(w.record(),before);
}
{
 const w=world(),row=rows[0];assert.equal(w.take(row).ok,true);const oldToken=w.token(row);
 assert.equal(w.action('abandon',row).ok,true);assert.equal(w.take(row).ok,true);
 const newer=Number(w.token(row).slice(1)),older=Number(oldToken.slice(1));
 assert.ok(Number.isSafeInteger(older) && older>0 && Number.isSafeInteger(newer) && newer>older);
 const before=w.record();
 assert.equal(w.action('abandon',row,oldToken).why,'session');
 assert.equal(w.svc.turnIn(1,row.id,w.merchant(row),undefined,oldToken).why,'session');
 assert.equal(w.svc.turnIn(1,row.id,w.merchant(row)).why,'session','direct return requires its original token');
 assert.equal(w.svc.walkAway(1,row.id).why,'session','direct entry cannot omit the original action token');
 assert.deepEqual(w.record(),before,'an old or missing button token cannot change the newer same-ID job');
}
{
 const w=world(),row=rows[0],now=fixture.clock.now;
 fixture.form(1).props[fixture.PROP]={v:1,open:{},cool:{},sceneBudget:{v:1,clock:now,serial:Number.MAX_SAFE_INTEGER-1,held:{},paid:[]}};
 assert.equal(w.take(row).ok,true);assert.equal(Number(w.token(row).slice(1)),Number.MAX_SAFE_INTEGER);
 assert.equal(w.action('abandon',row).ok,true);const before=w.record();
 assert.equal(w.take(row).ok,false,'an exhausted reservation counter cannot wrap or reuse a token');
 assert.deepEqual(w.record(),before);
}
for(const row of rows) {
 const w=world();w.ctx.__questRankRead=()=>({v:1,cls:'miner',prof:row.gate.profession,schools:['destruction'],ranks:{}});
 const before=copy(fixture.form(1));
 assert.equal(w.svc.describe(1,w.merchant(row)).find(offer=>offer.id===row.id).canTake,false);
 assert.equal(w.svc.offer(1,row.id,{traderRef:w.merchant(row)}).why,'eligibility');
 assert.deepEqual(copy(fixture.form(1)),before,'locked offers cannot reserve rewards or change progression');
}
{
 const w=world(),row=rows[0];let session=true;
 w.ctx.__thornswoodMerchantTrade.questAdmission=()=>()=>session;
 w.ctx.__beforeQuestCommit=()=>{session=false;};
 assert.equal(w.take(row).ok,false);assert.equal(fixture.form(1).props[fixture.PROP],undefined,'closed conversations leave no reservation');
}
{
 const w=world(),row=rows[0];
 w.ctx.__beforeQuestCommit=()=>{w.ctx.__questRankRead=()=>({v:1,prof:'cook',ranks:{hearthcook:'master'}});};
 assert.equal(w.take(row).ok,false);assert.equal(fixture.form(1).props[fixture.PROP],undefined,'final eligibility also guards the reserved payment');
}
{
 const w=world();for(const row of rows.slice(0,3))assert.equal(w.take(row).ok,true);
 const before=w.record();assert.equal(w.take(rows[3]).why,'open-limit');assert.deepEqual(w.record(),before);
 w.defeat(rows[0]);assert.equal(w.finish(rows[0]).ok,true);
 assert.equal(w.take(rows[3]).ok,true,'a completed reservation frees an open slot, while its paid gold remains counted');
 assert.equal(Object.keys(w.record().sceneBudget.held).length,3);
}
{
 const w=world(),row=rows[0],now=fixture.clock.now;
 fixture.form(1).props[fixture.PROP]={v:1,open:{},cool:{},unrelated:{keep:'yes'},
   sceneBudget:{v:1,clock:now,serial:15,held:{},paid:Array.from({length:15},()=>[now,10])}};
 const full=w.record();assert.equal(w.take(row).why,'allowance');assert.deepEqual(w.record(),full);
 fixture.clock.now+=86400000-1;assert.equal(w.take(row).why,'allowance');
 fixture.clock.now++;assert.equal(w.take(row).ok,true,'the half-open rolling window expires at the exact boundary');
 assert.equal(w.record().sceneBudget.held[row.id].token,16,'pruning paid history never resets replay identity');
 assert.deepEqual(w.record().unrelated,{keep:'yes'});
}
{
 const w=world(),row=rows[0];assert.equal(w.take(row).ok,true);
 fixture.clock.now+=86400000*2;w.defeat(row);
 assert.equal(w.finish(row).ok,true);
 assert.equal(w.record().sceneBudget.paid[0][0],fixture.clock.now,'late work uses successful payout time, not its old reservation time');
}
{
 const w=world(),a=rows[0],b=rows[2];assert.equal(w.take(a).ok,true);assert.equal(w.take(b).ok,true);
 const saved=fixture.form(1).props[fixture.PROP];saved.sceneBudget.paid=[[fixture.clock.now-1,100]];saved.sceneBudget.serial=3;
 saved.open[a.id].terms.hash='damaged';saved.open[a.id].terms.token=saved.open[b.id].terms.token;
 const before=w.record(),view=w.svc.describe(1,w.merchant(a)).find(row=>row.id===a.id);
 assert.equal(view.recovery,true);assert.equal(view.canAbandon,true);assert.equal(view.canReturn,false);
 assert.equal(w.action('abandon',a).ok,true,'abandon reconciles this same-ID current liability without trusting damaged copied terms');
 const after=w.record();assert.equal(after.open[a.id],undefined);assert.equal(after.sceneBudget.held[a.id],undefined);
 assert.deepEqual(after.sceneBudget.held[b.id],before.sceneBudget.held[b.id],'cannot release the other contract token');
 assert.deepEqual(after.sceneBudget.paid,before.sceneBudget.paid,'cancellation preserves payout evidence');
 assert.equal(after.cool[a.id],undefined);assert.equal(fixture.form(1).inv['f:Skyrim.esm'],undefined);
}
{
 const w=world(),row=rows[0];assert.equal(w.take(row).ok,true);
 delete fixture.form(1).props[fixture.PROP].open[row.id];
 const view=w.svc.describe(1,w.merchant(row)).find(offer=>offer.id===row.id);
 assert.equal(view.state,'open');assert.equal(view.canAbandon,true,'an orphan reservation has an explicit no-payment recovery action');
 assert.equal(w.action('abandon',row).ok,true);
 assert.equal(w.record().sceneBudget.held[row.id],undefined);
}
{
 const w=world(),row=rows[0];assert.equal(w.take(row).ok,true);
 fixture.form(1).props[fixture.PROP].sceneBudget={v:99};const before=w.record();
 const view=w.svc.describe(1,w.merchant(row)).find(offer=>offer.id===row.id);
 assert.equal(view.canAbandon,false);assert.match(view.check,/staff/);
 assert.equal(w.action('abandon',row).why,'recovery');
 assert.equal(w.take(rows[2]).ok,false);assert.deepEqual(w.record(),before,'structurally corrupt payment evidence requires trusted recovery and is never erased');
}
{
 const w=world(),a=rows[0],b=rows[2];let nested=false;
 w.ctx.__beforeQuestCommit=()=>{if(!nested){nested=true;assert.equal(w.take(b).ok,true);}};
 assert.equal(w.take(a).ok,false,'the earlier expected record cannot overwrite a competing acceptance');
 assert.deepEqual(Object.keys(w.record().sceneBudget.held),[b.id]);
 assert.deepEqual(Object.keys(w.record().open),[b.id]);
}
{
 const w=world(),row=rows[0];fixture.form(1).props[fixture.PROP]={v:1,open:{},cool:{},unknown:'x'.repeat(16384)};
 const before=w.record();assert.equal(w.take(row).ok,false);
 assert.deepEqual(w.record(),before,'capacity refusal preserves all prior data and creates no liability');
 assert.deepEqual(copy(fixture.form(1).inv),{});
}
for(const row of rows) {
 const w=world();assert.equal(w.take(row).ok,true);
 const id=fixture.npcIds[row.targets[0].ref],state=fixture.npcStates[id];state.isDead=true;state.pos=state.pos.map(value=>value+100000);
 const before=w.record();assert.equal(w.svc.noteKill(1,id).ok,false);assert.deepEqual(w.record(),before,'out-of-leash sources never credit');
}
{
 const w=world();for(const row of rows.slice(0,3))assert.equal(w.take(row).ok,true);
 const saved=fixture.form(1).props[fixture.PROP],now=fixture.clock.now;
 saved.sceneBudget.serial=Number.MAX_SAFE_INTEGER;
 saved.sceneBudget.paid=Array.from({length:9},()=>[now-1,10]);
 saved.legacy={retained:'x'.repeat(1024)};
 const legacy=w.svc.lineup();
 for(const old of legacy.scarce.concat(legacy.scene).filter(old=>!old.id.startsWith('q-')))saved.cool[old.id]=now+86400000;
 // All20 owned target histories can coexist with the three original-term
 // records and the largest valid remaining paid list for these60 held gold.
 const legacySources=require('../game/kill-contracts').createKillContracts({mp:w.ctx.mp,
   population:{keep:require('../game/data/npc-population.json').npcs.filter(row=>row.keep).map(row=>
     [row.ref,row.base,row.world||row.cell,row.pos,row.leash,row.returnMinutes,row.role,row.habitat,row.tier,row.cap,row.populationBucket,0,row.species])},
   raceOf:id=>fixture.npcStates[id].race,identity:()=> 'actor:1'}).rows;
 saved.killHistory={};
 for(const ref of legacySources.flatMap(row=>row.refs).concat(rows.flatMap(row=>row.targets.map(target=>target.ref))))
   saved.killHistory[ref]=Number.MAX_SAFE_INTEGER;
 assert.equal(Object.keys(saved.killHistory).length,20);
 const size=Buffer.byteLength(JSON.stringify(saved));assert.ok(size<16384,'the complete representative property must fit the native limit');
 assert.equal(require('../game/scene-reward-budget').inspect(copy(saved.sceneBudget),now).ok,true);
 console.log('PASS full scene property capacity:',size,'UTF-8 bytes, including1024 retained unknown bytes');
}
console.log('PASS shared allowance, recovery, receipt-safe competition, lifecycle and property-capacity boundaries');
