// test-cooldown-sweep.js
//
// A map that only ever grew, and a book that could be torn in half.
//
// From the To Do List: "Any cache keyed by something unbounded gets an
// eviction rule: a size cap, an age sweep, or removal when the session ends."
//
// lastUse holds one row per character and per reference for every press that
// gave something, and nothing ever took one out. The sweep drops a row once it
// is older than the longest wait any caller asks about, which is exactly when
// the row stops changing any answer, so this checks both halves of that: the
// map stays bounded, and no answer anybody gets is different after a sweep.
// It also checks the longest wait is worked out from the waits a row is really
// asked about, no more and no fewer (#1641).
//
// characters.json was written in place, and writeFileSync empties a file
// before it fills it, so a server stopped halfway left a book the next start
// could not read, and every row for somebody offline was lost. It is written
// whole now, by the engine's mp.writeFileWhole (#2740); this tears a write
// halfway and restarts, and has the write refused.
//
// Reads the gamemode. Writes only into a scratch folder under the system
// temp folder, which it removes. GM=<path> reads another copy of the file.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const os = require('os');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* Comments in this repo quote old code on purpose, so a check that reads them
   as code is a check that punishes writing them. */
function codeOf(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const code = codeOf(src);

/** From a line to the close of the function it opens, or null. */
function fnBody(s, head) {
  const a = s.indexOf(head);
  if (a < 0) return null;
  const b = s.indexOf('\n}\n', a);
  return b < 0 ? null : s.slice(a, b + 3);
}

/** A top level `const NAME = ...;`, an object literal or one line. */
function constOf(name) {
  const head = 'const ' + name + ' = ';
  const a = src.indexOf(head);
  if (a < 0) return null;
  if (src.charAt(a + head.length) === '{') {
    const b = src.indexOf('\n};', a);
    return b < 0 ? null : src.slice(a, b + 3);
  }
  const b = src.indexOf(';', a);
  return b < 0 ? null : src.slice(a, b + 1);
}

// ================================================================ lastUse ===

const startAt = src.indexOf('const COOLDOWN_MS = 20000;');
const stampFn = startAt < 0 ? null : fnBody(src.slice(startAt), 'function stampCooldown(');
const block = (startAt >= 0 && stampFn)
  ? src.slice(startAt, src.indexOf(stampFn, startAt) + stampFn.length) : null;
// The block holds COOLDOWN_MS; the plants' wait is defined with the farming.
// The fish, game and hunt tables are handed in too although longestWaitMs no
// longer reads them, so one that reads them again fails C1 and C2 by name
// rather than stopping on a ReferenceError.
const tables = ['HARVEST_COOLDOWN_MS', 'FISH_TUNING', 'GAME_TUNING', 'HUNT_TUNING'].map(constOf);

yes('the cooldown block is in the gamemode', block !== null);
yes('and so are the waits it is checked against', tables.every(function (t) { return t !== null; }));

/* The real block, with a clock, and a Map that counts how often it is walked. */
function rig(start) {
  const clock = { now: start || 1700000000000 };
  const walks = { n: 0 };
  class CountingMap extends Map {
    forEach(f, t) { walks.n++; return super.forEach(f, t); }
    [Symbol.iterator]() { walks.n++; return super[Symbol.iterator](); }
    entries() { walks.n++; return super.entries(); }
  }
  const fn = new Function('Date', 'Map',
    block + '\n' + tables.join('\n') + '\n' +
    'return { left: cooldownLeft, stamp: stampCooldown, map: lastUse,\n' +
    '  longest: typeof longestWaitMs === "function" ? longestWaitMs : null,\n' +
    '  mark: function () { return typeof lastUseSweepAt === "undefined" ? null : lastUseSweepAt; } };');
  const api = fn({ now: function () { return clock.now; } }, CountingMap);
  api.clock = clock;
  api.walks = walks;
  return api;
}

const HOUR = 3600000;
const MINUTE = 60000;

if (block !== null && tables.every(function (t) { return t !== null; })) {

  // C1: the longest wait comes off the constants, and today it is the ten
  // minutes on a picked plant. It was the four hours on a master fishing spot
  // until #1413 moved the rivers, the racks and the carcasses to the shared
  // stock; after that it kept rows four hours nothing asked about (#1641).
  {
    const r = rig();
    yes('C1 the longest wait is worked out, not typed', r.longest !== null);
    yes('C1 and it is the ten minutes on a picked plant', r.longest !== null && r.longest() === 10 * MINUTE);
  }

  // C2: every table a cooldown is read against is one longestWaitMs reads.
  // A new source with a longer wait than any of these would otherwise have
  // its rows swept while they were still waiting.
  {
    const named = {};
    const re = /cooldownLeft\(|lastUse\.get\(/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const a = code.lastIndexOf('\nfunction ', m.index);
      const b = code.indexOf('\n}\n', m.index);
      if (a < 0 || b < 0) continue;
      const body = code.slice(a, b);
      const names = /\b([A-Z][A-Z0-9_]*)\.cooldownMs\b|\b((?:[A-Z][A-Z0-9_]*_)?COOLDOWN_MS)\b/g;
      let n;
      while ((n = names.exec(body)) !== null) named[n[1] || n[2]] = true;
    }
    const list = Object.keys(named).sort();
    console.log('      waits a cooldown is read against: ' + list.join(', '));
    // Since #1413 the rivers, the racks and the carcasses keep their waits on
    // the shared resource stock, by the place and for everybody, and the seams
    // are deposits: the stations and the plants are what is left on lastUse.
    yes('C2 the scan finds the stations and the plants, the waits still kept per person',
        ['COOLDOWN_MS', 'HARVEST_COOLDOWN_MS'].every(function (k) { return named[k]; }));
    const stockWaits = ['function fish(', 'function game('].filter(function (h) {
      const body = fnBody(code, h);
      return !!body && /stock\.left\(refrId,\s*span\)/.test(body) && !/cooldownLeft\(|lastUse\.get\(/.test(body);
    });
    yes('C2 and the rivers and the racks wait on the shared stock, not on lastUse (' + stockWaits.length + ' of 2)',
        stockWaits.length === 2);
    const longestBody = fnBody(code, 'function longestWaitMs(');
    const missing = list.filter(function (k) {
      return !longestBody || !new RegExp('\\b' + k + '\\b').test(longestBody);
    });
    yes('C2 and longestWaitMs reads every one of them' +
        (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''), missing.length === 0);
    // And nothing else: a table no row is read against keeps every row as long
    // as its longest wait for nothing (#1641).
    const extra = [];
    const read = /\b([A-Z][A-Z0-9_]*)\.cooldownMs\b|\b((?:[A-Z][A-Z0-9_]*_)?COOLDOWN_MS)\b/g;
    let e;
    while (longestBody && (e = read.exec(longestBody)) !== null) {
      const k = e[1] || e[2];
      if (!named[k] && extra.indexOf(k) < 0) extra.push(k);
    }
    yes('C2 and longestWaitMs reads no wait a row is never asked about' +
        (extra.length ? ' (extra: ' + extra.join(', ') + ')' : ''), !!longestBody && extra.length === 0);

    // The writers. Every function that stamps a row reads its own wait in the
    // same function, so the scan above sees the wait of every row there is.
    // A stamp with its wait read somewhere else would slip past the scan.
    const writers = [];
    const stamp = /stampCooldown\(/g;
    let w;
    while ((w = stamp.exec(code)) !== null) {
      const a = code.lastIndexOf('\nfunction ', w.index);
      const b = code.indexOf('\n}\n', w.index);
      if (a < 0 || b < 0) continue;
      const head = code.slice(a + 1, code.indexOf('(', a));
      if (head === 'function stampCooldown') continue;
      const body = code.slice(a, b);
      writers.push({ name: head.replace('function ', ''), reads: /cooldownLeft\(|lastUse\.get\(/.test(body) });
    }
    console.log('      functions that stamp lastUse: ' + writers.map(function (x) { return x.name; }).join(', '));
    const blind = writers.filter(function (x) { return !x.reads; }).map(function (x) { return x.name; });
    yes('C2 something still stamps lastUse (' + writers.length + ')', writers.length > 0);
    yes('C2 and every one reads its own wait where it stamps' +
        (blind.length ? ' (not: ' + blind.join(', ') + ')' : ''), blind.length === 0);
    // The rivers, the racks, the carcasses and the seams write no row at all.
    const notWriters = ['function fish(', 'function game(', 'function loot(', 'function mineOre('].filter(function (h) {
      const body = fnBody(code, h);
      return !!body && !/stampCooldown\(|lastUse\.|cooldownLeft\(/.test(body);
    });
    yes('C2 and the rivers, the racks, the carcasses and the seams keep nothing in lastUse (' +
        notWriters.length + ' of 4)', notWriters.length === 4);
  }

  // C3: one way in. The plants used to set their row directly, past the rule.
  {
    const sets = code.match(/lastUse\.set\(/g) || [];
    const stampBody = fnBody(code, 'function stampCooldown(') || '';
    yes('C3 there is one place a row is written into lastUse', sets.length === 1);
    yes('C3 and it is stampCooldown', stampBody.indexOf('lastUse.set(') >= 0);
  }

  // C4: THE POINT. Fifty thousand presses over fifty hours, one every 3.6
  // seconds, each on a different reference. Without the rule the map ends at
  // fifty thousand rows; with it, it never holds much more than the five
  // thousand a sweep starts at.
  {
    const r = rig();
    let most = 0;
    for (let i = 0; i < 50000; i++) {
      r.clock.now += 3600;
      r.stamp(0xff000800 + (i % 20), 0x100000 + i);
      if (r.map.size > most) most = r.map.size;
    }
    console.log('      after 50,000 presses the map holds ' + r.map.size + ', at most ' + most);
    yes('C4 fifty hours of presses do not leave fifty thousand rows', r.map.size < 10000);
    yes('C4 and it never held much more than the mark a sweep starts at', most < 10000);
  }

  // C5: no answer changes across a sweep. Rows of every age from nothing to
  // half an hour, asked about with every wait a row is read against (the
  // stations' twenty seconds and the plants' ten minutes), before and after.
  {
    const r = rig();
    const T0 = r.clock.now;
    const spans = [20000, 10 * MINUTE];
    const rows = [];
    for (let i = 0; i < 360; i++) {
      r.clock.now = T0 + i * 5000;            // one every five seconds for half an hour
      r.stamp(0xff000900, 0x200000 + i);
      rows.push(0x200000 + i);
    }
    const askAt = T0 + 30 * MINUTE;
    r.clock.now = askAt;
    function answers() {
      return rows.map(function (ref) {
        return spans.map(function (s) { return r.left(0xff000900, ref, s); }).join(',');
      }).join(';');
    }
    const before = answers();
    const stale = rows.filter(function (ref, i) { return askAt - (T0 + i * 5000) > 10 * MINUTE; }).length;
    let filler = 0;
    while (r.map.has('4278192384:' + rows[0]) && filler < 20000) {
      r.stamp(0xff000a00, 0x300000 + filler);  // same moment, so the answers still match
      filler++;
    }
    const after = answers();
    const gone = rows.filter(function (ref) { return !r.map.has('4278192384:' + ref); }).length;
    yes('C5 a sweep ran once the map passed the mark', gone > 0);
    yes('C5 it took exactly the rows older than ten minutes (' + gone + ' of ' + stale + ')', gone === stale);
    yes('C5 and every answer for every wait is the same after it as before', before === after);
    // A plant picked nine minutes and fifty-five seconds ago is still refused.
    const plant = rows[241];                   // stamped at T0 + 20:05, half an hour on is 9:55 later
    yes('C5 a plant picked 9m55s ago still has five seconds to go',
        r.map.has('4278192384:' + plant) && r.left(0xff000900, plant, 10 * MINUTE) === 5);
  }

  // C6: the press that pushes the map past the mark keeps its own row.
  {
    const r = rig();
    for (let i = 0; i < 4999; i++) { r.stamp(0xff000b00, 0x400000 + i); }
    r.clock.now += 5 * HOUR;                   // everything so far is stale
    r.stamp(0xff000b00, 0x4fffff);             // the 5000th row, and the sweep
    yes('C6 the stale rows went', r.map.size === 1);
    yes('C6 and the row that set it off is kept and counts', r.left(0xff000b00, 0x4fffff) === 20);
  }

  // C7: a map full of rows that are all still waiting is not walked on every
  // press. Twenty thousand in the same minute: walked at 5,000, 10,000 and
  // 20,000, and not the fifteen thousand times in between.
  {
    const r = rig();
    for (let i = 0; i < 20000; i++) { r.stamp(0xff000c00 + (i % 20), 0x500000 + i); }
    console.log('      twenty thousand live rows were walked ' + r.walks.n + ' time(s)');
    yes('C7 the sweep does run', r.walks.n >= 1);
    yes('C7 but only once per doubling, not once per press', r.walks.n <= 3);
    yes('C7 and nothing that was still waiting was dropped', r.map.size === 20000);
    yes('C7 and the next mark is twice what is there', r.mark() === 40000);
  }
}

// ============================================================ the roster ===

const rosterA = src.indexOf('// ==== thornswood character roster ====');
const rosterB = src.indexOf('// ==== end thornswood character roster ====');
const roster = (rosterA >= 0 && rosterB > rosterA) ? src.slice(rosterA, rosterB) : null;
yes('the roster block is in the gamemode', roster !== null);

/*
  The real block, over a real folder, with fs watched. Since #2740 the book
  is written by the engine's mp.writeFileWhole: a new file beside it,
  renamed over it. The stand-in below keeps that contract: tear stops the
  next write halfway, which leaves the new file torn and the book as it was;
  refuse throws the way the engine does when a reader that does not share
  delete holds the book, and the book is as it was.
*/
function book(dir, online) {
  const spy = { writes: [], renames: [], whole: [], said: [], tear: false, refuse: false };
  const wrapped = Object.assign({}, fs, {
    readFileSync: function (p, enc) {
      if (p === 'server-settings.json') return JSON.stringify({ privDir: dir, dataDir: dir });
      return fs.readFileSync(p, enc);
    },
    writeFileSync: function (p, data) {
      spy.writes.push(String(p));
      return fs.writeFileSync(p, data);
    },
    renameSync: function (a, b) {
      spy.renames.push([String(a), String(b)]);
      return fs.renameSync(a, b);
    }
  });
  const people = {
    1: { pid: 42, name: 'Ada', raceId: 0x013746, female: true, prof: 'miner' },
    2: { pid: 43, name: 'Bram', raceId: 0x013741, female: false, prof: 'hunter' }
  };
  const mp = {
    get: function (id, key) {
      if (key === 'onlinePlayers') return online.slice();
      const p = people[id];
      if (!p) return null;
      if (key === 'profileId') return p.pid;
      if (key === 'appearance') return { name: p.name, raceId: p.raceId, isFemale: p.female };
      if (key === 'thornswoodCharacter') return { prof: p.prof };
      if (key === 'worldOrCellDesc') return '';
      return null;
    },
    lookupEspmRecordById: function () { return null; },
    getIdFromDesc: function () { return 0; },
    writeFileWhole: function (p, text) {
      spy.whole.push(String(p));
      if (spy.tear) {
        spy.tear = false;
        throw new Error('the server stopped');
      }
      if (spy.refuse) {
        spy.refuse = false;
        throw new Error('Could not write ' + p + ' whole: renaming the new file over it, refused because ' +
                        'another program has it open without sharing delete. characters.json is as it was.');
      }
      fs.writeFileSync(p, text);
    }
  };
  let tick = null;
  const fn = new Function('require', 'mp', 'chargenOf', 'setInterval', 'setTimeout',
                          'clearInterval', 'globalThis', 'console', roster);
  fn(function (name) {
       if (name === 'fs') return wrapped;
       if (name === 'path') return path;
       throw new Error('not in this harness: ' + name);
     },
     mp,
     function () { return { class: '', destination: 'Whiterun' }; },
     function (f) { tick = f; return 1; },
     function () { return 0; },
     function () { },
     {},
     { log: function (l) { spy.said.push(String(l)); } });
  spy.tick = function () { if (tick) tick(); };
  return spy;
}

function readBook(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).who || null; } catch (e) { return null; }
}

if (roster !== null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-roster-'));
  const FILE = path.join(dir, 'characters.json');
  try {
    // R1: an ordinary write.
    const online = [1];
    const s = book(dir, online);
    s.tick();
    const whole = readBook(FILE);
    yes('R1 the book is written and has Ada in it', !!(whole && whole['42'] && whole['42'].name === 'Ada'));
    yes('R1 characters.json itself is never opened to be written into',
        s.writes.indexOf(FILE) === -1);
    yes('R1 it is written whole, by the engine\'s mp.writeFileWhole (#2740)',
        s.whole.indexOf(FILE) >= 0 && s.renames.length === 0);
    yes('R1 and nothing is left beside it', fs.readdirSync(dir).join(',') === 'characters.json');

    // R2: THE POINT. Bram comes on, and the server stops halfway through
    // writing him down.
    online.length = 0; online.push(2);
    s.tear = true;
    s.tick();
    const after = readBook(FILE);
    yes('R2 a write that stops halfway leaves the last whole book on disk',
        !!(after && after['42'] && after['42'].name === 'Ada'));

    // And the server starts again, with Bram still on.
    const again = book(dir, [2]);
    again.tick();
    const restarted = readBook(FILE);
    yes('R2 after the restart Ada, who was offline, is still in the book',
        !!(restarted && restarted['42'] && restarted['42'].name === 'Ada'));
    yes('R2 and Bram is written in beside her',
        !!(restarted && restarted['43'] && restarted['43'].name === 'Bram'));

    // R3: the engine refuses the write, as it does while a reader that does
    // not share delete holds the book. Until #2740 a refused rename wrote the
    // book in place after all; now the book stays the last one written whole.
    fs.rmSync(FILE, { force: true });
    const heldOnline = [1];
    const held = book(dir, heldOnline);
    held.tick();
    heldOnline.push(2);
    held.refuse = true;
    held.tick();
    const kept = readBook(FILE);
    yes('R3 a refused write leaves the last whole book (Ada, not yet Bram)',
        !!(kept && kept['42'] && !kept['43']));
    yes('R3 nothing writes characters.json in place, and nothing is left beside it',
        held.writes.indexOf(FILE) === -1 && fs.readdirSync(dir).join(',') === 'characters.json');
    yes('R3 the console says why',
        held.said.some(function (l) { return /could not write .*characters\.json: .*without sharing delete/.test(l); }));
    held.tick();
    const later = readBook(FILE);
    yes('R3 and the next pass writes the whole book, Bram in it, with nothing new to say',
        !!(later && later['42'] && later['43'] && later['43'].name === 'Bram'));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
