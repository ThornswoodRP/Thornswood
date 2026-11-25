'use strict';
// Actual panels with the real front bridge; native Chrome/AX is checked separately.
const fs=require('fs'),path=require('path'),makePage=require('../../tests/fixtures/panel-page');
const root=path.join(__dirname,'../..'),ui=process.env.UI_ROOT||path.join(root,'game/ui');
let pass=0,fail=0;function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
const cases=[
 ['journal','Journal',{journals:[]}],['board','Board',{board:{here:true,hold:'whiterun',where:'Whiterun'},rows:[],mine:[]}],
 ['party','Party',{}],['skills','Skills',null],['trade','Trade',{open:true,sessionId:'a'.repeat(48),pack:[],mine:[],theirs:[]}],
 ['box','Box',{open:true,where:'Whiterun',rows:[],pack:[],packGold:50}],
 ['ride','Ride',{open:true,driver:'Bjorlam',stops:[{name:'Solitude',fare:20}]}],
 ['treat','Treat',{rows:[]}],['repair','Repair',{rows:[],kits:[]}],['furniture','Furniture',{rows:[]}],
 ['maneuvers','Maneuvers',null],['help','Help',null],
 ['merchant','Merchant',{open:true,sessionId:'merchant-a',trader:'Smith',place:'Whiterun',rows:[],quests:[]}],
 ['ship','Ship',{open:true,mode:'dock',port:{name:'Solitude'},lines:[],boats:[],routes:[]}]
];
for(const [name,word,data]of cases){
 try{
  const p=makePage();p.doc.createElementNS=(_,tag)=>p.doc.createElement(tag);
  p.run('bridge',fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8'));
  p.run(name,fs.readFileSync(path.join(ui,'thornswood-'+name+'.js'),'utf8'));
  const api=p.win['thornswood'+word],sentinel=p.doc.createElement('input');p.doc.body.appendChild(sentinel);sentinel.focus();
  const feed=()=>{
   if(name==='skills')api.setData(null,{panel:{class:'hunter',profession:'smith',ranks:{},tree:{},points:0}});
   else if(name==='maneuvers')api.setRows([{key:'cover',name:'Cover',stamina:10,ready:true}],'M');
   else if(data)api.setData(data);
  };
  feed();if(!api.isOpen())api.open();
  const dialogs=p.doc.querySelectorAll('[role="dialog"]'),dialog=dialogs[0];
  yes(name+' opens one named dialog',dialogs.length===1&&
   (dialog.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).some(id=>{const title=p.doc.getElementById(id);return title&&title.textContent.trim();}));
  const labelId=dialog&&dialog.getAttribute('aria-labelledby');
  yes(name+' label points to one mounted title',!!labelId&&p.doc.querySelectorAll('[id="'+labelId+'"]').length===1);
  yes(name+' keeps its existing modal policy',!!dialog&&dialog.hasAttribute('aria-modal')===(name==='merchant'||name==='ship'));
  yes(name+' moves initial focus to a mounted control inside its dialog',!!dialog&&!!p.doc.activeElement&&p.doc.activeElement!==sentinel&&dialog.contains(p.doc.activeElement)&&/^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(p.doc.activeElement.tagName));
  sentinel.focus();feed();api.open();yes(name+' repeated open and owner view do not steal typing focus',p.doc.activeElement===sentinel);
  api.close();api.open();yes(name+' a later closed to open moves focus again',!!dialog&&dialog.contains(p.doc.activeElement)&&p.doc.activeElement!==sentinel);
 }catch(error){yes(name+' real page setup succeeds: '+error.stack,false);}
}
// New native buttons retain their existing actions without invoking the page shortcut too.
for(const name of ['skills','maneuvers']){
 const p=makePage();p.doc.createElementNS=(_,tag)=>p.doc.createElement(tag);
 for(const file of ['bridge',name])p.run(file,fs.readFileSync(path.join(ui,'thornswood-'+file+'.js'),'utf8'));
 const api=p.win[name==='skills'?'thornswoodSkills':'thornswoodManeuvers'];
 if(name==='skills')api.setData(null,{panel:{class:'hunter',profession:'smith',ranks:{},tree:{},points:0}});
 else api.setRows([{key:'cover',name:'Cover',stamina:10,ready:true}],'M');
 api.open();const button=name==='skills'?p.doc.querySelectorAll('#ts-skills .navrow')[1]:p.doc.querySelector('#ts-maneuvers .row');
 yes(name+' navigation rows are native buttons',button&&button.tagName==='BUTTON');button.focus();
 const before=p.sent.length;
 for(const key of ['Enter',' ']){
  const fresh=p.fire(button,'keydown',key),held=p.fire(button,'keydown',key,{repeat:true});
  yes(name+' leaves a fresh native activation to its button and bounds repeats '+JSON.stringify(key),!fresh.defaultPrevented&&held.defaultPrevented&&p.sent.length===before);
 }
 if(name==='skills'){
  button.click();const next=p.doc.querySelectorAll('#ts-skills .navrow')[1];
  yes('K native navigation keeps the chosen section and focus without confirming',next.classList.contains('on')&&p.doc.activeElement===next&&p.sent.length===before);
 }else{
  p.fire(button,'click','');yes('a native maneuver click keeps its existing single command',p.sent.length===before+1&&p.sent.at(-1)==='/maneuver cover'&&!api.isOpen());
 }
}
// An explicit empty/disabled/hidden-control boundary, independent of any panel.
{
 const p=makePage();p.win.getComputedStyle=node=>node.style;
 p.run('bridge',fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8'));
 const wrap=p.doc.createElement('div');wrap.id='boundary';p.doc.body.appendChild(wrap);
 const dialog=p.doc.createElement('div'),title=p.doc.createElement('h2');title.textContent='Boundary title';wrap.appendChild(dialog);dialog.appendChild(title);
 const hidden=p.doc.createElement('button');hidden.style.display='none';dialog.appendChild(hidden);
 const disabled=p.doc.createElement('button');disabled.disabled=true;dialog.appendChild(disabled);
 const group=p.doc.createElement('div');group.setAttribute('inert','');dialog.appendChild(group);group.appendChild(p.doc.createElement('button'));
 const first=p.doc.createElement('input');dialog.appendChild(first);
 p.win.thornswoodDialog.open(dialog,title);
 yes('the shared open boundary skips hidden disabled and inert controls',p.doc.activeElement===first);
 yes('the shared helper adds no modal declaration or focus trap',!dialog.hasAttribute('aria-modal'));
 dialog.removeChild(first);p.win.thornswoodDialog.open(dialog,title);
 yes('an empty enabled-control list focuses the named dialog itself',p.doc.activeElement===dialog&&dialog.getAttribute('tabindex')==='-1');
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
