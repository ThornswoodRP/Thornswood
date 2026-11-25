'use strict';
// The actual chat page, its public send methods and socket flush.
const fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(process.env.CHAT || path.join(__dirname, '../ui/thornswood-chat.js'), 'utf8');
let pass = 0, fail = 0;
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
const queued = 'Not connected yet, that is queued.';
const overflow = 'Chat queue is full. The oldest waiting line was removed. This one is queued.';
function page() {
  const notes = [], sockets = [], timers = [];
  function Socket() { this.readyState = 0; this.sent = []; sockets.push(this); }
  Socket.prototype.send = function (raw) { this.sent.push(JSON.parse(raw)); };
  Socket.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose(); };
  const win = {
    THORNSWOOD: { host: 'voice.test', port: 7778, profileId: 7, name: 'Traveller', token: 't', base: 'https://voice.test/voice' },
    thornswoodChat: { add: parts => notes.push(parts.map(p => p.text).join('')) },
    skyrimPlatform: { sendMessage: function () {} }
  };
  vm.runInNewContext(source, { window: win, WebSocket: Socket, console,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {} });
  return { net: win.thornswoodNet, notes,
    up: function () {
      const socket = sockets[sockets.length - 1];
      socket.readyState = 1; socket.onopen();
      socket.onmessage({ data: JSON.stringify({ t: 'welcome', peer: 3 }) });
    },
    frames: () => sockets.flatMap(s => s.sent.filter(f => f.t === 'chat'))
  };
}
function send(p, mode, text) {
  return mode === 'typed' ? p.net.typed(text) : p.net.say(text, mode === 'quiet' ? { quiet: true } : undefined);
}
for (const mode of ['typed', 'button', 'quiet']) {
  const p = page(), expected = [];
  for (let i = 1; i <= 20; i++) {
    const text = 'PRIVATE WAITING LINE ' + i, press = i % 2 === 0;
    send(p, press ? 'button' : 'typed', text);
    expected.push(press ? { t: 'chat', text, press: true } : { t: 'chat', text });
  }
  yes(mode + ': twenty waiting lines fit without a loss warning', p.net.state().queued === 20 && !p.notes.includes(overflow));
  yes(mode + ': ordinary waiting notices remain unchanged', p.notes.filter(n => n === queued).length === 20);
  const oldNotes = p.notes.length, newest = 'PRIVATE NEWEST ' + mode;
  yes(mode + ': offline send keeps the existing false result', send(p, mode, newest) === false);
  expected.shift(); expected.push(mode === 'typed' ? { t: 'chat', text: newest } : { t: 'chat', text: newest, press: true });
  yes(mode + ': actual eviction has exactly one truthful warning', p.notes.length === oldNotes + 1 && p.notes.at(-1) === overflow);
  yes(mode + ': the warning exposes no private line contents', p.notes.slice(oldNotes).every(n => !n.includes('PRIVATE')));
  yes(mode + ': queue remains bounded at twenty', p.net.state().queued === 20);
  p.up();
  yes(mode + ': reconnect flushes the retained twenty exactly once in order with their marks', JSON.stringify(p.frames()) === JSON.stringify(expected));
  yes(mode + ': successful flush empties the queue', p.net.state().queued === 0);
}
{
  const p = page();
  for (let i = 1; i <= 25; i++) p.net.say('quiet ' + i, { quiet: true });
  yes('every quiet eviction is reported once', p.notes.filter(n => n === overflow).length === 5 && p.notes.length === 5);
  p.up();
  yes('repeated overflow still flushes only the newest twenty', p.frames().length === 20 && p.frames()[0].text === 'quiet 6' && p.frames().at(-1).text === 'quiet 25');
}
{
  const p = page(); p.net.say('quiet', { quiet: true });
  yes('quiet send below the limit stays quiet', p.notes.length === 0 && p.net.state().queued === 1);
  for (let i = 1; i < 20; i++) p.net.typed('waiting ' + i);
  p.net.typed('   '); p.net.typed('/roll invalid');
  yes('empty and refused dice input do not evict a waiting line', p.net.state().queued === 20 && !p.notes.includes(overflow));
}
{
  const p = page(); p.up(); const before = p.notes.length;
  for (let i = 0; i < 40; i++) yes('connected send ' + i + ' is sent immediately', p.net.typed('online ' + i) === true);
  yes('connected sends do not claim a queue loss or wait', p.frames().length === 40 && p.net.state().queued === 0 && p.notes.length === before);
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
