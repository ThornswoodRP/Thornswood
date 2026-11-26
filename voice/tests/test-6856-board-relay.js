'use strict';
// Real authenticated relay and the actual board/front bridge.
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module'),assert=require('node:assert/strict');
const makePage=require('../../tests/fixtures/panel-page');
const file=path.join(__dirname,'test-chat-limit.js'),source=fs.readFileSync(file,'utf8'),end=source.indexOf('(async () => {');assert(end>0);
const fixture=new Module(file,module);fixture.filename=file;fixture.paths=Module._nodeModulePaths(__dirname);
fixture._compile(source.slice(0,end)+'\nmodule.exports={ready,person,settle,server:()=>srv,closed:()=>srvClosed,port:()=>PORT,log:()=>log,chatDir:CHAT_DIR,dir};',file);
const h=fixture.exports;if(process.env.VOICE_SOURCE)fs.copyFileSync(process.env.VOICE_SOURCE,path.join(h.dir,'voice-server.js'));
let pass=0,fail=0,loud,quiet;function yes(n,b){console.log((b?'PASS ':'FAIL ')+n);b?pass++:fail++;}
(async()=>{try{
 await h.ready();loud=await h.person(1000,'Aldis');quiet=await h.person(1001,'Brenna');const stamp=9876543210123,p=makePage();
 for(const f of ['bridge','board'])p.run(f,fs.readFileSync(path.join(__dirname,'../../game/ui/thornswood-'+f+'.js'),'utf8'));
 p.win.thornswoodBoard.setData({me:1000,board:{hold:'windhelm',where:'Windhelm',here:true,wall:[{n:1,at:stamp,title:'Target',text:'Body',name:'Aldis',mine:true}],jobs:[],dests:[],arrivals:[],submit:[]}});p.win.thornswoodBoard.open();
 p.win.thornswoodNet.say=line=>{p.sent.push(line);loud.ws.send(JSON.stringify({t:'chat',text:line,press:true}));return true;};
 const commands=async()=>{await h.settle(loud);return(await(await fetch('http://127.0.0.1:'+h.port()+'/commands')).json()).commands;};
 const button=p.doc.querySelector('[data-do="unpin"]');button.click();button.click();let got=await commands();const line='/board-unpin-v1 '+JSON.stringify(['windhelm',1,stamp]);
 yes('actual confirmed page payload arrives whole and authenticated',got.length===1&&got[0].text===line&&got[0].profileId===1000&&got[0].proven===true);
 yes('ordinary command/frame caps remain ample',line.length<8200&&Buffer.byteLength(JSON.stringify({t:'chat',text:line,press:true}))<1000000);
 for(const press of [true,false]){const before=quiet.chat.length;loud.ws.send(JSON.stringify({t:'chat',text:line,press}));got=await commands();await h.settle(quiet);yes('private Take down never becomes public speech, pressed='+press,got.length===1&&quiet.chat.length===before);}
 for(const prefix of [' ','\n','\r\n\t'])for(const press of [true,false]){const before=quiet.chat.length;loud.ws.send(JSON.stringify({t:'chat',text:prefix+line,press}));got=await commands();await h.settle(quiet);yes('invalid private outer prefix is refused before logging/speech',got.length===0&&quiet.chat.length===before);}
 loud.ws.send(JSON.stringify({t:'chat',text:line+'x'.repeat(8200),press:true}));got=await commands();yes('oversized new intent refuses without slicing',got.length===0);await h.settle(loud);
 let logs='';if(fs.existsSync(h.chatDir))for(const f of fs.readdirSync(h.chatDir))if(fs.statSync(path.join(h.chatDir,f)).isFile())logs+=fs.readFileSync(path.join(h.chatDir,f),'utf8');
 yes('private target stamp is absent from disk/process logs',!logs.includes(String(stamp))&&!h.log().includes(String(stamp)));yes('masked private action remains diagnosable',logs.includes('/board-unpin-v1 [private board action]'));
 }finally{if(loud)loud.ws.close();if(quiet)quiet.ws.close();if(h.server()&&h.server().exitCode===null){h.server().kill();await h.closed();}const owned=path.resolve(h.dir),temp=path.resolve(os.tmpdir());assert(owned.startsWith(temp+path.sep+'thornswood-chatlimit-')&&owned!==temp);fs.rmSync(owned,{recursive:true,force:true});}
 console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
