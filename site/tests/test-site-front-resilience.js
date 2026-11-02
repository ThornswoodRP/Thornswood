'use strict';
const assert=require('assert'), fs=require('fs'), path=require('path'), vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'..','..','site','public','home.js'),'utf8');
const helper=source.slice(source.indexOf('function request('),source.indexOf('function show('));
function harness(fetch) {
  const timers=new Map(); let next=0, aborted=0;
  const box={Promise, Object, Error, Math, fetch,
    setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;}, clearTimeout(id){timers.delete(id);},
    AbortController:class{constructor(){this.signal={};}abort(){aborted++;}}};
  box.window=box; vm.createContext(box);vm.runInContext(helper,box);
  return {box,timers,aborted:()=>aborted};
}
async function main(){
  let count=0;
  const hung=harness(()=>{count++;return new Promise(()=>{});});
  const p=hung.box.request('/api/public'); const refusal=assert.rejects(p,/did not answer/);
  [...hung.timers.values()][0].fn(); await refusal;
  assert.equal(hung.aborted(),1);assert.equal(count,1,'no silent retry');
  const stalled=harness(()=>Promise.resolve({ok:true,json:()=>new Promise(()=>{})}));
  const body=stalled.box.request('/api/public'); const bodyRefusal=assert.rejects(body,/did not answer/);
  await Promise.resolve();[...stalled.timers.values()][0].fn();await bodyRefusal;
  const failed=harness(()=>Promise.resolve({ok:false,status:429,json:()=>Promise.resolve({error:'slow down'})}));
  await assert.rejects(failed.box.request('/api/gallery'),/could not load/);assert.equal(failed.timers.size,0);
  const proxy=harness(()=>Promise.resolve({ok:false,status:502,json:()=>Promise.reject(new Error('HTML error'))}));
  const reply=await proxy.box.request('/api/report',{method:'POST'});
  assert.equal(reply.ok,false);assert.deepEqual(await reply.json(),{});assert.equal(proxy.timers.size,0);
  const good=harness(()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({gallery:[]})}));
  assert.deepEqual((await (await good.box.request('/api/gallery')).json()).gallery,[]);assert.equal(good.timers.size,0);
  const plain={size:100,name:'small.png'};assert.strictEqual(await good.box.preparePicture(plain),plain);
  await assert.rejects(good.box.preparePicture({size:26*1048576,name:'big.png'}),/25 MB/);
  const gif={size:3*1048576,name:'motion.gif'};assert.strictEqual(await good.box.preparePicture(gif),gif);
  let dimensions,closed=0;
  good.box.File=class{constructor(parts,name,opts){this.size=parts[0].size;this.name=name;this.type=opts.type;}};
  good.box.createImageBitmap=()=>Promise.resolve({width:5120,height:2880,close(){closed++;}});
  good.box.document={createElement(){return{getContext(){return{drawImage(){}};},
    toBlob(callback){dimensions=[this.width,this.height];callback({size:200000,type:'image/webp'});}};}};
  const converted=await good.box.preparePicture({size:3*1048576,name:'scene.png'});
  assert.equal(converted.name,'scene.webp');assert.equal(converted.type,'image/webp');assert.equal(converted.size,200000);
  assert.deepEqual(dimensions,[2560,1440]);assert.equal(closed,1,'bitmap released');
  // Run the real pagination handler with a draft and an upload already in progress.
  const controls={galMore:{disabled:false,addEventListener(_,fn){this.click=fn;}},
    galMoreStatus:{focus(){this.focused=true;}},galleryCards:{html:'initial',insertAdjacentHTML(_,html){this.html+=html;}},
    galBy:{value:'Draft author'},galNote:{value:'Draft note'},galSend:{disabled:true},galChosen:{html:'blob:preview'}};
  const draft={...controls};let calls=0,bound=0;
  const data={gallery:[{name:'first'}],galleryNext:24};
  const pagination={document:{getElementById:id=>controls[id]},d:data,galData:data,
    galleryCards:items=>items.map(item=>item.name).join(','),bindGalleryReports(){bound++;},
    drawGallery(){throw new Error('Pagination replaced the submission form');},
    request:async url=>{calls++;assert.equal(url,'/api/gallery?offset=24');return{json:async()=>({gallery:[{name:'second'}],next:null})};}};
  vm.createContext(pagination);
  vm.runInContext(source.slice(source.indexOf("    var more = document.getElementById('galMore');"),source.indexOf('    function said(msg, bad)',source.indexOf('  function drawGallery()'))),pagination);
  controls.galMore.click();controls.galMore.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1,'concurrent pagination clicks do not duplicate the request');
  assert.equal(controls.galleryCards.html,'initialsecond');assert.equal(bound,1);
  for(const id of ['galBy','galNote','galSend','galChosen'])assert.strictEqual(controls[id],draft[id],'preserve '+id);
  assert.equal(controls.galBy.value,'Draft author');assert.equal(controls.galNote.value,'Draft note');
  assert.equal(controls.galSend.disabled,true,'ongoing upload remains locked');
  assert.equal(controls.galChosen.html,'blob:preview');assert.equal(controls.galMore.hidden,true);
  assert.equal(controls.galMoreStatus.focused,true,'focus moves to completion status');
  console.log('PASS request/body deadlines, failed requests, timer cleanup, no retry, image caps, compression, animation preservation and gallery draft preservation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
