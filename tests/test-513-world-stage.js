'use strict';
/*
  test-513-world-stage.js

  #513, the first slice: the world stage register and the office
  proclamation. What it holds to:
    - Patrick, 17 Oct: the war is tools, never a script. The stages are data:
      the block names no stage, no force and no timer, the first stage in the
      list is the start, and a stage's force is free text handed back as it
      is written.
    - One stage for the whole province, kept in private/war.json and read
      through worldStage(). No file is the start. A file that cannot be read,
      or whose stage the list does not have, is the start too, and the log
      says so once. The file is left as it is, and kept beside the new one
      when a move is made after that.
    - war.json keeps every move, oldest first, with when. Nothing is ever
      taken off it. It names nobody (#2860, #2353): who moved the world is in
      the staff log, and who made the proposal waiting is held in memory
      only, so after a restart nobody is named for it.
    - setWorldStage(id, by) refuses an id the list does not have, the stage
      the world is already at, and a move that does not say who made it, and
      writes nothing when it refuses. What it writes survives a restart.
    - The seam for server proposes, staff confirm: proposeWorldStage keeps
      one proposal and moves nothing, confirmWorldStage makes that move as
      the confirmer's, dropWorldStageProposal clears it, and a direct move
      clears it too.
    - The stage list in the gamemode is game/data/war-stages.json, and today
      that is peace alone.
    - proclaim(holds, office, title, body) puts one notice on each named
      board in an office's name: no fee, no ledger, nothing held, kept with
      the board posts across a restart, and one line to each person within
      400 of one of those boards. An unknown hold refuses the whole call and
      nothing is written.
    - Nothing in play calls either but the staff card on the Office page
      (tests/test-513-world-staff.js), and the block leaves the NPC
      population and the patrol cap (#1390) alone.

  The real world stage block and the real property block of
  game/gamemode.js run here over a pretend engine and a register in a
  temporary folder, the way tests/test-2554-board-posts.js runs the property
  block. Read only apart from its own temporary folder.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const REPO_DIR = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = require('./gamemode-tables.js').joined(read(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js')));
const stagesFile = JSON.parse(read(path.join(REPO_DIR, 'game', 'data', 'war-stages.json')));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, f) {
  try { f(); } catch (e) { yes(what + ' threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e), false); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const worldBlock = slice(gm, '// ==== thornswood world stage ====', '// ==== end thornswood world stage ====');
const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('the world stage block is in the gamemode', !!worldBlock);
yes('the property block is in the gamemode', !!propBlock);
if (!worldBlock || !propBlock) { done(); process.exit(1); }

/* ---------------------------------------------------------- the table and the file */
const tableText = slice(worldBlock, '// ==== WAR_STAGES ====', '// ==== end WAR_STAGES ====') || '';
const tableMatch = /var WAR_STAGES = (\{[^\n]*\});\n/.exec(tableText);
attempt('the table', function () {
  yes('T1 the gamemode carries the stage list', !!tableMatch);
  yes('T2 and it is game/data/war-stages.json, exactly',
      !!tableMatch && JSON.stringify(JSON.parse(tableMatch[1])) === JSON.stringify(stagesFile));
  const ids = (stagesFile.stages || []).map(function (s) { return s.id; });
  yes('T3 peace is a stage, and today it is the only one', ids.length === 1 && ids[0] === 'peace');
  yes('T4 every stage has an id, a name and words',
      (stagesFile.stages || []).every(function (s) { return s && typeof s.id === 'string' && s.id &&
        typeof s.name === 'string' && s.name && typeof s.text === 'string'; }));
  // The patrol file's key rule (#1390): thalmor-patrols.json gives a cap per
  // stage under stageMost and takes a key only when it is /^[a-z0-9-]{1,32}$/.
  const RULE = /^[a-z0-9-]{1,32}$/;
  const bad = (stagesFile.stages || []).filter(function (s) { return !RULE.test(s.id); }).map(function (s) { return s.id; });
  yes('T11 every id in war-stages.json follows the patrol file\'s key rule' + (bad.length ? ' (' + bad.join(', ') + ')' : ''),
      bad.length === 0);
  yes('T12 the block holds ids to that rule, written the same way',
      /var STAGE_ID = \/\^\[a-z0-9-\]\{1,32\}\$\/;/.test(worldBlock));
  // Once the patrol block is in the same file, the two rules must still agree.
  const patrolRule = /stageMost\)\.every\(k=>(\/[^\/]+\/)\.test\(k\)/.exec(gm);
  yes('T13 and when the patrol block is beside it, its stageMost rule is this one' + (patrolRule ? '' : ' (not in this file yet)'),
      !patrolRule || patrolRule[1] === '/^[a-z0-9-]{1,32}$/');
  yes('T5 the block comes after the season block',
      gm.indexOf('// ==== end thornswood season ====') >= 0 &&
      gm.indexOf('// ==== end thornswood season ====') < gm.indexOf('// ==== thornswood world stage ===='));
  const outside = gm.split(worldBlock).join('');
  yes('T6 nothing outside the block calls proclaim or setWorldStage', !/proclaim\s*\(|setWorldStage\s*\(/.test(outside));
  const code = worldBlock.split(tableText).join('').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  yes('T8 no timer moves a stage: the block sets none', !/setInterval|setTimeout/.test(code));
  yes('T9 the block names no stage: no id from the list is written in its code',
      (stagesFile.stages || []).every(function (st) { return code.indexOf("'" + st.id + "'") < 0 && code.indexOf('"' + st.id + '"') < 0; }));
  yes('T10 and no force: nothing in its code reads dominion, remnant, proxy or mixed',
      !/dominion|remnant|proxy|mixed/i.test(code));
  yes('T7 and nothing in it touches the NPC population or the patrol cap (#1390)',
      // Its words may name thalmor-patrols.json, whose key rule the stage ids
      // follow; its code may not touch the patrols.
      !/createNpcPopulation|placeActors|thornswoodNpcCommanded|NPC_POPULATION|patrol/i.test(
        worldBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''")));
});

/* A second stage, only here, so a move can be made and read back. */
const LANDING = { id: 'test-landing', name: 'A test landing', text: 'Only in this test.', force: 'remnant' };
const FREE = { id: 'test-free', name: 'Whatever staff wrote', text: 'Also only here.', force: 'Maormer raiders, paid by nobody who will say so' };
const TEST_STAGES = { version: 1, stages: [stagesFile.stages[0], LANDING, FREE] };
function withStages(list) {
  return tableMatch ? worldBlock.replace(tableMatch[1], JSON.stringify({ version: 1, stages: list })) : worldBlock;
}
const worldTest = withStages(TEST_STAGES.stages);

/* ------------------------------------------------------- the server, running */
const clock = { t: Date.UTC(2026, 9, 17, 22, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
const GOLD = 0x0000000F;
const WORLD = '3c:Skyrim.esm';
const SOLITUDE = 'solitude-world';

const ALICE = { a: 0xff000303, pid: 303, name: 'Alice', cell: WORLD, pos: [400, 0, 0] };      // exactly at reach
const BOB = { a: 0xff000404, pid: 404, name: 'Bob', cell: WORLD, pos: [401, 0, 0] };          // one past it
const CAROL = { a: 0xff000505, pid: 505, name: 'Carol', cell: SOLITUDE, pos: [1000, 1000, 0] }; // at Solitude's board
const DAVE = { a: 0xff000606, pid: 606, name: 'Dave', cell: WORLD, pos: [5000, 0, 0] };       // nowhere near one
const PEOPLE = [ALICE, BOB, CAROL, DAVE];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-513-stage-'));
const priv = path.join(dir, 'private');
const warFile = path.join(priv, 'war.json');
const regFile = path.join(priv, 'property.json');
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(priv);
fs.writeFileSync(path.join(priv, 'law.json'), JSON.stringify({ cells: {}, held: {} }));
function freshRegister() {
  fs.writeFileSync(regFile, JSON.stringify({
    claims: {}, boxes: {},
    // Boards a steward placed, so the seeding leaves them where they are.
    boards: { whiterun: { cell: WORLD, pos: [0, 0, 0], where: 'Whiterun', placed: true },
              solitude: { cell: SOLITUDE, pos: [1000, 1000, 0], where: 'Solitude', placed: true } },
    funds: { whiterun: 55 }, notices: {}
  }));
}
freshRegister();
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

const refs = {};
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: p.cell,
                pos: p.pos.slice(), inventory: { entries: [{ baseId: GOLD, count: 500 }] } };
});
const online = PEOPLE.map(function (p) { return p.a; });
const mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
    if (!refs[id]) { throw new Error('no reference ' + id); }
    const v = refs[id][key];
    return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  },
  set: function (id, key, v) {
    if (!refs[id]) { refs[id] = {}; }
    refs[id][key] = JSON.parse(JSON.stringify(v));
  },
  getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
  lookupEspmRecordById: function () { return null; },
  getNeighborsByPosition: function () { return []; }
};

/* A server start: both blocks, in the file's order, in a fresh context. */
function boot(worldSrc) {
  const logs = [];
  const said = [];
  const pushed = [];
  const box = {
    console: { log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); } },
    require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
    idOf: function (d) { const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(String(d || '')); return m ? parseInt(m[1], 16) : 0; },
    notify: function () { }, say: function (a, m) { said.push([a, m]); },
    guard: function (n, f) { return f; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    __thornswoodCharacter: { stateOf: function () { return { prof: 'cook' }; }, writeState: function () { } },
    __thornswoodOffices: function () { return { jarl: [], court: [], steward: [], guard: [] }; },
    __thornswoodSocial: { push: function (a) { pushed.push(a); } }
  };
  box.globalThis = box;
  inDir(function () {
    vm.runInNewContext(worldSrc, box, { filename: 'gamemode.js world stage' });
    vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' });
  });
  return { box: box, logs: logs, said: said, pushed: pushed,
           S: box.__thornswoodWorldStage, W: box.__thornswoodProperty };
}
function stageLogs(logs) { return logs.filter(function (l) { return /\[thornswood world stage\].*(not readable|does not have|could not read)/.test(l) && !/proposal/.test(l); }); }
function warText() { try { return fs.readFileSync(warFile, 'utf8'); } catch (e) { return null; } }
function gold(p) { return refs[p.a].inventory.entries.reduce(function (s, e) { return s + (e.baseId === GOLD ? e.count : 0); }, 0); }

