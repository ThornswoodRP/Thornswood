'use strict';
// Actual board page/front bridge and native-order keyboard defaults.
const fs=require('fs'),path=require('path'),makePage=require('../../tests/fixtures/panel-page');
const root=path.join(__dirname,'../..');let pass=0,fail=0;function yes(n,b){console.log((b?'PASS ':'FAIL ')+n);b?pass++:fail++;}
function rig(){const p=makePage();let now=10000,serial=0;const timers=new Map();p.win.Date=class extends Date{static now(){return now;}};
 p.win.setTimeout=(fn,ms)=>{timers.set(++serial,{fn,at:now+ms});return serial;};p.win.clearTimeout=id=>timers.delete(id);p.advance=ms=>{now+=ms;for(const[id,t]of timers)if(t.at<=now){timers.delete(id);t.fn();}};
 p.state={me:1000,board:{hold:'windhelm',where:'Windhelm',here:true,x:1,y:2,z:3,wall:[{n:1,at:1000,name:'Aldis',title:'A "named" notice',text:'Body',mine:true}],jobs:[],dests:[],arrivals:[],submit:[]}};
 for(const f of ['bridge','board'])p.run(f,fs.readFileSync(f==='board'&&process.env.BOARD_UI||path.join(root,'game/ui/thornswood-'+f+'.js'),'utf8'));
 p.api=p.win.thornswoodBoard;p.feed=()=>p.api.setData(JSON.parse(JSON.stringify(p.state)));p.feed();p.api.open();
 p.button=()=>{const b=p.doc.querySelector('[data-do="unpin"]');if(b)b.click=function(){const e=p.fire(this,'click','');if(!e.defaultPrevented&&this.onclick)this.onclick.call(this,e);};return b;};
 p.key=(b,k,repeat=false)=>{const e=p.fire(b,'keydown',k,{repeat});if(!e.defaultPrevented&&k==='Enter')b.click();return e;};return p;}
const expected='/board-unpin-v1 '+JSON.stringify(['windhelm',1,1000]);
{
 const p=rig(),b=p.button();b.click();yes('first Take down sends nothing',p.sent.length===0);yes('confirmation names the exact post and board',/again/.test(b.textContent)&&b.textContent.includes('A "named" notice')&&b.textContent.includes('Windhelm'));
 b.click();yes('fresh second press sends the exact three-field private opcode once',p.sent.length===1&&p.sent[0]===expected);
}
{
 const p=rig(),b=p.button();b.click();p.advance(5000);b.click();yes('five-second expiry makes the next press only arm again',p.sent.length===0);
 // The button is kept through an update (#4475); the update is what retires the arm.
 p.advance(5000);b.click();p.feed();b.click();yes('an owner update between the presses retires the arm',p.sent.length===0);
 p.feed();p.button().click();p.api.close();p.api.open();p.button().click();yes('close and reopen retire prior confirmation',p.sent.length===0);
}
for(const change of [s=>s.board.hold='whiterun',s=>s.board.wall[0].at++,s=>s.board.wall[0].title='Replacement',s=>s.board.here=false,s=>s.board.wall[0].mine=false,s=>s.me=2000]){
 const p=rig(),b=p.button();b.click();change(p.state);p.feed();b.onclick.call(b);yes('changed board/row/owner authority refuses an old confirmation',p.sent.length===0);
}
for(const key of ['Enter',' ']){
 const p=rig(),b=p.button(),first=p.key(b,key),repeat=p.key(b,key,true),up=p.fire(b,'keyup',key);
 if(key===' '&&!first.defaultPrevented&&!up.defaultPrevented)b.click();yes('held '+key+' and its default cannot confirm',p.sent.length===0&&repeat.defaultPrevented);
 p.key(b,key);const release=p.fire(b,'keyup',key);if(key===' '&&!release.defaultPrevented)b.click();yes('fresh released '+key+' confirms once',p.sent.length===1&&p.sent[0]===expected);
}
{
 const p=rig(),b=p.button();b.click();p.fire(b,'keydown','Escape');p.fire(b,'keydown','Escape',{repeat:true});yes('Escape cancels and repeat does not close',p.api.isOpen()&&p.sent.length===0);p.fire(b,'keydown','Escape');yes('fresh Escape closes',!p.api.isOpen());
}
{
 const p=rig(),b=p.button();b.click();const field=p.doc.getElementById('ts-board-to');field.value='Somebody';p.fire(field,'input');b.click();yes('editing another field cancels the armed action',p.sent.length===0);
 const q=rig(),c=q.button();c.click();q.doc.querySelector('[data-do="open"]').click();const next=q.button();next.click();yes('Read redraw requires a new first press',q.sent.length===0);
}
for(const throws of [false,true]){
 const p=rig(),b=p.button(),queue=[];p.win.thornswoodNet.say=line=>{queue.push(line);if(throws)throw Error('queued fixture');return false;};b.click();b.click();
 const status=p.doc.getElementById('ts-board-action-status');yes('queued/unknown delivery has no false unsent or success claim',status&&/Delivery not confirmed/.test(status.textContent)&&/Check the current board/.test(status.textContent));yes('unknown delivery preserves row and never automatically resends',p.state.board.wall.length===1&&queue.length===1);
}
for(const stamp of [undefined,'1000',null,1.5,-1]){
 const p=rig();p.state.board.wall[0].at=stamp;p.feed();const b=p.button();if(b){b.click();b.click();}yes('invalid public creation timestamp never sends',p.sent.length===0);
}
{
 const p=rig();delete p.state.me;p.feed();const b=p.button();b.click();b.click();yes('missing current owner identity never guesses authority',p.sent.length===0);
 const q=rig();q.state.board.wall[0].at=0;q.feed();q.button().click();q.button().click();yes('actual zero legacy stamp is preserved in the exact payload',q.sent[0]==='/board-unpin-v1 '+JSON.stringify(['windhelm',1,0]));
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
