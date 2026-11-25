'use strict';
// Render the real pages with their front bridge and audit live text controls,
// including conditional forms. A placeholder is never an accessible name.
const fs=require('fs'),path=require('path');
const makePage=require('../../tests/fixtures/panel-page');
const root=path.join(__dirname,'../..'),uiRoot=process.env.UI_ROOT||path.join(root,'game/ui');
let pass=0,fail=0;const seen=new Set();
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
function page(name){const p=makePage();p.doc.createElementNS=(_,tag)=>p.doc.createElement(tag);p.run('bridge',fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8'));p.run(name,fs.readFileSync(path.join(uiRoot,'thornswood-'+name+'.js'),'utf8'));return p;}
function fields(p){return p.doc.querySelectorAll('input,textarea').filter(n=>!['range','checkbox','hidden'].includes(n.getAttribute('type')));}
function named(p,n){
  if((n.getAttribute('aria-label')||'').trim())return true;
  const refs=(n.getAttribute('aria-labelledby')||'').trim().split(/\s+/).filter(Boolean);
  return refs.length>0&&refs.every(id=>!!p.doc.getElementById(id));
}
function audit(p,label,minimum){
  const list=fields(p);yes(label+' actually renders its expected text fields',list.length>=minimum);
  const missing=list.filter(n=>!named(p,n));
  yes(label+' names every text field independently of placeholders',missing.length===0);
  if(missing.length)console.log('UNNAMED '+missing.map(n=>n.id||n.placeholder||n.getAttribute('placeholder')||n.tagName).join(', '));
  list.forEach(n=>{seen.add(label+':'+(n.id||n.getAttribute('aria-label')||n.placeholder));n.value='Aldis';n.removeAttribute('placeholder');});
  yes(label+' keeps every name after typing removes the hint',list.every(n=>named(p,n)));
}
{
  const p=page('box');p.win.thornswoodBox.setData({open:true,where:'Whiterun',rows:[{n:1,what:'Bread',count:3,mine:true}],pack:[{slot:1,what:'Bread',count:4}],packGold:50});p.win.thornswoodBox.open();audit(p,'drop box',4);
}
{
  const p=page('stall'),api=p.win.thornswoodStall;
  const data={mine:true,keeperHere:true,lines:[{n:1,what:'Bread',count:3,words:'2 gold'}],pack:[{base:12,nth:0,what:'Bread',count:4}],found:[]};
  api.setData(data);api.open();audit(p,'keeper stall',5);
  api.setData({...data,mine:false,pack:[]});audit(p,'buyer stall',1);
}
{
  const p=page('trade');p.win.thornswoodTrade.setData({open:true,myGold:0,pack:[{b:12,n:'Bread',c:3}],mine:[{b:12,n:'Bread',c:2}],theirs:[]});audit(p,'trade',4);
}
{
  const p=page('emotes');p.win.thornswoodSetWheel([{name:'Wave'}],[]);audit(p,'emote search',1);
}
{
  const p=page('help');p.win.thornswoodHelp.open('help');audit(p,'help report',1);
}
{
  const p=page('journal'),api=p.win.thornswoodJournal;
  const groupBook={id:'g1',name:'Market book',kind:'business',read:true,canPrices:true,speak:true,invite:true,canRoles:true,owner:true,staff:true,people:[],roles:[]};
  api.setData({journals:[{id:'j1',title:'Notes',pages:[{id:'p1',title:'A day',text:'Words'}]}],group:{show:true,canBusiness:true,canFaction:true,books:[groupBook]}});api.open();
  p.doc.querySelector('[data-book="j1"]').click();p.doc.querySelector('[data-page="p1"]').click();audit(p,'journal editor and founding',4);
  p.doc.querySelector('[data-group="g1"]').click();audit(p,'group book tools',13);
}
{
  const p=page('board'),api=p.win.thornswoodBoard;
  api.setData({board:{here:true,hold:'whiterun',where:'Whiterun',steward:true,dests:[{hold:'riften',where:'Riften'}],x:0,y:0,z:0},rows:[],mine:[]});api.open();audit(p,'notice board letters and hauling',4);
  const make=p.doc.querySelector('[data-do="compose"]');
  yes('the real board exposes its post form action',!!make);if(make){make.click();audit(p,'notice board post form',3);}
}
{
  const p=page('skills'),api=p.win.thornswoodSkills;
  api.setData(null,{panel:{class:'hunter',profession:'smith',half:'edgewright',ranks:{},tree:{},points:0,
    officePage:{staff:true,door:{name:'A house',by:'Brenna',ours:true,staff:true,owing:[{pid:12,name:'Corvin',owed:20}]},
      company:{fields:[{key:'fee',label:'Haul fee',kind:'percent',value:10}]},craft:{them:{pid:12,name:'Corvin',ranks:[]}}}}});api.open();
  const office=p.doc.querySelectorAll('.navrow').find(n=>n.textContent.includes('Office'));yes('the real K navigation exposes Office',!!office);if(office){office.click();audit(p,'Office staff forms',7);}
  api.contractWith({id:12,name:'Brenna'});audit(p,'contract terms',1);
}
for(const name of ['box','stall']){
  const source=fs.readFileSync(path.join(uiRoot,'thornswood-'+name+'.js'),'utf8');
  yes(name+' fields retain a visible keyboard focus treatment',!source.includes('outline:none')||/input:focus[^}]*outline:/.test(source));
}
yes('actual conditional pages expose at least forty distinct text fields',seen.size>=40);
{
  const p=page('emotes');p.win.thornswoodSetWheel([],[]);const unnamed=p.doc.createElement('input');p.doc.body.appendChild(unnamed);
  yes('the page audit rejects an added unnamed text box',!named(p,unnamed));
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
