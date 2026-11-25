'use strict';
// Run the real page and bridge, click its controls and dispatch browser-order
// keyboard events. The server replies explicitly through the public page API.
const fs=require('fs'),path=require('path');
const makePage=require('../../tests/fixtures/panel-page.js');
const root=path.join(__dirname,'../..');
const ui=fs.readFileSync(process.env.SKILLS_UI||path.join(root,'game/ui/thornswood-skills.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8');
let pass=0,fail=0;
function yes(name,condition){console.log((condition?'PASS ':'FAIL ')+name);condition?pass++:fail++;}
function rig(state){
  const p=makePage(),clock={now:1800000000000},timers=[];
  p.win.Date=class extends Date{static now(){return clock.now;}};
  p.win.setTimeout=(fn,ms)=>{timers.push({fn,at:clock.now+ms});return timers.length;};
  p.run('bridge',bridge);p.run('skills',ui);
  const api=p.win.thornswoodSkills;
  let current=Object.assign({'class':null,profession:null,half:null,schools:[],ranks:{},tree:{},points:3,creating:false},state);
  api.setData(null,current);api.open();
  p.click=n=>{if(!n)throw Error('missing control');n.onclick({target:n,currentTarget:n,stopPropagation(){},preventDefault(){}});};
  p.nav=name=>p.click(p.doc.querySelectorAll('.navrow').find(n=>n.querySelector('.k').textContent===name));
  p.pick=name=>p.click(p.doc.querySelectorAll('.card').find(n=>n.querySelector('.name')&&n.querySelector('.name').textContent===name));
  p.confirm=()=>p.click(p.doc.querySelector('[data-act="confirm"]'));
  p.messages=()=>p.told.filter(line=>line.includes('skills:pick '));
  p.reply=patch=>{current=Object.assign({},current,patch);api.setData(null,current);};
  p.plus=()=>p.doc.querySelectorAll('.plus');
  p.advance=ms=>{clock.now+=ms;const due=timers.filter(t=>t.at<=clock.now);due.forEach(t=>{timers.splice(timers.indexOf(t),1);t.fn();});};
  return p;
}
for(const type of ['class','profession']){
  const p=rig();p.nav(type==='class'?'Class':'Profession');
  if(type==='class')p.pick('Hunter');
  else{p.pick('Smith');p.click(p.doc.querySelectorAll('.half').find(n=>n.querySelector('.hn').textContent==='Platewright'));}
  p.confirm();p.confirm();
  yes(type+' Confirm sends once on a quick second click',p.messages().length===1);
  yes(type+' Confirm goes unlit while waiting',/\boff\b/.test(p.doc.querySelector('[data-act="confirm"]').className));
  p.reply({points:4});p.confirm();
  yes(type+' unrelated authoritative updates do not release its pending pick',p.messages().length===1);
  p.reply({note:{at:0.5,about:type==='class'?'profession':'class',text:'Another choice was refused'}});p.confirm();
  yes(type+' a refusal for another section cannot release its pending pick',p.messages().length===1);
  p.reply({note:{at:1,about:type,text:'Try a different choice'}});
  yes(type+' refusal restores Confirm without losing the marked choice',!/\boff\b/.test(p.doc.querySelector('[data-act="confirm"]').className));
  p.confirm();yes(type+' can retry after its refusal',p.messages().length===2);
  p.reply(type==='class'?{'class':'hunter'}:{profession:'smith',half:'platewright'});
  p.confirm();yes(type+' successful reply settles the pick without another send',p.messages().length===2);
}
{
  const p=rig();p.nav('Class');p.pick('Hunter');
  p.fire(p.doc.body,'keydown','Enter');
  for(let i=0;i<4;i++)p.fire(p.doc.body,'keydown','Enter',{repeat:true});
  yes('held Enter confirms a marked class once',p.messages().length===1);
}
{
  const p=rig({'class':'hunter',profession:'smith',half:'platewright'});p.nav('Skill tree');
  p.click(p.plus()[0]);p.click(p.plus()[0]);p.click(p.plus()[1]);
  yes('all plus controls wait after one point is sent',p.messages().length===1&&p.plus().every(n=>/\boff\b/.test(n.className)));
  p.reply({points:4});p.click(p.plus()[0]);
  yes('an unrelated point grant cannot acknowledge a pending spend',p.messages().length===1);
  const skill=p.messages()[0].split('spend ')[1];
  p.reply({tree:{[skill]:1},points:3});
  yes('the authoritative skill change restores plus controls',p.plus().some(n=>!/\boff\b/.test(n.className)));
  p.fire(p.doc.body,'keydown','Enter',{repeat:true});
  yes('Enter repeat after an answer still sends no second point',p.messages().length===1);
  p.fire(p.doc.body,'keydown','Enter');
  yes('a new Enter press can spend after the answer',p.messages().length===2);
  p.reply({note:{at:2,about:'spend',text:'That point was refused'}});
  yes('spend refusal restores the controls',p.plus().some(n=>!/\boff\b/.test(n.className)));
}
{
  const p=rig();p.nav('Class');p.pick('Hunter');p.confirm();p.advance(30051);p.confirm();
  yes('a missing reply eventually permits an explicit retry',p.messages().length===2);
}
{
  const p=rig({'class':'hunter',profession:'smith',half:'platewright'});p.nav('Skill tree');
  p.click(p.plus()[0]);p.advance(30051);p.click(p.plus()[0]);
  yes('a missing spend reply eventually restores its controls for an explicit retry',p.messages().length===2);
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
