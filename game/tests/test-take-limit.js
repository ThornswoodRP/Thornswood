// test-take-limit.js
//
// A few things from another person, and only a share of a stack.
//
// WHY. Issue #475. Patrick, 28 September: "Bodies and storages even if they
// are offline they should be allowed to take some things. They should not be
// allowed to just take alot off of them and if they take spetum it should only
// be a percentages and still count as one of the few so let's say they can take
// 3 things and if they are taking something that is a stack only a percentage
// of that stack". The gamemode's take limit holds that in mp.onTakeItem.
//
// This cuts guard(), the take and drop watchers and the take limit out of
// gamemode.js and runs them against a stand-in mp, a stand-in property
// register, a clock turned by hand and a temp folder, so the counts can be
// read back after a pretend restart.
//
// Read only, apart from its own temp folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const SRC = process.env.GAMEMODE || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

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

function lift(from, to) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(to, a);
  return b < 0 ? null : src.slice(a, b + to.length);
}

// guard() counts its time through countSpent() since #385, so both are lifted.
const guardSrc = lift('function guard(name, fn) {', '\n}\n') &&
  lift('function guard(name, fn) {', '\n}\n') + '\n' + (lift('function countSpent(name, began) {', '\n}\n') || '');
// The audit helpers and the take watcher, through the line that closes it.
const watchSrc = lift('function auditProfile(refrId) {', "'from', auditSource(sourceRefrId), 'in', auditCell(actorId));\n});");
const limitSrc = lift('/*\n  THE TAKE LIMIT: A FEW THINGS', '})();\n// end of the take limit');
yes('gamemode.js has guard(), the take watcher and the take limit',
    guardSrc !== null && watchSrc !== null && limitSrc !== null);
if (guardSrc === null || watchSrc === null || limitSrc === null) done();

// The constants are named at the top of the block, where Patrick can change them.
yes('TAKE_LIMIT is 3', /var TAKE_LIMIT = 3;/.test(limitSrc));
yes('the window is 24 hours', /var TAKE_WINDOW_MS = 24 \* 60 \* 60 \* 1000;/.test(limitSrc));
yes('STACK_SHARE is 25%', /var STACK_SHARE = 0\.25;/.test(limitSrc));

// ------------------------------------------------------------ the world --

const ALICE = 0xff000058;      // the taker, profile 101
const BOB = 0xff000060;        // another person, online, profile 202
const CAROL = 0xff000070;      // another person, offline, profile 303
const DAVE = 0xff000080;       // a second taker, profile 404
const BANDIT = 0x0001a2b3;     // an NPC's body, profile -1
const WORLD_CHEST = 0x000a1b2c;  // a chest in a building nobody holds
const BOB_CHEST = 0x000b0b0b;    // a chest in Bob's house
const ALICE_CHEST = 0x000a11ce;  // a chest in Alice's own house
const CAROL_CHEST = 0x000ca401;  // a chest in Carol's house, Carol offline
const HOLD_BOX = 0x0000aaaa;     // a chest that was Whiterun's marked box (#2298), in a hall nobody holds

const ORE = 0x00071cf3;
const GOLD = 0x0000000f;
const ARROW = 0x0001397d;
const SWORD = 0x00012eb7;
const HELM = 0x00012e4d;

const BREEZEHOME = '165a7:Skyrim.esm';   // Bob holds it
const HONEYSIDE = '16778:Skyrim.esm';    // Alice holds it
const PROUDSPIRE = '16789:Skyrim.esm';   // Carol holds it
const DRAGONSREACH = '165a3:Skyrim.esm';  // nobody holds it
const TUNDRA = '3c:Skyrim.esm';          // the open world

function stuff() {
  return { entries: [
    { baseId: ORE, count: 1 }, { baseId: SWORD, count: 1 }, { baseId: HELM, count: 1 },
    { baseId: GOLD, count: 100 }, { baseId: ARROW, count: 20 }
  ] };
}

