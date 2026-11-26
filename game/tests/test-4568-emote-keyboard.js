'use strict';
// Actual wheel page and game plugin. Native Tab/button defaults run only
// after the page's browser-order handlers; no real game or browser is opened.
const fs=require('fs'),path=require('path'),vm=require('vm');
const makePage=require('../../tests/fixtures/panel-page');
const pluginPass=require('../../tests/fixtures/plugin-pass');
const root=path.join(__dirname,'../..');
const source=fs.readFileSync(process.env.PAGE||path.join(root,'game/ui/thornswood-emotes.js'),'utf8');
const plugin=fs.readFileSync(path.join(root,'game/plugins/thornswood-emotes.js'),'utf8');
let pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
function rig(){
  const p=makePage(),events={},writes=[],played=[],pending=[];
  p.doc.createElementNS=(_,tag)=>p.doc.createElement(tag);
  const pc={getFormID:()=>0x14,isWeaponDrawn:()=>false,sheatheWeapon(){},getParentCell:()=>null,getItemCount:()=>1};
  const sp={on(name,fn){(events[name]||=([])).push(fn);},printConsole(){},
    Game:{getPlayer:()=>pc,getFormFromFile:()=>null},Utility:{isInMenuMode:()=>false},
    browser:{isFocused:()=>!!p.claimed},TESModPlatform:{setWeaponDrawnMode(){}},
    hooks:{sendAnimationEvent:{add(){}}},Debug:{notification(){},sendAnimationEvent(_,name){played.push(name);}}};
  const io={readFileSync(file){
    if(/Thornswood\.ini$/.test(file))return '[Emotes]\n';
    if(/skymp5-client-settings\.txt$/.test(file))return JSON.stringify({'server-ip':JSON.parse(fs.readFileSync(path.join(root,'scripts/vps/vps.json'))).address});
    if(/thornswood-session\.txt$/.test(file))return String(Date.now());
    throw Error('absent fixture file');
  },writeFileSync(file,text){writes.push({file,text});},appendFileSync(){}};
  const box={skyrimPlatform:sp,require:()=>io,Thornswood:{ready:true,isTyping:()=>false,
    claimFocus(_,on){p.claimed=on;},js(code){p.run('plugin reply',code);return true;}},Date,JSON,Math,Number};
  vm.createContext(box);pluginPass.load(box,plugin,{filename:'thornswood-emotes.js'});
  function emit(name,event){(events[name]||[]).forEach(fn=>fn(event));}
  p.win.skyrimPlatform.sendMessage=(to,what)=>{p.told.push(to+' '+what);pending.push({arguments:[to,what]});};
  p.run('bridge',fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8'));
  p.run('wheel',source);
  p.flush=()=>{pending.splice(0).forEach(message=>emit('browserMessage',message));emit('update');};
  p.open=()=>{if(!p.claimed)emit('buttonEvent',{device:0,code:34,isDown:true});emit('update');};
  p.flush();p.open();
  p.find=()=>p.doc.getElementById('thornswood-emote-find');
  p.pins=()=>p.doc.getElementById('thornswood-emote-pins').querySelectorAll('button');
  p.rows=()=>p.doc.getElementById('thornswood-emote-rows').querySelectorAll('button[data-play]');
  p.controls=()=>p.doc.getElementById('thornswood-wheel').querySelectorAll('input,button,[tabindex="0"]');
  p.press=(key,more={})=>{
    const target=p.doc.activeElement,down=p.fire(target,'keydown',key,more);
    if(!down.defaultPrevented&&(key.length===1||key==='Enter'))down.press=p.fire(target,'keypress',key,more);
    if(!down.defaultPrevented&&key==='Tab'){
      const controls=p.controls(),index=controls.indexOf(target),next=index+(more.shiftKey?-1:1);
      (controls[next]||p.doc.body).focus();
    }
    if(!down.defaultPrevented&&key==='Enter'&&target.tagName==='BUTTON')target.click();
    const up=p.fire(target,'keyup',key,more);
    if(!down.defaultPrevented&&!up.defaultPrevented&&key===' '&&target.tagName==='BUTTON')target.click();
    p.flush();return down;
  };
  p.filter=text=>{p.find().focus();p.find().value=text;p.find().oninput();};
  p.assignments=()=>writes.filter(row=>/emote.*slots/i.test(row.file));p.played=played;
  return p;
}
{
  const p=rig();
  yes('real plugin opens the wheel and owns its focus claim',p.claimed&&p.rows().length===60);
  p.press('Tab');yes('first Tab reaches search',p.doc.activeElement===p.find());
  const nativeTab=p.press('Tab');yes('next Tab natively reaches first pin instead of trapping search',!nativeTab.defaultPrevented&&p.doc.activeElement===p.pins()[0]);
  p.press('ArrowRight');yes('right arrow reaches next pin',p.doc.activeElement===p.pins()[1]);
  const chosen=p.doc.activeElement;p.press('Enter');
  yes('Enter chooses the pin without replacing its focused node',p.doc.activeElement===chosen&&p.pins()[1]===chosen);
  yes('selected pin is exposed as pressed and names its purpose',chosen.getAttribute('aria-pressed')==='true'&&/slot 2/i.test(chosen.getAttribute('aria-label')||''));
  p.press('ArrowDown');yes('down arrow from pins reaches first name',p.doc.activeElement===p.rows()[0]);
  p.press('ArrowDown');yes('down arrow moves to the next name',p.doc.activeElement===p.rows()[1]);
  const name=p.doc.activeElement.getAttribute('data-play');p.press('Enter');
  const saved=p.assignments().at(-1);
  yes('keyboard assignment reaches real plugin slot persistence',saved&&JSON.parse(saved.text)[1]===name);
  yes('assignment does not close the wheel or play the emote',p.claimed&&p.played.length===0);
  p.press('Tab',{shiftKey:true});yes('Shift Tab continues through live controls',p.controls().includes(p.doc.activeElement));
  p.find().focus();p.press('Tab',{shiftKey:true});yes('reverse boundary Tab reaches last name',p.doc.activeElement===p.rows().at(-1));
  p.press('Tab');yes('forward boundary Tab returns to search',p.doc.activeElement===p.find());
  p.press('ArrowUp');yes('up arrow from search reaches last filtered name',p.doc.activeElement===p.rows().at(-1));
  const extra=p.doc.createElement('button');p.doc.getElementById('thornswood-wheel').appendChild(extra);
  const footerTab=p.press('Tab');yes('native Tab includes every existing control after the list',!footerTab.defaultPrevented&&p.doc.activeElement===extra);
  p.press('Tab',{shiftKey:true});yes('native reverse Tab returns from an additional control',p.doc.activeElement===p.rows().at(-1));
  p.rows()[0].focus();p.press('ArrowUp');yes('up arrow from first name returns to search',p.doc.activeElement===p.find());
}
{
  const p=rig();p.filter('wave');p.press('Enter');
  yes('Enter on filtered search sends first matching name through bridge',p.told.includes('thornswood-emote __play Wave'));
  yes('real plugin accepts the pick and releases the parent focus claim',!p.claimed);
  p.open();p.filter('zzzz-no-emote');const before=p.told.length;p.press('Enter');
  yes('Enter on no matches sends no action and leaves wheel open',p.told.length===before&&p.claimed);
}
{
  const p=rig();p.filter('bow');p.press('ArrowDown');
  yes('down arrow from search reaches first filtered match',p.doc.activeElement===p.rows()[0]);
  const first=p.doc.activeElement;p.press(' ');
  yes('Space on a focused name uses native activation once',p.told.filter(t=>t==='thornswood-emote __play '+first.getAttribute('data-play')).length===1&&!p.claimed);
  p.open();p.filter('wave');const before=p.told.length;
  p.press('Enter',{repeat:true});yes('held Enter cannot select a search result',p.told.length===before&&p.claimed);
  for(const key of ['g','n','1']){
    const event=p.press(key);yes('search keeps normal typing through the front bridge for '+key,!event.defaultPrevented&&event.press&&!event.press.defaultPrevented&&!event.press.stopped&&p.claimed);
  }
  p.press('Escape');yes('Escape in search uses actual close bridge',!p.claimed);
}
{
  const p=rig();p.pins()[2].focus();p.press(' ');p.filter('Wave');p.rows()[0].click();p.flush();
  yes('mouse row activation still assigns selected slot',JSON.parse(p.assignments().at(-1)?.text||'[]')[2]==='Wave');
  p.pins()[2].click();p.find().blur();p.press('1');
  yes('quick-slot numbers outside search still use the real bridge',p.told.includes('thornswood-emote __slot 1')&&!p.claimed);
}
{
  const p=rig();p.rows()[0].focus();const before=p.told.length;p.press('Enter',{repeat:true});
  yes('held Enter on a focused name cannot trigger native activation',p.told.length===before&&p.claimed);
  p.pins()[0].focus();p.press('ArrowLeft');yes('left arrow stays on the first pin at its boundary',p.doc.activeElement===p.pins()[0]);
  p.press('ArrowRight',{repeat:true});yes('held arrow keys still navigate without assigning',p.doc.activeElement===p.pins()[1]&&!p.assignments().length);
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
