'use strict';
/*
  test-513-world-staff.js

  #513, the second slice: server proposes, staff confirm, on the Office
  page of K (Patrick, 17 Oct: no slash commands, tools only, nothing
  scripted, staff confirm). What it holds to:
    - Staff, and only staff, get the world's card on the Office page: where
      the world is with its force and since when, and the proposal waiting,
      with its stage, when, and who proposed it while the server remembers.
    - war.json names nobody (#2860, #2353): who moved, proposed, confirmed
      or dropped is in the staff log. Who proposed the one waiting is held in
      memory, so after a restart the card and the log say only that it was
      proposed before the last restart.
    - The server checks staff again on every line the card sends, the way
      the #2551 staff buttons do (settleAs): who is staff, the staff block's
      proof, and the staff log loaded. Somebody who is not staff, or staff
      unproven, changes nothing, and nothing is logged as staff's.
    - Propose moves nothing. Confirm asks twice on the page, and names the
      proposal it confirms, so a press drawn before a newer proposal is
      refused. Drop clears it and moves nothing.
    - Every press is in the staff log through the staff block's record, with
      a sentence for each in the bot.
    - A stage's optional proclamation goes up when a confirm moves the world
      to it. Peace has none, a stage without one puts nothing up, and a
      notice refused leaves the move standing and says why.
    - /world is a word the server answers and the page sends, never one
      anybody is told to type.

  The real world stage block and the real property block run here over a
  pretend engine in a temporary folder, as in test-513-world-stage.js, and
  the real K panel runs in a stand-in document, as in test-1638-office.js.
  Read only apart from its own temporary folder.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const REPO_DIR = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = require('./gamemode-tables.js').joined(read(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js')));
const ui = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-skills.js'));
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
function noComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1'); }

const worldBlock = slice(gm, '// ==== thornswood world stage ====', '// ==== end thornswood world stage ====');
const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('the world stage block is in the gamemode', !!worldBlock);
yes('the property block is in the gamemode', !!propBlock);
if (!worldBlock || !propBlock) { done(); process.exit(1); }
const tableText = slice(worldBlock, '// ==== WAR_STAGES ====', '// ==== end WAR_STAGES ====') || '';
const tableMatch = /var WAR_STAGES = (\{[^\n]*\});\n/.exec(tableText);

/* ------------------------------------------------------------- the data */
attempt('the data', function () {
  yes('D1 the gamemode\'s stage list is still game/data/war-stages.json, exactly',
      !!tableMatch && JSON.stringify(JSON.parse(tableMatch[1])) === JSON.stringify(stagesFile));
  yes('D2 every stage id is one word the card can send (letters, digits and dashes)',
      (stagesFile.stages || []).every(function (s) { return /^[a-z0-9-]+$/.test(s.id); }));
  yes('D3 peace has no proclamation', !stagesFile.stages[0].proclamation);
  yes('D4 any proclamation in the list has an office, holds, a title and a body that fit a board',
      (stagesFile.stages || []).every(function (s) {
        const p = s.proclamation;
        if (p === undefined) { return true; }
        return p && typeof p.office === 'string' && p.office && p.office.length <= 60 &&
          (p.holds === 'all' || (Array.isArray(p.holds) && p.holds.length > 0)) &&
          typeof p.title === 'string' && p.title && p.title.length <= 60 &&
          typeof p.body === 'string' && p.body && p.body.length <= 600;
      }));
});

