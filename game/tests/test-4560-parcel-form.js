'use strict';
// #4560: Send a parcel on the actual board page and front bridge. Local checks only;
// the server checks the stack, the count and the pay again (tests/test-4560-parcels.js).
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const makePage=require('../../tests/fixtures/panel-page'),root=path.join(__dirname,'../..');
let pass=0,fail=0;function test(name,fn){try{fn();pass++;console.log('PASS '+name);}catch(e){fail++;console.log('FAIL '+name+': '+e.message);}}
const DAGGER=0x1397e;
function rig(pack){
 const p=makePage();p.win.crypto={getRandomValues:a=>require('node:crypto').randomFillSync(a)};for(const f of ['bridge','board'])p.run(f,fs.readFileSync(f==='board'&&process.env.BOARD_UI||path.join(root,'game/ui/thornswood-'+f+'.js'),'utf8'));
 p.state={me:1000,boardSubmissions:{owner:{profileId:1000,actorDesc:'parcel-fixture',runtime:'1'},results:[]},board:{hold:'windhelm',where:'Windhelm',here:true,x:1,y:2,z:3,
  wall:[{n:3,at:5,job:true,letter:true,parcel:true,name:'Brenna',title:'',reward:0,text:'A sealed parcel for Lydia',taken:'',mine:false,held:false,haul:false}],
  jobs:[],dests:[{hold:'whiterun',where:'Whiterun'}],arrivals:[],submit:[],
  pack:pack===undefined?[{slot:1,baseId:DAGGER,what:'Iron Dagger',count:2}]:pack,parcelPayMin:15}};
 p.api=p.win.thornswoodBoard;p.field=id=>p.doc.getElementById('ts-board-'+id);
 p.prepare=()=>{for(const field of p.doc.querySelectorAll('input,select'))if(!field.setCustomValidity){
  field.validationMessage='';field.validity={customError:false};field.reports=0;
  field.setCustomValidity=text=>{field.validationMessage=String(text);field.validity.customError=!!text;};
  field.reportValidity=()=>{field.reports++;return !field.validity.customError;};
 }};
 p.feed=()=>{p.api.setData(JSON.parse(JSON.stringify(p.state)));p.prepare();};p.feed();p.api.open();p.prepare();
 p.press=button=>{assert(button,'current control exists');button.focus();const e=p.fire(button,'click','');if(!e.defaultPrevented&&button.onclick)button.onclick.call(button,e);p.prepare();};
 p.button=()=>p.doc.querySelector('[data-do="parcel"]');
 p.fill=()=>{if(!p.field('p-to'))return;p.field('p-to').value='Lydia "Red" Stone';p.field('p-item').value='1:'+DAGGER;p.field('p-count').value='2';
  p.field('p-letter').value='For the road.';p.field('p-pay').value=' 25 ';};
 p.fill();
 return p;
}
function packets(lines){return lines.map(line=>{assert(line.startsWith('/board-submit-v1 '));const p=JSON.parse(line.slice('/board-submit-v1 '.length));assert.match(p[1],/^[0-9a-f]{32}$/);assert.deepEqual(p[3],[1000,'parcel-fixture','1']);return[p[0],p[2],...p.slice(4)];});}
{
 const p=rig();
 test('the board offers Send a parcel with the pack\'s stacks and the server\'s least pay',()=>{
  assert(p.button());assert(/Iron Dagger \(2\)/.test(p.field('p-item').textContent));assert(/15 or more/.test(p.doc.body.textContent));});
 p.press(p.button());
 test('a filled parcel sends one private submission: who, the words, the pay, the slot, its base and how many',()=>
  assert.deepEqual(packets(p.sent),[['parcel','windhelm','Lydia "Red" Stone','For the road.','25','1',String(DAGGER),'2']]));
}
{
 const p=rig();p.field('p-count').value='';p.press(p.button());
 test('how many left blank is one',()=>assert.deepEqual(packets(p.sent)[0].slice(-1),['1']));
}
for(const id of ['p-to','p-letter','p-pay'])for(const blank of ['','   ']){
 const p=rig(),field=p.field(id);field.value=blank;p.press(p.button());
 test(id+' blank '+JSON.stringify(blank)+' sends nothing, with the reason beside it',()=>{assert.equal(p.sent.length,0);
  assert.equal(p.doc.activeElement,field);assert.equal(field.getAttribute('aria-invalid'),'true');
  const note=p.field('parcel-reason');assert(note&&note.style.display!=='none'&&note.textContent);});
}
{
 const p=rig([]);
 test('with nothing in the pack that can go, there is no Send the parcel, and it says so',()=>{assert.equal(p.button(),null);
  assert(/Nothing in your pack that can go in a parcel/.test(p.doc.body.textContent));});
}
{
 const p=rig();
 test('a parcel on the wall reads as a Parcel, sealed, with Take',()=>{const t=p.doc.body.textContent;assert(/Parcel, Brenna/.test(t)&&/A sealed parcel for Lydia/.test(t));
  assert(Array.from(p.doc.querySelectorAll('[data-do="take"]')).some(b=>b.getAttribute('data-n')==='3'));});
}
{
 const p=rig();p.press(p.button());const id=JSON.parse(p.sent[0].slice('/board-submit-v1 '.length))[1];
 p.state.boardSubmissions.results=[{id:id,kind:'parcel',hold:'windhelm',status:'posted'}];p.feed();
 test('the server\'s posted result for that parcel clears its draft',()=>{assert.equal(p.field('p-to').value,'');assert.equal(p.field('p-letter').value,'');
  assert.equal(p.field('p-pay').value,'');assert(/post was saved/.test(p.field('action-status').textContent));});
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
