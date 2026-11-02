'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{h}=require('./merchant-retrieval-fixture');
const plots=require('../game/quest-orchard-plots'),data=require('../game/data/merchant-orchard.json');
const copy=v=>JSON.parse(JSON.stringify(v));
const cleanup=[];process.once('exit',()=>cleanup.forEach(fn=>fn()));
const farmProcess={cwd:()=>process.cwd(),chdir:p=>process.chdir(p),on:(event,fn)=>{assert.equal(event,'exit');cleanup.push(fn);}};
function setup(options={}) {
 h.reset();h.fault.write=false;h.fault.noAdd=[];h.clock.now=1000000;
 let saved={version:1,entries:Object.fromEntries(data.sources.map(r=>[r.reference,null]))},valid=true,rank='expert';
 const store=plots.createOrchardPlots({durable:true,load:()=>copy(saved),save:doc=>{saved=copy(doc);return true;}},Object.keys(saved.entries));
 const into=h.boot().ctx,ids=new Map(data.sources.map((r,i)=>[r.reference,8000+i]));let farm;
 into.__beforeQuestStartup=ctx=>{
  ctx.require=require;
  const resolve=ctx.mp.getIdFromDesc,describe=ctx.mp.getDescFromId;
  ctx.mp.getIdFromDesc=desc=>ids.has(desc)?ids.get(desc):resolve(desc);
  ctx.mp.getDescFromId=id=>id===7000?'1a66e:Skyrim.esm':id===7001?'3a198:Skyrim.esm':data.sources[id-8000]?.reference||describe(id);
  ctx.mp.writeFileWhole=()=>{};ctx.mp.getServerSettings=()=>({});
  ctx.MERCHANT_TRADING.orchardSources=()=>copy(data);
  ctx.MERCHANT_TRADING.createQuestOrchardSources=()=>({verify:()=>valid});
  ctx.MERCHANT_TRADING.orchardPlots={createOrchardStorage:()=>({}),createOrchardPlots:()=>store};
  if(options.unknown) {
   const create=ctx.MERCHANT_TRADING.createQuestTransactions;
   ctx.MERCHANT_TRADING.createQuestTransactions=function(...args) {
    const tx=create(...args),commit=tx.commit;
    tx.commit=function(...input){const result=commit(...input);if(result.ok&&input[3].length){ctx.__revoked=true;return {ok:false};}return result;};
    return tx;
   };
  }
  ctx.__thornswoodMerchantTrade.questRole=()=> 'Cook';
  ctx.__questRankRead=()=>({v:1,cls:'farmer',ranks:{farmer:rank}});
  ctx.__thornswoodFarming={harvestQuest:(...args)=>farm.F.harvestQuest(...args),sowQuest:(...args)=>farm.F.sowQuest(...args)};
 };
 const w=h.boot(into),file=path.join(__dirname,'test-farming.js'),source=fs.readFileSync(file,'utf8');
 const realm={require:createRequire(file),__dirname,process:farmProcess,console:{log(){}},Date:{now:()=>h.clock.now}};
 vm.runInNewContext(source.slice(0,source.indexOf('// 1. The table:'))+
  ';this.farm={F,actors,objects,idOf,addActor,addPlot};',realm);
 farm=realm.farm;realm.__thornswoodQuestOrchardRefs=w.ctx.__thornswoodQuestOrchardRefs;
 realm.__thornswoodOrchardPlots=store;realm.__thornswoodProperty={coversGround:()=>null};
 realm.__thornswoodQuests=w.svc;
 realm.__thornswoodSeason={grownMs:(at,now)=>now-at};
 const row=data.sources[0];farm.addActor(500,33,'Farmer','farmer',2,row.world,row.position);
 data.sources.forEach((r,i)=>farm.addPlot(8000+i,r.base,r.world,r.position));
 const draw=(i=0)=>w.svc.harvestOrchard(500,8000+i,data.sources[i].base);
 return {w,farm,realm,store,draw,saved:()=>copy(saved),rank:v=>{rank=v;},valid:v=>{valid=v;},
  take:()=>w.svc.act(500,'take','orchard',null,7000),finish:()=>w.svc.act(500,'return','orchard',null,7000),
  leave:()=>w.svc.act(500,'abandon','orchard',null,7000),
  ripe(i=0,step=2){return store.write(data.sources[i].reference,{by:33,crop:row.base,at:1,ms:100,step});}};
}
{
 const s=setup();s.rank('advanced');assert.equal(s.take().ok,false);s.rank('expert');assert.equal(s.take().ok,true);
 assert.equal(s.w.svc.act(500,'take','orchard',null,7001).ok,false,'another Cook cannot duplicate this job');
 assert.equal(s.draw().ok,true);assert.equal(h.have(500,'64b2e:Skyrim.esm'),1,'standing tree gives one');
 assert.equal(s.ripe(),true);assert.equal(s.draw().ok,true);assert.equal(h.have(500,'64b2e:Skyrim.esm'),5,'Expert sowing gives four');
 assert.equal(s.finish().ok,true);assert.equal(h.have(500,'64b2e:Skyrim.esm'),1);
 assert.equal(h.form(500).props.thornswoodQuests.cool.orchard,h.clock.now+12*3600000);
}
{
 const s=setup();s.take();s.ripe();s.draw();s.ripe(1);s.draw(1);
 s.ripe(2);assert.equal(s.draw(2).ok,false,'entire four-apple yield must fit cap');
 assert.equal(s.store.read(data.sources[2].reference).crop,data.sources[2].base,'refused yield remains ripe');
 assert.equal(s.draw(3).ok,true);assert.equal(s.draw(4).ok,true);assert.equal(h.have(500,'64b2e:Skyrim.esm'),10);
 assert.equal(s.draw(5).ok,false);assert.equal(s.leave().ok,true);assert.equal(h.have(500,'64b2e:Skyrim.esm'),0);
 assert.equal(h.form(500).props.thornswoodQuests.cool.orchard,undefined);
}
for(const defect of ['source','claim','season','season-nan','missing-property','identity','add']) {
 const s=setup();s.take();s.ripe();
 if(defect==='claim')s.realm.__thornswoodProperty.coversGround=()=>({by:99,name:'Another farmer'});
 // A holder can bring in their visitor's sowing, so make it another sower too.
 if(defect==='claim')s.store.write(data.sources[0].reference,{by:99,crop:data.sources[0].base,at:1,ms:100,step:2});
 if(defect==='season')s.realm.__thornswoodSeason.grownMs=()=>{throw Error('season unavailable');};
 if(defect==='season-nan')s.realm.__thornswoodSeason.grownMs=()=>NaN;
 if(defect==='missing-property')delete s.realm.__thornswoodProperty;
 if(defect==='add')h.fault.noAdd=['64b2e:Skyrim.esm'];
 if(defect==='source'||defect==='identity')s.w.ctx.__beforeQuestCommit=()=>{
  if(defect==='source')s.valid(false);else s.w.ctx.__identityToken='replacement';
 };
 assert.equal(s.draw().ok,false,defect);assert.equal(h.have(500,'64b2e:Skyrim.esm'),0,defect);
 assert.equal(s.store.read(data.sources[0].reference).crop,data.sources[0].base,defect+' preserves ripe crop');
 h.fault.noAdd=[];
}
{
 const s=setup();s.take();s.ripe();
 s.w.ctx.__beforeQuestCommit=()=>{s.realm.__thornswoodProperty.coversGround=()=>{s.valid(false);return null;};};
 assert.equal(s.draw().ok,false,'source disabled by final farm callback refuses');
 assert.equal(h.have(500,'64b2e:Skyrim.esm'),0);
 assert.equal(s.store.read(data.sources[0].reference).crop,data.sources[0].base);
}
{
 const s=setup();s.ripe();s.realm.__thornswoodSeason.grownMs=()=>{throw Error('season unavailable');};
 assert.equal(s.draw().ok,false,'unaccepted work cannot bypass strict source harvesting');
 assert.equal(h.have(500,'64b2e:Skyrim.esm'),0);
}
for(const defect of ['none','reentry','identity']) {
 const s=setup();s.take();s.draw();let nested=false;
 if(defect==='reentry')s.w.ctx.__beforeQuestCommit=()=>{
  if(nested)return;nested=true;assert.equal(s.draw().ok,false,'nested sowing is refused while seed commit is active');
 };
 if(defect==='identity')s.w.ctx.__beforeQuestCommit=()=>{s.w.ctx.__identityToken='replacement';};
 const result=s.draw(),plot=s.store.read(data.sources[0].reference);
 if(defect==='identity') {
  assert.equal(plot.crop,'');assert.equal(h.have(500,'64b2e:Skyrim.esm'),1);
 }else {
  assert.match(result.text,/You sow/);assert.equal(plot.crop,data.sources[0].base);assert.equal(h.have(500,'64b2e:Skyrim.esm'),0);
  assert.equal(h.form(500).props.thornswoodQuests.open.orchard.drawn,1,'sowing is not another quest draw');
 }
}
{
 const s=setup();s.take();s.draw();
 s.w.ctx.__afterCommit=()=>{s.realm.__thornswoodProperty.coversGround=()=>{s.w.ctx.__identityToken='post-seed replacement';return null;};};
 assert.equal(s.draw().ok,false);
 assert.equal(s.store.read(data.sources[0].reference).crop,'','post-seed callback cannot publish a plot for a replacement actor');
}
{
 const s=setup();s.take();s.store.write(data.sources[0].reference,{by:0,crop:'',at:0,ms:0,step:0});
 assert.match(s.draw().text,/here is seed/,'definite empty-pack shortage retains Farmer seed recovery');
 assert.equal(h.form(500).props.thornswoodQuests.open.orchard.drawn,0);
}
{
 const s=setup();s.take();let refreshed=0;
 const get=s.realm.mp.get,set=s.realm.mp.set;
 s.realm.mp.get=(id,key)=>key==='thornswoodPlotLine'?{hex:(8000).toString(16)}:get(id,key);
 s.realm.mp.set=(id,key,value)=>{if(key==='thornswoodPlotLine')refreshed++;else set(id,key,value);};
 assert.equal(s.draw().ok,true);assert.equal(refreshed,1,'harvest refreshes the displayed plot line immediately');
}
{
 const s=setup();s.take();let refreshed=0,calls=0;
 const get=s.realm.mp.get,set=s.realm.mp.set;
 s.realm.mp.get=(id,key)=>key==='thornswoodPlotLine'?{hex:(8000).toString(16)}:get(id,key);
 s.realm.mp.set=(id,key,value)=>{if(key==='thornswoodPlotLine')refreshed++;else set(id,key,value);};
 s.w.ctx.__afterCommit=()=>{s.realm.__thornswoodProperty.coversGround=()=>{
  if(++calls===2)s.w.ctx.__identityToken='refresh replacement';return null;
 };};
 assert.equal(s.draw().ok,true);assert.equal(refreshed,0,'refresh callback cannot write the line to a replacement actor');
}
{
 const s=setup({unknown:true});s.take();assert.equal(s.draw().ok,false);
 assert.equal(h.have(500,'64b2e:Skyrim.esm'),1);assert.equal(s.store.available(),false);
 const restored=plots.createOrchardPlots({durable:true,load:s.saved,save:()=>true},data.sources.map(r=>r.reference));
 assert.equal(restored.read(data.sources[0].reference).crop,'','restart retains authoritative consumed source');
 assert.equal(s.draw().ok,false);assert.equal(h.have(500,'64b2e:Skyrim.esm'),1);
}
{
 const s=setup(),ctx=s.w.ctx;
 ctx.__thornswoodFarming=s.farm.F;
 const gm=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8')).replace(/\r\n/g,'\n');
 vm.runInContext(gm.match(/^function farmActivate\([^\n]*\)[\s\S]*?^\}/m)[0],ctx);
 assert.match(ctx.farmActivate(500,8000,data.sources[0].base),/standing here/,'ordinary farming remains available without accepted work');
 ctx.__thornswoodQuestOrchardRefs=null;
 assert.match(ctx.farmActivate(500,8001,data.sources[1].base),/unavailable/,'missing register cannot fall through to a free harvest');
}
console.log('PASS actual Farmer standing/sown yields, exact Cook/rank, full-yield cap, extras/rest/abandon, source/claims/seasons/identity and atomic grant failures');