/* ---------------------------------------------------------- the wiring */
attempt('the wiring', function () {
  const wordsM = /const WORDS = \[([\s\S]*?)\];/.exec(gm);
  const playerM = /PLAYER_WORDS = \[([\s\S]*?)\]/.exec(gm);
  yes('R1 /world is a word the server answers', !!wordsM && /'\/world'/.test(noComments(wordsM[1])));
  yes('R1 and not one anybody is told to type', !!playerM && !/'\/world'/.test(playerM[1]));
  yes('R2 the character block hands it to the property block', /word === '\/haul' \|\| word === '\/world' \|\|/.test(gm));
  yes('R2 and the property block hands it to the world stage block',
      /if \(word === '\/world'\) \{[\s\S]{0,200}worldStage\.command\(parts, actorId, profileId, toProfile, cmd\)/.test(propBlock));
  const cmdSrc = slice(worldBlock, '  function command(parts, actorId, profileId, toProfile, cmd) {', '\n  }\n') || '';
  const strings = (cmdSrc.match(/'(?:[^'\\]|\\.)*'/g) || []).join(' ');
  yes('R3 no answer the card gets names a line to type', !!cmdSrc && !/\/world/.test(strings) && /Office page of K/.test(strings));
  yes('R4 it asks the staff block for proof and writes the staff log, like the #2551 buttons',
      /log\.unproven\(cmd, pid\)/.test(cmdSrc) && /__thornswoodIsStaff/.test(worldBlock) &&
      ['worldpropose', 'worldconfirm', 'worlddrop'].every(function (d) { return cmdSrc.indexOf("log.record('" + d + "'") >= 0; }));
  const code = noComments(worldBlock.split(tableText).join(''));
  yes('R5 still no timer and still no stage named in the code', !/setInterval|setTimeout/.test(code) &&
      (stagesFile.stages || []).every(function (st) { return code.indexOf("'" + st.id + "'") < 0; }));
  yes('R6 the Office page carries the card only through staffView, for staff',
      /view\.world = \(staff && worldStageApi && worldStageApi\.staffView\) \? worldStageApi\.staffView\(pid\) : null;/.test(propBlock));
});

/* ------------------------------------------------------ the server, running */
const LANDING = { id: 'test-landing', name: 'A test landing', text: 'Only in this test.', force: 'remnant',
  proclamation: { office: 'The Crown', holds: ['whiterun'], title: 'Ships on the coast',
                  body: 'By order of the Crown: ships are seen off the coast.' } };
const QUIET = { id: 'test-quiet', name: 'A quiet stage', text: 'No notice.' };
const BADNOTE = { id: 'test-badnote', name: 'A stage whose notice is wrong', text: 'Its hold has no board.',
  force: 'Maormer raiders, paid by nobody who will say so',
  proclamation: { office: 'The Crown', holds: ['nowhere'], title: 'Lost', body: 'Nowhere.' } };
const TEST_LIST = [stagesFile.stages[0], LANDING, QUIET, BADNOTE];
const worldTest = tableMatch ? worldBlock.replace(tableMatch[1], JSON.stringify({ version: 1, stages: TEST_LIST })) : worldBlock;

const clock = { t: Date.UTC(2026, 9, 17, 22, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
const WORLD = '3c:Skyrim.esm';
const ALICE = { a: 0xff000303, pid: 303, name: 'Aela', cell: WORLD, pos: [100, 0, 0] };   // staff, at Whiterun's board
const BOB = { a: 0xff000404, pid: 404, name: 'Bjorn', cell: WORLD, pos: [200, 0, 0] };    // staff
const CAROL = { a: 0xff000505, pid: 505, name: 'Carol', cell: WORLD, pos: [300, 0, 0] };  // nobody's staff
const PEOPLE = [ALICE, BOB, CAROL];
const STAFF = { 303: true, 404: true };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-513-staff-'));
const priv = path.join(dir, 'private');
const warFile = path.join(priv, 'war.json');
const regFile = path.join(priv, 'property.json');
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(priv);
fs.writeFileSync(path.join(priv, 'law.json'), JSON.stringify({ cells: {}, held: {} }));
fs.writeFileSync(regFile, JSON.stringify({
  claims: {}, boxes: {},
  boards: { whiterun: { cell: WORLD, pos: [0, 0, 0], where: 'Whiterun', placed: true } },
  funds: {}, notices: {}
}));
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}
const refs = {};
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: p.cell, pos: p.pos.slice(), inventory: { entries: [] } };
});
const mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (id === 0 && key === 'onlinePlayers') { return PEOPLE.map(function (p) { return p.a; }); }
    if (!refs[id]) { throw new Error('no reference ' + id); }
    const v = refs[id][key];
    return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  },
  set: function (id, key, v) { if (!refs[id]) { refs[id] = {}; } refs[id][key] = JSON.parse(JSON.stringify(v)); },
  getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
  lookupEspmRecordById: function () { return null; },
  getNeighborsByPosition: function () { return []; }
};

