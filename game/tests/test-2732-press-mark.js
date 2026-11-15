'use strict';
/*
  test-2732-press-mark.js

      node .\game\tests\test-2732-press-mark.js

  A line a key or a panel button sends reaches the voice service marked as a
  press, and still says "Not connected yet" when it has to wait (#2732).

  WHY THIS EXISTS. The chat log writes a line with via: press (shown as "key
  press" on the hub) only when the chat page sent it with press: true (#2251).
  The chat page's say(text, auto) had one flag for two things: auto marked
  the line as pressed and also kept the "Not connected yet, that is queued."
  notice quiet. A panel button wants the mark and the notice, so no panel
  passed auto, and the party, trade, merchant, ride, repair, treatment, drop
  box, notice board, maneuver and K panel buttons and the look keys were
  written to the chat log as if somebody had typed them. Now the door a line
  comes in by says whether it was typed (typed, from the chat box alone), and
  quiet is asked on its own (say(line, { quiet: true })).

  A. The real thornswood-chat.js, in a sandbox with a fake socket: say(line)
     goes with press and is told when queued; say(line, { quiet: true }) goes
     with press and is queued without a word; typed(line) goes with no press
     and is told when queued; a queued line keeps its mark through the flush.
  B. Every thornswoodNet.say and typed in game/ui, found in the source and
     held to the table below: each panel call is run, as written, against the
     real chat page, offline and then online, and must reach the socket with
     press and be told it is queued. The chat box's two calls in
     thornswood-bridge.js are the only typed ones, and the only ones that go
     with no press.
  C. Every thornswoodNet.say the front plugin writes into the page (T.js),
     found in the source: the page code each one builds is run against the
     real chat page, and must reach the socket with press; the look keys are
     told when queued, the plugin's own lines are not.

  ROOT=<folder> reads game\ui and game\plugins from another checkout, which
  is how it was shown to fail on main. Read only.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.ROOT || path.join(__dirname, '..', '..');
const UI = path.join(ROOT, 'game', 'ui');
const rd = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const CHAT = rd(path.join(UI, 'thornswood-chat.js'));
const FRONT = rd(path.join(ROOT, 'game', 'plugins', 'thornswood-front.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const QUEUED = 'Not connected yet, that is queued.';

/* The real chat page over a fake socket, as game\tests\test-creation-quiet.js builds it. */
function chatPage() {
  const notes = [];
  const sockets = [];
  const timers = [];
  function Sock(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  Sock.prototype.send = function (m) { this.sent.push(JSON.parse(m)); };
  Sock.prototype.close = function () {
    if (this.readyState === 3) { return; }
    this.readyState = 3;
    if (this.onclose) { this.onclose(); }
  };
  let minted = 0;
  const win = {
    THORNSWOOD: { host: 'voice.test', port: 7778, profileId: 7, name: 'Traveller', token: 't', base: 'https://voice.test/voice' },
    thornswoodChat: { add: function (parts) { notes.push(parts.map(function (r) { return r.text; }).join('')); } },
    skyrimPlatform: { sendMessage: function (to, what) {
      if (to !== 'thornswood-front' || String(what).indexOf('token? ') !== 0) { return; }
      timers.push(function () { win.thornswoodNet.setToken('front-' + (++minted)); });
    } }
  };
  win.window = win;
  const box = {
    window: win, WebSocket: Sock, console: { log: function () { } },
    setTimeout: function (fn) { timers.push(fn); return timers.length; },
    clearTimeout: function () { }, JSON: JSON, Math: Math,
    setInterval: function () { return 0; }, clearInterval: function () { }
  };
  vm.createContext(box);
  vm.runInContext(CHAT, box);
  return {
    box: box, win: win, net: win.thornswoodNet,
    up: function () {
      const s = sockets[sockets.length - 1];
      s.readyState = 1; s.onopen(); s.onmessage({ data: JSON.stringify({ t: 'welcome', peer: 3 }) });
    },
    told: function () { return notes.filter(function (n) { return n === QUEUED; }).length; },
    chat: function () {
      const s = sockets[sockets.length - 1];
      return s ? s.sent.filter(function (m) { return m.t === 'chat'; }) : [];
    }
  };
}

/* From just after "(", to its matching ")", skipping quoted strings. */
function argAt(src, open) {
  let d = 1, q = '';
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '\\') { i++; } else if (ch === q) { q = ''; } continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') d++;
    else if (ch === ')' || ch === ']' || ch === '}') { d--; if (d === 0) return src.slice(open, i); }
  }
  return null;
}
/* How many arguments a call's text holds: commas at the top level, outside strings. */
function argCount(a) {
  if (!a.trim()) return 0;
  let d = 0, q = '', n = 1;
  for (let i = 0; i < a.length; i++) {
    const ch = a[i];
    if (q) { if (ch === '\\') { i++; } else if (ch === q) { q = ''; } continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') d++;
    else if (ch === ')' || ch === ']' || ch === '}') d--;
    else if (ch === ',' && d === 0) n++;
  }
  return n;
}
const fold = (s) => s.replace(/\s+/g, ' ').trim();

/* ---------------------------------------------------------- A: the page --- */
{
  const c = chatPage();
  yes('A0 the chat page has say and typed', typeof c.net.say === 'function' && typeof c.net.typed === 'function');
  if (typeof c.net.typed === 'function') {
    c.net.say('/party leave');
    yes('A1 say(line) offline is told it is queued, once', c.told() === 1);
    c.net.say('/place indoors - 0 1 0 -', { quiet: true });
    yes('A2 say(line, { quiet: true }) offline is queued without a word', c.told() === 1);
    c.net.typed('hello, is anybody here');
    yes('A3 typed(line) offline is told it is queued', c.told() === 2);
    c.up();
    const out = c.chat().map(function (m) { return JSON.stringify(m); });
    yes('A4 on connect all three go out, in order, the two said with press and the typed one with none: ' + out.join(' '),
        JSON.stringify(out) === JSON.stringify([
          '{"t":"chat","text":"/party leave","press":true}',
          '{"t":"chat","text":"/place indoors - 0 1 0 -","press":true}',
          '{"t":"chat","text":"hello, is anybody here"}']));
    const before = c.told();
    yes('A5 online, say(line) answers true and goes with press',
        c.net.say('/trade ok') === true && JSON.stringify(c.chat().pop()) === '{"t":"chat","text":"/trade ok","press":true}');
    yes('A6 online, typed(line) answers true and goes with no press',
        c.net.typed('/me waves') === true && JSON.stringify(c.chat().pop()) === '{"t":"chat","text":"/me waves"}');
    yes('A7 and nothing online is told it is queued', c.told() === before);
    yes('A8 a typed /roll is still rebuilt in its plain form',
        c.net.typed('/roll d20') === true && JSON.stringify(c.chat().pop()) === '{"t":"chat","text":"/roll 20"}');
  }
}

/* --------------------------------------------------------- B: the panels --- */
/* Each file's calls, by kind. say: a key or a panel button. typed: the chat box. */
const PANELS = {
  'thornswood-board.js': { say: 1 },
  'thornswood-furniture.js': { say: 1 },
  'thornswood-box.js': { say: 1 },
  'thornswood-bridge.js': { typed: 2 },
  'thornswood-journal.js': { say: 1 },
  'thornswood-maneuvers.js': { say: 1 },
  'thornswood-merchant.js': { say: 1 },
  'thornswood-party.js': { say: 1 },
  'thornswood-preserve.js': { say: 1 },
  'thornswood-repair.js': { say: 1 },
  'thornswood-ride.js': { say: 1 },
  'thornswood-ship.js': { say: 1 },
  'thornswood-skills.js': { say: 3 },
  'thornswood-stall.js': { say: 1 },
  'thornswood-trade.js': { say: 1 },
  'thornswood-treat.js': { say: 1 }
};
/* What the free names in a call stand for when it is run. */
const SAMPLE = {
  line: '/party leave', text: '/me waves',
  r: { key: 'shove', b: 'b1' }, gst: { pid: 5 }
};
const CALL = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.(say|typed)\(/g;
const sites = [];
for (const f of fs.readdirSync(UI).filter((n) => /^thornswood-.*\.js$/.test(n) && n !== 'thornswood-chat.js').sort()) {
  const src = rd(path.join(UI, f));
  for (let m; (m = CALL.exec(src));) {
    const callee = m[1];
    // The chat page's object, by its name or a local holding it (the journal's n).
    if (!/(^|\.)thornswoodNet$/.test(callee) && !(f === 'thornswood-journal.js' && callee === 'n')) continue;
    const args = argAt(src, m.index + m[0].length);
    sites.push({ file: f, callee: callee, kind: m[2], args: args === null ? '' : args });
  }
}
const counted = {};
for (const s of sites) {
  counted[s.file] = counted[s.file] || {};
  counted[s.file][s.kind] = (counted[s.file][s.kind] || 0) + 1;
}
const drift = Object.keys(PANELS).concat(Object.keys(counted)).filter((f, i, all) => all.indexOf(f) === i)
  .filter((f) => JSON.stringify(PANELS[f] || {}) !== JSON.stringify(counted[f] || {}));
yes('B0 every say and typed in game/ui is in this table (' + sites.length + ' calls)' +
    (drift.length ? '; differs: ' + drift.map((f) => f + ' ' + JSON.stringify(counted[f] || {})).join(' | ') : ''),
    drift.length === 0);
yes('B1 typed is called from thornswood-bridge.js alone, the chat box',
    sites.filter((s) => s.kind === 'typed').every((s) => s.file === 'thornswood-bridge.js') &&
    sites.some((s) => s.kind === 'typed'));
yes('B2 every panel call passes the line and nothing else, so it keeps the notice',
    sites.filter((s) => s.kind === 'say').every((s) => argCount(s.args) === 1));

for (const s of sites) {
  const name = s.file + ' ' + s.callee + '.' + s.kind + '(' + fold(s.args) + ')';
  const c = chatPage();
  const run = function () {
    const held = ['/me waves'];
    return new Function('window', 'n', 'line', 'text', 'held', 'r', 'gst', 'return ' + s.callee + '.' + s.kind + '(' + s.args + ');')(
      c.win, c.net, SAMPLE.line, SAMPLE.text, held, SAMPLE.r, SAMPLE.gst);
  };
  let threw = '';
  try { run(); } catch (e) { threw = String(e && e.message); }
  const toldOffline = c.told();
  c.up();
  const first = c.chat()[0];
  try { run(); } catch (e) { threw = threw || String(e && e.message); }
  const second = c.chat()[1];
  const typed = s.kind === 'typed';
  yes('B3 ' + name + (typed ? ': no press, typed' : ': press') + ', offline and online' + (threw ? ' (threw ' + threw + ')' : ''),
      !threw && !!first && !!second &&
      (typed ? (first.press === undefined && second.press === undefined)
             : (first.press === true && second.press === true)));
  yes('B4 ' + name + ': told once that it is queued', toldOffline === 1 && c.told() === 1);
}

/* ---------------------------------------------------- C: the front plugin --- */
/* Each say the plugin writes into the page, by the source of its line, and
   whether the chat says it is queued. */
const FRONT_SITES = {
  "' + JSON.stringify('/line hand ' + id) + '": { told: false, text: '/line hand 777' },
  "' + JSON.stringify('/joinpass ' + pass) + '": { told: false, text: '/joinpass jp1.abc.def' },
  '"/line"': { told: false, text: '/line' },
  '"/line leave"': { told: false, text: '/line leave' },
  "' + JSON.stringify(toServer[0]) + '": { told: false, text: '/lock ff001234' },
  // the look keys (lookVerb): /party, /trade, /friend, /mute, /deliver, /sleephere, /treat
  "' + JSON.stringify(line) + '": { told: true, text: '/trade ff00a001' }
};
const fsites = [];
for (let at = FRONT.indexOf('T.js('); at >= 0; at = FRONT.indexOf('T.js(', at + 1)) {
  const a = argAt(FRONT, at + 'T.js('.length);
  if (a === null || a.indexOf('thornswoodNet.say(') < 0) continue;
  const m = /thornswoodNet\.say\(([^;]*?)(,\{quiet:true\}|,true)?\);/.exec(a);
  fsites.push({ code: a, key: m ? fold(m[1]) : fold(a), flag: m ? (m[2] || '') : '?' });
}
const fkeys = fsites.map((s) => s.key);
const fmissing = fkeys.filter((k) => !FRONT_SITES[k]);
const fgone = Object.keys(FRONT_SITES).filter((k) => fkeys.indexOf(k) < 0);
yes('C0 every thornswoodNet.say the front plugin writes into the page is in this table (' + fsites.length + ')' +
    (fmissing.length ? '; not here: ' + fmissing.join(' | ') : '') + (fgone.length ? '; gone: ' + fgone.join(' | ') : ''),
    fmissing.length === 0 && fgone.length === 0 && fkeys.length === Object.keys(FRONT_SITES).length);
yes('C1 none passes the old true, which meant press and quiet at once', fsites.every((s) => s.flag !== ',true'));

for (const s of fsites) {
  const want = FRONT_SITES[s.key];
  if (!want) continue;
  const c = chatPage();
  const page = new Function('id', 'pass', 'line', 'toServer', 'return ' + s.code + ';')(
    777, 'jp1.abc.def', want.text, [want.text]);
  let threw = '';
  try { vm.runInContext(page, c.box); } catch (e) { threw = String(e && e.message); }
  const told = c.told();
  c.up();
  const frame = c.chat()[0];
  yes('C2 ' + s.key + ' reaches the socket as ' + want.text + ' with press' + (threw ? ' (threw ' + threw + ')' : ''),
      !threw && !!frame && frame.text === want.text && frame.press === true);
  yes('C3 ' + s.key + (want.told ? ': a look key, told it is queued' : ': the plugin\'s own, queued without a word'),
      told === (want.told ? 1 : 0));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
