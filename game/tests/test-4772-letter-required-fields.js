'use strict';
// Actual current board page/front bridge; no receipt or transport authority model.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const makePage=require('../../tests/fixtures/panel-page'),root=path.join(__dirname,'../..');let pass=0,fail=0;
function test(name,fn){try{fn();pass++;console.log('PASS '+name);}catch(e){fail++;console.log('FAIL '+name+': '+e.message);}}
function rig(){const p=makePage();p.win.crypto={getRandomValues:a=>require('node:crypto').randomFillSync(a)};for(const f of ['bridge','board'])p.run(f,fs.readFileSync(f==='board'&&process.env.BOARD_UI||path.join(root,'game/ui/thornswood-'+f+'.js'),'utf8'));
 p.state={me:1000,boardSubmissions:{owner:{profileId:1000,actorDesc:'letter-fixture',runtime:'1'},results:[]},board:{hold:'windhelm',where:'Windhelm',here:true,x:1,y:2,z:3,wall:[],jobs:[],dests:[{hold:'whiterun',where:'Whiterun'}],arrivals:[],submit:[]}};
 p.api=p.win.thornswoodBoard;p.field=id=>p.doc.getElementById('ts-board-'+id);p.prepare=()=>{for(const f of p.doc.querySelectorAll('input,select'))if(!f.setCustomValidity){f.validationMessage='';f.validity={customError:false};f.reports=0;f.setCustomValidity=t=>{f.validationMessage=String(t);f.validity.customError=!!t;};f.reportValidity=()=>{f.reports++;return !f.validity.customError;};}};
 p.feed=()=>{p.api.setData(JSON.parse(JSON.stringify(p.state)));p.prepare();};p.feed();p.api.open();p.prepare();
 p.button=verb=>p.doc.querySelector('[data-do="'+(verb||'letter')+'"]');p.press=b=>{assert(b,'current control exists');b.focus();const e=p.fire(b,'click','');if(!e.defaultPrevented&&b.onclick)b.onclick.call(b,e);p.prepare();};
 p.values=()=>['to','letter','pay','dest','haul'].map(id=>p.field(id)?.value);
 for(const[id,value]of [['to','Brenna'],['letter','A private draft'],['pay','25'],['dest','whiterun'],['haul','Timber']])p.field(id).value=value;
 return p;}