/* -------------------------------------------------------------- the stage */
function onDisk() { return JSON.parse(warText() || 'null'); }
function call(s, name) { const args = Array.prototype.slice.call(arguments, 2); return inDir(function () { return s.S[name].apply(null, args); }); }

attempt('the stage', function () {
  let s = boot(worldTest);
  yes('S0 the block runs and hands out what it has', !!s.S && ['worldStage', 'worldHistory', 'setWorldStage',
      'proposeWorldStage', 'confirmWorldStage', 'dropWorldStageProposal', 'pendingWorldStage', 'proclaim']
      .every(function (k) { return typeof s.S[k] === 'function'; }));
  let st = call(s, 'worldStage');
  yes('S1 no file is the first stage, at no time, with no force, and it names nobody',
      st.id === 'peace' && st.name === 'Peace' && st.since === 0 && !('by' in st) && st.force === '' &&
      call(s, 'worldHistory').length === 0 && call(s, 'pendingWorldStage') === null);
  yes('S1 and a missing file is not a fault the log reports', stageLogs(s.logs).length === 0);
  yes('S1 and nothing is written just for reading it', warText() === null);
  const other = boot(withStages([LANDING, stagesFile.stages[0]]));
  yes('S1 the start is the list\'s, not the code\'s: put another stage first and the world starts there',
      call(other, 'worldStage').id === 'test-landing' && warText() === null);

  let r = call(s, 'setWorldStage', 'dragons', 'Gavin');
  yes('S2 an id the list does not have is refused: "' + (r && r.why) + '"',
      r && r.ok === false && /no stage called "dragons"/.test(r.why) && warText() === null);
  r = call(s, 'setWorldStage', 42, 'Gavin');
  yes('S2 and so is something that is not an id', r && r.ok === false && warText() === null);
  r = call(s, 'setWorldStage', 'peace', 'Gavin');
  yes('S3 the stage it is already at is refused: "' + (r && r.why) + '"',
      r && r.ok === false && /already at Peace/.test(r.why) && warText() === null);
  r = call(s, 'setWorldStage', 'test-landing', '   ');
  yes('S4 a move that does not say who made it is refused', r && r.ok === false && /who moved/.test(r.why) && warText() === null);
  r = call(s, 'setWorldStage', 'test-landing', 'x'.repeat(81));
  yes('S4 and so is a who past 80 characters', r && r.ok === false && warText() === null);
  ['Test-Landing', 'test_landing', 'test landing', 'a'.repeat(33), ''].forEach(function (bad) {
    const m = call(s, 'setWorldStage', bad, 'Gavin');
    const p = call(s, 'proposeWorldStage', bad, 'Gavin');
    yes('S4b an id that breaks the patrol file\'s key rule is refused by a move and a proposal: ' + JSON.stringify(bad),
        m && m.ok === false && p && p.ok === false &&
        /A stage id is lower case letters, digits and dashes, 1 to 32 of them/.test(m.why) && m.why === p.why &&
        m.why.indexOf(JSON.stringify(bad)) >= 0 && warText() === null && call(s, 'pendingWorldStage') === null);
  });

  const t1 = clock.t;
  r = call(s, 'setWorldStage', 'test-landing', 'Gavin  (a test)');
  let d = onDisk();
  yes('S5 a stage the list has is taken, and written with when, as the first move on record',
      r && r.ok === true && r.stage.id === 'test-landing' && !!d && d.id === 'test-landing' &&
      d.since === t1 && Array.isArray(d.history) && d.history.length === 1 &&
      JSON.stringify(d.history[0]) === JSON.stringify({ id: 'test-landing', at: t1 }));
  yes('S5 and the file names nobody: who moved it is the staff log\'s (#2860)',
      !('by' in d) && warText().indexOf('Gavin') < 0);
  st = call(s, 'worldStage');
  yes('S5 and worldStage() reads it at once, with the force as written', st.id === 'test-landing' && st.force === 'remnant');
  yes('S5 and no half written file is left beside it', !fs.existsSync(warFile + '.tmp'));

  clock.t += 60 * 60 * 1000;
  const t2 = clock.t;
  r = call(s, 'setWorldStage', 'test-free', 'Smeagle');
  st = call(s, 'worldStage');
  yes('S6 any force staff write is handed back as it is: "' + st.force + '"',
      r.ok && st.force === 'Maormer raiders, paid by nobody who will say so');
  clock.t += 60 * 60 * 1000;
  const t3 = clock.t;
  call(s, 'setWorldStage', 'peace', 'Gavin');
  s = boot(worldTest);
  st = call(s, 'worldStage');
  const h = call(s, 'worldHistory');
  yes('S7 after a restart the stage and when are still there', st.id === 'peace' && st.since === t3 &&
      stageLogs(s.logs).length === 0);
  yes('S7 and the history keeps every move, oldest first, a later stage taking none off, naming nobody',
      JSON.stringify(h) === JSON.stringify([{ id: 'test-landing', at: t1 }, { id: 'test-free', at: t2 }, { id: 'peace', at: t3 }]) &&
      ['Gavin', 'Smeagle'].every(function (n) { return warText().indexOf(n) < 0; }));
  h.length = 0;
  yes('S7 and what worldHistory() hands out is a copy', call(s, 'worldHistory').length === 3);
  const before = warText();
  r = call(s, 'setWorldStage', 'peace', 'Somebody else');
  yes('S8 moving to where it already is changes nothing on disk', r.ok === false && warText() === before);

  // The seam: the server proposes, staff confirm.
  r = call(s, 'proposeWorldStage', 'dragons', 'the server');
  yes('S9 a proposal to a stage the list does not have is refused', r.ok === false && warText() === before);
  r = call(s, 'proposeWorldStage', 'peace', 'the server');
  yes('S9 and so is one to where the world already is', r.ok === false && warText() === before);
  r = call(s, 'proposeWorldStage', 'test-landing', '');
  yes('S9 and one that does not say who proposes it: "' + r.why + '"', r.ok === false && /who proposes it/.test(r.why) && warText() === before);
  clock.t += 1000;
  const tp = clock.t;
  r = call(s, 'proposeWorldStage', 'test-landing', 'the server');
  yes('S10 a proposal is kept and moves nothing', r.ok === true && call(s, 'worldStage').id === 'peace' &&
      JSON.stringify(call(s, 'pendingWorldStage')) === JSON.stringify({ id: 'test-landing', at: tp, by: 'the server' }) &&
      onDisk().history.length === 3 && onDisk().pending.id === 'test-landing');
  yes('S10 and the file keeps its stage and when, never who proposed it',
      JSON.stringify(onDisk().pending) === JSON.stringify({ id: 'test-landing', at: tp }) && warText().indexOf('the server') < 0);
  s = boot(worldTest);
  yes('S10 and it is still there after a restart, with nobody named for it',
      JSON.stringify(call(s, 'pendingWorldStage')) === JSON.stringify({ id: 'test-landing', at: tp, by: '' }));
  r = call(s, 'proposeWorldStage', 'test-free', 'the server');
  yes('S11 a later proposal replaces it', r.ok && call(s, 'pendingWorldStage').id === 'test-free');
  r = call(s, 'confirmWorldStage', ' ');
  yes('S12 a yes that does not say who gives it is refused', r.ok === false && call(s, 'worldStage').id === 'peace' &&
      call(s, 'pendingWorldStage').id === 'test-free');
  clock.t += 1000;
  const tc = clock.t;
  r = call(s, 'confirmWorldStage', 'Gavin');
  const last = call(s, 'worldHistory').slice(-1)[0];
  yes('S12 a yes makes the move and clears it, handing back who proposed it for the staff log, and the file names neither',
      r.ok === true && r.proposedBy === 'the server' && call(s, 'worldStage').id === 'test-free' &&
      JSON.stringify(last) === JSON.stringify({ id: 'test-free', at: tc }) &&
      call(s, 'pendingWorldStage') === null && onDisk().pending === null &&
      warText().indexOf('Gavin') < 0 && warText().indexOf('the server') < 0);
  r = call(s, 'confirmWorldStage', 'Gavin');
  yes('S13 a second yes has nothing to confirm', r.ok === false && /Nothing is proposed/.test(r.why));
  call(s, 'proposeWorldStage', 'peace', 'the server');
  const hist0 = JSON.stringify(call(s, 'worldHistory'));
  r = call(s, 'dropWorldStageProposal', 'Gavin');
  yes('S14 a proposal dropped moves nothing and leaves the history alone',
      r.ok === true && r.proposedBy === 'the server' && call(s, 'pendingWorldStage') === null && call(s, 'worldStage').id === 'test-free' &&
      JSON.stringify(call(s, 'worldHistory')) === hist0 && onDisk().pending === null);
  yes('S14 and dropping nothing is refused', call(s, 'dropWorldStageProposal', 'Gavin').ok === false);
  call(s, 'proposeWorldStage', 'test-landing', 'the server');
  r = call(s, 'setWorldStage', 'peace', 'Gavin');
  yes('S15 a direct move clears a proposal it overtook', r.ok && call(s, 'pendingWorldStage') === null && onDisk().pending === null);
  call(s, 'proposeWorldStage', 'test-landing', 'the server');
  s = boot(worldTest);
  clock.t += 1000;
  r = call(s, 'confirmWorldStage', 'Gavin');
  yes('S15b a proposal made before a restart is confirmed with nobody named for it',
      r.ok === true && r.proposedBy === '' && call(s, 'worldStage').id === 'test-landing' &&
      JSON.stringify(call(s, 'worldHistory').slice(-1)[0]) === JSON.stringify({ id: 'test-landing', at: clock.t }));
  call(s, 'setWorldStage', 'peace', 'Gavin');

  // Files the list cannot account for.
  const kept = warText();
  // Put the world, in the file, at a stage the real list does not have.
  fs.writeFileSync(warFile, JSON.stringify(Object.assign(JSON.parse(kept), { id: 'test-landing',
    history: JSON.parse(kept).history.concat([{ id: 'test-landing', at: 1 }]) })));
  const lostText = warText();
  s = boot(worldBlock);
  st = call(s, 'worldStage');
  yes('S16 the real list reads a stage it does not have as the start, and says so once',
      st.id === 'peace' && stageLogs(s.logs).length === 1 && warText() === lostText);
  r = call(s, 'setWorldStage', 'peace', 'Gavin');
  yes('S16 the start may then be set, and every move on record is kept with it',
      r.ok === true && onDisk().history.length === JSON.parse(lostText).history.length + 1 &&
      onDisk().history.slice(-2)[0].id === 'test-landing');

  fs.writeFileSync(warFile, JSON.stringify({ history: [{ id: 'peace', at: 1 }], pending: { id: 'dragons', at: 2 } }));
  s = boot(worldTest);
  yes('S17 a proposal naming a stage the list does not have is not kept', call(s, 'pendingWorldStage') === null &&
      call(s, 'worldStage').id === 'peace');

  fs.writeFileSync(warFile, '{not json');
  s = boot(worldTest);
  call(s, 'worldStage'); call(s, 'worldStage'); call(s, 'worldStage');
  st = call(s, 'worldStage');
  yes('S18 a file that cannot be read is the start, and the log says so once however often it is asked',
      st.id === 'peace' && stageLogs(s.logs).length === 1);
  yes('S18 and the file is left as it was', warText() === '{not json');
  clock.t += 1000;
  r = call(s, 'setWorldStage', 'test-landing', 'Gavin');
  const aside = path.join(priv, 'war.json.unreadable-' + clock.t);
  yes('S19 a move after that keeps the unreadable file beside the new one',
      r.ok === true && fs.existsSync(aside) && fs.readFileSync(aside, 'utf8') === '{not json' &&
      onDisk().history.length === 1);
  fs.unlinkSync(aside);

  fs.writeFileSync(warFile, JSON.stringify({ history: [{ id: 'dragons', at: 5 }] }));
  s = boot(worldTest);
  st = call(s, 'worldStage');
  yes('S20 a file naming a stage the list does not have is the start, said once', st.id === 'peace' && st.since === 0 &&
      stageLogs(s.logs).length === 1 && /dragons/.test(stageLogs(s.logs)[0]));

  fs.writeFileSync(warFile, '\uFEFF' + JSON.stringify({ history: [{ id: 'test-landing', at: 7 }] }));
  s = boot(worldTest);
  yes('S21 a file a Windows editor saved with a byte order mark still reads',
      call(s, 'worldStage').id === 'test-landing' && stageLogs(s.logs).length === 0);
  fs.unlinkSync(warFile);
});

