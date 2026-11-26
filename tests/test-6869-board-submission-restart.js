'use strict';
// Reuse the actual property block and existing split live/saved pack fixture.
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module'),assert=require('node:assert/strict');
const file=path.join(__dirname,'test-4901-pack-first.js'),source=fs.readFileSync(file,'utf8'),end=source.indexOf('MOVES.forEach(function (m)');
assert(end>0);const fixture=new Module(file,module);fixture.filename=file;fixture.paths=Module._nodeModulePaths(__dirname);
const prefix=source.slice(0,end).replace("path.join(REPO_DIR, 'game', 'gamemode.js')","process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js')");
fixture._compile(prefix+'\nmodule.exports={folder,engine,boot,inDir,settle,register,ALICE,GOLD,HOLD,temps};',file);
const h=fixture.exports;let pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
function receipt(W){return W.boardSubmissions?.(h.ALICE.a,h.ALICE.pid)?.results||[];}
function submit(dir,W,kind,id){const o=W.boardSubmissions?.(h.ALICE.a,h.ALICE.pid)?.owner,owner=o&&[o.profileId,o.actorDesc,o.runtime];h.inDir(dir,()=>W.submitBoard?.(kind==='letter'?['letter',id,h.HOLD,owner,'Lydia','SEALED-RESTART']:['haul',id,h.HOLD,owner,'50','riften','a crate of mead'],h.ALICE.a,h.ALICE.pid,()=>{}));}
try{
 for(const kind of ['letter','haul'])for(const stage of ['before-pack-save','after-pack-save','after-register-save']){
  const dir=h.folder(),e=h.engine(),W=h.boot(dir,e),id=(kind==='letter'?'a':'b').repeat(32);
  submit(dir,W,kind,id);yes(kind+' '+stage+' has no optimistic result',receipt(W).length===0);
  if(stage!=='before-pack-save')e.savePack(h.ALICE.a);
  if(stage==='after-register-save')h.settle(dir,W);
  e.restart();const restored=h.boot(dir,e);h.settle(dir,restored);h.settle(dir,restored);
  const doc=h.register(dir),rows=doc.notices[h.HOLD]||[],cost=kind==='letter'?35:60;
  if(stage==='before-pack-save')yes(kind+' crash before saved debit cannot create result notice or fee',receipt(restored).length===0&&rows.length===0&&e.count(h.ALICE.a,h.GOLD)===500&&doc.debits.length===0);
  else yes(kind+' '+stage+' recovers exactly its saved notice metadata and fee once',receipt(restored).length===1&&receipt(restored)[0].id===id&&rows.length===1&&e.count(h.ALICE.a,h.GOLD)===500-cost&&doc.funds[h.HOLD]===cost&&e.writes===1);
 }
}finally{
 const temp=path.resolve(os.tmpdir());for(const dir of h.temps){const owned=path.resolve(dir);assert(owned.startsWith(temp+path.sep+'ts-4901-')&&owned!==temp);fs.rmSync(owned,{recursive:true,force:true});}
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
