/*
  test-stuck.js

      node .\tests\test-stuck.js

  Issue #414, the /stuck part, built to Patrick's rules of 28 September:
  back a few steps to a recent safe spot out of a short trail the server
  keeps, else the nearest temple; once every 5 minutes for each character;
  refused while dead; in a fight a 15 second wait that being hit or moving
  cancels; every use written where staff read it (for-bot/moderation.log,
  which the bot says in the staff channel); a line in the chat every time.

  It runs the REAL chat command block of game/gamemode.js (WORDS through the
  end of the chat commands: the real poll(), dispatch() and handle()), the
  REAL stuck block and the REAL staff block, over a pretend world with its own
  clock. Commands go in the way they do on the server, through the voice
  service's GET /commands answer, and every answer is read back from the
  POST /say it makes. DATA and BUILDING_NAME are the real tables, read out of
  the same file.

  Checked:
    - dead: refused, with a line, and nothing moves or is recorded;
    - the 5 minutes: a second use is refused with how long is left, and works
      once they are up;
    - in a fight (hurt, or swinging): a 15 second wait, cancelled by a hit and
      by a step, each with a line and a staff record; standing still it
      completes after 15 seconds, and not at 14;
    - back a few steps versus the temple: the newest trail point away from
      the stuck place; a fall never becomes a point; still standing where the
      last /stuck put them is the temple; no trail is the temple; the nearest
      temple on the same map, indoors measured from where they went in, or
      the hold's capital, and Whiterun's when nothing is known;
    - the record: one JSON line in moderation.log with character, profile,
      Discord account, from, to and time, one line in thornswood.log, and the
      reply says it is logged;
    - the temple table agrees with DATA (the death respawn's own points) and
      every cell is a temple in the load order;
    - /stuck is in WORDS, in what everybody is told about, and in the help
      panel's Getting help (#1633), with the stuck block's own numbers;
    - frozen by staff, or still making the character: refused with a line.

  Read only. Nothing leaves the process.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GM = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(GM, 'utf8')).split(CR).join('');
/*
  One topic of the help panel (#1633), as a fresh install reads it: /help's
  topics moved out of the gamemode into game/ui/thornswood-help.js, each a
  list of paragraphs made from the key names.
*/
function helpTopic(id) {
  const page = fs.readFileSync(path.join(ROOT, 'game', 'ui', 'thornswood-help.js'), 'utf8')
    .split(String.fromCharCode(13)).join('');
  const a = page.indexOf('  var TOPICS = [');
  const b = a < 0 ? -1 : page.indexOf('\n  ];\n', a);
  const k = /var keys = (\{[\s\S]*?\});/.exec(page);
  if (a < 0 || b < 0 || !k) { return ''; }
  try {
    const topics = new Function('return ' + page.slice(page.indexOf('[', a), b + 4))();
    const t = topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.text(new Function('return ' + k[1])()).join(' ') : '';
  } catch (e) { return ''; }
}

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

function slice(from, to) {
  const a = src.indexOf(from);
  const b = a < 0 ? -1 : src.indexOf(to, a);
  return (a < 0 || b < 0) ? null : src.slice(a, b + to.length);
}
function constLine(name) {
  const lines = src.split('\n');
  for (const l of lines) {
    if (l.indexOf('const ' + name + ' = ') === 0) {
      return JSON.parse(l.slice(('const ' + name + ' = ').length).replace(/;\s*$/, ''));
    }
  }
  return null;
}

const COMMANDS = slice('const WORDS = [', '// ==== end thornswood chat commands ====');
const STUCK = slice('// ==== thornswood stuck ====', '// ==== end thornswood stuck ====');
const STAFF = slice('// ==== thornswood staff ====', '// ==== end thornswood staff ====');
const PLACE_ACTORS = slice('\nfunction placeActors(', '\n  return { made: made, why: why };\n}');
const DATA = constLine('DATA');
const BUILDING_NAME = constLine('BUILDING_NAME');
yes('the chat command block is in gamemode.js', !!COMMANDS);
yes('the stuck block is in gamemode.js between its markers', !!STUCK);
yes('the staff block is in gamemode.js', !!STAFF);
yes('DATA and BUILDING_NAME read out of the same file', !!(DATA && DATA.destinations && BUILDING_NAME));
if (!(COMMANDS && STUCK && STAFF && PLACE_ACTORS && DATA && BUILDING_NAME)) { done(); }

