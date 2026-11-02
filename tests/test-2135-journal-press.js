// test-2135-journal-press.js
//
// #2135: how many /journal new lines leave the game for one press of New.
// #2037 put a 2 s window on the server ("the same press arriving again") with
// nothing measured behind it. This runs the real chat file
// (game/ui/thornswood-chat.js) and the real journal panel
// (game/ui/thornswood-journal.js) in one stand-in page, over a stand-in
// WebSocket, and counts the chat frames carrying /journal new:
//
//   1. connected: one press sends one frame, and presses while it is in
//      flight send none;
//   2. not connected yet: the line is queued (thornswoodNet.say returns
//      false). Until #2135 the panel took any call to say as sent, so its
//      3 s wait for an answer ran out while the line was still in the queue,
//      and a press after that queued another: the welcome then sent one per
//      3 s of waiting. That is the one way one person's New reached the
//      server more than once, and it is fixed in the panel;
//   3. after the frame leaves, nothing upstream doubles it: the voice service
//      gives it one command id and the gamemode runs an id once however
//      often it is offered (voice/tests/test-command-ack.js), so the server takes
//      every /journal new it gets as a request of its own.
//
// Read only. No network.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const ROOT = path.join(__dirname, '..');
const CHAT_SRC = fs.readFileSync(path.join(ROOT, 'game', 'ui', 'thornswood-chat.js'), 'utf8');
const JOURNAL_SRC = fs.readFileSync(path.join(ROOT, 'game', 'ui', 'thornswood-journal.js'), 'utf8')
  .split(String.fromCharCode(13)).join('');
const GM_SRC = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8');
const VOICE_SRC = fs.readFileSync(path.join(ROOT, 'voice', 'voice-server.js'), 'utf8');