function makeRefs() {
  const refs = {};
  refs[ALICE] = { profileId: 101, appearance: { name: 'Alice' }, worldOrCellDesc: BREEZEHOME,
                  inventory: { entries: [{ baseId: ORE, count: 2 }] } };
  refs[BOB] = { profileId: 202, appearance: { name: 'Bob' }, worldOrCellDesc: TUNDRA, inventory: stuff() };
  refs[CAROL] = { profileId: 303, appearance: { name: 'Carol' }, worldOrCellDesc: TUNDRA, inventory: stuff() };
  refs[DAVE] = { profileId: 404, appearance: { name: 'Dave' }, worldOrCellDesc: TUNDRA, inventory: { entries: [] } };
  refs[BANDIT] = { profileId: -1, appearance: null, worldOrCellDesc: TUNDRA, inventory: stuff() };
  // A container answers no profile id at all.
  refs[WORLD_CHEST] = { worldOrCellDesc: DRAGONSREACH, inventory: stuff() };
  refs[BOB_CHEST] = { worldOrCellDesc: BREEZEHOME, inventory: {
    entries: [{ baseId: ARROW, count: 20 }, { baseId: GOLD, count: 3 }, { baseId: ORE, count: 1 },
              { baseId: SWORD, count: 1 }, { baseId: HELM, count: 1 }] } };
  refs[ALICE_CHEST] = { worldOrCellDesc: HONEYSIDE, inventory: stuff() };
  refs[CAROL_CHEST] = { worldOrCellDesc: PROUDSPIRE, inventory: stuff() };
  refs[HOLD_BOX] = { worldOrCellDesc: DRAGONSREACH, inventory: { entries: [{ baseId: GOLD, count: 400 }] } };
  return refs;
}

const claims = {};
claims[BREEZEHOME] = { by: 202, name: 'Bob' };
claims[HONEYSIDE] = { by: 101, name: 'Alice' };
claims[PROUDSPIRE] = { by: 303, name: 'Carol' };
const property = {
  holderOf: function (b) { return Object.prototype.hasOwnProperty.call(claims, b) ? claims[b] : null; }
};

const box = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-take-limit-'));
const dataDir = path.join(box, 'data');
const privDir = path.join(box, 'private');
fs.mkdirSync(dataDir);
fs.writeFileSync(path.join(box, 'server-settings.json'),
  JSON.stringify({ port: 7787, dataDir: dataDir, privDir: privDir }));

let clock = Date.UTC(2026, 8, 28, 12, 0, 0);
const HOUR = 3600000;

// One server: a fresh load of the three pieces, reading whatever the private
// folder holds, the way a restart does.
function boot(opts) {
  opts = opts || {};
  const refs = makeRefs();
  const w = { said: [], lines: [], errors: [], writes: [], refs: refs };
  const mp = {
    get: function (id, prop) {
      if (id === 0 && prop === 'onlinePlayers') { return [ALICE, BOB, DAVE]; }  // Carol is offline
      if (!Object.prototype.hasOwnProperty.call(refs, id)) { throw new Error('no reference ' + id); }
      return refs[id][prop];
    },
    getDescFromId: function (id) { return '0x' + id.toString(16); },
    set: function (id, prop, v) { w.writes.push([id, prop, v]); },
    // The engine's whole-file write (#2740), as far as the gamemode can tell.
    writeFileWhole: function (p, text) { fs.writeFileSync(p, text); }
  };
  const sandbox = {
    mp: mp,
    require: require,
    console: { log: function () { }, error: function (m) { w.errors.push(String(m)); } },
    log: function () { w.lines.push(Array.prototype.slice.call(arguments).join(' ')); },
    say: function (id, text) { w.said.push({ id: id, text: text }); },
    Date: { now: function () { return clock; } }
  };
  sandbox.globalThis = sandbox;
  if (!opts.noProperty) { sandbox.__thornswoodProperty = property; }
  const was = process.cwd();
  process.chdir(box);
  try {
    vm.runInNewContext(require('../../tests/fixtures/ordinary-quest-items') + guardSrc + '\n' + watchSrc + '\n' + limitSrc, sandbox,
                       { filename: 'gamemode.js take limit' });
  } finally {
    process.chdir(was);
  }
  // The block reads server-settings.json once, relative to where the server
  // runs; every take after that runs from the same folder.
  w.take = function (source, actor, baseId, count) {
    const back = process.cwd();
    process.chdir(box);
    try { return sandbox.mp.onTakeItem(source, actor, baseId, count); }
    finally { process.chdir(back); }
  };
  w.limit = sandbox.__thornswoodTakeLimit;
  return w;
}

function plain(text) {
  return text.indexOf(String.fromCharCode(0x2014)) === -1 && !/\bplayers?\b/i.test(text);
}

// --------------------------------------------------------------- the rule --

let s = boot();
yes('the block publishes the take limit', !!(s.limit && typeof s.limit.take === 'function'));

