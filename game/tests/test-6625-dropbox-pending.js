'use strict';
// Execute the actual drop-box page and bridge; the receipt enters its public
// setData API. No balance delta is treated as an acknowledgement.
const fs=require('fs'),path=require('path');
const makePage=require('../../tests/fixtures/panel-page.js');
const root=path.join(__dirname,'../..');
const source=fs.readFileSync(process.env.BOX_UI||path.join(root,'game/ui/thornswood-box.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8');
let pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
function rig(){
  const p=makePage(),clock={now:1800000000000},timers=[];
  p.win.Date=class extends Date{static now(){return clock.now;}};
  p.win.setTimeout=(fn,ms)=>{const timer={fn,at:clock.now+ms};timers.push(timer);return timer;};
  p.win.clearTimeout=timer=>{const i=timers.indexOf(timer);if(i>=0)timers.splice(i,1);};
  p.run('bridge',bridge);p.run('box',source);
  let view={open:true,hold:'windhelm',where:'Windhelm',rows:[],pack:[],packGold:100,mineGold:0,at:1};
  const api=p.win.thornswoodBox;
  api.setData(view);
  p.button=()=>p.doc.querySelector('[data-do="gold"]');
  p.amount=value=>{p.doc.getElementById('ts-box-gold').value=value;};
  p.amount('10');
  p.click=node=>(node||p.button()).onclick.call(node||p.button(),{target:node||p.button(),preventDefault(){}});
  p.reply=patch=>{view=Object.assign({},view,patch);api.setData(view);};
  p.token=()=>p.sent[p.sent.length-1].split(' ')[3];
  p.waiting=()=>p.button().hasAttribute('disabled')||p.button().disabled;
  p.advance=ms=>{clock.now+=ms;for(const timer of timers.slice())if(timer.at<=clock.now){timers.splice(timers.indexOf(timer),1);timer.fn();}};
  p.local=()=>p.doc.querySelector('.body').innerHTML;
  return p;
}
{
  const p=rig(),old=p.button();p.click(old);p.click(old);p.click();
  yes('rapid and retained-handler clicks send a single deposit',p.sent.length===1);
  yes('the pressed button immediately looks and acts busy',p.waiting()&&/Putting in/.test(p.local()));
  yes('the amount is preserved while awaiting the answer',p.doc.getElementById('ts-box-gold').value==='10');
  const token=p.token();
  yes('gold requests carry a bounded correlation token',typeof token==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(token));
  p.reply({packGold:90,mineGold:10,at:2});p.click();
  yes('a balance change without its receipt cannot unlock gold',p.sent.length===1&&p.waiting());
  p.reply({goldRequest:'another-request',said:'Something else happened',at:3});p.click();
  yes('an unrelated receipt and statement cannot unlock gold',p.sent.length===1&&p.waiting());
  p.reply({hold:'whiterun',goldRequest:token,at:4});p.click();
  yes('the same token on another box cannot acknowledge the deposit',p.sent.length===1&&p.waiting());
  p.reply({hold:'windhelm',goldRequest:token,said:'Gold put in.',at:5});
  yes('the matching box receipt restores its controls',!p.waiting());
  p.click();const next=p.token();
  yes('a fresh press after the answer sends a distinct request',p.sent.length===2&&next!==token);
  p.reply({goldRequest:token,at:6});p.click();
  yes('a stale earlier receipt cannot release a newer deposit',p.sent.length===2&&p.waiting());
  p.reply({goldRequest:next,said:'You do not carry that much gold.',at:7});
  yes('a matching refusal restores controls and retains the explanation',!p.waiting()&&/do not carry/.test(p.local()));
}
{
  const p=rig();p.click();p.win.thornswoodBox.close();p.win.thornswoodBox.open();p.click();
  yes('closing and reopening cannot bypass an outstanding deposit',p.sent.length===1&&p.waiting());
  p.advance(30001);
  yes('a lost answer restores explicit controls and says to check first',!p.waiting()&&/check.*box|box.*check/i.test(p.local()));
  yes('timeout never sends another deposit on its own',p.sent.length===1);
  p.click();yes('a fresh press is possible after the missing-answer warning',p.sent.length===2);
}
for(const key of ['Enter',' ']){
  const p=rig(),button=p.button();
  const first=p.fire(button,'keydown',key);
  if(!first.defaultPrevented)p.click(button); // Native button default activation.
  for(let n=0;n<4;n++){
    const event=p.fire(button,'keydown',key,{repeat:true});
    if(!event.defaultPrevented)p.click(button);
  }
  yes(JSON.stringify(key)+' activation is sent once while held',p.sent.length===1);
  p.reply({goldRequest:p.token(),said:'Gold put in.',at:2});
  const event=p.fire(p.button(),'keydown',key,{repeat:true});
  if(!event.defaultPrevented)p.click();
  yes(JSON.stringify(key)+' repeat after a reply sends no second deposit',p.sent.length===1);
  const fresh=p.fire(p.button(),'keydown',key);
  if(!fresh.defaultPrevented)p.click();
  yes(JSON.stringify(key)+' fresh press after release can deposit again',p.sent.length===2);
}
{
  const p=rig();p.amount('');p.click();
  yes('an empty amount sends nothing and does not strand the control',p.sent.length===0&&!p.waiting());
  p.amount('10');delete p.win.thornswoodNet;p.click();
  yes('an absent transport restores the control with a failure explanation',!p.waiting()&&/could not|not sent/i.test(p.local()));
}
{
  const p=rig();p.win.thornswoodNet.say=line=>{p.sent.push(line);return false;};p.click();p.click();
  yes('a queued transport result still waits because false can mean queued',p.sent.length===1&&p.waiting());
}
{
  const p=rig();p.win.thornswoodNet.say=line=>{p.sent.push(line);throw Error('notification failed after queuing');};p.click();p.click();
  yes('a transport exception after accepting a line cannot permit another deposit',p.sent.length===1&&p.waiting());
}
{
  const p=rig(),input=p.doc.getElementById('ts-box-gold');
  p.fire(input,'keydown','Enter');p.fire(input,'keydown','Enter',{repeat:true});
  yes('Enter in the amount field shares the same single pending deposit',p.sent.length===1&&p.waiting());
  const token=p.token();p.reply({goldRequest:token,open:false});
  yes('a matching out-of-reach refusal closes the panel',!p.win.thornswoodBox.isOpen());
  p.reply({open:true,hold:'windhelm',goldRequest:undefined,at:3});
  yes('the refused press does not strand a reopened panel',!p.waiting());
}
{
  const p=rig();p.win.thornswoodNet.say=line=>{p.sent.push(line);p.reply({goldRequest:line.split(' ')[3],said:'Gold put in.',at:2});return true;};
  p.click();p.advance(30001);
  yes('a synchronous receipt wins over the later missing-answer timer',p.sent.length===1&&!p.waiting()&&!/No answer arrived/.test(p.local()));
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
