'use strict';
// Actual board page/front bridge: local validation only, not a commit receipt.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const makePage=require('../../tests/fixtures/panel-page'),root=path.join(__dirname,'../..');
let pass=0,fail=0;function test(name,fn){try{fn();pass++;console.log('PASS '+name);}catch(e){fail++;console.log('FAIL '+name+': '+e.message);}}
function rig(){
 const p=makePage();for(const f of ['bridge','board'])p.run(f,fs.readFileSync(f==='board'&&process.env.BOARD_UI||path.join(root,'game/ui/thornswood-'+f+'.js'),'utf8'));
 p.state={me:1000,board:{hold:'windhelm',where:'Windhelm',here:true,x:1,y:2,z:3,wall:[],jobs:[],dests:[{hold:'whiterun',where:'Whiterun'}],arrivals:[],submit:[]}};
 p.api=p.win.thornswoodBoard;p.field=id=>p.doc.getElementById('ts-board-'+id);
 p.prepare=()=>{for(const field of p.doc.querySelectorAll('input,select'))if(!field.setCustomValidity){
  field.validationMessage='';field.validity={customError:false};field.reports=0;
  field.setCustomValidity=text=>{field.validationMessage=String(text);field.validity.customError=!!text;};
  field.reportValidity=()=>{field.reports++;return !field.validity.customError;};
 }};
 p.feed=()=>{p.api.setData(JSON.parse(JSON.stringify(p.state)));p.prepare();};p.feed();p.api.open();p.prepare();
 p.press=button=>{assert(button,'current control exists');button.focus();const e=p.fire(button,'click','');if(!e.defaultPrevented&&button.onclick)button.onclick.call(button,e);p.prepare();};
 p.button=()=>p.doc.querySelector('[data-do="haul"]');p.values=()=>['pay','dest','haul','to','letter'].map(id=>p.field(id)?.value);
 p.field('pay').value=' 25 ';p.field('dest').value='whiterun';p.field('haul').value=' timber ';p.field('to').value='Brenna';p.field('letter').value='A private draft';
 return p;
}
for(const id of ['pay','dest','haul'])for(const blank of ['', '   ']){
 const p=rig(),field=p.field(id);field.value=blank;const before=p.values(),state=JSON.stringify(p.state);p.press(p.button());
 test(id+' blank '+JSON.stringify(blank)+' sends nothing and preserves all values',()=>{assert.equal(p.sent.length,0);assert.deepEqual(p.values(),before);assert.equal(JSON.stringify(p.state),state);});
 test(id+' blank '+JSON.stringify(blank)+' has focused native validity and a visible associated reason',()=>{
  assert.equal(p.doc.activeElement,field);assert.equal(field.getAttribute('aria-invalid'),'true');assert(field.validity.customError&&field.reports>0);
  const ids=(field.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean),nodes=ids.map(id=>p.doc.getElementById(id)).filter(Boolean);
  assert(nodes.some(n=>n.style.display!=='none'&&new RegExp(id==='dest'?'destination':id==='haul'?'carr':'pay','i').test(n.textContent)));
 });
}
{
 const p=rig();for(const id of ['pay','dest','haul'])p.field(id).value='';
 for(const [id,value]of [['pay','20'],['dest','whiterun'],['haul','Timber']]){
  p.press(p.button());test('first missing field progresses to '+id,()=>{assert.equal(p.doc.activeElement,p.field(id));assert.equal(p.sent.length,0);});
  p.field(id).value=value;p.fire(p.field(id),id==='dest'?'change':'input');
  test('editing '+id+' retires only its missing-field reason',()=>{assert.equal(p.field(id).validity.customError,false);assert.equal(p.field(id).getAttribute('aria-invalid'),null);const note=p.field('haul-reason');assert(!note||note.style.display==='none'||!note.textContent);});
 }
 p.press(p.button());test('completed required fields keep the exact existing wire',()=>assert.deepEqual(p.sent,['/haul 20 whiterun Timber']));
}
for(const kind of ['prior','newer','cleared']){
 const p=rig(),f=p.field('haul');f.value='';f.setAttribute('aria-describedby','existing-hint');
 const hint=p.doc.createElement('p');hint.id='existing-hint';hint.textContent='Existing hint';p.doc.body.appendChild(hint);
 if(kind==='prior'){f.setCustomValidity('Prior error');f.setAttribute('aria-invalid','grammar');}
 p.press(p.button());
 test(kind+' ownership control starts with an installed missing-field error',()=>assert(f.validity.customError&&f.validationMessage!=='Prior error'));
 if(kind==='newer'){f.setCustomValidity('A newer error');f.setAttribute('aria-invalid','true');}
 if(kind==='cleared'){f.setCustomValidity('');f.removeAttribute('aria-invalid');}
 f.value='Timber';p.fire(f,'input');
 test(kind+' validity and descriptions retain their actual ownership',()=>{
  assert.equal(f.validationMessage,kind==='prior'?'Prior error':kind==='newer'?'A newer error':'');
  assert.equal(f.getAttribute('aria-invalid'),kind==='prior'?'grammar':kind==='newer'?'true':null);
  assert.equal(f.getAttribute('aria-describedby'),'existing-hint');
 });
}
for(const mode of ['redraw','close','compose']){
 const p=rig(),f=p.field('haul');f.value='';p.press(p.button());const old=p.button(),handler=old.onclick;
 test(mode+' lifecycle control starts with native missing-field validation',()=>assert(f.validity.customError));
 if(mode==='redraw')p.feed();else if(mode==='close')p.api.close();else p.press(p.doc.querySelector('[data-do="compose"]'));
 if(p.field('haul'))p.field('haul').value='Timber';
 test(mode+' retires stale owned error and the removed haul handler',()=>{assert.equal(f.validity.customError,false);assert.equal(f.getAttribute('aria-invalid'),null);const before=p.sent.length;handler.call(old);assert.equal(p.sent.length,before);});
}
for(const delivery of ['sent','queued','throws']){
 const p=rig(),calls=[],values=p.values();p.win.thornswoodNet.say=line=>{calls.push(line);if(delivery==='throws')throw Error('after queue');return delivery==='sent';};p.press(p.button());
 test(delivery+' preserves entered values with no retry or acknowledgement claim',()=>{assert.deepEqual(calls,['/haul 25 whiterun timber']);assert.deepEqual(p.values(),values);});
}
{
 const p=rig();p.field('pay').value='0';p.press(p.button());test('zero still follows the existing wire and authoritative refusal path',()=>assert.deepEqual(p.sent,['/haul 0 whiterun timber']));
 const q=rig();q.field('pay').value='1a2';q.press(q.button());test('existing pay grammar is unchanged by empty-field feedback',()=>assert.deepEqual(q.sent,['/haul 12 whiterun timber']));
 const r=rig();r.state.board.dests=[];r.feed();test('unavailable haul form has no invented destination or send button',()=>assert.equal(r.button(),null));
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
