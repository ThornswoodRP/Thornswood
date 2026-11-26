'use strict';
// Real authenticated sockets and command queue: private JSON must never float/log.
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module'),assert=require('node:assert/strict');
const file=path.join(__dirname,'test-chat-limit.js'),source=fs.readFileSync(file,'utf8'),end=source.indexOf('(async () => {');assert(end>0);
const fixture=new Module(file,module);fixture.filename=file;fixture.paths=Module._nodeModulePaths(__dirname);
fixture._compile(source.slice(0,end)+'\nmodule.exports={ready,person,settle,shut,server:()=>srv,closed:()=>srvClosed,port:()=>PORT,log:()=>log,chatDir:CHAT_DIR,dir};',file);
const h=fixture.exports;if(process.env.VOICE_SOURCE)fs.copyFileSync(process.env.VOICE_SOURCE,path.join(h.dir,'voice-server.js'));
let pass=0,fail=0,loud,quiet;function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
const owner=[1000,'relay-character','1'],id='6869'.repeat(8),wire=p=>'/board-submit-v1 '+JSON.stringify(p);
(async()=>{try{
 await h.ready();loud=await h.person(1000,'Brenna');quiet=await h.person(1001,'Corvin');
 const commands=async()=>{await h.settle(loud);return(await(await fetch('http://127.0.0.1:'+h.port()+'/commands')).json()).commands;};
 for(const kind of ['letter','haul'])for(const press of [true,false]){
  const line=wire(kind==='letter'?['letter',id,'windhelm',owner,'Lydia "Red" Stone','SEALED-6869-RELAY']:['haul',id,'windhelm',owner,'15','whiterun','PRIVATE-6869-CARGO']);
  const before=quiet.chat.length;loud.ws.send(JSON.stringify({t:'chat',text:line,press}));const got=await commands();await h.settle(quiet);
  yes(kind+' typed/pressed command retains exact whole JSON and proven owner '+press,got.length===1&&got[0].text===line&&got[0].profileId===1000&&got[0].proven===true);
  yes(kind+' private command never becomes public speech '+press,quiet.chat.length===before);
 }
 const maximum=wire(['letter',id,'windhelm',owner,'雪'.repeat(60),'雪'.repeat(300)]);
 loud.ws.send(JSON.stringify({t:'chat',text:maximum,press:true}));yes('maximum canonical letter fits unchanged8200 command cap',(await commands())[0]?.text===maximum&&maximum.length<8200);
 for(const prefix of [' ','\n','\r\n\t'])for(const press of [true,false]){
  const before=quiet.chat.length;loud.ws.send(JSON.stringify({t:'chat',text:prefix+wire(['letter',id,'windhelm',owner,'Lydia','SEALED-6869-BAD-PREFIX']),press}));const got=await commands();await h.settle(quiet);
  yes('leading whitespace private opcode is refused before queue/speech '+JSON.stringify(prefix)+' '+press,got.length===0&&quiet.chat.length===before);
 }
 for(const press of [true,false]){loud.ws.send(JSON.stringify({t:'chat',text:wire(['letter',id,'windhelm',owner,'Lydia','SEALED-6869-OVERSIZE'])+' '.repeat(8200),press}));yes('oversized request is refused whole rather than cut '+press,(await commands()).length===0);}
 for(const line of ['/board-submit-v1'+JSON.stringify(['letter',id,'windhelm',owner,'Lydia','SEALED-6869-NO-DELIMITER']),'/BOARD-SUBMIT-V1 '+JSON.stringify(['letter',id,'windhelm',owner,'Lydia','SEALED-6869-CASE']),'/board-submit-v1\t'+JSON.stringify(['letter',id,'windhelm',owner,'Lydia','SEALED-6869-TAB'])]){
  loud.ws.send(JSON.stringify({t:'chat',text:line,press:false}));yes('malformed private opcode delimiter/case cannot enter queue or log',(await commands()).length===0);
 }
 for(const suffix of ['x','_'])for(const press of [true,false]){
  const line='/board-submit-v1'+suffix+' '+JSON.stringify(['letter',id,'windhelm',owner,'Lydia','SEALED-6869-SUFFIX']);
  const before=quiet.chat.length;loud.ws.send(JSON.stringify({t:'chat',text:line,press}));const got=await commands();await h.settle(quiet);
  yes('reserved private stem with word suffix is refused before queue/speech '+suffix+' '+press,got.length===0&&quiet.chat.length===before);
 }
 await h.shut(loud);loud=null;await h.shut(quiet);quiet=null;h.server().kill();await h.closed();
 const logs=fs.existsSync(h.chatDir)?fs.readdirSync(h.chatDir).filter(n=>n.endsWith('.jsonl')).map(n=>fs.readFileSync(path.join(h.chatDir,n),'utf8')).join(''):'';
 yes('actual process and chat logs contain no letter body cargo or request ID',!logs.includes('SEALED-6869')&&!logs.includes('PRIVATE-6869')&&!logs.includes(id)&&!logs.includes('relay-character')&&!h.log().includes('SEALED-6869')&&!h.log().includes('PRIVATE-6869')&&!h.log().includes(id));
 yes('masked private board submission action remains in actual log',logs.includes('/board-submit-v1 [private board submission]'));
}finally{
 if(loud)loud.ws.close();if(quiet)quiet.ws.close();if(h.server()&&h.server().exitCode===null){h.server().kill();await h.closed();}
 const owned=path.resolve(h.dir),temp=path.resolve(os.tmpdir());assert(owned.startsWith(temp+path.sep+'thornswood-chatlimit-')&&owned!==temp);fs.rmSync(owned,{recursive:true,force:true});
}console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
