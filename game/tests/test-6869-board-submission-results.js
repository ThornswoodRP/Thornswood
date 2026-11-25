'use strict';
// Actual private request -> queued canonical posting -> saved register -> owner script.
const standIn=require('../../tests/stand-in-server');
const {attachScenarioReservation}=require('../../tests/fixtures/pack-first');
const t=standIn.checks(),yes=t.yes;
const w=standIn.world({name:'6869-board-results',gm:process.env.GM,settings:{thornswoodServer:'main',thornswoodRequirePass:true},files:{
 'private/allowed.json':{profiles:[1000,1001],accounts:{1000:'a',1001:'b'}}
}});
const cell='1691d:Skyrim.esm',pos=[134265.1,35842.3,-12397.5];
w.record('593b:Thornswood-Content.esp','ACTI');w.ref(w.idOf('23592:Skyrim.esm'),{base:'1a2b3:Skyrim.esm',cell,pos:[pos[0]+876,pos[1],pos[2]]});
const a=w.person(0xff006869,{profileId:1000,name:'Brenna',cell,pos,inventory:{entries:[{baseId:15,count:10000}]}});
const b=w.person(0xff00686a,{profileId:1001,name:'Corvin',cell,pos:[pos[0]+100,pos[1],pos[2]],inventory:{entries:[{baseId:15,count:100}]}});
let mp;
const id=n=>n.toString(16).padStart(32,'0');
const wire=p=>'/board-submit-v1 '+JSON.stringify(p);
const letter=(n,hold='windhelm',to='Lydia "Red" Stone',body='SEALED-6869-'+n)=>['letter',id(n),hold,to,body];
const haul=(n,hold='windhelm',pay='15',dest='whiterun',cargo='Full crates  with "labels"')=>['haul',id(n),hold,pay,dest,cargo];
function send(payload,actor=a){w.say(actor,wire(payload));w.run(2200);}
const doc=()=>w.readPrivate('property.json');
const rows=()=>doc().notices.windhelm||[];
const view=(actor=a)=>w.box().__thornswoodSocial.view(actor);
const result=(nonce,actor=a)=>(view(actor).boardSubmissions?.results||[]).find(x=>x.id===nonce);
const prop=()=>w.box().__thornswoodProperty;
try{
 yes('whole gamemode loads',w.boot());
 if(w.loaded()){
  mp=w.mp();attachScenarioReservation(w);w.arrive(a);w.arrive(b);w.run(30000);
  const gold=w.count(a,15);send(letter(1));
  yes('strict JSON private letter reaches the canonical saved notice and fee',rows().at(-1)?.to==='Lydia "Red" Stone'&&rows().at(-1)?.text==='SEALED-6869-1'&&w.count(a,15)===gold-35);
  yes('committed notice stores only strict private correlation plus native owner',rows().at(-1)?.boardSubmission?.id===id(1)&&rows().at(-1)?.boardSubmission?.actorDesc===mp.getDescFromId(a)&&rows().at(-1)?.boardSubmission?.version===1);
  yes('owner receives correlated posted result from the saved notice',JSON.stringify(result(id(1)))===JSON.stringify({id:id(1),kind:'letter',hold:'windhelm',status:'posted'}));
  const owned=view().boardSubmissions;
  yes('owner envelope carries native descriptor profile and exact decimal runtime',owned?.owner?.profileId===1000&&owned?.owner?.actorDesc===mp.getDescFromId(a)&&owned?.owner?.runtime===mp.getActorRuntimeIdentity(a));
  yes('correlation never appears on public board wall or another owner projection',!JSON.stringify(prop().boardPanel(b,1001)).includes(id(1))&&!JSON.stringify(view(b).boardSubmissions||{}).includes(id(1)));
  yes('owner result carries no sealed recipient/body or inventory marker',!JSON.stringify(owned||{}).includes('SEALED-6869')&&!JSON.stringify(owned||{}).includes('Lydia')&&!JSON.stringify(owned||{}).includes('sequence'));
  send(haul(2));
  yes('new haul wire uses canonical fee pay destination and joined cargo',rows().at(-1)?.haul===true&&rows().at(-1)?.pay===15&&rows().at(-1)?.dest==='whiterun'&&rows().at(-1)?.text==='Full crates with "labels"');
  yes('letter and haul results coexist instead of replacing one last result',!!result(id(1))&&result(id(2))?.kind==='haul');
  const nativeSet=mp.set;let refuseOwner=true,ownerRefusals=0;
  mp.set=function(actor,name,value){if(actor===a&&name==='thornswoodSocialView'&&refuseOwner){ownerRefusals++;throw Error('6869 owner publication refused');}return nativeSet.call(mp,actor,name,value);};
  try{send(letter(9));yes('failed owner publication cannot undo or fabricate the saved posting',rows().some(x=>x.boardSubmission?.id===id(9))&&ownerRefusals>0);}
  finally{refuseOwner=false;mp.set=nativeSet;}
  w.run(4000);yes('next ordinary owner push recovers the same saved result after publication refusal',w.prop(a,'thornswoodSocialView')?.boardSubmissions?.results.some(x=>x.id===id(9))===true);
  const beforeDelay=rows().length;w.holdSaves(true);send(letter(3));
  yes('saved intent or live inventory debit does not publish posted result',doc().debits.some(x=>x.data?.made?.boardSubmission?.id===id(3))&&rows().length===beforeDelay&&!result(id(3)));
  w.holdSaves(false);w.run(4000);
  yes('ordinary save acknowledgement lands and then projects exactly its result',rows().length===beforeDelay+1&&!!result(id(3)));
  const saved=JSON.stringify(doc()),funds=doc().funds.windhelm,priorGold=w.count(a,15);
  const bad=[[],letter(4).slice(0,4),[...letter(4),'extra'],['job',id(4),'windhelm','A','B'],letter(4).map((x,i)=>i===1?'bad':x),letter(4).map((x,i)=>i===2?'unknown':x),letter(4).map((x,i)=>i===3?3:x),letter(4,'windhelm','A'.repeat(61)),letter(4,'windhelm','Lydia','B'.repeat(301)),letter(4,'windhelm','Bad\nName'),haul(4,'windhelm','1.5'),haul(4,'windhelm','15 whiterun forged'),haul(4,'windhelm','9007199254740992'),haul(4,'windhelm','15','windhelm'),haul(4,'windhelm','15','whiterun','   ')];
  for(const p of bad){send(p);yes('invalid private payload never changes notice ledger or pack '+JSON.stringify(p).slice(0,70),JSON.stringify(doc())===saved&&w.count(a,15)===priorGold);}
  for(const text of [' '+wire(letter(4)),wire(letter(4))+' extra','/board-submit-v1 nope',wire(letter(4))+' '.repeat(8200)]){w.say(a,text);w.run(2200);yes('invalid private outer boundary is refused whole',JSON.stringify(doc())===saved&&w.count(a,15)===priorGold);}
  const run=w.run;w.run=()=>{};try{w.say(a,wire(letter(5)));}finally{w.run=run;}
  const other=prop().boards().whiterun;w.moveTo(a,other.cell,other.pos);w.run(2200);
  yes('queued request for old board cannot choose new board or take any gold',JSON.stringify(doc())===saved&&w.count(a,15)===priorGold);
  w.moveTo(a,cell,pos);
  w.relayCommand({profileId:1000,proven:false,text:wire(letter(6))});w.run(2200);
  yes('copied correlation does not authenticate an unproved command',JSON.stringify(doc())===saved&&w.count(a,15)===priorGold);
  const nativeWrite=mp.writeFileWhole;let rejectIntent=true;
  mp.writeFileWhole=function(file,text){const d=JSON.parse(text);if(rejectIntent&&d.debits?.some(x=>x.data?.made?.boardSubmission?.id===id(7)))throw Error('6869 intent refused');return nativeWrite.call(mp,file,text);};
  try{send(letter(7));}finally{rejectIntent=false;mp.writeFileWhole=nativeWrite;}
  yes('refused durable intent publishes no result and consumes no gold',!result(id(7))&&w.count(a,15)===priorGold&&JSON.stringify(doc())===saved);
  let refuseLanding=true;
  mp.writeFileWhole=function(file,text){const d=JSON.parse(text);if(refuseLanding&&d.notices?.windhelm?.some(x=>x.boardSubmission?.id===id(8)))throw Error('6869 landing refused');return nativeWrite.call(mp,file,text);};
  try{send(letter(8));yes('refused final register save preserves pending intent and hides result',doc().debits.some(x=>x.data?.made?.boardSubmission?.id===id(8))&&!result(id(8))&&!rows().some(x=>x.boardSubmission?.id===id(8)));}
  finally{refuseLanding=false;mp.writeFileWhole=nativeWrite;}
  w.run(4000);yes('existing settlement later saves the notice and confirms it once',rows().filter(x=>x.boardSubmission?.id===id(8)).length===1&&!!result(id(8))&&doc().funds.windhelm===funds+35);
  yes('same committed result survives gamemode reload',w.reload()&&!!result(id(8)));
  // The fixture does not invalidate runtime on arrive/leave. Drive the real
  // getter boundary explicitly, as native SetUserActor/ActorsMap actually do.
  const nativeRuntime=mp.getActorRuntimeIdentity;let runtime='7001';
  mp.getActorRuntimeIdentity=function(actor){return actor===a?runtime:nativeRuntime.call(mp,actor);};
  try{
   yes('projection reads the current runtime for unchanged profile',view().boardSubmissions?.owner?.runtime==='7001');
   runtime='7003';yes('A to B to A without B page update exposes a different runtime',view().boardSubmissions?.owner?.runtime==='7003'&&view().me===1000);
   let reads=0;mp.getActorRuntimeIdentity=function(actor){return actor===a?String(8000+reads++):nativeRuntime.call(mp,actor);};
   yes('owner changing during projection fails closed without guessed identity',view().boardSubmissions===null);
   mp.getActorRuntimeIdentity=function(){throw Error('identity unreadable');};
   yes('unreadable runtime fails closed instead of initializing an owner',view().boardSubmissions===null);
  }finally{mp.getActorRuntimeIdentity=nativeRuntime;}
  const d=doc();if(!d.notices.windhelm)d.notices.windhelm=[];
  for(let n=20;n<60;n++)d.notices.windhelm.push({by:1000,name:'Brenna',at:n,letter:n!==40,haul:n===40,to:'Lydia',text:'private',boardSubmission:{version:1,id:id(n),kind:n===40?'haul':'letter',actorDesc:mp.getDescFromId(a)}});
  d.notices.windhelm.push({by:1000,at:999,letter:true,text:'must not project',boardSubmission:{version:99,id:id(99),kind:'letter',actorDesc:mp.getDescFromId(a)}});
  d.notices.windhelm.push({by:1000,at:1000,letter:true,text:'must not project',boardSubmission:{version:1,id:id(100),kind:'letter',actorDesc:'different-character:Skyrim.esm'}});
  w.writePrivate('property.json',d);w.reload();
  const bounded=view().boardSubmissions;
  yes('projection is bounded across history and retains both submission kinds',bounded?.results.length<=32&&bounded?.results.some(x=>x.kind==='haul')&&bounded?.results.filter(x=>x.kind==='letter').length===16);
  yes('a result outside the fixed recent tail is absent rather than guessed',!result(id(1)));
  const history=prop().notices().windhelm;let slotReads=0,tailOnly=null;
  prop().notices().windhelm=new Proxy(history,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key)){slotReads++;if(Number(key)<target.length-32)throw Error('older history must not be read');}return Reflect.get(target,key,receiver);}});
  try{if(prop().boardSubmissions)tailOnly=prop().boardSubmissions(a,1000);}finally{prop().notices().windhelm=history;}
  yes('projection work inspects exactly32 recent slots regardless of older history',!!tailOnly&&slotReads===32);
  yes('unknown metadata version and foreign actor descriptor never project',!result(id(99))&&!result(id(100)));
  const priorOwner=view().boardSubmissions;w.moveTo(a,cell,[pos[0]+10000,pos[1],pos[2]]);
  yes('receipt authority is owner-based and remains available away from all boards',view().board===null&&JSON.stringify(view().boardSubmissions)===JSON.stringify(priorOwner));w.moveTo(a,cell,pos);
  const down=doc();const target=down.notices.windhelm.find(x=>x.boardSubmission?.id===id(59));target.down=Date.now();w.writePrivate('property.json',down);w.reload();
  yes('down notice can confirm historical posting without claiming currently on wall',result(id(59))?.status==='posted');
  const removed=doc();removed.notices.windhelm=removed.notices.windhelm.filter(x=>x.boardSubmission?.id!==id(59));w.writePrivate('property.json',removed);w.reload();
  yes('removed notice gives no invented posted result',!result(id(59)));
  const ownerDef=w.propertyDefinition('thornswoodSocialView');
  yes('actual result transport remains owner-only with no neighbor script',ownerDef?.isVisibleByOwner===true&&ownerDef.isVisibleByNeighbors===false&&ownerDef.updateNeighbor==='');
  let script='',got=null;
  if(ownerDef)new Function('ctx',ownerDef.updateOwner)({value:{...view(),at:123},state:{},sp:{browser:{executeJavaScript:s=>{script=s;}}}});
  if(script)new Function('window',script)({thornswoodBoard:{setData:d=>{got=d;}}});
  yes('actual registered owner script forwards full identity/result envelope to board',!!got?.boardSubmissions&&JSON.stringify(got.boardSubmissions)===JSON.stringify(view().boardSubmissions));
  prop().release({profile:pid=>pid===1000});
  yes('canonical character release removes private correlation from anonymized notices',doc().notices.windhelm.every(n=>!n.boardSubmission)&&view().boardSubmissions?.results.length===0);
 }
}finally{t.done(w);}
