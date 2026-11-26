'use strict';
// Render the real session table, chat export and log headings in three host
// zones. In particular the two repeated autumn hours must stay distinguishable.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
if(!process.env.SESSION_CLOCK_CHILD){
 let failed=0;
 for(const zone of ['UTC','America/Denver','Asia/Kolkata']){
  const r=cp.spawnSync(process.execPath,[__filename],{encoding:'utf8',env:{...process.env,TZ:zone,SESSION_CLOCK_CHILD:'1'}});
  console.log(zone+'\n'+r.stdout);if(r.status!==0){failed++;console.error(r.stderr);}
 }
 process.exitCode=failed?1:0;
}else{
 const src=fs.readFileSync(path.join(__dirname,'../public/hub.js'),'utf8');
 function grab(name){
  const at=src.indexOf('function '+name+'(');if(at<0)return '';
  let depth=0;for(let i=src.indexOf('{',at);i<src.length;i++){
   if(src[i]==='{')depth++;else if(src[i]==='}'&&!--depth)return src.slice(at,i+1);
  }throw Error('Unclosed '+name);
 }
 const ctx=vm.createContext({esc:x=>String(x),bytesFor:x=>String(x),sessionChars:()=>'',sessionOpen:s=>!s.end,forMins:()=>'',Date});
 for(const n of ['sessionTime','sessionTable','chatText','logFileHtml'])vm.runInContext(grab(n),ctx);
 let pass=0,fail=0;const yes=(name,ok)=>{console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;};
 const first=Date.parse('2026-11-01T07:30:00Z'),second=Date.parse('2026-11-01T08:30:00Z');
 const table=ctx.sessionTable([{start:first,end:second,who:'123',session:'a',channel:'dev',profile:1}]);
 yes('session endpoints name UTC and distinguish both repeated hours',table.includes('2026-11-01 07:30:00 UTC')&&table.includes('2026-11-01 08:30:00 UTC'));
 const text=ctx.chatText([{at:first,name:'A',text:'first',proven:true},{at:second,name:'A',text:'second',proven:true}]);
 yes('downloaded chat carries dated UTC stamps for both instants',text.includes('2026-11-01 07:30:00 UTC  A: first')&&text.includes('2026-11-01 08:30:00 UTC  A: second'));
 yes('missing endpoints keep their existing truthful wording',ctx.sessionTable([{who:'123',session:'b',channel:'dev'}]).includes('start never seen'));
 yes('unusable timestamps cannot become a false date or an exception',typeof ctx.sessionTime==='function'&&ctx.sessionTime('bad')==='unknown'&&ctx.sessionTime(null)==='unknown');
 const server=ctx.logFileHtml('a','server-dev.log','raw server line'),launcher=ctx.logFileHtml('a','launcher.log','raw launcher line');
 yes('server log heading distinguishes UTC from legacy server local stamps',/UTC/.test(server)&&/server.*local time/i.test(server));
 yes('launcher log heading distinguishes UTC from legacy machine local stamps',/UTC/.test(launcher)&&/PC.*local time/i.test(launcher));
 yes('log explanations preserve the original displayed log bytes',server.includes('<pre>raw server line</pre>')&&launcher.includes('<pre>raw launcher line</pre>'));
 console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
}
