'use strict';
// Real authenticated relay, actual board/front bridge and whole queued gamemode.
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module'),assert=require('node:assert/strict');
const standIn=require('../../tests/stand-in-server'),makePage=require('../../tests/fixtures/panel-page');
const {attachScenarioReservation}=require('../../tests/fixtures/pack-first');
const file=path.join(__dirname,'test-chat-limit.js'),source=fs.readFileSync(file,'utf8'),end=source.indexOf('(async () => {');assert(end>0);
const fixture=new Module(file,module);fixture.filename=file;fixture.paths=Module._nodeModulePaths(__dirname);
fixture._compile(source.slice(0,end)+'\nmodule.exports={ready,person,settle,shut,server:()=>srv,closed:()=>srvClosed,port:()=>PORT,log:()=>log,chatDir:CHAT_DIR,dir};',file);
const h=fixture.exports;if(process.env.VOICE_SOURCE)fs.copyFileSync(process.env.VOICE_SOURCE,path.join(h.dir,'voice-server.js'));let pass=0,fail=0;function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
const w=standIn.world({name:'4412-real-relay',settings:{thornswoodServer:'main'}});
const cell='1691d:Skyrim.esm',pos=[134265.1,35842.3,-12397.5];w.record('593b:Thornswood-Content.esp','ACTI');w.ref(w.idOf('23592:Skyrim.esm'),{base:'1a2b3:Skyrim.esm',cell,pos:[pos[0]+876,pos[1],pos[2]]});
const a=w.person(0xff004419,{profileId:1000,name:'Brenna',cell,pos,inventory:{entries:[{baseId:15,count:300}]}});
let loud,quiet,old;
(async()=>{try{
 yes('the whole gamemode loads',w.boot());attachScenarioReservation(w);w.arrive(a);w.run(30000);
 const p=makePage();for(const file of ['bridge','board'])p.run(file,fs.readFileSync(path.join(__dirname,'../../game/ui/thornswood-'+file+'.js'),'utf8'));
 p.win.thornswoodBoard.setData({board:w.box().__thornswoodProperty.boardPanel(a,1000)});p.win.thornswoodBoard.open();
 await h.ready();loud=await h.person(1000,'Brenna');quiet=await h.person(1001,'Corvin');
 p.win.thornswoodNet.say=line=>{p.sent.push(line);loud.ws.send(JSON.stringify({t:'chat',text:line,press:true}));return true;};
 const commands=async()=>{await h.settle(loud);return(await(await fetch('http://127.0.0.1:'+h.port()+'/commands')).json()).commands;};
 let got;
 for(const [label,title,body]of [['maximum URI','雪'.repeat(60),'雪'.repeat(300)],['quoted Unicode','雪'.repeat(58)+'""','雪'.repeat(300)]]){
  p.doc.getElementById('ts-board-to').value=title;p.doc.getElementById('ts-board-letter').value=body;p.doc.querySelector('[data-do="letter"]').click();
  got=await commands();const line=p.sent.at(-1),frame=JSON.stringify({t:'chat',text:line,press:true});
  yes(label+' actual form reaches the relay whole and authenticated',got.length===1&&got[0].text===line&&got[0].profileId===1000&&got[0].proven===true);
  yes(label+' needs no larger command or frame cap',line.length<=8200&&Buffer.byteLength(frame,'utf8')<1000000);
  console.log('MEASURE '+label+': commandChars='+line.length+' frameBytes='+Buffer.byteLength(frame,'utf8'));
  const prior=w.count(a,15);if(got[0])w.relayCommand(got[0]);w.run(2200);
  const saved=w.readPrivate('property.json').notices.windhelm.at(-1);
  yes(label+' relay and queue keep the exact recipient and full body',saved.to===title&&saved.text===body&&w.count(a,15)===prior-35);
 }
 if(process.env.LEGACY_GM){
  old=standIn.world({name:'4412-old-server',gm:process.env.LEGACY_GM,settings:{thornswoodServer:'main'}});
  const beforeActor=old.person(0xff004418,{profileId:1000,name:'Brenna',cell,pos,inventory:{entries:[{baseId:15,count:200}]}});
  old.record('593b:Thornswood-Content.esp','ACTI');old.ref(old.idOf('23592:Skyrim.esm'),{base:'1a2b3:Skyrim.esm',cell,pos:[pos[0]+876,pos[1],pos[2]]});
  yes('the exact old bundle loads for compatibility proof',old.boot());attachScenarioReservation(old);old.arrive(beforeActor);old.run(30000);
  const prior=JSON.stringify(old.readPrivate('property.json'));
  old.relayCommand(got[0]);old.run(2200);
  yes('an old server never charges or raw-posts the new encoded verb',old.count(beforeActor,15)===200&&JSON.stringify(old.readPrivate('property.json'))===prior);
 }
 const privateLine='/letter-post-v1 '+encodeURIComponent('Lydia "Red" Stone')+' '+encodeURIComponent('SECRET-4412-SEALED-BODY');
 for(const press of [true,false]){
  const before=quiet.chat.length;loud.ws.send(JSON.stringify({t:'chat',text:privateLine,press}));const queued=await commands();await h.settle(quiet);
  yes('a new sealed letter stays a command and is not broadcast, pressed='+press,queued.length===1&&quiet.chat.length===before);
 }
 for(const prefix of [' ','\n','\r\n\t']){
  const before=quiet.chat.length;loud.ws.send(JSON.stringify({t:'chat',text:prefix+privateLine,press:true}));const queued=await commands();await h.settle(quiet);
  yes('malformed private prefix is refused before public speech/logging '+JSON.stringify(prefix),queued.length===0&&quiet.chat.length===before);
 }
 loud.ws.send(JSON.stringify({t:'chat',text:privateLine+' '.repeat(8200)+'extra',press:true}));
 yes('an over-cap request is refused rather than truncating away extra arguments',(await commands()).length===0);
 await h.shut(loud);loud=null;await h.shut(quiet);quiet=null;h.server().kill();await h.closed();
 const logs=fs.existsSync(h.chatDir)?fs.readdirSync(h.chatDir).filter(n=>n.endsWith('.jsonl')).map(n=>fs.readFileSync(path.join(h.chatDir,n),'utf8')).join(''):'';
 yes('sealed prose is absent from actual chat and process logs',!logs.includes('SECRET-4412')&&!h.log().includes('SECRET-4412'));
 yes('the log retains the masked sealed-letter action',logs.includes('/letter-post-v1 [sealed letter]'));
 }finally{
  if(loud)loud.ws.close();if(quiet)quiet.ws.close();if(h.server()&&h.server().exitCode===null){h.server().kill();await h.closed();}
  if(old)old.done();w.done();const owned=path.resolve(h.dir),temp=path.resolve(os.tmpdir());assert(owned.startsWith(temp+path.sep+'thornswood-chatlimit-')&&owned!==temp);fs.rmSync(owned,{recursive:true,force:true});
 }
 console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
