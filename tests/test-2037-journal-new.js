// test-2037-journal-new.js
//
// #2037: New on the Journals panel kept making journals up to the carry limit
// (12), then flooded chat with "You are carrying as many journals as you can."
//
// Both ends now hold one press to one journal:
//   A. the panel (game/ui/thornswood-journal.js) sends /journal new once and
//      ignores more presses until the server's view shows the new journal, or
//      3 seconds pass with no answer;
//   B. the server (journalCommand/newJournal in game/gamemode.js) runs a
//      command offered again under its id once, and says the full refusal at
//      most once every 10 seconds per character. It had a 2 s window too,
//      for "the same press arriving again"; #2135 measured that nothing
//      repeats a press (tests/test-2135-journal-press.js) and took it out.
// A runs the real panel under a stand-in page (as test-1630-journal-gui.js
// does). B loads the whole gamemode under a stand-in mp (as
// test-spawn-reply.js does) with a hand-turned clock.
//
// Read only.
let clock = 1700000000000;
class ClockDate extends Date {
  constructor(...a) { if (a.length) { super(...a); } else { super(clock); } }
  static now() { return clock; }
}
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GM = process.env.GM || path.join(__dirname, '..', 'game', 'gamemode.js');
// The whole gamemode loads below, and it reads its tables from the folder it
// runs in, which is the server's folder on the box and here the repository's
// root, where game/gamemode-tables is (#5191). So this runs from the root
// wherever it was started from.
process.chdir(path.join(__dirname, '..'));
const src = fs.readFileSync(GM, 'utf8');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------ the world ---
const ME = 0x14, PID = 5, OTHER = 6;
const CELL = '1a26f:Skyrim.esm';
const actors = {};
actors[ME] = { profileId: PID, pos: [1000, 2000, 300], angle: [0, 0, 90],
               worldOrCellDesc: CELL, inventory: { entries: [] } };

// Which ids are not NPC records; everything else the load order has is one.
const NOT_NPC = { 0x12eb7: 'WEAP' };
const placed = [], moved = [], destroyed = [], created = [], said = [], logs = [];
let nextRef = 0xff000100;
let placeThrows = '', setThrows = '';
// The join pass hold off on purpose: these lines come from a chat connection
// with no join token and a session with no pass, and the hold is what
// test-join-pass-trust.js covers. Absent would be on (#1319).
const HOLD_OFF = { thornswoodRequirePass: false };
let settings = Object.assign({}, HOLD_OFF);
const properties = new Set();

const mpBase = {
  get: function (id, prop) {
    if (id === 0 && prop === 'onlinePlayers') { return [ME]; }
    if (actors[id] && prop in actors[id]) { return actors[id][prop]; }
    return undefined;
  },
  set: function (id, prop, value) {
    if(prop === 'thornswoodNpcCommanded' && !properties.has(prop)) throw new Error('Property '+prop+" doesn't exist");
    if (prop === 'locationalData') {
      if (setThrows) { throw new Error(setThrows); }
      moved.push({ id: id, to: value });
      return;
    }
    if (actors[id]) { actors[id][prop] = value; }
  },
  getIdFromDesc: function (d) { return /:Skyrim\.esm$/.test(d) ? parseInt(d, 16) : 0; },
  getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
  lookupEspmRecordById: function (id) {
    return { record: { id: id, type: NOT_NPC[id] || 'NPC_', editorId: '', flags: 0, fields: [] } };
  },
  place: function (baseId) {
    if (placeThrows) { throw new Error(placeThrows); }
    const ref = nextRef++;
    actors[ref] = {baseDesc:baseId.toString(16)+':Skyrim.esm',profileId:-1};
    placed.push({ base: baseId, ref: ref });
    return ref;
  },
  destroyActor: function (id) { destroyed.push(id); },
  // The engine's meaning: the id the NEW actor gets. Nothing here should call it.
  createActor: function (formId) { created.push(formId); return formId; },
  getServerSettings: function () { return settings; },
  makeProperty: function (name) { properties.add(name); },
  makeEventSource: function () {},
  clear: function () {},
};
const mp = new Proxy(mpBase, {
  get: function (t, k) {
    if (k in t) { return t[k]; }
    if (typeof k === 'string' && /^on[A-Z]/.test(k)) { return undefined; }
    return function () { return undefined; };
  },
});