// T1: three takes from another person's body go through, the fourth is refused.
{
  const a = s.take(BOB, ALICE, ORE, 1);
  const b = s.take(BOB, ALICE, SWORD, 1);
  const c = s.take(BOB, ALICE, HELM, 1);
  yes('T1 three single takes from Bob\'s body all go through', a === undefined && b === undefined && c === undefined);
  yes('T1 and nothing was said to Alice for them', s.said.length === 0);
  const d = s.take(BOB, ALICE, GOLD, 1);
  yes('T1 the fourth is refused', d === false);
  const said = s.said[0] || { text: '' };
  yes('T1 with one chat line to Alice', s.said.length === 1 && said.id === ALICE);
  yes('T1 that says she has taken 3 and when she may take again (got "' + said.text + '")',
      said.text.indexOf('You have already taken 3 things from this body.') === 0 &&
      said.text.indexOf('Leave the rest.') !== -1 && /in 24 hours\.$/.test(said.text));
  yes('T1 and the line keeps the writing rules (no em dash, no banned word)', plain(said.text));
  const l = s.lines[s.lines.length - 1] || '';
  yes('T1 and the log says take refused, who, and why (got "' + l + '")',
      l.indexOf('take refused: profile 101 (Alice') === 0 && l.indexOf('the body of profile 202') !== -1 &&
      l.indexOf('(the limit of 3 takes)') !== -1);
  yes('T1 and Alice\'s pack is sent back to her, so the refused item leaves it',
      s.writes.some(function (x) { return x[0] === ALICE && x[1] === 'inventory'; }));
}

// T2: the count is per taker and per source.
{
  yes('T2 Dave still has his own three from Bob\'s body', s.take(BOB, DAVE, ORE, 1) === undefined);
  yes('T2 and Alice still has her three from Bob\'s house chest', s.take(BOB_CHEST, ALICE, ORE, 1) === undefined);
}

// T3: a stack counts as one take, and only 25% of it may be taken.
{
  const before = s.said.length;
  const over = s.take(BOB_CHEST, ALICE, ARROW, 6);
  const said = (s.said[before] || { text: '' }).text;
  yes('T3 6 of a stack of 20 is over the share and refused', over === false);
  yes('T3 and Alice is told she may take 5 (got "' + said + '")',
      said.indexOf('You may take up to 5 of those 20, not 6.') === 0 && said.indexOf('25%') !== -1 && plain(said));
  const l = s.lines[s.lines.length - 1] || '';
  yes('T3 and the log says why', l.indexOf('take refused: ') === 0 && l.indexOf('(over the share, 5 of 20)') !== -1);
  yes('T3 5 of the 20 goes through', s.take(BOB_CHEST, ALICE, ARROW, 5) === undefined);
  yes('T3 and the refused 6 did not count: the ore, the arrows and one more make three',
      s.take(BOB_CHEST, ALICE, SWORD, 1) === undefined);
  yes('T3 and the arrows counted as one of the three, so the next is refused',
      s.take(BOB_CHEST, ALICE, HELM, 1) === false);
}

// T4: a stack too small for a quarter still gives one.
{
  const t = boot();
  clock += 1;
  yes('T4 1 of a stack of 3 goes through (a quarter rounds down to 0, and at least 1 may be taken)',
      t.take(BOB_CHEST, DAVE, GOLD, 1) === undefined);
  yes('T4 2 of it is refused', t.take(BOB_CHEST, DAVE, GOLD, 2) === false &&
      (t.said[0] || { text: '' }).text.indexOf('You may take up to 1 of those 3, not 2.') === 0);
}

// T5: unlimited where the rule does not reach.
{
  const t = boot();
  let own = true, ownHouse = true, world = true, npc = true, hold = true;
  for (let i = 0; i < 10; i++) {
    own = own && t.take(ALICE, ALICE, ORE, 2) === undefined;
    ownHouse = ownHouse && t.take(ALICE_CHEST, ALICE, GOLD, 100) === undefined;
    world = world && t.take(WORLD_CHEST, ALICE, GOLD, 100) === undefined;
    npc = npc && t.take(BANDIT, ALICE, GOLD, 100) === undefined;
    hold = hold && t.take(HOLD_BOX, ALICE, GOLD, 400) === undefined;
  }
  yes('T5 ten whole-stack takes from her own body all go through', own);
  yes('T5 ten whole-stack takes from a chest in her own house all go through', ownHouse);
  yes('T5 ten whole-stack takes from a chest in a building nobody holds all go through', world);
  yes('T5 ten whole-stack takes from an NPC\'s body all go through', npc);
  yes('T5 ten whole-stack takes from a chest that was a hold\'s box, in a building nobody holds, all go through', hold);
  yes('T5 and nobody was told anything', t.said.length === 0);
  yes('T5 and no take refused: line', !t.lines.some(function (l) { return l.indexOf('take refused:') === 0; }));
}

