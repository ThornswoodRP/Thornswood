'use strict';
// The real authenticated WebSocket relay, with the actual P page/front bridge.
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module'),assert=require('node:assert/strict');
const makePage=require('../../tests/fixtures/panel-page');
const file=path.join(__dirname,'test-chat-limit.js'),source=fs.readFileSync(file,'utf8'),end=source.indexOf('(async () => {');assert(end>0);
const fixture=new Module(file,module);fixture.filename=file;fixture.paths=Module._nodeModulePaths(__dirname);
fixture._compile(source.slice(0,end)+'\nmodule.exports={ready,person,settle,server:()=>srv,closed:()=>srvClosed,port:()=>PORT,log:()=>log,chatDir:CHAT_DIR,dir};',file);
const h=fixture.exports;if(process.env.VOICE_SOURCE)fs.copyFileSync(process.env.VOICE_SOURCE,path.join(h.dir,'voice-server.js'));
let pass=0,fail=0,loud,quiet;function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
(async()=>{try{
 await h.ready();loud=await h.person(1000,'Aldis');quiet=await h.person(1001,'Brenna');
 const id='a'.repeat(48),version='b'.repeat(48),p=makePage();
 for(const file of ['bridge','party'])p.run(file,fs.readFileSync(path.join(__dirname,'../../game/ui/thornswood-'+file+'.js'),'utf8'));
 p.win.thornswoodParty.setData({me:1000,partyIntent:{id,version},party:[{p:1000,name:'Aldis',me:true,leader:true},{p:1001,name:'Brenna'}],friends:[],together:2,bonus:10});p.win.thornswoodParty.open();
 p.win.thornswoodNet.say=line=>{p.sent.push(line);loud.ws.send(JSON.stringify({t:'chat',text:line,press:true}));return true;};
 const commands=async()=>{await h.settle(loud);return(await(await fetch('http://127.0.0.1:'+h.port()+'/commands')).json()).commands;};
 const button=p.doc.querySelector('[data-do="kick"]');button.click();button.click();let got=await commands();
 const line='/party-action-v1 kick '+id+' '+version+' 1001';
 yes('actual confirmed page command reaches relay whole and authenticated',got.length===1&&got[0].text===line&&got[0].profileId===1000&&got[0].proven===true);
 yes('normal command and UTF8 frame caps remain ample',line.length<8200&&Buffer.byteLength(JSON.stringify({t:'chat',text:line,press:true}))<1000000);
 for(const press of [true,false]){
  const before=quiet.chat.length;loud.ws.send(JSON.stringify({t:'chat',text:line,press}));got=await commands();await h.settle(quiet);
  yes('party binding never becomes public speech, press='+press,got.length===1&&quiet.chat.length===before);
 }
 for(const prefix of [' ','\n','\r\n\t'])for(const press of [true,false]){
  const before=quiet.chat.length;loud.ws.send(JSON.stringify({t:'chat',text:prefix+line,press}));got=await commands();await h.settle(quiet);
  yes('malformed outer prefix is refused before log/speech, press='+press,got.length===0&&quiet.chat.length===before);
 }
 loud.ws.send(JSON.stringify({t:'chat',text:line+'x'.repeat(8200),press:true}));got=await commands();yes('oversized request is refused without slicing',got.length===0);
 await h.settle(loud);
 let logs='';if(fs.existsSync(h.chatDir))for(const f of fs.readdirSync(h.chatDir))if(fs.statSync(path.join(h.chatDir,f)).isFile())logs+=fs.readFileSync(path.join(h.chatDir,f),'utf8');
 yes('opaque party binding is absent from disk/process logs',!logs.includes(id)&&!logs.includes(version)&&!h.log().includes(id)&&!h.log().includes(version));
 yes('private action retains a masked diagnostic',logs.includes('/party-action-v1 [private party action]'));
 }finally{
  if(loud)loud.ws.close();if(quiet)quiet.ws.close();if(h.server()&&h.server().exitCode===null){h.server().kill();await h.closed();}
  const owned=path.resolve(h.dir),temp=path.resolve(os.tmpdir());assert(owned.startsWith(temp+path.sep+'thornswood-chatlimit-')&&owned!==temp);fs.rmSync(owned,{recursive:true,force:true});
 }
 console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
