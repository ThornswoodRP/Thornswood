'use strict';
// Run the actual property block with the compiler's site tables and isolated
// server-owned actor/reference positions. No game, private save or network I/O.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const folder = process.argv[2];
assert.ok(folder, 'give the compiler fixture folder');
const read = name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
const catalogue = read('doors.json');
const tables = Object.fromEntries(['BUILDING_BY_DOOR', 'BUILDING_NAME', 'WAY_OUT']
  .map(name => [name, read(path.join('tables', name + '.json'))]));
const candidates = Object.entries(catalogue.sites).filter(([, site]) => site.passageOnly);
assert.ok(candidates.length > 0, 'the compiler must admit new sites');
const script = new vm.Script(fs.readFileSync(path.join(ROOT, 'game/gamemode/property.ts'), 'utf8'));
const embassyScript = new vm.Script(fs.readFileSync(path.join(ROOT, 'game/gamemode/embassy-and-remnant.ts'), 'utf8'));
let claims = 0, refusals = 0, passages = 0;
function world(doors, files = new Map(), sourceTables = tables, embassy = false) {
  files.set('server-settings.json', JSON.stringify({ dataDir: 'data', privDir: 'private' }));
  const key = file => path.normalize(String(file));
  const fakeFs = {
    existsSync: file => files.has(key(file)), mkdirSync() {},
    readFileSync(file) {
      if (!files.has(key(file))) { const e = new Error('fixture file absent'); e.code = 'ENOENT'; throw e; }
      return files.get(key(file));
    },
    writeFileSync(file, text) { files.set(key(file), String(text)); },
    renameSync(from, to) { files.set(key(to), files.get(key(from))); files.delete(key(from)); },
  };
  const ids = new Map(), descs = new Map(), refs = new Map();
  let next = 0x05000000;
  const idOf = desc => {
    if (!ids.has(desc)) { ids.set(desc, next); descs.set(next++, desc); }
    return ids.get(desc);
  };
  const a = 0xff000001, b = 0xff000002;
  for (const [actor, profileId] of [[a, 501], [b, 502]]) refs.set(actor, {
    profileId, appearance: { name: 'Fixture ' + profileId }, inventory: { entries: [] },
    worldOrCellDesc: '3c:Skyrim.esm', pos: [0, 0, 0],
  });
  for (const d of doors) refs.set(idOf(d), { worldOrCellDesc: '3c:Skyrim.esm', pos: [0, 0, 0] });
  const copy = value => value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  const mp = {
    makeProperty() {}, getDescFromId: id => descs.get(id) || '',
    lookupEspmRecordById: () => null, getNeighborsByPosition: () => [],
    get(id, name) {
      if (id === 0 && name === 'onlinePlayers') return [a, b];
      if (!refs.has(id)) throw new Error('unknown fixture reference');
      return copy(refs.get(id)[name]);
    },
    set(id, name, value) { if (!refs.has(id)) refs.set(id, {}); refs.get(id)[name] = copy(value); },
    writeFileWhole(file, text) { fakeFs.writeFileSync(file, text); },
  };
  const box = vm.createContext({ console: { log() {} }, mp, idOf,
    BUILDING_BY_DOOR: sourceTables.BUILDING_BY_DOOR, BUILDING_NAME: sourceTables.BUILDING_NAME, WAY_OUT: sourceTables.WAY_OUT,
    table: name => sourceTables[name] || {}, require: name => name === 'fs' ? fakeFs : require(name),
    notify() {}, say() {}, log() {}, guard: (name, fn) => fn,
    setInterval: () => 1, clearInterval() {}, BENCH_BY_BASE: {},
  });
  if (embassy) embassyScript.runInContext(box);
  script.runInContext(box);
  const property = box.__thornswoodProperty;
  const command = (actor, word, args = []) => property.command(word, [word, ...args], actor,
    refs.get(actor).profileId, () => {});
  const look = actor => command(actor, '/doorlook', [idOf(doors[0]).toString(16)]);
  return { property, command, look, refs, idOf, a, b, files, box };
}
for (const [site] of candidates) {
  const doors = Object.keys(tables.BUILDING_BY_DOOR).filter(d => tables.BUILDING_BY_DOOR[d] === site);
  assert.ok(doors.length > 0, 'every site has an actual leaf');
  const { property, command, look, refs, idOf, a, b } = world(doors);
  look(a);
  assert.equal(refs.get(a).thornswoodDoorLine?.x, 'claim', site + ' offers a claim');
  command(a, '/claim');
  assert.equal(property.holderOf(site)?.by, 501, site + ' records the actual holder'); claims++;
  assert.ok(refs.get(a).inventory.entries.some(e => String(e.name).startsWith('Deed to ')), 'hands over a deed');
  look(b); command(b, '/claim');
  assert.equal(property.holderOf(site)?.by, 501, site + ' refuses a second claimant'); refusals++;
  command(a, '/lock');
  const state = property.shutFor(b, 502);
  for (const d of doors) {
    assert.ok(state.open.includes(idOf(d)) && !state.shut.includes(idOf(d)), d + ' remains passable'); passages++;
  }
}
// A genuinely empty embassy after the reset is not a synthetic office claim.
// The real embassy module still runs, including its role/roll authority.
const EMBASSY = 'e48e:The Great City of Solitude.esp';
const EMBASSY_DOOR = '5cb0:The Great City of Solitude.esp';
const embassyTables = {
  ...tables,
  BUILDING_BY_DOOR: { ...tables.BUILDING_BY_DOOR, [EMBASSY_DOOR]: EMBASSY },
  BUILDING_NAME: { ...tables.BUILDING_NAME, [EMBASSY]: 'Abandoned Warehouse' },
  WAY_OUT: { ...tables.WAY_OUT },
};
delete embassyTables.WAY_OUT[EMBASSY_DOOR];
let e = world([EMBASSY_DOOR], new Map(), embassyTables, true);
assert.ok(e.box.__thornswoodEmbassy.holds(EMBASSY), 'actual embassy identity is loaded');
e.look(e.a);
assert.equal(e.refs.get(e.a).thornswoodDoorLine?.x, 'claim', 'empty embassy offers a claim');
e.command(e.a, '/claim'); e.command(e.a, '/lock');
assert.equal(e.property.holderOf(EMBASSY)?.by, 501, 'empty embassy records its actual owner');
assert.ok(e.property.shutFor(e.b, 502).shut.includes(e.idOf(EMBASSY_DOOR)), 'actual owner may lock proven ingress');
e.look(e.b); e.command(e.b, '/claim');
assert.equal(e.property.holderOf(EMBASSY)?.by, 501, 'office identity does not let a stranger hijack it');
e = world([EMBASSY_DOOR], e.files, embassyTables, true);
assert.equal(e.property.holderOf(EMBASSY)?.by, 501, 'restart preserves the real embassy holding');
assert.equal(e.property.holderOf(EMBASSY)?.locked, true, 'restart preserves its actual lock');
e.look(e.b); e.command(e.b, '/claim');
assert.equal(e.property.holderOf(EMBASSY)?.by, 501, 'existing owner remains protected after restart');
console.log(JSON.stringify({ claims, refusedHijacks: refusals, passableLeaves: passages, embassyRestart: true }));