// T6: an offline owner is the same as an online one.
{
  const t = boot();
  const body = [t.take(CAROL, DAVE, ORE, 1), t.take(CAROL, DAVE, SWORD, 1), t.take(CAROL, DAVE, HELM, 1),
                t.take(CAROL, DAVE, GOLD, 1)];
  yes('T6 Carol is offline and her body gives three, then refuses the fourth',
      body[0] === undefined && body[1] === undefined && body[2] === undefined && body[3] === false);
  const house = [t.take(CAROL_CHEST, DAVE, ORE, 1), t.take(CAROL_CHEST, DAVE, SWORD, 1),
                 t.take(CAROL_CHEST, DAVE, HELM, 1), t.take(CAROL_CHEST, DAVE, GOLD, 1)];
  yes('T6 and a chest in her house the same',
      house[0] === undefined && house[1] === undefined && house[2] === undefined && house[3] === false);
  yes('T6 and the chest says container, not body',
      (t.said[1] || { text: '' }).text.indexOf('from this container.') !== -1);
  yes('T6 her house chest is still limited to a quarter of a stack',
      t.take(CAROL_CHEST, ALICE, GOLD, 26) === false && t.take(CAROL_CHEST, ALICE, GOLD, 25) === undefined);
}

// T7: the counts survive a restart.
{
  clock += HOUR;
  const file = path.join(privDir, 'take-limit.json');
  yes('T7 the counts are on disk in the private folder', fs.existsSync(file));
  yes('T7 and no temp copy is left beside them', !fs.existsSync(file + '.tmp'));
  yes('T7 and nothing landed in the served data folder', fs.readdirSync(dataDir).length === 0);
  const r = boot();
  const out = r.take(BOB, ALICE, GOLD, 1);
  const said = (r.said[0] || { text: '' }).text;
  yes('T7 after a restart Alice is still refused at Bob\'s body', out === false);
  yes('T7 and told the hours left on the same window (got "' + said + '")', / in 2[23] hours\.$/.test(said));
  yes('T7 and Dave still has his two left there', r.take(BOB, DAVE, SWORD, 1) === undefined &&
      r.take(BOB, DAVE, HELM, 1) === undefined && r.take(BOB, DAVE, GOLD, 1) === false);
}

// T8: the window resets.
{
  clock += 23 * HOUR;
  const r = boot();
  yes('T8 24 hours after her first take Alice may take from Bob\'s body again',
      r.take(BOB, ALICE, ORE, 1) === undefined);
  yes('T8 and the count starts over: two more, then the fourth is refused',
      r.take(BOB, ALICE, SWORD, 1) === undefined && r.take(BOB, ALICE, HELM, 1) === undefined &&
      r.take(BOB, ALICE, GOLD, 1) === false);
  const kept = JSON.parse(fs.readFileSync(path.join(privDir, 'take-limit.json'), 'utf8')).counts;
  yes('T8 and rows past their window are dropped from the file',
      Object.keys(kept).every(function (k) { return clock - kept[k].at < 24 * HOUR; }));
}

// T9: with no property register loaded, bodies are still limited and
//     containers are let through rather than guessed at.
{
  clock += 25 * HOUR;
  const r = boot({ noProperty: true });
  let chest = true;
  for (let i = 0; i < 5; i++) { chest = chest && r.take(BOB_CHEST, ALICE, ARROW, 20) === undefined; }
  yes('T9 no register: a chest is let through', chest);
  yes('T9 but a body is still limited', r.take(BOB, ALICE, ORE, 1) === undefined &&
      r.take(BOB, ALICE, ORE, 1) === undefined && r.take(BOB, ALICE, ORE, 1) === undefined &&
      r.take(BOB, ALICE, ORE, 1) === false);
}

// T10: a take limit that cannot read anything lets the take through.
{
  const r = boot();
  const refs = r.refs;
  refs[BOB].profileId = undefined;
  delete refs[BOB].worldOrCellDesc;
  let ok = true;
  for (let i = 0; i < 5; i++) { ok = ok && r.take(BOB, ALICE, GOLD, 100) === undefined; }
  yes('T10 a source whose owner cannot be read is let through', ok);
  yes('T10 and nothing reached the engine as a throw', r.errors.length === 0);
}

try { fs.rmSync(box, { recursive: true, force: true }); } catch (e) { }
done();
