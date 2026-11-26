'use strict';
// Actual P page and front bridge. Native defaults run only when not cancelled.
const fs=require('fs'),path=require('path'),makePage=require('../../tests/fixtures/panel-page');
const root=path.join(__dirname,'../..');let pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
const id='a'.repeat(48),version='b'.repeat(48);
function rig(){
 const p=makePage();let now=10000,serial=0;const timers=new Map();
 p.win.Date=class extends Date{static now(){return now;}};
 p.win.setTimeout=(fn,ms)=>{timers.set(++serial,{fn,at:now+ms});return serial;};p.win.clearTimeout=k=>timers.delete(k);
 p.advance=ms=>{now+=ms;for(const[k,t]of timers)if(t.at<=now){timers.delete(k);t.fn();}};
 p.state={me:1000,partyIntent:{id,version},party:[{p:1000,name:'Aldis',me:true,leader:true,on:true},{p:1001,name:'Brenna "Red"',on:true}],friends:[{p:1001,name:'Brenna "Red"',on:true}],together:2,bonus:10};
 for(const file of ['bridge','party'])p.run(file,fs.readFileSync(file==='party'&&process.env.PARTY_UI||path.join(root,'game/ui/thornswood-'+file+'.js'),'utf8'));
 p.api=p.win.thornswoodParty;p.feed=()=>p.api.setData(JSON.parse(JSON.stringify(p.state)));p.feed();p.api.open();
 p.button=verb=>{const button=p.doc.querySelector('[data-do="'+verb+'"]');if(button)button.click=function(){const ev=p.fire(this,'click','');if(!ev.defaultPrevented&&this.onclick)this.onclick.call(this,ev);};return button;};
 p.key=(button,key,repeat=false)=>{const e=p.fire(button,'keydown',key,{repeat});if(!e.defaultPrevented&&key==='Enter')button.click();return e;};
 return p;
}
const actions=[['disband','/party-action-v1 disband '+id+' '+version],['kick','/party-action-v1 kick '+id+' '+version+' 1001'],['drop','/friend remove 1001']];
for(const[verb,line]of actions){
 const p=rig(),b=p.button(verb);b.click();yes(verb+' first press sends nothing',p.sent.length===0);
 yes(verb+' names action and exact target',/again/i.test(b.textContent)&&b.textContent.includes(verb==='disband'?'party':'Brenna "Red"'));
 b.click();yes(verb+' fresh second press sends exact bound wire once',p.sent.length===1&&p.sent[0]===line);
}
for(const[verb]of actions){
 const p=rig(),b=p.button(verb);b.click();p.advance(5000);b.click();yes(verb+' expires after five seconds',p.sent.length===0);
 const stale=b.onclick;p.feed();stale.call(b);yes(verb+' redraw retires detached handlers',p.sent.length===0);
 const fresh=p.button(verb);fresh.click();p.api.close();p.api.open();p.button(verb).click();yes(verb+' close retires the arm',p.sent.length===0);
}
for(const[verb,line]of actions){
 const p=rig(),b=p.button(verb);p.key(b,'Enter');const held=p.key(b,'Enter',true);
 yes(verb+' held Enter cannot confirm',p.sent.length===0&&held.defaultPrevented);
 p.fire(b,'keyup','Enter');p.key(b,'Enter');p.fire(b,'keyup','Enter');yes(verb+' fresh Enter sends once',p.sent.length===1&&p.sent[0]===line);
 const q=rig(),c=q.button(verb),first=q.key(c,' '),repeat=q.key(c,' ',true),up=q.fire(c,'keyup',' ');
 if(!first.defaultPrevented&&!up.defaultPrevented)c.click();yes(verb+' native Space default and repeat do not confirm',q.sent.length===0&&repeat.defaultPrevented);
 q.key(c,' ');const release=q.fire(c,'keyup',' ');if(!release.defaultPrevented)c.click();yes(verb+' released Space confirms once',q.sent.length===1&&q.sent[0]===line);
}
{
 const p=rig(),b=p.button('disband');b.click();p.fire(b,'keydown','Escape');p.fire(b,'keydown','Escape',{repeat:true});
 yes('Escape cancels arm and a held repeat does not close',p.api.isOpen()&&p.sent.length===0);p.fire(b,'keydown','Escape');yes('fresh Escape closes',!p.api.isOpen());
}
for(const change of [p=>p.state.partyIntent.version='c'.repeat(48),p=>p.state.party[0].leader=false,p=>p.state.party.splice(1,1),p=>p.state.me=2000]){
 const p=rig(),b=p.button('kick');b.click();change(p);p.feed();b.onclick.call(b);yes('changed party/authority refuses previous intent',p.sent.length===0);
}
{
 const p=rig();p.state.partyIntent=null;p.feed();const b=p.button('disband');if(b){b.click();b.click();}yes('missing party capability never falls back to an unbound command',p.sent.length===0);
 const q=rig();delete q.state.friends[0].p;q.feed();const c=q.button('drop');if(c){c.click();c.click();}yes('missing friend profile never guesses a name',q.sent.length===0);
}
{
 const p=rig(),b=p.button('kick');b.click();p.button('mute').click();b.click();yes('a different action cancels the arm',p.sent.length===1&&p.sent[0]==='/mute 1001');
 const q=rig(),c=q.button('kick');c.click();q.api.setWhere([]);c.onclick.call(c);yes('position redraw retires the arm',q.sent.length===0);
}
{
 const p=rig(),b=p.button('drop');let calls=0;p.win.thornswoodNet.say=()=>{calls++;return false;};b.click();b.click();
 yes('local refusal changes no authoritative friend data or success label',calls===1&&p.state.friends.length===1&&!/removed|no longer/.test(b.textContent));
 b.click();yes('local refusal needs a new confirmation rather than automatic retry',calls===1);
}
for(const throws of [false,true]){
 const p=rig(),b=p.button('drop'),queued=[];
 p.win.thornswoodNet.say=line=>{queued.push(line);if(throws)throw Error('after queue fixture');return false;};
 b.click();b.click();const message=p.doc.getElementById('ts-party-sub').textContent;
 yes('queued delivery is never falsely described as unsent, throws='+throws,/Delivery not confirmed/.test(message)&&/Check the current list/.test(message)&&!message.includes('Not sent'));
 yes('unknown delivery preserves state and never resends automatically, throws='+throws,queued.length===1&&p.state.friends.length===1);
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