// ------------------------------------------------------------ the world --
const TAMRIEL = '3c:Skyrim.esm';
const SOLSTHEIM = '800:Dragonborn.esm';
const BJORN = 2002, SERA = 4004, AELA = 1001;
const A_BJORN = 0xff000002, A_SERA = 0xff000004, A_AELA = 0xff000001;

function load() {
  const w = {
    clock: 1790000000000,
    online: [A_BJORN, A_SERA, A_AELA],
    pid: { [A_BJORN]: BJORN, [A_SERA]: SERA, [A_AELA]: AELA },
    name: { [A_BJORN]: 'Bjorn Iron-Hand', [A_SERA]: 'Sera', [A_AELA]: 'Aela' },
    where: {
      [A_BJORN]: { desc: TAMRIEL, pos: [170000, -90000, 0], rot: [0, 0, 0] },
      [A_SERA]: { desc: TAMRIEL, pos: [0, 0, 0], rot: [0, 0, 0] },
      [A_AELA]: { desc: TAMRIEL, pos: [9, 9, 9], rot: [0, 0, 0] }
    },
    hp: { [A_BJORN]: 1, [A_SERA]: 1, [A_AELA]: 1 },
    anim: {}, dead: {}, creating: {},
    set: [], said: [], logged: [], records: [], queue: [], timers: []
  };
  const mp = {
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return w.online.slice(); }
      if (w.online.indexOf(id) < 0 && key === 'profileId') { throw new Error('no such actor'); }
      if (key === 'profileId') { return w.pid[id]; }
      if (key === 'appearance') { return { name: w.name[id] }; }
      if (key === 'worldOrCellDesc') { return (w.where[id] || {}).desc; }
      if (key === 'pos') { return (w.where[id] || {}).pos.slice(); }
      if (key === 'angle') { return (w.where[id] || {}).rot.slice(); }
      if (key === 'isDead') { return !!w.dead[id]; }
      if (key === 'percentages') { return { health: w.hp[id], magicka: 1, stamina: 1 }; }
      if (key === 'lastAnimEvent') { return w.anim[id] || null; }
      return undefined;
    },
    set: function (id, key, v) {
      w.set.push({ id: id, key: key, v: v });
      if (key === 'locationalData') {
        w.where[id] = { desc: v.cellOrWorldDesc, pos: v.pos.slice(), rot: v.rot.slice() };
      }
    },
    getServerSettings: function () { return { privDir: 'private', thornswoodServer: 'dev' }; },
    getUserByActor: function () { return -1; },
    kick: function () { },
    place: function () { return 0; },
    makeProperty: function () { },
    callPapyrusFunction: function () { }
  };
  const http = {
    request: function (opts, cb) {
      const req = {
        on: function () { return req; },
        destroy: function () { },
        end: function (body) {
          if (opts.method === 'GET' && String(opts.path).indexOf('/commands') === 0) {
            const out = JSON.stringify({ commands: w.queue.splice(0, w.queue.length) });
            const h = {};
            const res = { on: function (ev, fn) { h[ev] = fn; return res; }, resume: function () { } };
            cb(res);
            if (h.data) { h.data(out); }
            if (h.end) { h.end(); }
            return;
          }
          let doc = null;
          try { doc = JSON.parse(body); } catch (e) { doc = body; }
          if (opts.path === '/say') { w.said.push({ to: doc.profileId, text: doc.text }); }
          if (cb) { cb({ resume: function () { }, on: function () { } }); }
        }
      };
      return req;
    }
  };
  const fakeFs = {
    readFileSync: function () { throw new Error('not here'); },
    existsSync: function () { return false; },
    appendFileSync: function (p, text) { w.records.push({ path: p, text: text }); },
    mkdirSync: function (p) { (w.dirs = w.dirs || []).push(p); },
    writeFileSync: function () { }, unlinkSync: function () { }
  };
  class FakeDate extends Date {
    constructor(...a) { if (a.length) { super(...a); } else { super(w.clock); } }
    static now() { return w.clock; }
  }
  const box = {
    mp: mp,
    Date: FakeDate,
    require: function (n) { return n === 'http' ? http : n === 'fs' ? fakeFs : n === 'path' ? path : require(n); },
    console: { log: function () { }, error: function () { } },
    Buffer: Buffer,
    log: function () { w.logged.push(Array.prototype.join.call(arguments, ' ')); },
    voicePort: function () { return 7778; },
    guard: function (name, fn) { return fn; },
    setInterval: function (fn, ms) { w.timers.push({ fn: fn, ms: ms }); return w.timers.length; },
    clearInterval: function () { },
    setTimeout: function () { return 0; },
    clearTimeout: function () { },
    idOf: function () { return 0; },
    addItem: function () { return false; },
    ORES_BY_BASE: {}, HARVESTS_BY_BASE: {}, CROPS_BY_BASE: {}, FISH_BY_BASE: {},
    HUNTS_BY_BASE: {}, GAME_BY_BASE: {}, RECIPES_BY_ID: {}, ITEM_NAMES: {}, ITEMS: {},
    ADMIN_ITEMS: {}, ADMIN_ACTORS: {},
    HALL: { desc: 'Hall:0', pos: [0, 0, 0], rot: [0, 0, 0] },
    PASSAGES: {},
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {},
    DATA: DATA
  };
  vm.createContext(box);
  box.__thornswoodIsDev = function (p) { return p === AELA; };
  box.__thornswoodIsAdmin = function () { return false; };
  box.__thornswoodIsAllowed = function () { return true; };
  // Bjorn's join pass names his Discord account; Sera has none on hand.
  box.__thornswoodPassSeen = { passes: { [BJORN]: { at: w.clock, x: w.clock + 600000, v: '1.1.102', d: '111222333' } },
                               online: {}, said: {} };
  box.__thornswoodChargen = { inCreation: function (a) { return !!w.creating[a]; } };
  box.__thornswoodSocial = {
    findPerson: function (want) {
      const low = String(want).toLowerCase();
      const hit = w.online.filter(function (a) { return String(w.name[a]).toLowerCase().indexOf(low) === 0; });
      if (hit.length === 1) { return { actorId: hit[0], why: '' }; }
      return { actorId: 0, why: 'Nobody here by that name.' };
    }
  };
  vm.runInContext(PLACE_ACTORS + '\n' +
                  COMMANDS.split('const WORDS').join('var WORDS').split('const PLAYER_WORDS').join('var PLAYER_WORDS') +
                  '\n' + STUCK + '\n' + STAFF, box, { filename: 'gamemode.js (commands, stuck and staff)' });
  w.box = box;
  w.poll = w.timers.filter(function (t) { return t.ms === 1500; })[0];
  w.stuck = box.__thornswoodStuck;
  return w;
}

