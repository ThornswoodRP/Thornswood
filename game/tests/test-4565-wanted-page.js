'use strict';
// #4565: wanted posters on the actual board page and front bridge. Local checks only; the
// server checks the kind, the bounty, who confirms and who takes down again
// (tests/test-4565-wanted-posters.js).
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const makePage=require('../../tests/fixtures/panel-page'),root=path.join(__dirname,'../..');
let pass=0,fail=0;function test(name,fn){try{fn();pass++;console.log('PASS '+name);}catch(e){fail++;console.log('FAIL '+name+': '+e.message);}}
function wantedRow(over){return Object.assign({n:4,at:5,job:true,letter:false,haul:false,wanted:true,name:'Alice',title:'Wanted: Hjalti',
  reward:75,text:'Took three horses.',taken:'Bob',mine:false,held:false},over||{});}
function rig(board){
 const p=makePage();p.win.crypto={getRandomValues:a=>require('node:crypto').randomFillSync(a)};
 for(const f of ['bridge','board'])p.run(f,fs.readFileSync(path.join(root,'game/ui/thornswood-'+f+'.js'),'utf8'));
 p.state={me:1000,boardSubmissions:{owner:{profileId:1000,actorDesc:'wanted-fixture',runtime:'1'},results:[]},
  board:Object.assign({hold:'whiterun',where:'Whiterun',here:true,x:1,y:2,z:3,wall:[wantedRow()],jobs:[],dests:[],arrivals:[],submit:[],
   pack:[],parcelPayMin:15,guard:false,bountyGuard:false,steward:false},board||{})};
 p.api=p.win.thornswoodBoard;p.api.setData(JSON.parse(JSON.stringify(p.state)));p.api.open();
 p.press=b=>{assert(b,'control exists');const e=p.fire(b,'click','');if(!e.defaultPrevented&&b.onclick)b.onclick.call(b,e);};
 p.buttons=(verb)=>Array.from(p.doc.querySelectorAll('[data-do="'+verb+'"]'));
 p.labels=()=>Array.from(p.doc.querySelectorAll('button')).map(b=>b.textContent);
 return p;
}
function type(p,id,value){const f=p.doc.getElementById('ts-board-'+id);assert(f,'field '+id);f.value=value;p.fire(f,'input','');}
{
 const p=rig();
 test('a wanted poster reads as Wanted with its bounty on the wall',()=>assert(/Wanted, 75 gold bounty/.test(p.doc.body.textContent)));
 test('nobody but a guard is offered Confirm the bounty or Take down on it',()=>{
  assert(!p.labels().includes('Confirm the bounty'));assert.equal(p.buttons('unpin').length,0);assert.equal(p.buttons('paid').length,0);});
}
{
 const p=rig({wall:[wantedRow({mine:true})]});
 test('the one who put it up gets neither Pay the reward nor Take down on it',()=>{
  assert.equal(p.buttons('paid').length,0);assert.equal(p.buttons('unpin').length,0);});
}
{
 const p=rig({guard:true,bountyGuard:true});
 test('a guard of the hold gets Confirm the bounty and Take down on a taken poster',()=>{
  assert(p.labels().includes('Confirm the bounty'));assert.equal(p.buttons('unpin').length,1);});
 p.press(p.buttons('paid')[0]);
 test('and Confirm the bounty sends the line that pays it',()=>assert.equal(p.sent[p.sent.length-1],'/job done 4'));
}
{
 const p=rig({guard:true,bountyGuard:true,wall:[wantedRow({held:true})]});
 test('a guard who took it is offered no Confirm the bounty on it',()=>assert(!p.labels().includes('Confirm the bounty')));
}
{
 const p=rig({guard:true,bountyGuard:false});
 test('the Jarl gets Take down and no Confirm the bounty',()=>{
  assert.equal(p.buttons('unpin').length,1);assert(!p.labels().includes('Confirm the bounty'));});
}
{
 const p=rig({guard:true,bountyGuard:true,wall:[wantedRow({taken:''})]});
 test('nothing to confirm before anybody has taken it',()=>assert(!p.labels().includes('Confirm the bounty')));
}
{
 const p=rig({wall:[]});
 p.press(p.buttons('compose')[0]);
 const wanted=p.buttons('kind').filter(b=>b.getAttribute('data-kind')==='wanted')[0];
 test('Make a post offers Wanted beside Notice and Job',()=>assert(wanted&&wanted.textContent==='Wanted'));
 p.press(wanted);
 test('and picking it asks for the bounty and says who pays it out',()=>{
  assert.notEqual(p.doc.getElementById('ts-board-rewardline').style.display,'none');
  assert(/until a guard of this hold confirms it was earned/.test(p.doc.getElementById('ts-board-cost').textContent));});
 type(p,'title','Wanted: Hjalti');type(p,'text','Took three horses.');type(p,'reward','');
 const before=p.sent.length;
 p.press(p.buttons('send')[0]);
 test('a bounty left blank sends nothing, and says why',()=>{assert.equal(p.sent.length,before);
  assert(/A bounty is a whole number of gold/.test(p.doc.getElementById('ts-board-said').textContent));});
 type(p,'reward','75');
 p.press(p.buttons('send')[0]);
 test('a filled wanted poster sends one post: the kind, the bounty, the title, the words and the board',()=>{
  const line=p.sent[p.sent.length-1];assert(line.startsWith('/board-post-v1 '));
  assert.deepEqual(JSON.parse(line.slice('/board-post-v1 '.length)),['wanted',75,'Wanted: Hjalti','Took three horses.','whiterun']);});
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
