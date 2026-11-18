'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const chat = fs.readFileSync(path.join(root, 'game/ui/thornswood-chat.js'), 'utf8');
const front = fs.readFileSync(path.join(root, 'game/plugins/thornswood-front.js'), 'utf8');
let passed = 0, failed=0;
function check(name, run) { try { run(); passed++; console.log('PASS ' + name); } catch(e) { failed++; console.log('FAIL '+name+': '+e.message); } }
function page() {
  let now = 1000000, next = 1;
  const timers = new Map(), sockets = [], lines = [], asks = [], logs = [];
  function add(fn, ms, every) { const id = next++; timers.set(id, {fn, at: now + ms, every}); return id; }
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      if (due[1].every) due[1].at += due[1].every; else timers.delete(due[0]);
      due[1].fn();
    }
    now = end;
  }
  class Socket {
    constructor(url, protocols) { this.readyState=0; this.token=protocols[1]; this.sent=[]; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState=2; } // Browser close events arrive asynchronously.
    finishClose() { this.readyState=3; if(this.onclose)this.onclose({}); }
    admit() { this.readyState=1; if(this.onopen)this.onopen({}); this.say({t:'welcome',peer:sockets.indexOf(this)+1}); }
    say(data) { if(this.onmessage)this.onmessage({data:JSON.stringify(data)}); }
  }
  const window = {
    THORNSWOOD:{host:'h',profileId:7,name:'Tester',base:'https://example.invalid/voice',token:'initial'},
    thornswoodChat:{add(parts){lines.push(parts.map(p=>p.text).join(''));}},
    skyrimPlatform:{sendMessage(to,what){if(String(what).startsWith('token? '))asks.push(what);}}
  };
  vm.runInNewContext(chat, {window,WebSocket:Socket,Date:{now:()=>now},console:{log:text=>logs.push(text)},Math,JSON,Object,Array,Number,String,isFinite,parseInt,
    setTimeout:(fn,ms)=>add(fn,ms,0),clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>add(fn,ms,ms),clearInterval:id=>timers.delete(id)});
  return {window,sockets,lines,asks,logs,advance};
}
check('a silent chat reports its peer and heartbeat counters once without payloads', () => {
  const p=page(), socket=p.sockets[0]; socket.admit();
  p.advance(25000); socket.say({t:'pong'});
  p.advance(100000);
  const reports=p.logs.filter(l=>l.startsWith('[chat] heartbeat ')).map(l=>JSON.parse(l.slice(17)));
  assert.equal(reports.length,1);
  assert.equal(reports[0].reason,'silent');
  assert.equal(reports[0].peer,1);
  assert.equal(reports[0].pongRx,1);
  assert(reports[0].pingTx>0 && reports[0].rxAgeMs>=70000);
  assert.deepEqual(Object.keys(reports[0]).sort(),
    ['event','reason','peer','ageMs','rxAgeMs','pingTx','pongRx','rxMessages','txMessages','txAgeMs','bufferedBytes','closeCode','clean'].sort());
});
check('a late old close cannot mark the replacement disconnected or stop its heartbeats', () => {
  const p=page(), old=p.sockets[0]; old.admit();
  p.window.thornswoodNet.setName('Renamed');
  p.window.thornswoodNet.setToken('replacement');
  assert.equal(p.sockets.length,2);
  const replacement=p.sockets[1]; replacement.admit();
  if(old.onopen)old.onopen({});
  if(old.onerror)old.onerror({});
  old.say({t:'chat',text:'retired socket must not speak',name:'old',profileId:8});
  assert.equal(replacement.readyState,1);
  assert(!p.lines.some(x=>x.includes('retired socket must not speak')));
  old.finishClose();
  assert.equal(p.logs.filter(l=>l.startsWith('[chat] heartbeat ')).length,1);
  assert.equal(JSON.parse(p.logs.find(l=>l.startsWith('[chat] heartbeat ')).slice(17)).reason,'rename');
  assert(!p.lines.some(x=>x.includes('Chat lost the server')));
  p.advance(26000);
  assert(replacement.sent.some(x=>x.t==='ping'));
});
check('an unsolicited token while connected is not saved until it has expired for a later reconnect', () => {
  const p=page(), first=p.sockets[0]; first.admit();
  p.window.thornswoodNet.setToken('unused-old-response');
  for(let i=0;i<8;i++){p.advance(25000);first.say({t:'pong'});}
  first.finishClose(); p.advance(3000);
  assert.equal(p.sockets.length,1);
  assert(p.asks.includes('token? 7'));
  p.window.thornswoodNet.setToken('fresh-response');
  assert.equal(p.sockets[1].token,'fresh-response');
});
check('changing character survives the old close without losing the new profile connection', () => {
  const p=page(), old=p.sockets[0]; old.admit();
  assert.equal(p.window.thornswoodNet.rejoinAs(8,''),true);
  p.window.thornswoodNet.setToken('profile-8-response');
  const next=p.sockets[1]; next.admit(); old.finishClose();
  assert.equal(next.sent.find(m=>m.t==='join').profileId,8);
  p.advance(26000);
  assert.equal(next.readyState,1);
  assert(next.sent.some(m=>m.t==='ping'));
  assert(!p.lines.some(x=>x.includes('Chat lost the server')));
});
check('the front waits for the file response to the current ask instead of handing over an unseen old token', () => {
  const start=front.indexOf('  function joinToken()');
  const end=front.indexOf('  // Whose session this is.',start);
  const tickStart=front.indexOf('    if (tokenWant && now - tokenAt > 1000)');
  const tickEnd=front.indexOf('\n  }));',tickStart);
  assert(start>=0&&end>start&&tickStart>=0&&tickEnd>tickStart);
  let file='v2.7.100.old-response.mac'; const delivered=[], asks=[];
  const window={thornswoodNet:{setToken:t=>delivered.push(t)}};
  const context={readText:()=>file,require:()=>({writeFileSync:(f,v)=>asks.push([f,v])}),Date:{now:()=>1000000},log:()=>{},window};
  context.T={js:code=>vm.runInContext(code,context)};
  vm.createContext(context);
  vm.runInContext(front.slice(start,end)+'\nlet lastToken="already-used";let tokenAt=0;\nfunction tick(now){'+front.slice(tickStart,tickEnd)+'}\nthis.ask=askToken;this.tick=tick;',context);
  context.ask(7); context.tick(1001001);
  assert.equal(delivered.length,0);
  file='v2.7.1000001.fresh-response.mac';
  context.ask(7); // A retry after the response arrived must not reset its baseline.
  context.tick(1002002);
  assert.deepEqual(delivered,[file]);
  assert.equal(asks.length,4); // Both existing file-channel folders receive each ask.
  context.ask(7); // A profile-7 request remains outstanding when the choice changes.
  file='v2.8.100.old-profile-8-response.mac';
  context.ask(8); context.tick(1003003);
  assert.equal(delivered.length,1);
  file='v2.8.1000002.other-profile.mac'; context.tick(1004004);
  assert.deepEqual(delivered.slice(1),[file]);
});
console.log(passed+' passed, '+failed+' failed');
process.exitCode=failed?1:0;