/* --------------------------------------------------------- the proclamation */
attempt('the proclamation', function () {
  freshRegister();
  let s = boot(worldTest);
  const W = s.W;
  yes('P0 the property block hands the hook out', !!W && typeof W.officePost === 'function');
  const gold0 = PEOPLE.map(gold);
  const funds0 = JSON.stringify(W.funds());
  const held0 = W.heldOn('whiterun', null);

  let r = inDir(function () { return s.S.proclaim(['whiterun'], 'The Crown', 'The roads are watched', 'By order of the Crown, the roads are watched.'); });
  const list = W.notices().whiterun || [];
  const n = list[list.length - 1];
  yes('P1 one notice goes up on the board named', r && r.ok === true && r.holds.join() === 'whiterun' && list.length === 1);
  yes('P1 in the office\'s name, put up by nobody', !!n && n.name === 'The Crown' && n.by === 0 && n.office === true &&
      n.title === 'The roads are watched' && n.text === 'By order of the Crown, the roads are watched.' &&
      n.job === false && n.at === clock.t);
  yes('P2 no fee: nobody\'s gold moved', JSON.stringify(PEOPLE.map(gold)) === JSON.stringify(gold0));
  yes('P2 no ledger entry: the funds are as they were', JSON.stringify(W.funds()) === funds0);
  yes('P2 and nothing is held for it', W.heldOn('whiterun', null) === held0 && held0 === 0);
  yes('P2 and Solitude\'s board is untouched', !(W.notices().solitude || []).length);

  const toAlice = s.said.filter(function (x) { return x[0] === ALICE.a; });
  yes('P3 the person at 400 is told exactly once: "' + (toAlice[0] && toAlice[0][1]) + '"',
      toAlice.length === 1 && toAlice[0][1] === 'A notice from The Crown is up on the board: The roads are watched.');
  yes('P3 the person at 401 is not', !s.said.some(function (x) { return x[0] === BOB.a; }));
  yes('P3 nor anybody far off or at another hold\'s board',
      !s.said.some(function (x) { return x[0] === DAVE.a || x[0] === CAROL.a; }) && r.told === 1);
  yes('P3 and the open panel of the one told is pushed', s.pushed.length === 1 && s.pushed[0] === ALICE.a);

  const wall = inDir(function () { return W.boardPanel(ALICE.a, ALICE.pid); });
  const row = wall && wall.wall && wall.wall[0];
  yes('P4 it is on the wall like any notice, under the office, and nobody\'s own',
      !!row && row.title === 'The roads are watched' && row.name === 'The Crown' && row.mine === false && row.job === false);

  const by = {};
  inDir(function () { W.command('/unpin', ['/unpin', '1'], ALICE.a, ALICE.pid, function (pid, m) { (by[pid] = by[pid] || []).push(m); }); });
  yes('P5 a person cannot take it down as theirs: "' + (by[ALICE.pid] || []).join(' ') + '"', !W.notices().whiterun[0].down);

  const disk = JSON.parse(fs.readFileSync(regFile, 'utf8'));
  yes('P6 it is in the register on disk', ((disk.notices || {}).whiterun || []).length === 1 &&
      disk.notices.whiterun[0].name === 'The Crown' && disk.funds.whiterun === 55);
  s = boot(worldTest);
  yes('P6 and still there after a restart', (s.W.notices().whiterun || []).length === 1 &&
      s.W.notices().whiterun[0].title === 'The roads are watched');

  // Refusals: nothing written, nobody told.
  const reg0 = fs.readFileSync(regFile, 'utf8');
  function refused(label, args, re) {
    s.said.length = 0;
    const out = inDir(function () { return s.S.proclaim.apply(null, args); });
    yes(label + ': "' + (out && out.why) + '"', out && out.ok === false && re.test(out.why) &&
        fs.readFileSync(regFile, 'utf8') === reg0 && s.W.notices().whiterun.length === 1 &&
        !(s.W.notices().solitude || []).length && s.said.length === 0);
  }
  refused('P7 an unknown hold refuses the whole call, the known one too', [['whiterun', 'nowhere'], 'The Crown', 'A title', 'A body.'], /No board in nowhere/);
  refused('P7 a hold of the ten with no board is refused the same', [['falkreath'], 'The Crown', 'A title', 'A body.'], /No board in falkreath/);
  refused('P7 and no hold at all', [[], 'The Crown', 'A title', 'A body.'], /Name a hold/);
  refused('P8 a 61 character title is refused', [['whiterun'], 'The Crown', 'T'.repeat(61), 'A body.'], /up to 60 characters\. That one is 61/);
  refused('P8 a 601 character body is refused', [['whiterun'], 'The Crown', 'A title', 'x'.repeat(601)], /up to 600 characters\. That is 601/);
  refused('P8 an empty title is refused', [['whiterun'], 'The Crown', '  ', 'A body.'], /Give the notice a title/);
  refused('P8 an empty body is refused', [['whiterun'], 'The Crown', 'A title', ''], /Say what the notice says/);
  refused('P8 and no office is refused', [['whiterun'], '', 'A title', 'A body.'], /Name the office/);

  // At the limits, to every board, and a hold named twice.
  s.said.length = 0;
  r = inDir(function () { return s.S.proclaim('all', 'Jarl of Haafingar', 'T'.repeat(60), 'y'.repeat(600)); });
  yes('P9 \'all\' puts one up on every board, at the limits exactly',
      r && r.ok === true && r.holds.slice().sort().join() === Object.keys(s.W.boards()).filter(function (h) {
        return s.W.LEDGER_HOLDS.indexOf(h) >= 0; }).sort().join() &&
      s.W.notices().whiterun.length === 2 && (s.W.notices().solitude || []).length === 1);
  yes('P9 and each person at a board is told once, at their own board',
      s.said.filter(function (x) { return x[0] === ALICE.a; }).length === 1 &&
      s.said.filter(function (x) { return x[0] === CAROL.a; }).length === 1 && s.said.length === 2 && r.told === 2);
  r = inDir(function () { return s.S.proclaim(['Whiterun', 'whiterun'], 'The Crown', 'Twice?', 'Once.'); });
  yes('P10 a hold named twice, in any case, gets one notice', r.ok === true && r.holds.join() === 'whiterun' &&
      s.W.notices().whiterun.length === 3);
  yes('P10 and a title that ends a sentence is not given a second stop',
      s.said[s.said.length - 1][1] === 'A notice from The Crown is up on the board: Twice?');
  yes('P11 after all of it, still no fee and no ledger change',
      JSON.stringify(PEOPLE.map(gold)) === JSON.stringify(gold0) && JSON.stringify(s.W.funds()) === funds0);
});