let nextId = 1;
function run(w, pid, text) {
  const before = w.said.length;
  w.queue.push({ id: 't:' + (nextId++), profileId: pid, name: '', text: text, at: w.clock, proven: true });
  w.poll.fn();
  return w.said.slice(before).filter(function (l) { return l.to === pid; }).map(function (l) { return l.text; });
}
/* One second of server time: the clock moves, the stuck tick runs, and
   every third second the trail timer does, as on the server. */
function second(w, n) {
  const before = w.said.length;
  for (let i = 0; i < (n || 1); i++) {
    w.clock += 1000; w.stuck.tick();
    w.secs = (w.secs || 0) + 1;
    if (w.secs % 3 === 0) { w.stuck.trailTick(); }
  }
  return w.said.slice(before);
}
/* Stand somewhere for one trail sample (three ticks). */
function standAt(w, actor, desc, pos) {
  w.where[actor] = { desc: desc, pos: pos.slice(), rot: [0, 0, 30] };
  second(w, 3);
}
function records(w) { return w.records.map(function (r) { return JSON.parse(r.text); }); }
function moves(w, actor) {
  return w.set.filter(function (s) { return s.id === actor && s.key === 'locationalData'; });
}
function temple(key) { return DATA.destinations[key].temple; }

const w = load();
yes('the blocks load, and the stuck block is on globalThis with its two timers armed',
    !!w.poll && !!w.stuck && w.timers.some(function (t) { return t.ms === 1000; }) &&
    w.timers.some(function (t) { return t.ms === 3000; }));

