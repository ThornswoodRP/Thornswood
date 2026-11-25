'use strict';
// Real HTTP/authentication/storage path. No Discord or other remote service.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const siteFiles=require('../../tests/site-files');
const tempBase=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(tempBase,'tw5855-'));
const secret=crypto.randomBytes(32).toString('hex'),ids=['222222222222222222','333333333333333333'];
let child,port,pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
function cookie(id,name){const at=String(Date.now()),value=id+'|'+name+'|'+at;
  return 'twa='+encodeURIComponent(value+'|'+crypto.createHmac('sha256',secret).update(value).digest('hex').slice(0,32));}
function marks(){return JSON.parse(fs.readFileSync(path.join(dir,'data/results.json'),'utf8'));}
async function request(payload,auth,origin){const res=await fetch('http://127.0.0.1:'+port+'/api/results',{
  method:'PUT',headers:{'content-type':'application/json',...(auth?{cookie:auth}:{}),origin:origin||'http://127.0.0.1:'+port},
  body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});const text=await res.text();let body={};
  try{body=JSON.parse(text);}catch(error){body={error:text};}return {status:res.status,body};}
async function stop(){if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolve=>{child.once('close',resolve);child.kill();});}
(async()=>{
  try{
    siteFiles.copy(dir);
    fs.mkdirSync(path.join(dir,'data'),{recursive:true});
    fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({password:crypto.randomBytes(16).toString('hex'),secret,
      admins:ids,discord:{clientId:'fixture',clientSecret:'fixture',botToken:'',guildId:'',invite:''},
      gameCheckPort:1,onlineFile:path.join(dir,'online.json')}));
    const untouched={status:'pass',notes:'someone else marked this',by:'Earlier tester',at:1};
    fs.writeFileSync(path.join(dir,'data/results.json'),JSON.stringify({'other-test':untouched}));
    child=spawn(process.execPath,[path.join(dir,'server.js')],{cwd:dir,stdio:['ignore','pipe','pipe'],env:{...process.env,
      THORNSWOOD_DOCS_PORT:'0',THORNSWOOD_DOCS_LOCAL:'1',THORNSWOOD_GITHUB_API:'http://127.0.0.1:1'}});
    port=(await siteFiles.listening(child)).port;
    const a=cookie(ids[0],'Aela'),b=cookie(ids[1],'Brénna');
    for(const [i,by]of ['Another staff member','',null,{toString:'forged'},['Other'],false].entries()){
      const status=['pass','fail','skip',''][i%4],id='author-'+i;
      const res=await request({id,status,notes:'kept note '+i,by},a);
      yes('request author is ignored for case '+i,res.status===200&&res.body.results[id].by==='Aela'&&marks()[id].by==='Aela');
      yes('status and notes retain their existing meaning for case '+i,res.status===200&&marks()[id].status===status&&marks()[id].notes==='kept note '+i);
    }
    const omitted=await request({id:'no-author',status:'pass'},a);
    yes('omitting an author still records the authenticated name',omitted.status===200&&marks()['no-author'].by==='Aela');
    const changed=await request({id:'author-0',status:'fail',by:'Aela'},b);
    yes('a later signed-in staff member becomes the actual author',changed.status===200&&marks()['author-0'].by==='Brénna');
    yes('another existing mark remains exactly unchanged',JSON.stringify(marks()['other-test'])===JSON.stringify(untouched));
    const before=fs.readFileSync(path.join(dir,'data/results.json'),'utf8');
    const unauthorized=await request({id:'intruder',status:'pass',by:'Aela'});
    yes('a request body cannot replace authentication',unauthorized.status===401&&fs.readFileSync(path.join(dir,'data/results.json'),'utf8')===before);
    const crossSite=await request({id:'cross-site',status:'pass',by:'Aela'},a,'https://other.invalid');
    yes('the existing cross-site write protection remains effective',crossSite.status===403&&fs.readFileSync(path.join(dir,'data/results.json'),'utf8')===before);
    const blocker=path.join(dir,'data','.results.json.'+child.pid+'.tmp');fs.mkdirSync(blocker);
    const refused=await request({id:'failed-save',status:'pass',by:'Other'},a);
    yes('failed persistence keeps every existing author and mark unchanged',refused.status===500&&fs.readFileSync(path.join(dir,'data/results.json'),'utf8')===before);
    fs.rmdirSync(blocker);
    fs.writeFileSync(path.join(dir,'data/results.json'),'{broken');
    const corrupt=await request({id:'corrupt-file',status:'pass',by:'Other'},a);
    yes('an unreadable marks file is never replaced by one new mark',corrupt.status===500&&fs.readFileSync(path.join(dir,'data/results.json'),'utf8')==='{broken');
  }finally{
    await stop();
    const resolved=fs.realpathSync(dir);
    if(path.dirname(resolved)!==tempBase||!path.basename(resolved).startsWith('tw5855-'))throw Error('fixture cleanup escaped its temp parent');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
  console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