function packets(lines){return lines.map(line=>{assert(line.startsWith('/board-submit-v1 '));const p=JSON.parse(line.slice('/board-submit-v1 '.length));assert.match(p[1],/^[0-9a-f]{32}$/);assert.deepEqual(p[3],[1000,'letter-fixture','1']);return[p[0],p[2],...p.slice(4)];});}
for(const id of ['to','letter'])for(const blank of ['', '   ']){
 const p=rig(),f=p.field(id);f.value=blank;const values=p.values(),state=JSON.stringify(p.state);p.press(p.button());
 test(id+JSON.stringify(blank)+' refuses without sending or changing any input',()=>{assert.equal(p.sent.length,0);assert.deepEqual(p.values(),values);assert.equal(JSON.stringify(p.state),state);});
 test(id+JSON.stringify(blank)+' has native validity, focus and a visible associated reason',()=>{assert(p.doc.activeElement===f);assert(f.validity.customError&&f.reports>0);assert.equal(f.getAttribute('aria-invalid'),'true');const ids=(f.getAttribute('aria-describedby')||'').split(/\s+/);assert(ids.map(id=>p.doc.getElementById(id)).filter(Boolean).some(n=>n.style.display!=='none'&&new RegExp(id==='to'?'for|recipient':'says|text','i').test(n.textContent)));});
}
{
 const p=rig();p.field('to').value='';p.field('letter').value='';p.press(p.button());
 test('recipient is the first missing input',()=>assert(p.doc.activeElement===p.field('to')));
 p.field('to').value='  Brenna "Ox" & Co  ';p.fire(p.field('to'),'input');p.press(p.button());
 test('correction advances to missing body while preserving raw recipient',()=>{assert(p.doc.activeElement===p.field('letter'));assert.equal(p.field('to').value,'  Brenna "Ox" & Co  ');assert.equal(p.sent.length,0);});
 p.field('letter').value='  Meet <near> & west\nThen return.  ';p.fire(p.field('letter'),'input');p.press(p.button());
 test('completed letter preserves exact raw private JSON fields and captured hold',()=>assert.deepEqual(packets(p.sent),[['letter','windhelm',p.field('to').value,p.field('letter').value]]));
}
for(const kind of ['prior','newer','cleared']){
 const p=rig(),f=p.field('letter');f.value='';f.setAttribute('aria-describedby','old-hint');if(kind==='prior'){f.setCustomValidity('Prior error');f.setAttribute('aria-invalid','grammar');}p.press(p.button());
 test(kind+' ownership control installs its actual refusal first',()=>assert(f.validity.customError&&f.validationMessage!=='Prior error'));
 if(kind==='newer'){f.setCustomValidity('A newer error');f.setAttribute('aria-invalid','true');}if(kind==='cleared'){f.setCustomValidity('');f.removeAttribute('aria-invalid');}
 f.value='Ready';p.fire(f,'input');test(kind+' validity and prior description preserve their owner',()=>{assert.equal(f.validationMessage,kind==='prior'?'Prior error':kind==='newer'?'A newer error':'');assert.equal(f.getAttribute('aria-invalid'),kind==='prior'?'grammar':kind==='newer'?'true':null);assert.equal(f.getAttribute('aria-describedby'),'old-hint');});
}
for(const mode of ['redraw','close','compose']){
 const p=rig(),f=p.field('letter');f.value='';p.press(p.button());const old=p.button(),handler=old.onclick;
 test(mode+' starts with installed letter validation',()=>assert(f.validity.customError));if(mode==='redraw')p.feed();else if(mode==='close')p.api.close();else p.press(p.button('compose'));
 if(p.field('letter'))p.field('letter').value='A new draft';test(mode+' retires old validation and '+(mode==='redraw'?'keeps the live letter button (#4475)':'stale handler'),()=>{assert.equal(f.validity.customError,false);assert.equal(f.getAttribute('aria-invalid'),null);const count=p.sent.length;handler.call(old);
  if(mode==='redraw'){assert.equal(p.button(),old);assert.equal(p.sent.length,count+1);}else assert.equal(p.sent.length,count);});
}
{
 const p=rig();p.field('letter').value='';p.press(p.button());const letter=p.field('letter'),old=p.field('letter-reason');p.field('haul').value='';p.press(p.button('haul'));
 test('switching to haul retires only the old letter error',()=>{assert.equal(letter.validity.customError,false);assert.equal(old.textContent,'');assert(p.field('haul').validity.customError);assert(p.field('haul-reason').textContent);});
 p.press(p.button());test('switching back to letter retains one owned reason',()=>{assert.equal(p.field('haul').validity.customError,false);assert.equal(p.field('haul-reason').textContent,'');assert(p.field('letter').validity.customError);});
}
{
 const p=rig(),f=p.field('letter');f.value='';p.press(p.button());const old=p.field('letter-reason');
 test('replacement-region control starts with a real mounted reason',()=>assert(old&&old.textContent));
 const parent=old&&old.parentNode;if(parent)parent.removeChild(old);test('fixture removal detaches a parsed child from traversal and its parent',()=>{assert(old);assert.equal(old.parentNode,null);assert(!parent.contains(old));assert.equal(parent.querySelector('#'+old.id),null);});const next=p.doc.createElement('div');next.id='ts-board-letter-reason';next.textContent='A replacement status';if(parent)parent.appendChild(next);f.value='Ready';p.fire(f,'input');
 test('cleanup does not clear a replacement region or its now-valid description token',()=>{assert(parent);assert.equal(next.textContent,'A replacement status');assert.equal(f.getAttribute('aria-describedby'),next.id);assert.equal(f.validity.customError,false);});
}
{
 const p=rig(),f=p.field('letter');f.value='';p.press(p.button());const note=p.field('letter-reason');test('newer-message control installs the original reason first',()=>assert(note&&note.textContent));
 if(note)note.textContent='A newer status';f.value='Ready';p.fire(f,'input');test('cleanup preserves newer text in the same note',()=>{assert(note);assert.equal(note.textContent,'A newer status');assert.equal(f.getAttribute('aria-describedby'),note.id);assert.equal(f.validity.customError,false);});
}
for(const id of ['to','letter']){
 const p=rig();p.field(id).value='bad\ud800text';const values=p.values();p.press(p.button());
 test(id+' invalid URI text stays unsent with raw values and a visible non-native diagnostic',()=>{assert.equal(p.sent.length,0);assert.deepEqual(p.values(),values);const note=p.field('letter-reason');assert(note&&note.style.display!=='none'&&/invalid text/.test(note.textContent));assert.equal(p.field('to').validity.customError,false);assert.equal(p.field('letter').validity.customError,false);});
 p.api.close();test(id+' invalid-text diagnostic is retired on close',()=>{const note=p.field('letter-reason');assert(!note||!note.textContent);});
}
for(const delivery of ['sent','queued','throws']){
 const p=rig(),values=p.values(),calls=[];p.win.thornswoodNet.say=line=>{calls.push(line);if(delivery==='throws')throw Error('after queue');return delivery==='sent';};p.press(p.button());test(delivery+' preserves both drafts and never retries',()=>{assert.deepEqual(packets(calls),[['letter','windhelm','Brenna','A private draft']]);assert.deepEqual(p.values(),values);});
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