// ------------------------------------------------------------ the table --
console.log('\nthe temple table:');
{
  const T = w.stuck.TEMPLES;
  const keys = Object.keys(DATA.destinations).filter(function (k) { return DATA.destinations[k].temple; }).sort();
  yes('one row for every temple the death respawn knows (' + keys.join(', ') + ')',
      T.map(function (t) { return t.key; }).sort().join() === keys.join());
  let same = true, named = true;
  for (const t of T) {
    const d = temple(t.key);
    if (t.desc !== d.desc || JSON.stringify(t.pos) !== JSON.stringify(d.pos) ||
        JSON.stringify(t.rot) !== JSON.stringify(d.rot) ||
        JSON.stringify(t.door) !== JSON.stringify(d.entrancePos) ||
        parseInt(t.doorWorld.split(':')[0], 16) !== (parseInt(d.entranceWorld, 16) & 0xffffff)) {
      same = false; console.log('      differs: ' + t.key);
    }
    if (!/temple/i.test(BUILDING_NAME[t.desc] || '')) { named = false; console.log('      not a temple: ' + t.key + ' ' + BUILDING_NAME[t.desc]); }
  }
  yes('every cell, point, facing, door and door map is the one DATA.destinations holds', same);
  yes('and every cell is a temple by the load order\'s own name for it', named);
  yes('the five mainland temples are on Tamriel\'s map and Raven Rock\'s on Solstheim\'s',
      T.filter(function (t) { return t.frame === 'tamriel'; }).length === 5 &&
      T.filter(function (t) { return t.frame === 'solstheim'; }).map(function (t) { return t.key; }).join() === 'ravenrock');
  yes('each door\'s map is the map of that frame',
      T.every(function (t) { return w.stuck.frameOf(t.doorWorld) === t.frame; }));
}

// --------------------------------------------------------------- words --
console.log('\nfindable:');
{
  yes('/stuck is a word the server answers', w.box.WORDS.indexOf('/stuck') >= 0);
  yes('and one everybody is told about', w.box.PLAYER_WORDS.indexOf('/stuck') >= 0);
  // The help is a panel since #1633: its Getting help, as a fresh install
  // reads it, with the minutes and the seconds read out of the stuck block.
  const help = helpTopic('help');
  const block = slice('// ==== thornswood stuck ====', '// ==== end thornswood stuck ====') || '';
  const again = Number((/var AGAIN_MS = (\d+) \* 60 \* 1000;/.exec(block) || [])[1]);
  const wait = Number((/var WAIT_MS = (\d+);/.exec(block) || [])[1]) / 1000;
  yes('the help panel says what /stuck does, the ' + again + ' minutes, the ' + wait + ' second wait and that it is logged',
      again > 0 && wait > 0 && /\/stuck/.test(help) && help.indexOf('once every ' + again + ' minutes') !== -1 &&
      help.indexOf('a ' + wait + ' second wait in a fight') !== -1 && /logged for staff/.test(help));
  const said = run(w, SERA, '/help');
  yes('and /help typed out of habit says where the panel is, and names /stuck',
      said.length === 1 && /^Help is a panel/.test(said[0]) && /\/stuck/.test(said[0]));
}