const records = [];
const redrawn = [];
const staffLog = {
  // The staff block's proof, as it is: the line must be proven.
  unproven: function (cmd) { return cmd && cmd.proven === true ? '' : 'Staff presses need a proven connection.'; },
  record: function () { records.push(Array.prototype.slice.call(arguments)); }
};
function boot(withLog) {
  const logs = [];
  const box = {
    console: { log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); } },
    require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
    idOf: function () { return 0; },
    notify: function () { }, say: function () { },
    guard: function (n, f) { return f; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    __thornswoodCharacter: { stateOf: function () { return { prof: 'cook' }; }, writeState: function (a) { redrawn.push(a); } },
    __thornswoodOffices: function () { return { jarl: [], court: [], steward: [], guard: [] }; },
    __thornswoodSocial: { push: function () { } },
    __thornswoodIsStaff: function (pid) { return !!STAFF[pid]; }
  };
  if (withLog) { box.__thornswoodStaff = staffLog; }
  box.globalThis = box;
  inDir(function () {
    vm.runInNewContext(worldTest, box, { filename: 'gamemode.js world stage' });
    vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' });
  });
  return { box: box, logs: logs, S: box.__thornswoodWorldStage, W: box.__thornswoodProperty };
}
const PROVEN = { proven: true };
let told = [];
function press(s, who, line, cmd) {
  told = [];
  const parts = line.split(' ');
  return inDir(function () {
    return s.W.command(parts[0], parts, who.a, who.pid, function (pid, m) { told.push([pid, m]); }, cmd === undefined ? PROVEN : cmd);
  });
}
function warText() { try { return fs.readFileSync(warFile, 'utf8'); } catch (e) { return null; } }
function stage(s) { return inDir(function () { return s.S.worldStage(); }); }
function pending(s) { return inDir(function () { return s.S.pendingWorldStage(); }); }
function view(s, who) { return inDir(function () { return s.W.officeView(who.a, who.pid); }); }
function said() { return told.map(function (t) { return t[1]; }).join(' | '); }
function notices(s) { return (s.W.notices().whiterun || []).length; }
let cardView = null;