/* A list with ids the patrol file could never key (#1390's rule). */
attempt('the id rule', function () {
  const LONGEST = { id: 'a'.repeat(32), name: 'The longest id', text: 'Thirty two characters.' };
  const s = boot(withStages([stagesFile.stages[0], LONGEST,
    { id: 'Upper', name: 'Upper', text: 'x' }, { id: 'b'.repeat(33), name: 'Too long', text: 'x' },
    { id: 'has space', name: 'Spaced', text: 'x' }, { id: 7, name: 'A number', text: 'x' }]));
  const left = s.logs.filter(function (l) { return /war-stages\.json has a stage left out of the list: A stage id is/.test(l); });
  yes('I1 each stage whose id breaks the rule is left out, and the log says so once each (' + left.length + ')',
      left.length === 4 && /"Upper"/.test(left[0]) && /"has space"/.test(left[2]) && /"7"/.test(left[3]));
  const ids = call(s, 'stages').map(function (r) { return r.id; });
  yes('I2 the list is what is left, in order', ids.join() === ['peace', LONGEST.id].join());
  let r = call(s, 'setWorldStage', 'Upper', 'Gavin');
  yes('I3 a move to one of them is refused with the rule', r.ok === false && /1 to 32 of them/.test(r.why));
  r = call(s, 'proposeWorldStage', 'b'.repeat(33), 'Gavin');
  yes('I3 and so is a proposal', r.ok === false && /1 to 32 of them/.test(r.why));
  r = call(s, 'setWorldStage', LONGEST.id, 'Gavin');
  yes('I4 an id of exactly 32 is a stage the world can reach', r.ok === true && call(s, 'worldStage').id === LONGEST.id);
  const plain = boot(worldTest);
  yes('I5 a list that keeps the rule leaves nothing out and logs nothing about it',
      !plain.logs.some(function (l) { return /left out of the list/.test(l); }));
});

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
done();
