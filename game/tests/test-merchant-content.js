'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','..'),doc=JSON.parse(fs.readFileSync(path.join(root,'game/data/quest-content.json'),'utf8'));
const buf=fs.readFileSync(path.join(root,'game/content/Thornswood-Content.esp')),records=new Map();
function fields(data) {
 const out=new Map();let at=0,wide=null;
 while(at<data.length) {
  assert(at+6<=data.length);const tag=data.toString('ascii',at,at+4);let size=data.readUInt16LE(at+4);at+=6;
  assert(at+size<=data.length);
  if(tag==='XXXX'){assert.equal(size,4);wide=data.readUInt32LE(at);at+=size;continue;}
  if(wide!==null){size=wide;wide=null;assert(at+size<=data.length);}
  assert(!out.has(tag),'duplicate field '+tag);out.set(tag,data.subarray(at,at+size));at+=size;
 }
 assert.equal(wide,null);return out;
}
// Only the new authored records have single fields. Other records can contain
// repeated effects and inventory rows, so decode those only when selected.
function walk(start,end,groups=[]) {
 for(let at=start;at<end;) {
  assert(at+24<=end);const tag=buf.toString('ascii',at,at+4),size=buf.readUInt32LE(at+4);
  const next=at+(tag==='GRUP'?size:24+size);assert(next<=end&&next>at);
  if(tag==='GRUP')walk(at+24,next,groups.concat([[buf.readUInt32LE(at+8),buf.readInt32LE(at+12)]]));
  else {const id=buf.readUInt32LE(at+12);assert(!records.has(id));records.set(id,{tag,flags:buf.readUInt32LE(at+8),body:buf.subarray(at+24,next),groups});}
  at=next;
 }
}
walk(24+buf.readUInt32LE(4),buf.length);
const fid=desc=>0x05000000+parseInt(desc.split(':')[0],16),text=b=>b.toString('utf8').replace(/\0$/,'');
assert.equal(doc.version,1);assert.equal(doc.items.length,7);assert.equal(Object.keys(doc.sites).length,9);
const sealedCase=doc.items.find(r=>r.key==='case'),dispatch=doc.items.find(r=>r.key==='dispatch');
assert.equal(dispatch.model,sealedCase.model,'dispatch is the same kind of sealed case');
assert.deepEqual(dispatch.bounds,sealedCase.bounds);
for(const [i,row] of doc.items.entries()) {
 assert.equal(fid(row.ref),0x05017000+i);const r=records.get(fid(row.ref));assert(r,'missing '+row.ref);assert.equal(r.tag,'MISC');assert.equal(r.flags,0);
 const f=fields(r.body);assert.deepEqual([...f.keys()],['EDID','OBND','FULL','MODL','KSIZ','KWDA','DATA']);
 assert.equal(f.get('KSIZ').readUInt32LE(),0);assert.equal(f.get('KWDA').length,0);
 assert.equal(text(f.get('EDID')),row.edid);assert.equal(text(f.get('FULL')),row.name);assert.equal(text(f.get('MODL')),row.model);
 assert.deepEqual(Array.from({length:6},(_,i)=>f.get('OBND').readInt16LE(2*i)),row.bounds);
 assert.equal(f.get('DATA').length,8);assert.equal(f.get('DATA').readUInt32LE(),0);assert.equal(f.get('DATA').readFloatLE(4),Math.fround(row.weight));
}
const ledger=records.get(0x05017100);assert(ledger,'dedicated ledger activator missing');assert.equal(ledger.tag,'ACTI');
assert.deepEqual([...fields(ledger.body).keys()],['EDID','OBND','FULL','MODL']);
const expectedKeys=Array.from({length:8},(_,i)=>'longfin'+(i+1)).concat('ledger');assert.deepEqual(Object.keys(doc.sites),expectedKeys);
// Sea water uses Tamriel DNAM's default height -14000: these CELLs have
// HasWater and XCLW's max-float sentinel. A seabed clam is not a reachable
// surface fishing marker, even though its CELL and world are correct.
for(const key of expectedKeys.filter(k=>k!=='ledger'))assert(Math.abs(doc.sites[key].pos[2]+14000)<=128,'longfin marker must be reachable from the recorded sea surface: '+key);
for(const [i,key] of expectedKeys.entries()) {
 const row=doc.sites[key],r=records.get(0x05017200+i);assert(r,'missing placement '+key);assert.equal(r.tag,'REFR');assert.equal(r.flags,0);
 assert.equal(fid(row.ref),0x05017200+i);const f=fields(r.body);assert.deepEqual([...f.keys()],['EDID','NAME','DATA']);assert.equal(text(f.get('EDID')),'ThornswoodQuestSite'+key[0].toUpperCase()+key.slice(1));assert.equal(f.get('NAME').readUInt32LE(),fid(row.base));
 assert.equal(f.get('DATA').length,24);const values=Array.from({length:6},(_,i)=>f.get('DATA').readFloatLE(4*i));
 assert.deepEqual(values,row.pos.concat([0,0,row.angle*Math.PI/180]).map(Math.fround));
 const cell=parseInt(row.cell.split(':')[0],16);assert(r.groups.some(g=>g[0]===cell&&g[1]===9));
 if(key==='ledger') {assert.equal(row.cell,'133c9:Skyrim.esm');assert.equal(row.base,'17100:Thornswood-Content.esp');assert.equal(row.pos[2],row.anchorPosition[2]+12);}
 else {assert.equal(row.base,'154a5:Thornswood-Content.esp');assert.equal(row.pos[0],row.anchorPosition[0]+48);assert.equal(row.pos[1],row.anchorPosition[1]);assert.equal(row.pos[2],doc.seaWater.height-doc.seaWater.depth);assert.equal(row.space,'3c:Skyrim.esm');}
}
// Every old station and every new quest placement is accounted for. An extra
// accidental placement cannot hide behind filtering to the station bases.
const stations=JSON.parse(fs.readFileSync(path.join(root,'game/data/station-sites.json'),'utf8')).sites;
const expected=new Set(Object.values(stations).concat(Object.values(doc.sites)).map(r=>fid(r.ref)));
assert.deepEqual(new Set([...records].filter(([,r])=>r.tag==='REFR').map(([id])=>id)),expected);
// Content can precede its runtime release. The newly placed FLOR markers
// must not become ordinary unbounded fishing while that controller is absent.
{
 const vm=require('node:vm'),gm=fs.readFileSync(path.join(root,'game/gamemode.js'),'utf8');
 const start=gm.indexOf('function fish(actorId'),end=gm.indexOf('\n}',start)+2;
 let grants=0;const longfin='154a5:Thornswood-Content.esp',clam='85f80:Skyrim.esm';
 const context={isFish:()=>true,FISH_BY_BASE:{[longfin]:{rank:'master',name:'Longfin',from:'Water',produce:'106e1b:Skyrim.esm'},
  [clam]:{rank:'novice',name:'Clam Meat',from:'Clam',produce:'ec03:Skyrim.esm'}},withinResourceReach:()=>true,
  __thornswoodResourceStock:{left:()=>0,take(ref,span,give){return {ok:give()};}},
  classGate:()=>null,toolGate:()=>null,poleTooWeak:()=>null,rankStep:()=>3,rankWord:v=>v,
  RANK_LADDER:['novice','advanced','expert','master'],FISH_TUNING:{cooldownMs:{novice:600000,master:14400000},yieldByStep:{3:[2,4]}},
  randInt:()=>4,addItemsAtomic:()=>{grants++;return true;},creditWork:()=>'',economyGathered:()=>{},wearTool:()=>'',waitWord:String};
 vm.runInNewContext(gm.slice(start,end),context);
 assert.match(context.fish(1,999999,longfin),/unavailable/);assert.equal(grants,0);
 assert.match(context.fish(1,999999,clam),/4 Clam Meat/);assert.equal(grants,1,'ordinary clams still work');
}
const {spawnSync}=require('node:child_process');
const code=String.raw`
import copy,importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('quest_content_writer','scripts/mods/Add-ContentRecords.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
good=json.loads(Path('game/data/quest-content.json').read_text(encoding='utf-8'))
cases=[]
bad=copy.deepcopy(good);bad['items'].pop();cases.append(bad)
bad=copy.deepcopy(good);bad['items'][0]['ref']=bad['items'][1]['ref'];cases.append(bad)
bad=copy.deepcopy(good);bad['sites']['ledger']['base']='ed045:Skyrim.esm';cases.append(bad)
bad=copy.deepcopy(good);bad['sites']['longfin1']['pos'][0]+=1;cases.append(bad)
bad=copy.deepcopy(good);bad['sites']['longfin1']['pos'][0]=float('nan');cases.append(bad)
bad=copy.deepcopy(good);bad['sites']['longfin1']['interior']=True;cases.append(bad)
bad=copy.deepcopy(good);bad['items'][0]['bounds']=[0]*5;cases.append(bad)
bad=copy.deepcopy(good);bad['seaWater']['height']=0;cases.append(bad)
bad=copy.deepcopy(good);bad['sites']['longfin1']['pos'][2]=bad['sites']['longfin1']['anchorPosition'][2];cases.append(bad)
for bad in cases:
 m.json.load=lambda ignored:bad
 try:m.quest_content()
 except ValueError:pass
 else:raise AssertionError('invalid content declaration accepted')
m.quest_identity(None,'ThornswoodQuestSatchel')
record=m.own_record(b'MISC',0x5017000,[(b'EDID',m.zstr('OtherThing'))])
try:m.quest_identity(record,'ThornswoodQuestSatchel')
except ValueError:pass
else:raise AssertionError('an existing record ID was overwritten')
record=m.own_record(b'REFR',0x5017200,[(b'NAME',b'\0'*4)])
try:m.quest_identity(record,'ThornswoodQuestSiteLongfin1')
except ValueError:pass
else:raise AssertionError('an existing unlabelled placement ID was overwritten')
`;
const result=spawnSync('python',['-c',code],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);
console.log('PASS seven inert retrieval tokens, eight distinct longfin markers, dedicated non-skill ledger and exact placement union');