// ---------------------------------------------------------------- dead --
console.log('\ndead:');
{
  w.dead[A_SERA] = true;
  const got = run(w, SERA, '/stuck');
  yes('refused outright with a line saying why',
      got.length === 1 && /^You are dead, so \/stuck cannot move you/.test(got[0]));
  yes('nothing moved and nothing recorded', moves(w, A_SERA).length === 0 && w.records.length === 0);
  yes('the refusal is in thornswood.log', w.logged.some(function (l) { return /stuck: profile 4004 refused: dead/.test(l); }));
  w.dead[A_SERA] = false;
}

// -------------------------------------------------- back a few steps --
console.log('\nback a few steps:');
{
  standAt(w, A_BJORN, TAMRIEL, [170000, -90000, 0]);
  standAt(w, A_BJORN, TAMRIEL, [170500, -90000, 0]);
  standAt(w, A_BJORN, TAMRIEL, [171000, -90000, 0]);
  // Wedged: a step on, then stuck there for a while.
  standAt(w, A_BJORN, TAMRIEL, [171100, -90000, 0]);
  second(w, 30);
  const got = run(w, BJORN, '/stuck');
  const m = moves(w, A_BJORN);
  yes('out of a fight it works at once', m.length === 1);
  yes('back to the newest trail point away from the stuck place, not the one beside it',
      m.length === 1 && m[0].v.cellOrWorldDesc === TAMRIEL && JSON.stringify(m[0].v.pos) === '[170500,-90000,0]');
  yes('facing the way they were facing there', m.length === 1 && JSON.stringify(m[0].v.rot) === '[0,0,30]');
  yes('the reply says where and that it is logged',
      got.length === 1 && /^Sent back to where you were standing a moment ago\./.test(got[0]) &&
      /every use is logged for staff/.test(got[0]) && /warning or a ban/.test(got[0]) &&
      /again in 5 minutes/.test(got[0]));

  const r = records(w);
  // In for-bot beside private, which the bot reads by a rule on the folder (#2321).
  yes('one line in moderation.log, in for-bot beside privDir, the folder made first', w.records.length === 1 &&
      w.records[0].path === path.join('for-bot', 'moderation.log') && (w.dirs || []).indexOf('for-bot') >= 0);
  const row = r[0] || {};
  yes('it says /stuck, the server, the profile, the name, the character and the Discord account',
      row.did === 'stuck' && row.server === 'dev' && row.by === BJORN && row.who === BJORN &&
      row.byName === 'Bjorn Iron-Hand' && row.character === 'ff000002' && row.account === '111222333');
  yes('where from and where to, and the time',
      row.result === 'trail' && row.from && row.from.desc === TAMRIEL &&
      JSON.stringify(row.from.pos) === '[171100,-90000,0]' && row.to && JSON.stringify(row.to.pos) === '[170500,-90000,0]' &&
      row.at === new Date(w.clock).toISOString());
  yes('and the sentence the staff channel shows says the same',
      /^used \/stuck and was sent back a few steps, from 3c:Skyrim\.esm \(171100, -90000, 0\) to 3c:Skyrim\.esm \(170500, -90000, 0\)\. Character ff000002, Discord 111222333\.$/.test(row.why || ''));
  yes('and one line in thornswood.log with the account',
      w.logged.some(function (l) { return /^stuck: Bjorn Iron-Hand \(profile 2002, character ff000002, Discord 111222333\) used \/stuck and was sent back a few steps/.test(l); }));
}