// ------------------------------------------- the voice service's two ends ---
let queue = [];
const fakeHttp = {
  request: function (opts, cb) {
    const req = {
      on: function () { return req; },
      destroy: function () {},
      write: function () {},
      end: function (body) {
        if (opts.path === '/say') { try { said.push(JSON.parse(body)); } catch (e) { } return; }
        if (String(opts.path).indexOf('/commands?') === 0 && cb) {
          const out = JSON.stringify({ commands: queue });
          queue = [];
          const res = { statusCode: 200, on: function (ev, fn) { res['_' + ev] = fn; return res; },
                        setEncoding: function () {}, resume: function () {} };
          cb(res);
          if (res._data) { res._data(out); }
          if (res._end) { res._end(); }
        }
      },
    };
    return req;
  },
  get: function () { return { on: function () { return this; }, end: function () {} }; },
};

// Reads go through; anything that would write, remove or start something does not.
const quietFs = {};
Object.keys(fs).forEach(function (k) {
  quietFs[k] = /write|append|mkdir|rename|copy|unlink|rm|symlink|link|truncate|chmod|chown|utimes|cp/i.test(k) &&
               typeof fs[k] === 'function' ? function () {} : fs[k];
});
quietFs.createWriteStream = function () { return { write: function () {}, end: function () {}, on: function () {} }; };

const timers = [];
const box = {
  mp: mp,
  console: { log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
             error: function () { logs.push('ERR ' + Array.prototype.join.call(arguments, ' ')); },
             warn: function () { logs.push('WARN ' + Array.prototype.join.call(arguments, ' ')); } },
  require: function (n) {
    if (n === 'http' || n === 'https') { return fakeHttp; }
    if (n === 'fs') { return quietFs; }
    if (n === 'child_process') { return { spawn: function () { throw new Error('no'); }, exec: function () {}, execFile: function () {} }; }
    return require(n);
  },
  setInterval: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
  clearInterval: function () {},
  setTimeout: function () { return 0; },
  clearTimeout: function () {},
  setImmediate: function () {},
  Buffer: Buffer, process: process, Date: ClockDate,
};
box.globalThis = box;
vm.createContext(box);
let loaded = true;
try { vm.runInContext(src, box, { filename: 'gamemode.js' }); }
catch (e) { loaded = false; console.log('gamemode.js threw while loading: ' + (e && e.stack)); }
yes('the whole gamemode loads under the stand-in', loaded);

const pollTimer = timers.filter(function (t) { return /\bpoll\(\)/.test(String(t.fn)); }).pop();
yes('the command timer that polls the voice service is armed', !!pollTimer);

