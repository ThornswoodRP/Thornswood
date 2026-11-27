'use strict';
// test-6883-held-building-ownership.js
//
// A building you hold is yours to use (#6883). On Main a claimed Whiterun
// tavern's storage still showed the game's red Steal, because the claim is
// the server's register and the game's ownership (on the cell, and on the
// chests and things in it) was still vanilla's. The server now puts the
// cells this character holds on the lock list, the lock script hands them to
// the front plugin, and the plugin makes a held, loaded building and what in
// it had an owner the character's own, and gives a building no longer held
// back its owners.
//
// Runs property.ts's shutFor and lockScript and the plugin's own-cells code
// against a stand-in game.
//
//   node game/tests/test-6883-held-building-ownership.js
//
// Read only.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const prop = fs.readFileSync(path.join(root, 'game/gamemode/property.ts'), 'utf8').split(CR).join('');
const front = fs.readFileSync(process.env.FRONT || path.join(root, 'game/plugins/thornswood-front.js'), 'utf8').split(CR).join('');
let pass = 0, fail = 0;
function yes(what, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + what); ok ? pass++ : fail++; }
function lift(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a);
  return b < 0 ? null : src.slice(a, b + end.length);
}

// ------------------------------------------------------------ the server --
{
  const body = lift(prop, '  function shutFor(actorId, profileId) {', '\n  }');
  yes('server: shutFor can be lifted out', !!body);
  if (body) {
    const make = new Function('claims', 'doorsOf', 'mayPass', 'wayOut', 'jailHoldOf', 'cellLists', 'idOf',
      body + '\nreturn shutFor;');
    const claims = { 'a:T.esp': { by: 7 }, 'b:T.esp': { by: 8 }, 'c:T.esp': { by: 7 } };
    const ids = { 'a:T.esp': 0xa, 'b:T.esp': 0xb, 'c:T.esp': 0xc };
    const shutFor = make(claims, () => [], () => true, () => false, () => null, () => { }, d => ids[d] || 0);
    const mine = shutFor(1, 7);
    yes('server: the holder\'s lock list names every building they hold', JSON.stringify(mine.own) === JSON.stringify([0xa, 0xc]));
    yes('server: nobody else\'s list names a building they do not hold', JSON.stringify(shutFor(2, 9).own) === '[]' && JSON.stringify(shutFor(3, 8).own) === JSON.stringify([0xb]));
    yes('server: a character with no profile holds nothing', JSON.stringify(shutFor(4, 0).own) === '[]');
  }
  const ls = lift(prop, '  function lockScript() {', '\n  }');
  yes('server: the lock script can be lifted out', !!ls);
  if (ls) {
    const script = new Function('LOCK_EVERY_MS', ls + '\nreturn lockScript();')(4000);
    const g = {};
    let handed = null;
    g.__thornswoodOwnCells = ids => { handed = ids; };
    const run = new Function('ctx', 'globalThis', script);
    run({ value: { shut: [], open: [], own: [0xa], at: 1 }, state: {}, sp: { ObjectReference: { from: () => null }, Game: { getFormEx: () => null } } }, g);
    yes('server: the lock script hands the held cells to the plugin and publishes them', JSON.stringify(handed) === '[10]' && JSON.stringify(g.__thornswoodPropertyOwn) === '[10]');
  }
}