// ------------------------------------------------------------ cooldown --
console.log('\nonce every 5 minutes:');
{
  // A step away from where it put him, so this is about the time only.
  standAt(w, A_BJORN, TAMRIEL, [170800, -90000, 0]);
  let got = run(w, BJORN, '/stuck');
  yes('a second use inside 5 minutes is refused with how long is left',
      got.length === 1 && /^\/stuck works once every 5 minutes for each character\. You can use it again in 5 minutes\./.test(got[0]) &&
      /\/helpme reaches staff/.test(got[0]));
  yes('and nothing moved or was recorded', moves(w, A_BJORN).length === 1 && w.records.length === 1);
  second(w, 150);
  got = run(w, BJORN, '/stuck');
  yes('half way it says less is left', got.length === 1 && /again in 3 minutes/.test(got[0]));
  second(w, 145);
  got = run(w, BJORN, '/stuck');
  yes('it is counted for the character: still refused at 4 minutes 58', got.length === 1 && /again in a minute/.test(got[0]));
  second(w, 3);
  got = run(w, BJORN, '/stuck');
  yes('and works again once the 5 minutes are up', moves(w, A_BJORN).length === 2 && /^Sent back/.test(got[0] || ''));
}

// -------------------------------------------------------------- temple --
console.log('\nthe temple instead:');
{
  // Still standing exactly where that /stuck put him, 5 minutes later.
  const put = moves(w, A_BJORN)[1].v;
  second(w, 301);
  let got = run(w, BJORN, '/stuck');
  let m = moves(w, A_BJORN);
  const rif = temple('riften');
  yes('still where the last /stuck put them: that is the stuck place, so the temple',
      m.length === 3 && m[2].v.cellOrWorldDesc === rif.desc && JSON.stringify(m[2].v.pos) === JSON.stringify(rif.pos));
  yes('the nearest one on the map: Riften\'s, next to Riften', !!put && /Temple of Mara in Riften/.test(got[0] || ''));
  yes('the reply says no safe spot was known and that it is logged',
      /^No safe spot near you was known, so you were sent to the Temple of Mara in Riften\./.test(got[0] || '') &&
      /logged for staff/.test(got[0] || ''));
  const row = records(w).pop();
  yes('and the record says the temple', row.result === 'temple' && /was sent to the Temple of Mara in Riften, from /.test(row.why) &&
      row.to.desc === rif.desc);

  // Sera: just arrived, nobody has a trail for her yet.
  delete w.stuck.state.chars['ff000004'];
  w.where[A_SERA] = { desc: TAMRIEL, pos: [-57000, 108000, 0], rot: [0, 0, 0] };
  got = run(w, SERA, '/stuck');
  m = moves(w, A_SERA);
  yes('no trail at all: the nearest temple, Solitude\'s beside Solitude',
      m.length === 1 && m[0].v.cellOrWorldDesc === temple('solitude').desc);
  const sr = records(w).pop();
  yes('somebody with no join pass on hand is recorded as such',
      sr.account === '' && /no join pass on hand\.$/.test(sr.why));
}