let seq = 0;
function send(text, pid) {
  queue.push({ id: 'test:' + (++seq), profileId: pid || PID, name: 'Patrick', text: text });
  said.length = 0; placed.length = 0; moved.length = 0; destroyed.length = 0; created.length = 0;
  const before = logs.length;
  if (pollTimer) { pollTimer.fn(); }
  return {
    said: said.map(function (s) { return s.text; }),
    to: said.map(function (s) { return s.profileId; }),
    placed: placed.slice(), moved: moved.slice(), destroyed: destroyed.slice(), created: created.slice(),
    threw: logs.slice(before).filter(function (l) { return /threw/.test(l); }),
  };
}
function one(r) { return r.said.length === 1 ? r.said[0] : JSON.stringify(r.said); }
function unesc(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
function makeEl(tag) {
  const e = {
    tagName: String(tag).toLowerCase(), attrs: {}, kids: [], children: [], html: '',
    id: '', className: '', textContent: '', value: '', onclick: null,
    appendChild(c) { this.children.push(c); return c; },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    querySelectorAll(sel) {
      const tests = sel.split(',').map(function (s) { return matcher(s.trim()); });
      const out = [];
      (function walk(list) {
        list.forEach(function (k) {
          if (tests.some(function (t) { return t(k); })) { out.push(k); }
          walk(k.kids);
        });
      })(this.kids.concat(this.children));
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  };
  Object.defineProperty(e, 'innerHTML', {
    get() { return this.html; },
    set(h) { this.html = h; this.kids = parse(h); }
  });
  return e;
}
function matcher(sel) {
  const m = /^([a-z0-9]*)(?:#([\w-]+))?(?:\[([\w-]+)\])?$/i.exec(sel);
  if (!m) { throw new Error('the stand-in page cannot read the selector ' + sel); }
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
    el.className = el.attrs['class'] || '';
    if (el.tagName === 'input') { el.value = el.attrs.value || ''; }
    const shut = html.indexOf('</' + m[1] + '>', tag.lastIndex);
    if (el.tagName === 'button' && shut > 0) { el.textContent = unesc(html.slice(tag.lastIndex, shut)); }
    out.push(el);
  }
  return out;
}

// ---------------------------------------------------- B. the server ---
if (loaded && pollTimer) {
  const journals = function () {
    const raw = actors[ME] && Object.keys(actors[ME]).filter(function (k) { return /social/i.test(k); });
    for (const k of raw || []) {
      const v = actors[ME][k];
      const s = typeof v === 'string' ? (function () { try { return JSON.parse(v); } catch (e) { return null; } })() : v;
      if (s && Array.isArray(s.journals)) { return s.journals.length; }
    }
    return -1;
  };
  let started = 0, full = 0;
  // One press whose acknowledgement went missing, so the voice service
  // offers it again under the same id: one journal however often it comes.
  for (let n = 0; n < 3; n++) {
    queue.push({ id: 'test:offered-again', profileId: PID, name: 'Patrick', text: '/journal new Journal' });
    said.length = 0;
    pollTimer.fn();
    started += said.filter(function (x) { return /^Started /.test(x.text); }).length;
    clock += 50;
  }
  yes('B1: one press offered three times makes one journal: started ' + started + ', held ' + journals(),
      started === 1 && journals() === 1);

  for (let n = 0; n < 11; n++) { clock += 50; send('/journal new Journal'); }
  yes('B2: separate presses make one each, however close, up to the 12 carried: ' + journals(), journals() === 12);
  for (let n = 0; n < 30; n++) {
    clock += 300;
    const r = send('/journal new Journal');
    full += r.said.filter(function (x) { return /as many journals/.test(x); }).length;
  }
  yes('B3: thirty presses at the limit over nine seconds say the refusal once, not thirty times: ' + full, full === 1);
  clock += 11000;
  const r = send('/journal new Journal');
  yes('B4: and say it again after ten quiet seconds', r.said.some(function (x) { return /as many journals/.test(x); }));
}

// ---------------------------------------------------- A. the panel ---
{
  const journalSrc = fs.readFileSync(path.join(__dirname, '..', 'game', 'ui', 'thornswood-journal.js'), 'utf8')
    .split(String.fromCharCode(13)).join('');
  const sent = [];
  const doc = { head: makeEl('head'), body: makeEl('body'), activeElement: null, createElement: makeEl,
                addEventListener() { } };
  const win = { skyrimPlatform: { sendMessage() { } },
                thornswoodNet: { say(line) { sent.push(line); return true; } },
                innerWidth: 1920, innerHeight: 1080, addEventListener() { } };
  const realNow = Date.now;
  Date.now = function () { return clock; };
  try {
    new Function('window', 'document', journalSrc)(win, doc);
    const J = win.thornswoodJournal;
    const root = doc.body.children[0];
    J.setData({ journals: [], shared: [] });
    J.open();
    const newBtn = function () { return root.querySelectorAll('button[data-new]')[0]; };
    for (let n = 0; n < 6; n++) { newBtn().onclick.call(newBtn()); clock += 100; }
    yes('A1: six presses of New before the server answers send one line: ' + sent.length,
        sent.length === 1 && sent[0] === '/journal new Journal');
    J.setData({ journals: [{ id: 'j1', title: 'Journal', pages: [] }], shared: [] });
    newBtn().onclick.call(newBtn());
    yes('A2: once the new journal shows, New answers the next press', sent.length === 2);
    clock += 3500;
    newBtn().onclick.call(newBtn());
    yes('A3: and a press with no answer for three seconds is allowed again', sent.length === 3);
  } finally { Date.now = realNow; }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);