// ------------------------------------------------------------ the plugin --
const block = lift(front, '  const OWN_REF_TYPES = [', "    wantOwnCells(ids);\n  }));");
yes('plugin: the own-cells code can be lifted out', !!block);
if (block) {
  const forms = {};
  function Owned(id) { this.id = id; this.actor = 0; this.faction = 0; }
  Owned.prototype.getFormID = function () { return this.id; };
  Owned.prototype.getActorOwner = function () { return this.actor ? forms[this.actor] : null; };
  Owned.prototype.getFactionOwner = function () { return this.faction ? forms[this.faction] : null; };
  Owned.prototype.setActorOwner = function (b) { this.actor = b ? b.getFormID() : 0; this.faction = 0; };
  Owned.prototype.setFactionOwner = function (f) { this.faction = f ? f.getFormID() : 0; this.actor = 0; };
  const form = (id, extra) => (forms[id] = Object.assign(new Owned(id), extra || {}));
  const me = form(0x7), keeper = form(0x1b0), innFaction = form(0x2f0);
  function cell(id, refs) {
    const c = form(id, { attached: true, refs: refs });
    c.isAttached = function () { return this.attached; };
    c.getNumRefs = function (t) { return this.attached ? this.refs.filter(r => r.type === t).length : 0; };
    c.getNthRef = function (i, t) { return this.refs.filter(r => r.type === t)[i] || null; };
    return c;
  }
  const chest = form(0x101, { type: 28 }); chest.actor = keeper.id;
  const plate = form(0x102, { type: 32 }); plate.faction = innFaction.id;
  const loose = form(0x103, { type: 32 });
  const bed = form(0x104, { type: 40 }); bed.actor = keeper.id;
  const tavern = cell(0xa, [chest, plate, loose, bed]); tavern.actor = keeper.id;
  const otherChest = form(0x201, { type: 28 }); otherChest.actor = keeper.id;
  const other = cell(0xb, [otherChest]); other.faction = innFaction.id;
  const unloaded = new Set();
  const handlers = {};
  const said = [];
  const g = {};
  const sp = {
    Game: { getPlayer: () => ({ getActorBase: () => me }), getFormEx: id => (unloaded.has(Number(id)) ? null : forms[Number(id)] || null) },
    Cell: { from: f => f }, ObjectReference: { from: f => f }, ActorBase: { from: f => f }, Faction: { from: f => f },
    on: (name, fn) => { handlers[name] = fn; }, once: (name, fn) => { handlers['once ' + name] = fn; }
  };
  const guard = (name, fn) => fn;
  new Function('sp', 'guard', 'say', 'globalThis', block)(sp, guard, s => said.push(s), g);
  g.__thornswoodPropertyOwn = [0xa];
  handlers['once update']();
  yes('plugin: a held, loaded building is the character\'s, cell and all', tavern.actor === me.id);
  yes('plugin: its chest and the inn\'s plate are theirs, so taking from them is not theft', chest.actor === me.id && plate.actor === me.id && plate.faction === 0);
  yes('plugin: a thing with no owner of its own is left to the cell, and the bed to the bed code', loose.actor === 0 && loose.faction === 0 && bed.actor === keeper.id);
  yes('plugin: a building somebody else holds keeps its owners', other.faction === innFaction.id && otherChest.actor === keeper.id);
  yes('plugin: the log says it once', said.length === 1 && /theirs to use: a, 2 thing/.test(said[0]));
  g.__thornswoodOwnCells([0xa]);
  yes('plugin: the heartbeat after it changes nothing and says nothing again', tavern.actor === me.id && said.length === 1);

  // A building that comes in later, and one whose things load after it.
  other.attached = false;
  g.__thornswoodOwnCells([0xa, 0xb]);
  yes('plugin: a held building that is not loaded is left until it is', other.faction === innFaction.id && otherChest.actor === keeper.id);
  other.attached = true;
  const late = form(0x202, { type: 46 }); late.faction = innFaction.id;
  handlers.cellFullyLoaded({ cell: other });
  yes('plugin: it is the character\'s once it has loaded', other.actor === me.id && otherChest.actor === me.id);
  other.refs.push(late);
  handlers.cellFullyLoaded({ cell: other });
  yes('plugin: a thing that was not there yet is gone through when the cell finishes loading', late.actor === me.id);

  // Losing it: a lapse, an eviction, the deed handed on, another character.
  unloaded.add(otherChest.id);
  g.__thornswoodOwnCells([0xa]);
  yes('plugin: a building no longer held is given back its owners', other.faction === innFaction.id && other.actor === 0 && late.faction === innFaction.id);
  yes('plugin: a thing not loaded when it is given back keeps waiting', otherChest.actor === me.id);
  unloaded.delete(otherChest.id);
  handlers.cellFullyLoaded({ cell: other });
  yes('plugin: and is given back when its cell loads', otherChest.actor === keeper.id);
  g.__thornswoodOwnCells([]);
  yes('plugin: the tavern goes back to its keeper and the plate to the inn', tavern.actor === keeper.id && chest.actor === keeper.id && plate.faction === innFaction.id && plate.actor === 0);
  g.__thornswoodOwnCells([0xa]);
  yes('plugin: held again, it is the character\'s again', tavern.actor === me.id && chest.actor === me.id && plate.actor === me.id);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