{
  const s = w.stuck;
  const TW = 0xff0000aa;
  w.where[TW] = { desc: TAMRIEL, pos: [0, 0, 0], rot: [0, 0, 0] };
  // Solstheim.
  let t = s.nearestTemple(s.mapSpot(TW, { desc: SOLSTHEIM, pos: [30000, 30000, 0] }));
  yes('on Solstheim it is Raven Rock\'s, never a mainland one', t.key === 'ravenrock');
  // Tamriel, by distance to each door.
  t = s.nearestTemple(s.mapSpot(TW, { desc: TAMRIEL, pos: [130000, 40000, 0] }));
  yes('outdoors near Windhelm it is Windhelm\'s', t.key === 'windhelm');
  t = s.nearestTemple(s.mapSpot(TW, { desc: '16d71:Skyrim.esm', pos: [-176000, 4000, 0] }));
  yes('inside a walled city\'s own map it measures in Tamriel\'s coordinates: Markarth\'s', t.key === 'markarth');
  // An interior with a trail point outside: where they went in.
  s.state.chars[(TW >>> 0).toString(16)] = { trail: [{ desc: TAMRIEL, pos: [-58000, 110000, 0], rot: [0, 0, 0], at: 0 }],
                                           hp: 1, anim: '', fightAt: 0, last: null };
  t = s.nearestTemple(s.mapSpot(TW, { desc: 'abcde:Somewhere.esp', pos: [0, 0, 0] }));
  yes('indoors, from the trail point where they went in: Solitude\'s', t.key === 'solitude');
  delete s.state.chars[(TW >>> 0).toString(16)];
  // An interior the hold table knows, and no trail.
  const riftCell = Object.keys(DATA.cellToHold).filter(function (k) { return DATA.cellToHold[k] === 'RiftHoldLocation'; })[0];
  t = s.nearestTemple(s.mapSpot(TW, { desc: riftCell, pos: [0, 0, 0] }));
  yes('indoors with no trail, from the capital of the cell\'s hold: Riften\'s (' + riftCell + ')', t.key === 'riften');
  const solCell = Object.keys(DATA.cellToHold).filter(function (k) { return DATA.cellToHold[k] === 'DLC2SolstheimLocation'; })[0];
  t = s.nearestTemple(s.mapSpot(TW, { desc: solCell, pos: [0, 0, 0] }));
  yes('and a Solstheim interior is Raven Rock\'s (' + solCell + ')', t.key === 'ravenrock');
  t = s.nearestTemple(s.mapSpot(TW, { desc: 'abcde:Somewhere.esp', pos: [0, 0, 0] }));
  yes('nowhere known at all: Whiterun\'s, the death respawn\'s own fallback', t.key === 'whiterun');
}

// ---------------------------------------------------------------- a fall --
console.log('\na fall is not a safe spot:');
{
  const w2 = load();
  standAt(w2, A_BJORN, TAMRIEL, [1000, 1000, 5000]);
  // Walked to the edge, then through the world: every sample lower than the last.
  standAt(w2, A_BJORN, TAMRIEL, [1000, 1500, 5000]);
  standAt(w2, A_BJORN, TAMRIEL, [1000, 1600, 4000]);
  standAt(w2, A_BJORN, TAMRIEL, [1000, 1700, 2500]);
  standAt(w2, A_BJORN, TAMRIEL, [1000, 1800, 1000]);
  const trail = w2.stuck.state.chars['ff000002'].trail;
  yes('the samples taken while falling never became trail points',
      trail.length === 2 && trail.every(function (p) { return p.pos[2] === 5000; }));
  run(w2, BJORN, '/stuck');
  const m = moves(w2, A_BJORN);
  yes('so /stuck puts them back on the ledge, not in the air',
      m.length === 1 && JSON.stringify(m[0].v.pos) === '[1000,1500,5000]');
}

