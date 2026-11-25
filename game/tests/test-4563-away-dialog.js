'use strict';
// Actual away page and front bridge, with the page's own timer and messages.
// This verifies DOM accessibility semantics, not a screen-reader speech engine.
const fs=require('fs'),path=require('path');
const makePage=require('../../tests/fixtures/panel-page');
const root=path.join(__dirname,'../..');
const page=fs.readFileSync(process.env.PAGE||path.join(root,'game/ui/thornswood-afk.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8');
let pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
function rig(preset=0){
  const p=makePage(),timers=new Map();let now=1000000,next=0;
  p.win.Date=class extends Date{static now(){return now;}};
  p.win.setInterval=fn=>{timers.set(++next,fn);return next;};
  p.win.clearInterval=id=>timers.delete(id);
  p.run('bridge',bridge);p.chatBox.focus();p.win.THORNSWOOD_AFK_ASK=preset;p.run('away',page);
  p.api=p.win.thornswoodAfk;p.card=()=>p.doc.querySelector('[role="alertdialog"]');
  p.button=()=>p.doc.querySelector('#ts-afk .here');
  p.status=()=>p.doc.getElementById('ts-afk-status');
  p.advance=seconds=>{now+=seconds*1000;[...timers.values()].forEach(fn=>fn());};
  p.messages=()=>p.told.filter(s=>s==='thornswood-front afk:here');
  p.timers=timers;p.baselineTimers=timers.size-(preset?1:0);return p;
}
{
  const p=rig();p.api.ask(60);const card=p.card(),button=p.button();
  yes('the opened window is an explicit modal alert dialog',!!card&&card.getAttribute('aria-modal')==='true');
  const label=card&&p.doc.getElementById(card.getAttribute('aria-labelledby'));
  yes('the dialog name resolves to the actual question',!!label&&/id="ts-afk-title">Are you still here\?/.test(p.doc.getElementById('ts-afk').innerHTML));
  const description=card&&p.doc.getElementById(card.getAttribute('aria-describedby'));
  yes('the dialog description resolves to the idle and return explanation',!!description&&/15 minutes/.test(p.doc.getElementById('ts-afk').innerHTML));
  yes('opening focuses the live answer button',p.doc.activeElement===button);
  const status=p.status();
  yes('remaining time has a separate polite atomic live region',!!status&&status.getAttribute('role')==='status'&&status.getAttribute('aria-live')==='polite'&&status.getAttribute('aria-atomic')==='true');
  yes('the opening time is announced',!!status&&/60 seconds/.test(status.textContent));
  const announced=[status?.textContent];
  for(let second=1;second<=60;second++){
    p.advance(1);if(status&&status.textContent!==announced.at(-1))announced.push(status.textContent);
    if(second===1)yes('the visible clock still updates every second',/59 seconds/.test(p.doc.querySelector('#ts-afk .left').textContent));
  }
  yes('speech changes only at opening, thirty, ten and expiry',announced.length===4&&/30 seconds/.test(announced[1])&&/10 seconds/.test(announced[2])&&/Taking you back/.test(announced[3]));
  yes('the page timer never answers or dismisses an expired authoritative question',p.api.isOpen()&&p.api.left()===0&&p.messages().length===0);
  const tab=p.fire(button,'keydown','Tab');
  yes('Tab keeps focus in the modal answer control',tab.defaultPrevented&&p.doc.activeElement===button);
  p.fire(button,'keydown','Tab',{shiftKey:true});
  yes('reverse Tab also stays in the dialog',p.doc.activeElement===button);
  p.fire(button,'click','');
  yes('clicking answers exactly once through the front message bridge',p.messages().length===1&&!p.api.isOpen());
  yes('closing returns focus to the previous connected control',p.doc.activeElement===p.chatBox);
  yes('closing cancels its display timer',p.timers.size===p.baselineTimers);
  p.api.close();yes('repeated close neither answers nor changes focus',p.messages().length===1&&p.doc.activeElement===p.chatBox);
  p.api.ask(60);yes('a later question resets the opening announcement and focus',p.doc.activeElement===p.button()&&/60 seconds/.test(p.status()?.textContent||''));
  p.advance(55);yes('a delayed tick announces the actual time rather than a missed milestone',/5 seconds/.test(p.status()?.textContent||''));
}
for(const key of ['Enter',' ']){
  const p=rig(60),button=p.button();
  yes('a lazily loaded prompt focuses its button before '+JSON.stringify(key),p.api.isOpen()&&p.doc.activeElement===button&&p.win.THORNSWOOD_AFK_ASK===0);
  const held=p.fire(button,'keydown',key,{repeat:true});
  yes('a key already held when the question opens cannot answer it '+JSON.stringify(key),held.defaultPrevented&&p.api.isOpen()&&p.messages().length===0);
  const event=p.fire(button,'keydown',key);
  yes('a fresh activation answers once without a native duplicate '+JSON.stringify(key),event.defaultPrevented&&!p.api.isOpen()&&p.messages().length===1);
}
{
  const p=rig();const previous=p.doc.createElement('button');p.doc.body.appendChild(previous);previous.focus();p.api.ask(60);
  p.doc.body.removeChild(previous);p.api.close();
  yes('closing never focuses a detached previous control',p.doc.activeElement!==previous);
  p.api.ask(5);const status=p.status();p.advance(1);
  yes('a short question announces its opening time without a one-second speech loop',!!status&&/5 seconds/.test(status.textContent));
}
{
  const p=rig();p.api.ask(60);const next=p.doc.createElement('button');p.doc.body.appendChild(next);next.focus();p.api.close();
  yes('closing does not steal focus from a newer parent control',p.doc.activeElement===next);
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