// ------------------------------------------------------- a stand-in page ---
function unesc(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
function makeEl(tag) {
  const e = {
    tagName: String(tag || 'div').toLowerCase(), attrs: {}, kids: [], children: [], html: '', style: {},
    id: '', className: '', textContent: '', value: '', onclick: null, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, insertBefore(c) { this.children.push(c); return c; },
    setAttribute(n, v) { this.attrs[n] = String(v); }, removeAttribute(n) { delete this.attrs[n]; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, contains() { return false; },
    scrollTop: 0, scrollHeight: 0, clientHeight: 0, getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    querySelectorAll(sel) {
      const tests = sel.split(',').map(function (s) { return matcher(s.trim()); });
      const out = [];
      (function walk(list) {
        list.forEach(function (k) { if (tests.some(function (t) { return t(k); })) { out.push(k); } walk(k.kids || []); });
      })(this.kids.concat(this.children));
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  };
  Object.defineProperty(e, 'innerHTML', { get() { return this.html; }, set(h) { this.html = h; this.kids = parse(h); } });
  return e;
}
function matcher(sel) {
  const m = /^([a-z0-9]*)(?:#([\w-]+))?(?:\[([\w-]+)\])?$/i.exec(sel);
  if (!m) { return function () { return false; }; }
  return function (el) {
    if (m[1] && el.tagName !== m[1].toLowerCase()) { return false; }
    if (m[2] && el.attrs.id !== m[2]) { return false; }
    if (m[3] && !Object.prototype.hasOwnProperty.call(el.attrs, m[3])) { return false; }
    return true;
  };
}
function parse(html) {
  const out = [];
  const tag = /<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/gi;
  let m;
  while ((m = tag.exec(html))) {
    const el = makeEl(m[1]);
    const attr = /([a-z-]+)(?:="([^"]*)")?/gi;
    let a;
    while ((a = attr.exec(m[2]))) { el.attrs[a[1]] = a[2] == null ? '' : unesc(a[2]); }
    el.id = el.attrs.id || '';
    out.push(el);
  }
  return out;
}

let clock = 1700000000000;
function page() {
  const frames = [];        // every frame the chat file put on the socket
  const sockets = [];
  function FakeSocket(url, protocols) {
    this.url = url; this.protocols = protocols; this.readyState = 0;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    this.send = (d) => { if (this.readyState !== 1) { throw new Error('not open'); } frames.push(JSON.parse(d)); };
    this.close = () => { this.readyState = 3; };
    sockets.push(this);
  }
  const doc = { head: makeEl('head'), body: makeEl('body'), documentElement: makeEl('html'), activeElement: null,
                createElement: makeEl, getElementById() { return null; }, addEventListener() {}, removeEventListener() {},
                querySelector() { return null; }, querySelectorAll() { return []; } };
  const box = {
    THORNSWOOD: { host: 'thornswood.test', port: 443, profileId: 7, name: 'Djinn', token: 'tok', base: 'https://thornswood.test/voice' },
    skyrimPlatform: { sendMessage() {} },
    document: doc, navigator: {}, location: { href: 'file:///Data/Platform/UI/index.html' },
    WebSocket: FakeSocket, console: { log() {}, warn() {}, error() {} },
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    innerWidth: 1920, innerHeight: 1080, addEventListener() {}, removeEventListener() {},
    Date: class extends Date { constructor(...a) { if (a.length) { super(...a); } else { super(clock); } } static now() { return clock; } },
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(CHAT_SRC, box, { filename: 'thornswood-chat.js' });
  vm.runInContext(JOURNAL_SRC, box, { filename: 'thornswood-journal.js' });
  const J = box.thornswoodJournal;
  J.setData({ journals: [], shared: [] });
  J.open();
  const root = doc.body.children.filter(function (c) { return c.querySelectorAll('button[data-new]').length; })[0] ||
               doc.body.children[doc.body.children.length - 1];
  return {
    box: box, J: J, sockets: sockets,
    press() { const b = root.querySelectorAll('button[data-new]')[0]; b.onclick.call(b); },
    news() { return frames.filter(function (f) { return f.t === 'chat' && /^\/journal new\b/.test(f.text); }).length; },
    connect() {
      const s = sockets[sockets.length - 1];
      s.readyState = 1; s.onopen({});
      s.onmessage({ data: JSON.stringify({ t: 'welcome', peer: 3 }) });
    },
  };
}

// ------------------------------------------------------ 1. connected ---
{
  const p = page();
  yes('the chat file opened its socket', p.sockets.length === 1);
  p.connect();
  yes('and is joined', p.box.thornswoodNet.state().joined === true);
  p.press();
  yes('1a: one press, connected, sends one /journal new: ' + p.news(), p.news() === 1);
  for (let n = 0; n < 5; n++) { clock += 200; p.press(); }
  yes('1b: five more presses before the server answers send none: ' + p.news(), p.news() === 1);
  p.J.setData({ journals: [{ id: 'j1', title: 'Journal', pages: [] }], shared: [] });
  p.press();
  yes('1c: once the journal shows, the next press is one more: ' + p.news(), p.news() === 2);
}

// ------------------------------------------ 2. not connected yet ---
{
  const p = page();
  yes('2: the page is not joined yet', p.box.thornswoodNet.state().joined === false);
  // Somebody pressing again because nothing happened: once a second for
  // eight seconds, past the panel's 3 s wait for an answer.
  p.press();
  for (let n = 0; n < 8; n++) { clock += 1000; p.press(); }
  const queued = p.box.thornswoodNet.state().queued;
  yes('2a: nine presses over eight seconds before the chat joins queue one line, not one per 3 s: ' + queued, queued === 1);
  p.connect();
  yes('2b: and the welcome sends one /journal new: ' + p.news(), p.news() === 1);
  // The line has left. It is in flight like a connected press: held until
  // the server's view shows the journal, or NEW_WAIT_MS with no answer.
  clock += 500; p.press();
  yes('2c: a press just after it left sends nothing: ' + p.news(), p.news() === 1);
  p.J.setData({ journals: [{ id: 'j1', title: 'Journal', pages: [] }], shared: [] });
  p.press();
  yes('2d: once the journal shows, the next press is one more: ' + p.news(), p.news() === 2);
}

// ------------------------------------------- 3. after it leaves ---
// The service hands every chat command its own id, once (COMMANDS_BOOT +
// nextCommand), and the gamemode skips an id it has run (commandsRun), which
// voice/tests/test-command-ack.js runs end to end. So the server's window guarded
// against nothing that reaches it, and it is gone.
yes('3a: the service gives each command line one id',
    /commands\.push\(\{\s*id: COMMANDS_BOOT \+ ':' \+ \(nextCommand\+\+\)/.test(VOICE_SRC));
yes('3b: the gamemode runs an id once however often it is offered',
    /if \(id && commandsRun\.seen\[id\] === true\) \{ ran\.push\(id\); continue; \}/.test(GM_SRC));
yes('3c: and newJournal has no time window left (#2135)',
    !/NEW_JOURNAL_GAP_MS/.test(GM_SRC) && !/again: true/.test(GM_SRC));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
