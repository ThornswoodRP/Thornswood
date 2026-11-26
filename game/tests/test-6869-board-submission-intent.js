'use strict';
// Actual mounted page -> queued command selection -> canonical saved posting.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file=path.join(__dirname,'test-6869-board-submission-page.js'),source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),end=source.indexOf("try{\n yes('whole gamemode loads'");
if(end<0)throw Error('Actual queued page fixture boundary changed');
const fixture=new Module(file,module);fixture.filename=file;fixture.paths=Module._nodeModulePaths(__dirname);
fixture._compile(source.slice(0,end)+'\nmodule.exports={w,sender,attachScenarioReservation,page,t};',file);
const {w,sender:a,attachScenarioReservation,page,t}=fixture.exports,yes=t.yes;
const cell='1691d:Skyrim.esm',pos=[134265.1,35842.3,-12397.5];
const b=w.person(0xff00686b,{profileId:1000,name:'Other character',cell,pos,inventory:{entries:[{baseId:15,count:500}]}});
const doc=()=>w.readPrivate('property.json'),rows=()=>doc().notices.windhelm||[];
const tuple=actor=>[1000,w.mp().getDescFromId(actor),w.mp().getActorRuntimeIdentity(actor)];
const packet=(owner,body='Current owner')=>'/board-submit-v1 '+JSON.stringify(['letter','f'.repeat(32),'windhelm',owner,'Lydia',body]);
function enqueue(line){const run=w.run;w.run=()=>{};try{w.say(a,line);}finally{w.run=run;}}
function press(body){const p=page();p.fill('letter',{to:'Lydia',letter:body});p.press('letter');return p.sent[0];}
function select(actor){w.leave(a);w.leave(b);w.arrive(actor);}
try{
 yes('whole queued gamemode loads',w.boot());if(w.loaded()){
  attachScenarioReservation(w);w.arrive(a);w.run(30000);
  const line=press('Queued on A'),payload=JSON.parse(line.slice('/board-submit-v1 '.length)),ownerA=tuple(a);
  yes('actual UI captures its complete native owner tuple in the private wire',payload.length===6&&JSON.stringify(payload[3])===JSON.stringify(ownerA));
  const beforeA=w.count(a,15),beforeB=w.count(b,15),count=rows().length;enqueue(line);select(b);w.run(4000);
  yes('A queued press never charges or posts on B at the same board',w.count(a,15)===beforeA&&w.count(b,15)===beforeB&&rows().length===count);
  select(a);w.run(2200);
  const current=tuple(a),gold=w.count(a,15);w.say(a,packet(current,'Good 😀\nSecond line'));w.run(2200);
  yes('the correct current owner tuple retains its canonical fee and Unicode post',w.count(a,15)===gold-35&&rows().at(-1)?.text==='Good 😀\nSecond line');
  const invalid=[null,[],current.slice(0,2),[...current,'extra'],[1001,current[1],current[2]],[1000,tuple(b)[1],current[2]],[1000,current[1],'0'],[1000,current[1],Number(current[2])],[1000,current[1],'999999']];
  for(const owner of invalid){const before=JSON.stringify(doc()),gold=w.count(a,15);w.say(a,packet(owner));w.run(2200);yes('missing malformed or forged owner tuple cannot create a debit '+JSON.stringify(owner),JSON.stringify(doc())===before&&w.count(a,15)===gold);}
  for(const old of [['letter','e'.repeat(32),'windhelm','Lydia','Old private shape'],['haul','e'.repeat(32),'windhelm','15','whiterun','Old private shape']]){
   const before=JSON.stringify(doc()),gold=w.count(a,15);w.say(a,'/board-submit-v1 '+JSON.stringify(old));w.run(2200);yes('old unpublished private shapes are refused whole',JSON.stringify(doc())===before&&w.count(a,15)===gold);
  }
  for(const boundary of ['location','pack']){
   const expected=tuple(a),mp=w.mp(),nativeGet=mp.get,nativeRuntime=mp.getActorRuntimeIdentity,nativeWrite=mp.writeFileWhole;
   const before=JSON.stringify(doc()),gold=w.count(a,15);let changed=false,writes=0;
   mp.get=function(actor,key){const value=nativeGet.call(mp,actor,key);if(actor===a&&key===(boundary==='location'?'pos':'inventory'))changed=true;return value;};
   mp.getActorRuntimeIdentity=function(actor){return actor===a&&changed?'999993':nativeRuntime.call(mp,actor);};
   mp.writeFileWhole=function(...args){writes++;return nativeWrite.apply(mp,args);};
   try{w.box().__thornswoodProperty.submitBoard(JSON.parse(packet(expected).slice('/board-submit-v1 '.length)),a,1000,()=>{});}
   finally{mp.get=nativeGet;mp.getActorRuntimeIdentity=nativeRuntime;mp.writeFileWhole=nativeWrite;}
   yes(boundary+' owner revocation is rejected before any debit intent write',changed&&writes===0&&w.count(a,15)===gold&&JSON.stringify(doc())===before);
  }
  // This shared fixture does not invalidate runtime on leave/arrive. Its
  // existing death/respawn native boundary DOES advance the real fixture
  // runtime map, so use that explicitly for unchanged desc/profile ABA.
  const stale=press('Old runtime'),old=tuple(a);enqueue(stale);select(b);select(a);w.die(a,0,null);w.respawn(a);w.moveTo(a,cell,pos);w.give(a,15,500);
  const afterTransition=w.count(a,15),beforeRuntimeRows=rows().length;
  yes('native-contract runtime advanced with unchanged descriptor and profile',tuple(a)[1]===old[1]&&tuple(a)[2]!==old[2]);w.run(4000);
  yes('old runtime intent cannot debit the same character after a lifecycle ABA',w.count(a,15)===afterTransition&&rows().length===beforeRuntimeRows);
 }
}finally{t.done(w);}
