'use strict';
// A real authenticated voice service, real page/front bridge and whole gamemode.
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module'),assert=require('node:assert/strict');
const standIn=require('../../tests/stand-in-server'),editor=require('../../tests/fixtures/journal-editor');
const file=path.join(__dirname,'test-chat-limit.js'),setup=fs.readFileSync(file,'utf8');
const stop=setup.indexOf('(async () => {');assert(stop>0,'the real relay fixture setup must be found');
const fixtureModule=new Module(file,module);fixtureModule.filename=file;fixtureModule.paths=Module._nodeModulePaths(__dirname);
fixtureModule._compile(setup.slice(0,stop)+'\nmodule.exports={ready,person,settle,shut,server:()=>srv,closed:()=>srvClosed,port:()=>PORT,log:()=>log,chatDir:CHAT_DIR,dir};',file);
const h=fixtureModule.exports;
if(process.env.VOICE_SOURCE)fs.copyFileSync(process.env.VOICE_SOURCE,path.join(h.dir,'voice-server.js'));
let pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
const w=standIn.world({name:'4771-real-relay',settings:{thornswoodServer:'main'}});
const a=w.person(0xff004773,{profileId:1000,name:'Brenna',cell:'3c:Skyrim.esm',pos:[0,0,0]});
let loud,quiet;
(async()=>{
 try{
  yes('the whole gamemode loads',w.boot());w.arrive(a);w.run(30000);
  const soc=()=>w.box().__thornswoodSocial;
  const book=soc().newJournal(a,'Relay notebook').journal;soc().writePage(a,book.id,'','Before','Before');
  const pid=w.prop(a,'thornswoodSocial').journals[0].pages[0].id;
  const p=editor({journalId:book.id,pageId:pid,view:()=>{soc().push(a);return w.prop(a,'thornswoodSocialView');}});
  await h.ready();loud=await h.person(1000,'Brenna');quiet=await h.person(1001,'Corvin');
  p.win.thornswoodNet.say=line=>{p.sent.push(line);loud.ws.send(JSON.stringify({t:'chat',text:line,press:true}));return true;};
  const commands=async()=>{await h.settle(loud);return(await(await fetch('http://127.0.0.1:'+h.port()+'/commands')).json()).commands;};
  for(const [label,title,text]of[
   ['Unicode','雪'.repeat(60),'雪'.repeat(4000)],
   ['maximum JSON escapes','\0'.repeat(60),'\0'.repeat(4000)],
   ['private prose','Private :: title','SECRET-4771-PRIVATE-PROSE\n  literal\\n 雪']
  ]){
   p.type(title,text);const line=p.save(),frame=JSON.stringify({t:'chat',text:line,press:true});
   const received=await commands();
   yes(label+' reaches the actual relay whole and authenticated',received.length===1&&received[0].text===line&&received[0].profileId===1000&&received[0].proven===true);
   yes(label+' fits the narrowly bounded command and frame limits',line.length<=25000&&Buffer.byteLength(frame,'utf8')<1000000);
   console.log('MEASURE '+label+': commandChars='+line.length+' frameBytes='+Buffer.byteLength(frame,'utf8'));
   if(received[0])w.relayCommand(received[0]);w.run(2100);
   const saved=w.prop(a,'thornswoodSocial').journals[0].pages[0];
   yes(label+' is saved exactly by the whole gamemode after the actual relay',saved.title===title&&saved.text===text);
  }
  const quietBefore=quiet.chat.length;
  loud.ws.send(JSON.stringify({t:'chat',text:'/journal-write-v1 '+JSON.stringify([book.id,pid,'Private','SECRET-4771-TYPED']),press:false}));
  await commands();await h.settle(quiet);
  yes('private page commands are never broadcast to another peer',quiet.chat.length===quietBefore);
  loud.ws.send(JSON.stringify({t:'chat',text:'/journal-write-v1 '+'x'.repeat(25000),press:true}));
  const oversized=await commands();
  yes('an over-limit versioned request is refused without queuing a truncated command',oversized.length===0&&loud.chat.some(m=>/too long.*not sent|too long.*not.*server/i.test(m.text)));
  loud.ws.send(JSON.stringify({t:'chat',text:'/journal-write-v10 '+'x'.repeat(24000),press:true}));
  const ordinary=await commands();yes('a similar other verb retains the original command cap',ordinary.length===1&&ordinary[0].text.length===8200);
  await h.shut(loud);loud=null;await h.shut(quiet);quiet=null;
  h.server().kill();await h.closed();
  const logs=fs.existsSync(h.chatDir)?fs.readdirSync(h.chatDir).filter(n=>n.endsWith('.jsonl')).map(n=>fs.readFileSync(path.join(h.chatDir,n),'utf8')).join(''):'';
  yes('pressed and typed private prose is absent from the actual chat and process logs',!logs.includes('SECRET-4771-PRIVATE-PROSE')&&!logs.includes('SECRET-4771-TYPED')&&!h.log().includes('SECRET-4771'));
  yes('the private command log retains only its masked action',logs.includes('/journal-write-v1 [private page]'));
 }finally{
  if(loud)loud.ws.close();if(quiet)quiet.ws.close();if(h.server()&&h.server().exitCode===null){h.server().kill();await h.closed();}
  w.done();
  const owned=path.resolve(h.dir),temporary=path.resolve(os.tmpdir());
  assert(owned.startsWith(temporary+path.sep+'thornswood-chatlimit-')&&owned!==temporary,'cleanup stays in the relay fixture folder');
  fs.rmSync(owned,{recursive:true,force:true});
 }
 console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
