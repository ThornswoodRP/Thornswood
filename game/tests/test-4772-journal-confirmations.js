'use strict';
// Real journal page and front bridge; browser-default button activation is
// modeled only after an uncancelled keyboard event, never by calling a mirror.
const fs=require('node:fs'),path=require('node:path'),makePage=require('../../tests/fixtures/panel-page');
const root=path.join(__dirname,'../..');let pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
function rig(group=false){
 const p=makePage();let now=10000,serial=0;const timers=new Map();
 p.win.Date=class extends Date{static now(){return now;}};
 p.win.setTimeout=(fn,ms)=>{timers.set(++serial,{fn,at:now+ms});return serial;};
 p.win.clearTimeout=id=>timers.delete(id);
 p.advance=ms=>{now+=ms;for(const[id,t]of timers)if(t.at<=now){timers.delete(id);t.fn();}};
 p.state={journals:[{id:'j',title:'Private "notes"',pages:[{id:'p',title:'Saved title',text:'Saved body'}]}],
   group:{show:true,books:[{id:'g',name:'Our group',kind:'business',owner:true,invite:true,read:true,speak:true,
    people:[{name:'Aldis',role:'Owner'},{name:'Brenna',role:'Member'}],roles:[],priceList:[],chat:[]}]}};
 p.run('bridge',fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8'));
 p.run('journal',fs.readFileSync(process.env.JOURNAL_UI||path.join(root,'game/ui/thornswood-journal.js'),'utf8'));
 p.api=p.win.thornswoodJournal;p.feed=()=>p.api.setData(JSON.parse(JSON.stringify(p.state)));
 p.feed();p.api.open();p.doc.querySelector(group?'[data-group="g"]':'[data-book="j"]').click();
 p.click=button=>{const ev=p.fire(button,'click','');if(!ev.defaultPrevented&&button.onclick)button.onclick.call(button,ev);};
 p.button=verb=>{const button=p.doc.querySelector('[data-'+(group?'g':'do')+'="'+verb+'"]');
   if(button)button.click=function(){p.click(this);};return button;};
 p.target=p.doc.getElementById('ts-journal-gwho');if(p.target)p.target.value='Brenna';
 p.activate=(button,key,repeat=false)=>{const ev=p.fire(button,'keydown',key,{repeat});
  if(!ev.defaultPrevented&&key==='Enter')button.click();return ev;};
 return p;
}
// Member Remove remains a separate child: its name-only server route cannot
// be replaced with a numeric target, and Invite does not require Read.
const actions=[['dropbook',false,'/journal drop j'],['disband',true,'/book disband g']];
for(const[verb,group,line]of actions){
 const p=rig(group),b=p.button(verb);b.click();
 yes(verb+' first real button press sends no destructive command',p.sent.length===0);
 yes(verb+' first press visibly names the action and target',/again/i.test(b.textContent)&&b.textContent.includes(group?'Our group':'Private "notes"'));
 b.click();yes(verb+' second press sends its original exact target once',p.sent.length===1&&p.sent[0]===line);
}
for(const[verb,group]of actions){
 const p=rig(group),b=p.button(verb);b.click();const before=p.sent.length;p.advance(5000);b.click();
 yes(verb+' expires at five seconds and the next press only arms again',p.sent.length===before&&/again/i.test(b.textContent));
}
for(const[verb,group]of actions){
 const p=rig(group),b=p.button(verb);b.click();const before=p.sent.length,stale=b.onclick;
 p.feed();stale.call(b);
 yes(verb+' owner redraw retires the old button and its retained handler',p.sent.length===before);
 const fresh=p.button(verb);if(fresh)fresh.click();
 yes(verb+' current button after redraw needs a fresh first press',p.sent.length===before);
}
for(const[verb,group]of actions){
 const p=rig(group),b=p.button(verb);b.click();const before=p.sent.length;
 p.api.close();p.api.open();const fresh=p.button(verb);if(fresh)fresh.click();
 yes(verb+' close and reopen discard the earlier confirmation',p.sent.length===before);
}
for(const[verb,group]of actions){
 const p=rig(group),b=p.button(verb);p.activate(b,'Enter');const before=p.sent.length;
 const held=p.activate(b,'Enter',true);yes(verb+' held Enter cannot supply the second press',p.sent.length===before&&held.defaultPrevented);
 p.fire(b,'keyup','Enter');p.activate(b,'Enter');p.fire(b,'keyup','Enter');
 yes(verb+' a fresh released Enter confirms exactly once',p.sent.length===1);
}
for(const[verb,group]of actions){
 const p=rig(group),b=p.button(verb);
 function space(repeat=false){const down=p.fire(b,'keydown',' ',{repeat});return down;}
 const first=space(),held=space(true),before=p.sent.length;
 const up=p.fire(b,'keyup',' ');if(!first.defaultPrevented&&!up.defaultPrevented)b.click();
 yes(verb+' held Space and its native keyup default cannot confirm',before===0&&p.sent.length===0&&held.defaultPrevented);
 const second=space(),released=p.fire(b,'keyup',' ');if(!second.defaultPrevented&&!released.defaultPrevented)b.click();
 yes(verb+' another released Space confirms exactly once',p.sent.length===1);
}
{
 const p=rig(),b=p.button('dropbook'),field=p.doc.getElementById('ts-journal-title');b.click();
 field.value='Changed';p.fire(field,'input','');field.value='Private "notes"';p.fire(field,'input','');b.click();
 yes('editing and returning a title still cancels its earlier deletion confirmation',p.sent.length===0);
}
{
 const p=rig(true),b=p.button('disband');b.click();
 const field=p.doc.getElementById('ts-journal-gline');field.value='A harmless message';
 p.button('say').click();b.click();
 yes('another actual button action retires the old Disband confirmation',p.sent.length===1&&p.sent[0]==='/book say g A harmless message');
}
{
 const p=rig(),b=p.button('dropbook');b.click();p.fire(b,'keydown','Escape');
 yes('Escape cancels an armed action without closing the journal',p.sent.length===0&&p.api.isOpen()&&!/again/i.test(b.textContent));
 p.fire(b,'keydown','Escape',{repeat:true});yes('held Escape cannot immediately close after cancelling the arm',p.api.isOpen());
}
{
 const p=rig(true),b=p.button('disband');b.click();const before=p.sent.length;
 p.state.group.books[0].owner=false;p.feed();b.onclick.call(b);
 yes('lost ownership cannot reuse a retained Disband handler',p.sent.length===before);
}
{
 const p=rig(false),b=p.button('dropbook');b.click();const before=p.sent.length;
 p.state.journals[0].pages.push({id:'new',title:'New page',text:'New writing'});p.feed();
 const fresh=p.button('dropbook');if(fresh)fresh.click();
 yes('a changed journal snapshot cannot reuse its earlier deletion confirmation',p.sent.length===before);
}
{
 const p=rig();p.doc.querySelector('[data-page="p"]').click();
 const text=p.doc.getElementById('ts-journal-text');text.value='UNSAVED PRIVATE WORDS';text.oninput.call(text);p.fire(text,'input','');
 p.button('dropbook').click();const choice=p.doc.getElementById('ts-journal-leave-choice'),discard=p.doc.getElementById('ts-journal-discard');
 yes('dirty Throw away uses one explicit target-named journal deletion choice',!choice.hidden&&p.sent.length===0&&
   /Private "notes"/.test(p.doc.getElementById('ts-journal-leave-title').textContent)&&/throw away.*journal.*unsaved/i.test(discard.textContent));
 discard.click();yes('the existing explicit dirty-page choice sends the deletion once without another confirmation',p.sent.length===1&&p.sent[0]==='/journal drop j');
}
{
 const p=rig();p.doc.querySelector('[data-page="p"]').click();const text=p.doc.getElementById('ts-journal-text');
 text.value='Private draft';text.oninput.call(text);p.button('dropbook').click();
 p.state.journals[0].pages.push({id:'later',title:'Later',text:'Other writing'});p.feed();
 p.doc.getElementById('ts-journal-discard').click();
 yes('dirty deletion rechecks the exact journal snapshot before sending',p.sent.length===0&&p.doc.getElementById('ts-journal-text').value==='Private draft');
}
{
 const p=rig();p.doc.querySelector('[data-page="p"]').click();const text=p.doc.getElementById('ts-journal-text');
 text.value='Private draft';text.oninput.call(text);p.activate(p.button('dropbook'),'Enter');
 const keep=p.doc.getElementById('ts-journal-keep');p.activate(keep,'Enter',true);
 yes('holding the opening key cannot activate a newly focused choice button',p.sent.length===0&&!p.doc.getElementById('ts-journal-leave-choice').hidden);
 p.fire(keep,'keyup','Enter');
}
for(const[verb,group]of actions){
 const p=rig(group),b=p.button(verb);p.win.thornswoodNet.say=()=>false;b.click();b.click();
 yes(verb+' refused local delivery does not close the selected book or claim success',p.sent.length===0&&p.api.isOpen()&&!!p.button(verb)&&!/again/i.test(b.textContent));
}
{
 const p=rig();p.doc.querySelector('[data-page="p"]').click();const text=p.doc.getElementById('ts-journal-text');
 text.value='Private draft';text.oninput.call(text);const b=p.button('dropbook'),stale=b.onclick;p.feed();stale.call(b);
 yes('a detached dirty-journal handler cannot open a fresh deletion choice',p.sent.length===0&&p.doc.getElementById('ts-journal-leave-choice').hidden);
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