// ---------------------------------------------------------------- fight --
console.log('\nin a fight:');
{
  const w3 = load();
  standAt(w3, A_BJORN, TAMRIEL, [20000, -3000, 0]);
  standAt(w3, A_BJORN, TAMRIEL, [20500, -3000, 0]);
  // Hit: health goes down on the server.
  w3.hp[A_BJORN] = 0.8;
  second(w3, 1);
  let got = run(w3, BJORN, '/stuck');
  yes('hurt in the last 15 seconds: a 15 second wait, said, and nothing moves yet',
      got.length === 1 && /^You have been in a fight in the last 15 seconds, so \/stuck waits 15 seconds first\./.test(got[0]) &&
      /being hit or moving cancels it/.test(got[0]) && /logged for staff/.test(got[0]) && moves(w3, A_BJORN).length === 0);
  got = run(w3, BJORN, '/stuck');
  yes('typing it again says how long is left', got.length === 1 && /already counting down: 15 seconds left/.test(got[0]));

  second(w3, 3);
  w3.hp[A_BJORN] = 0.7;
  let lines = second(w3, 1).filter(function (l) { return l.to === BJORN; });
  yes('hit during the wait: cancelled, with a line',
      lines.length === 1 && /^\/stuck was cancelled because you were hit\./.test(lines[0].text) && /logged for staff/.test(lines[0].text));
  yes('nobody moved, and staff have it', moves(w3, A_BJORN).length === 0 &&
      records(w3).length === 1 && records(w3)[0].result === 'cancelled' && records(w3)[0].because === 'they were hit' &&
      /used \/stuck in a fight and the wait was cancelled because they were hit, at 3c:Skyrim\.esm \(20500, -3000, 0\)\. Nobody was moved\./.test(records(w3)[0].why));

  got = run(w3, BJORN, '/stuck');
  yes('the hit that cancelled it is itself a fight: the next one waits too', /waits 15 seconds first/.test(got[0] || ''));
  second(w3, 2);
  w3.where[A_BJORN].pos = [20700, -3000, 0];
  lines = second(w3, 1).filter(function (l) { return l.to === BJORN; });
  yes('a step during the wait: cancelled, with a line',
      lines.length === 1 && /^\/stuck was cancelled because you moved\./.test(lines[0].text) && /logged for staff/.test(lines[0].text));
  yes('nobody moved, and staff have that too', moves(w3, A_BJORN).length === 0 &&
      records(w3).length === 2 && records(w3)[1].because === 'they moved');

  got = run(w3, BJORN, '/stuck');
  yes('standing still, it waits again', /waits 15 seconds first/.test(got[0] || ''));
  w3.where[A_BJORN].pos = [20730, -3000, 0];   // a shuffle inside the slack
  second(w3, 14);
  yes('not moved at 14 seconds', moves(w3, A_BJORN).length === 0);
  lines = second(w3, 1).filter(function (l) { return l.to === BJORN; });
  const m = moves(w3, A_BJORN);
  yes('and at 15 seconds it completes: back a few steps', m.length === 1 &&
      JSON.stringify(m[0].v.pos) === '[20000,-3000,0]');
  yes('with the same reply and record as out of a fight', lines.length === 1 && /^Sent back/.test(lines[0].text) &&
      /logged for staff/.test(lines[0].text) && records(w3).length === 3 && records(w3)[2].result === 'trail');

  // A swing counts as a fight too, and dying during the wait cancels it.
  const w4 = load();
  standAt(w4, A_SERA, TAMRIEL, [0, 0, 0]);
  w4.anim[A_SERA] = 'attackStart';
  second(w4, 1);
  got = run(w4, SERA, '/stuck');
  yes('swinging in the last 15 seconds counts as a fight', /waits 15 seconds first/.test(got[0] || ''));
  w4.dead[A_SERA] = true;
  lines = second(w4, 1).filter(function (l) { return l.to === SERA; });
  yes('dying during the wait cancels it, with a line',
      lines.length === 1 && /^\/stuck was cancelled because you died\./.test(lines[0].text));
  w4.dead[A_SERA] = false;
  second(w4, 20);
  got = run(w4, SERA, '/stuck');
  yes('15 seconds after the last sign of a fight it works at once again',
      moves(w4, A_SERA).length === 1 && /^No safe spot near you was known/.test(got[0] || ''));
}

// -------------------------------------------------------------- refused --
console.log('\nrefused for other reasons:');
{
  const w5 = load();
  w5.box.__thornswoodStaffState.frozen[SERA] = { desc: TAMRIEL, pos: [0, 0, 0], rot: [0, 0, 0] };
  let got = run(w5, SERA, '/stuck');
  yes('frozen by staff: refused, with a line', got.length === 1 && /^Staff have you frozen in place, so \/stuck cannot move you/.test(got[0]) &&
      moves(w5, A_SERA).length === 0);
  delete w5.box.__thornswoodStaffState.frozen[SERA];
  w5.creating[A_SERA] = true;
  got = run(w5, SERA, '/stuck');
  yes('still making the character: refused, with a line', got.length === 1 && /works once your character is made/.test(got[0]) &&
      moves(w5, A_SERA).length === 0);
  w5.creating[A_SERA] = false;
  yes('none of those were recorded for staff', w5.records.length === 0);
}

done();
