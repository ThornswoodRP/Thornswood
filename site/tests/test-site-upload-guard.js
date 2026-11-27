'use strict';
const fs=require('fs'), path=require('path'), os=require('os'), vm=require('vm'), assert=require('assert'),crypto=require('crypto');
const {PassThrough}=require('stream');
// The guard is two halves since server.js was split (#5357): what takes where
// and when out of a file (site\lib\media.js, from its marker) and
// receiveUpload, which checks an upload before it is kept (site\lib\uploads.js,
// to its marker).
const media=fs.readFileSync(path.join(__dirname,'..','..','site','lib','media.js'),'utf8');
const uploads=fs.readFileSync(path.join(__dirname,'..','..','site','lib','uploads.js'),'utf8');
const code=media.split('// ==== thornswood upload guard ====')[1].split('\nObject.assign(module.exports')[0]+'\n'+
  uploads.slice(uploads.indexOf('\nfunction receiveUpload(')).split('// ==== end thornswood upload guard ====')[0];
const work=fs.mkdtempSync(path.join(os.tmpdir(),'tw-upload-guard-'));
let key='one';
/* Only the stalled upload needs a short deadline. Compressing every timer to
   100ms made the concurrent same-name check flake on a loaded VPS: one stream's
   close could land after the mocked deadline and return 408 (Refs #2541). */
let compressDeadlineMs=null;
/* The disk's free floor (#4404) is left at nothing here: what this checks is
   the guard's other refusals, and site/tests/test-4404-upload-room.js checks
   the floor with the free space stood in for. */
/* An upload is written in UP_PART and moved into UP once whole (#4956). */
const box={fs,path,crypto,Buffer,Map,Date,UP:work,UP_PART:path.join(work,'.part'),UPLOAD_FREE_FLOOR:0,reportFrom:()=>key,
  setTimeout:(fn,ms)=>setTimeout(fn, compressDeadlineMs==null ? ms : Math.min(ms,compressDeadlineMs)),clearTimeout,
  send:(res,status,payload,type,headers)=>res.finish({status,payload,headers}),
  sendJson:(res,status,payload)=>res.finish({status,payload})};
vm.createContext(box);vm.runInContext(code,box);
function upload(name,bytes,allow,cap=4096,hang=false) {
  return new Promise(resolve=>{
    const req=new PassThrough();req.headers={};req.complete=!hang;
    const res={finish:resolve,destroy:()=>resolve({status:0})};
    box.receiveUpload(req,res,name,cap,allow,saved=>resolve({status:200,name:saved}));
    if(hang) req.write(bytes);else req.end(bytes);
  });
}
/* An upload held open (#4587): it has sent part of its file and not the
   rest, the way a slow connection does, until finish() sends the rest. Each
   is finished at the end whatever happened, so a failed check does not leave
   one open for its five minute deadline. */
const held=[];
function hold(name) {
  const req=new PassThrough();req.headers={};req.complete=false;
  let resolve;const done=new Promise(r=>{resolve=r;});
  const res={finish:resolve,destroy:()=>resolve({status:0})};
  box.receiveUpload(req,res,name,4096,null,saved=>resolve({status:200,name:saved}));
  req.write(Buffer.from('part one '));
  const h={done,finish(){if(!req.writableEnded){req.complete=true;req.end(Buffer.from('part two'));}return done;}};
  held.push(h);
  return h;
}
async function main(){
  const png=Buffer.from('89504e470d0a1a0a00000000','hex');
  const valid=await upload('screen.png',png,['.png']);assert.equal(valid.status,200);
  assert(fs.readFileSync(path.join(work,valid.name)).equals(png),'saved unchanged');
  const before=fs.readdirSync(work).length;
  assert.equal((await upload('fake.png',Buffer.from('<script>bad</script>'),['.png'])).status,415);
  assert.equal(fs.readdirSync(work).length,before,'invalid media removed');
  assert.equal((await upload('big.log',Buffer.alloc(32),null,16)).status,413);
  assert.equal(fs.readdirSync(work).length,before,'oversize partial removed');
  compressDeadlineMs=100;
  assert.equal((await upload('stalled.log',Buffer.from('start'),null,4096,true)).status,408);
  compressDeadlineMs=null;
  assert.equal(fs.readdirSync(work).length,before,'timed out partial removed');
  assert.equal((await upload('script.svg',Buffer.from('<svg/>'),['.png'])).status,415);
  const concurrent=await Promise.all([upload('same.log',Buffer.from('FIRST'),null),upload('same.log',Buffer.from('SECOND'),null)]);
  assert(concurrent.every(r=>r.status===200), 'concurrent statuses '+concurrent.map(r=>r.status).join(','));
  assert.notEqual(concurrent[0].name,concurrent[1].name);
  assert.equal(fs.readFileSync(path.join(work,concurrent[0].name),'utf8'),'FIRST');
  assert.equal(fs.readFileSync(path.join(work,concurrent[1].name),'utf8'),'SECOND');
  key='count-limit';
  for(let i=0;i<40;i++)assert.equal((await upload('a.log',Buffer.from('x'),null)).status,200);
  const blocked=await upload('a.log',Buffer.from('x'),null);assert.equal(blocked.status,429);
  assert(Number(blocked.headers['Retry-After'])>0,'retry-after on quota');
  // Two at once from one connection, and no third (#4587).
  key='at-once';
  const first=hold('one.log'),second=hold('two.log');
  const third=await upload('three.log',Buffer.from('x'),null);
  assert.equal(third.status,429,'a third upload while two are open is refused, got '+third.status);
  assert(Number(third.headers['Retry-After'])>0,'retry-after on the third at once');
  assert.equal((await first.finish()).status,200,'the first of the two still finishes');
  const fourth=await upload('four.log',Buffer.from('x'),null);
  assert.equal(fourth.status,200,'once one of the two has finished, the next is taken, got '+fourth.status);
  assert.equal((await second.finish()).status,200,'and so does the second');
  // Boundary validation covers every advertised picture and recording type.
  assert(box.mediaSignature('.jpg',Buffer.from('ffd8ff','hex')));
  assert(box.mediaSignature('.gif',Buffer.from('GIF89a')));
  assert(box.mediaSignature('.webp',Buffer.from('RIFF0000WEBP')));
  assert(box.mediaSignature('.mp4',Buffer.from('0000ftyp')));
  assert(box.mediaSignature('.webm',Buffer.from('1a45dfa3','hex')));
  console.log('PASS upload signatures, byte caps, deadlines, cleanup, hourly rate cap, two at once and retry guidance');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await Promise.all(held.map(h=>h.finish()));fs.rmSync(work,{recursive:true,force:true});});