attempt('the server', function () {
  let s = boot(true);
  yes('W0 the block hands out the card\'s two halves', typeof s.S.staffView === 'function' && typeof s.S.command === 'function');

  // Who sees the card.
  yes('W1 somebody who is not staff and holds no office has no Office page at all', view(s, CAROL) === null);
  yes('W1 and the block gives them no card', inDir(function () { return s.S.staffView(CAROL.pid); }) === null);
  const v = view(s, ALICE);
  yes('W2 staff get the card on the Office page: where the world is and nothing waiting',
      !!v && !!v.world && v.world.stage.id === 'peace' && v.world.stage.name === 'Peace' && v.world.stage.force === '' &&
      v.world.pending === null);
  yes('W2 with every stage in the list, and the office of a stage\'s notice',
      v.world.stages.map(function (x) { return x.id; }).join() === TEST_LIST.map(function (x) { return x.id; }).join() &&
      v.world.stages[1].notice === 'The Crown' && v.world.stages[1].force === 'remnant' && !v.world.stages[2].notice);

  // The server checks staff on every line, whatever the page drew.
  let r = press(s, CAROL, '/world propose test-landing');
  yes('W3 a line from somebody who is not staff is refused: "' + said() + '"',
      r === true && /staff's\. Nothing changed/.test(said()) && pending(s) === null && warText() === null && records.length === 0);
  r = press(s, ALICE, '/world propose test-landing', { proven: false });
  yes('W4 staff on a line that is not proven are refused, with the staff block\'s words',
      /proven connection/.test(said()) && pending(s) === null && warText() === null && records.length === 0);
  const noLog = boot(false);
  press(noLog, ALICE, '/world propose test-landing');
  yes('W4 and no press is taken when the staff log is not loaded', /staff log is not loaded/.test(said()) &&
      pending(noLog) === null && warText() === null && records.length === 0);
  press(s, ALICE, '/world propose dragons');
  yes('W5 a stage the list does not have is refused and not logged: "' + said() + '"',
      /dragons/.test(said()) && pending(s) === null && records.length === 0);
  ['Test-Landing', 'a'.repeat(33), 'test_landing'].forEach(function (bad) {
    press(s, ALICE, '/world propose ' + bad);
    yes('W5b a proposal from the card whose id breaks the patrol file\'s key rule is refused, in words staff can act on: "' + said() + '"',
        /^A stage id is lower case letters, digits and dashes, 1 to 32 of them, the rule thalmor-patrols\.json keys its stages by, and /.test(said()) &&
        said().indexOf(JSON.stringify(bad)) >= 0 && /Nothing changed\.$/.test(said()) &&
        pending(s) === null && warText() === null && records.length === 0);
  });
  press(s, ALICE, '/world propose peace');
  yes('W5 and so is the stage the world is already at', /already at Peace/.test(said()) && pending(s) === null && records.length === 0);

  // Propose.
  redrawn.length = 0;
  const t0 = clock.t;
  press(s, ALICE, '/world propose test-landing');
  const p = pending(s);
  yes('W6 a proposal moves nothing and waits: "' + said() + '"',
      !!p && p.id === 'test-landing' && p.by === 'Aela (profile 303)' && p.at === t0 && stage(s).id === 'peace' &&
      /You propose moving the world to A test landing/.test(said()));
  const rec = records[records.length - 1];
  yes('W6 and it is in the staff log: who, the stage and where from',
      records.length === 1 && rec[0] === 'worldpropose' && rec[1] === 303 && rec[2] === 'Aela' && rec[3] === 0 &&
      rec[4] === 'A test landing' && /from peace to test-landing, force: remnant/.test(rec[5]) &&
      rec[7].stage === 'test-landing' && rec[7].from === 'peace' && rec[7].force === 'remnant');
  yes('W6 and every staff member\'s panel is drawn again, nobody else\'s',
      redrawn.length === 2 && redrawn.indexOf(ALICE.a) >= 0 && redrawn.indexOf(BOB.a) >= 0 && redrawn.indexOf(CAROL.a) < 0);
  cardView = view(s, BOB);
  yes('W7 the card shows what is proposed, by whom and when, to every staff member',
      !!cardView.world.pending && cardView.world.pending.id === 'test-landing' && cardView.world.pending.name === 'A test landing' &&
      cardView.world.pending.by === 'Aela (profile 303)' && cardView.world.pending.at === t0 &&
      cardView.world.pending.force === 'remnant' && cardView.world.pending.notice === 'The Crown');

  // Confirm: only the proposal waiting, only by staff.
  clock.t += 60000;
  press(s, CAROL, '/world confirm test-landing ' + t0);
  yes('W8 somebody who is not staff cannot confirm, even with the right proposal', /staff's/.test(said()) &&
      stage(s).id === 'peace' && !!pending(s) && records.length === 1);
  press(s, BOB, '/world confirm test-landing ' + (t0 - 1));
  yes('W9 a confirm drawn for another proposal is refused: "' + said() + '"',
      /not the proposal waiting now/.test(said()) && stage(s).id === 'peace' && !!pending(s) && records.length === 1);
  press(s, BOB, '/world confirm test-quiet ' + t0);
  yes('W9 and so is one naming another stage', /not the proposal waiting now/.test(said()) && stage(s).id === 'peace');
  delete STAFF[404];
  press(s, BOB, '/world confirm test-landing ' + t0);
  yes('W10 staff taken off since the page was drawn cannot confirm', /staff's/.test(said()) && stage(s).id === 'peace');
  STAFF[404] = true;
  const n0 = notices(s);
  press(s, BOB, '/world confirm test-landing ' + t0);
  const st = stage(s);
  yes('W11 the confirm moves the world: "' + said() + '"',
      st.id === 'test-landing' && st.force === 'remnant' && st.since === clock.t && pending(s) === null &&
      JSON.stringify(JSON.parse(warText()).history.slice(-1)[0]) === JSON.stringify({ id: 'test-landing', at: clock.t }));
  yes('W11 and war.json names neither who confirmed nor who proposed, by name or profile',
      ['Aela', 'Bjorn', '303', '404', 'profile'].every(function (w) { return warText().indexOf(w) < 0; }));
  const crec = records[records.length - 1];
  yes('W11 and it is in the staff log with the notice it put up',
      records.length === 2 && crec[0] === 'worldconfirm' && crec[1] === 404 && crec[4] === 'A test landing' &&
      /proposed by Aela \(profile 303\)/.test(crec[5]) && /notice is up in whiterun/.test(crec[5]) &&
      crec[7].proposedBy === 'Aela (profile 303)' && JSON.stringify(crec[7].notice) === '["whiterun"]');
  const list = s.W.notices().whiterun || [];
  const n = list[list.length - 1];
  yes('W12 the stage\'s proclamation goes up on the board it names, in the office\'s name',
      notices(s) === n0 + 1 && n.name === 'The Crown' && n.by === 0 && n.title === 'Ships on the coast' &&
      /Its notice is up on the board in 1 hold\./.test(said()));
  press(s, BOB, '/world confirm test-landing ' + t0);
  yes('W13 a second confirm has nothing to confirm', /Nothing is proposed/.test(said()) && records.length === 2);

  // Drop.
  press(s, ALICE, '/world propose test-quiet');
  const pq = pending(s);
  press(s, BOB, '/world drop ' + (pq.at + 5));
  yes('W14 a drop drawn for another proposal is refused', /not the proposal waiting now/.test(said()) && !!pending(s));
  press(s, CAROL, '/world drop ' + pq.at);
  yes('W14 and somebody who is not staff cannot drop it', /staff's/.test(said()) && !!pending(s));
  const hist = JSON.stringify(JSON.parse(warText()).history);
  press(s, BOB, '/world drop ' + pq.at);
  const drec = records[records.length - 1];
  yes('W15 a drop clears it and moves nothing: "' + said() + '"',
      pending(s) === null && stage(s).id === 'test-landing' && JSON.stringify(JSON.parse(warText()).history) === hist &&
      /You drop the proposal to move the world to A quiet stage/.test(said()));
  yes('W15 and it is in the staff log', drec[0] === 'worlddrop' && drec[1] === 404 && drec[4] === 'A quiet stage' &&
      /proposed by Aela \(profile 303\)/.test(drec[5]) && records.length === 4);

  // A stage with no notice, and one whose notice is refused.
  press(s, ALICE, '/world propose test-quiet');
  const n1 = notices(s);
  press(s, ALICE, '/world confirm test-quiet ' + pending(s).at);
  const qrec = records[records.length - 1];
  yes('W16 a stage with no proclamation puts nothing up', stage(s).id === 'test-quiet' && notices(s) === n1 &&
      !/notice/.test(said()) && qrec[0] === 'worldconfirm' && qrec[7].notice === null);
  press(s, ALICE, '/world propose test-badnote');
  press(s, BOB, '/world confirm test-badnote ' + pending(s).at);
  const brec = records[records.length - 1];
  yes('W17 a notice that is refused leaves the move standing, and says why: "' + said() + '"',
      stage(s).id === 'test-badnote' && notices(s) === n1 && /Its notice did not go up: .*nowhere/.test(said()) &&
      /its notice was refused/.test(brec[5]) && brec[7].notice === false &&
      brec[7].force === 'Maormer raiders, paid by nobody who will say so');
  press(s, ALICE, '/world propose test-landing');
  press(s, BOB, '/world propose peace');
  const rrec = records[records.length - 1];
  yes('W18 a new proposal takes the place of the one waiting, and the log says which',
      pending(s).id === 'peace' && /in place of the proposal to test-landing/.test(rrec[5]));
  press(s, ALICE, '/world');
  yes('W19 a line with nothing after it says where to go, not what to type', /Office page of K/.test(said()) && !/\/world/.test(said()));

  // It all survives a restart, but who proposed: the file never had it.
  s = boot(true);
  yes('W20 after a restart the world and the proposal are where they were',
      stage(s).id === 'test-badnote' && pending(s).id === 'peace');
  const pw = pending(s);
  yes('W21 the proposal waiting is on disk with its stage and when only',
      JSON.stringify(JSON.parse(warText()).pending) === JSON.stringify({ id: 'peace', at: pw.at }) &&
      ['Aela', 'Bjorn', '303', '404', 'profile'].every(function (w) { return warText().indexOf(w) < 0; }));
  const rv = view(s, ALICE);
  yes('W21 after a restart the card still shows it, with nobody named for it',
      !!rv.world.pending && rv.world.pending.id === 'peace' && rv.world.pending.at === pw.at && rv.world.pending.by === '');
  press(s, ALICE, '/world drop ' + pw.at);
  const lrec = records[records.length - 1];
  yes('W22 and a drop of it is logged as proposed before the last restart',
      pending(s) === null && lrec[0] === 'worlddrop' && /^proposed before the last restart; /.test(lrec[5]) && lrec[7].proposedBy === '');
  press(s, ALICE, '/world propose peace');
  s = boot(true);
  press(s, BOB, '/world confirm peace ' + pending(s).at);
  const frec = records[records.length - 1];
  yes('W22 and so is a confirm of one', stage(s).id === 'peace' && frec[0] === 'worldconfirm' &&
      /, proposed before the last restart/.test(frec[5]) && frec[7].proposedBy === '');
  fs.unlinkSync(warFile);
});

/* ---------------------------------------------------------- the K panel */
attempt('the K panel', function () {
  const lines = [];
  function node(tag) {
    const n = { tag: tag, children: [], style: {}, className: '', _text: '', id: '', onclick: null, title: '' };
    Object.defineProperty(n, 'textContent', {
      get: function () { return n._text + n.children.map(function (c) { return c.textContent; }).join(''); },
      set: function (v) { n._text = String(v); n.children = []; }
    });
    n.appendChild = function (c) { n.children.push(c); return c; };
    n.querySelector = function (sel) { return (n._q && n._q[sel]) || node('div'); };
    return n;
  }
  const docu = {
    head: node('head'), body: node('body'),
    createElement: function (tag) {
      const n = node(tag);
      Object.defineProperty(n, 'innerHTML', { set: function () {
        const close = node('div'); close._q = { span: node('span'), '.key': node('span') };
        n._q = { '.title': node('div'), '.who': node('div'), '.nav': node('div'), '.body': node('div'),
                 '.status': node('div'), '[data-act="confirm"]': node('div'), '[data-act="close"]': close, '.panel': node('div') };
      } });
      return n;
    },
    createTextNode: function (t) { const n = node('#text'); n._text = String(t); return n; }
  };
  const win = { innerWidth: 1920, innerHeight: 1080, addEventListener: function () { },
                skyrimPlatform: { sendMessage: function () { } },
                thornswoodNet: { say: function (l) { lines.push(l); } } };
  const box = { window: win, document: docu, setTimeout: function () { }, Date: Date, JSON: JSON, console: console };
  vm.createContext(box);
  vm.runInContext(ui, box, { filename: 'thornswood-skills.js' });
  const api = win.thornswoodSkills;
  yes('K0 the K panel runs in a stand-in document', !!api);
  const root = docu.body.children[0];
  const nav = root._q['.nav'], body = root._q['.body'];
  const all = function (n, out) { out = out || []; out.push(n); (n.children || []).forEach(function (c) { all(c, out); }); return out; };
  const buttons = function (text) { return all(body).filter(function (n) { return n.className === 'stop' && n.textContent === text; }); };
  const goOffice = function () {
    const r = nav.children.filter(function (x) { return /navrow/.test(x.className) && x.children[0].textContent === 'Office'; })[0];
    if (r) { r.onclick(); }
    return r;
  };
  const base = { 'class': 'hunter', profession: 'smith', half: 'edgewright', ranks: {}, tree: {}, points: 0 };
  const show = function (v) { api.setData(null, { panel: Object.assign({}, base, { officePage: v }) }); };
  api.open();
  const page = { jarls: [], clash: [], courtOf: [], stewardOf: [], guardOf: [], toHold: [], steward: false, staff: true,
                 door: null, box: null, boards: [] };

  show(Object.assign({}, page, { world: null }));
  goOffice();
  yes('K1 a page with no world on it (anybody not staff) has no card for it', !/The world is at/.test(body.textContent));

  const w = cardView && cardView.world;
  show(Object.assign({}, page, { world: w }));
  goOffice();
  const text = body.textContent;
  yes('K2 staff see where the world is and what is proposed, by whom', /The world is at Peace\./.test(text) &&
      /Proposed: A test landing \(remnant\)/.test(text) && /by Aela \(profile 303\)/.test(text));
  yes('K3 the stage it is at is not offered, every other one is',
      buttons('Peace').length === 0 && buttons('A quiet stage').length === 1 && buttons('A stage whose notice is wrong').length === 1 &&
      buttons('A test landing').length === 1);
  lines.length = 0;
  buttons('A quiet stage')[0].onclick({});
  yes('K4 a stage\'s button proposes it (' + lines.join(' | ') + ')', lines.join() === '/world propose test-quiet');
  lines.length = 0;
  const confirm = buttons('Confirm')[0];
  confirm.onclick({});
  yes('K5 the first press on Confirm sends nothing and asks again: "' + confirm.textContent + '"',
      lines.length === 0 && confirm.textContent === 'Press again to move the world to A test landing and put up its notice');
  confirm.onclick({});
  yes('K5 the second sends the proposal it confirms (' + lines.join(' | ') + ')',
      lines.join() === '/world confirm test-landing ' + w.pending.at);
  lines.length = 0;
  buttons('Drop')[0].onclick({});
  yes('K6 Drop sends the proposal it drops (' + lines.join(' | ') + ')', lines.join() === '/world drop ' + w.pending.at);

  show(Object.assign({}, page, { world: { stage: { id: 'test-quiet', name: 'A quiet stage', force: '', text: 'No notice.',
    since: Date.now() }, pending: null, stages: w.stages } }));
  goOffice();
  yes('K7 with nothing proposed the card says so, and when the world got where it is',
      /Nothing is proposed\./.test(body.textContent) && /It got there /.test(body.textContent) && !/moved by/.test(body.textContent) &&
      buttons('Confirm').length === 0 && buttons('Drop').length === 0 && buttons('A quiet stage').length === 0);
  show(Object.assign({}, page, { world: { stage: w.stage, pending: Object.assign({}, w.pending, { by: '' }), stages: w.stages } }));
  goOffice();
  yes('K7b a proposal made before a restart shows when, and names nobody',
      /Proposed: A test landing \(remnant\)/.test(body.textContent) && !/\bby\b/.test(body.textContent.split('Proposed:')[1].split('Confirm')[0]) &&
      !/somebody/.test(body.textContent));
  const words = all(body).map(function (n) { return n._text; }).join(' ');
  yes('K8 no em dash and never the forbidden word on the card',
      words.indexOf('\u2014') < 0 && words.toLowerCase().indexOf('pla' + 'yer') < 0);
});

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
done();
