'use strict';
// Execute the actual door catalogue override and property block. The two
// reciprocal inside leaves are from the SHA-bound Dev 135 door catalogue;
// positions, people and storage below are an isolated engine fixture.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..');
const doorSource = fs.readFileSync(path.join(ROOT, 'game/gamemode/building-doors.ts'), 'utf8');
const propertySource = fs.readFileSync(path.join(ROOT, 'game/gamemode/property.ts'), 'utf8');
const RIFT = 'gate:riften-main', WHITE = 'gate:whiterun-main';
const inside = ['42283:Skyrim.esm', '42285:Skyrim.esm'];
const outside = ['42284:Skyrim.esm', '42286:Skyrim.esm'];
// One existing cell door for each of the ten canonical jail buildings.
const jails = [
  ['markarth', '16203:Skyrim.esm', 'bf4d4:Skyrim.esm'],
  ['windhelm', '1677a:Skyrim.esm', '105fbb:Skyrim.esm'],
  ['ravenrock', '19ad8:Dragonborn.esm', '19b09:Dragonborn.esm'],
  ['whiterun', '4a376:Skyrim.esm', '9dc35:Skyrim.esm'],
  ['solitude', '56e88:Skyrim.esm', '5e91e:Skyrim.esm'],
  ['morthal', '5d010:Skyrim.esm', 'ec565:Skyrim.esm'],
  ['winterhold', '961ff:Skyrim.esm', '10cff3:Skyrim.esm'],
  ['riften', 'a8b23:Skyrim.esm', '40fa0:Skyrim.esm'],
  ['dawnstar', 'eb440:Skyrim.esm', 'ec564:Skyrim.esm'],
  ['falkreath', 'ef324:Skyrim.esm', 'ef434:Skyrim.esm']
];
const EMBASSY = 'e48e:The Great City of Solitude.esp';
const EMBASSY_DOOR = 'e5c9:The Great City of Solitude.esp';
let passed = 0, failed = 0;
function yes(name, ok) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (ok) passed++; else failed++;
}
function world() {
  const files = new Map([['server-settings.json', JSON.stringify({ dataDir: 'data', privDir: 'private' })]]);
  const key = value => path.normalize(String(value));
  const fakeFs = {
    existsSync: file => files.has(key(file)), mkdirSync() {},
    readFileSync(file) {
      if (!files.has(key(file))) { const e = new Error('fixture file absent'); e.code = 'ENOENT'; throw e; }
      return files.get(key(file));
    },
    writeFileSync(file, text) { files.set(key(file), String(text)); },
    renameSync(from, to) { files.set(key(to), files.get(key(from))); files.delete(key(from)); },
    unlinkSync(file) { files.delete(key(file)); }
  };
  const byDoor = { [EMBASSY_DOOR]: EMBASSY };
  const tables = {
    BUILDING_BY_DOOR: byDoor,
    BUILDING_NAME: { [EMBASSY]: 'The Embassy' },
    WAY_OUT: {}, JAIL_BUILDING: {}, JAIL_DOOR: {}, JAIL_NAME: {}, JAIL_SHUT: {}
  };
  for (const [hold, building, door] of jails) {
    byDoor[door] = building;
    tables.BUILDING_NAME[building] = hold + ' jail';
    tables.JAIL_BUILDING[building] = hold;
    tables.JAIL_DOOR[door] = hold;
    tables.JAIL_NAME[hold] = hold + ' jail';
    tables.JAIL_SHUT[door] = 1;
  }
  files.set(key(path.join('private', 'law.json')), JSON.stringify({
    cells: Object.fromEntries(jails.map(row => [row[2], true])), held: {}
  }));
  const ids = new Map(), descs = new Map(), refs = new Map();
  let nextId = 0x05000000;
  const idOf = desc => {
    if (!ids.has(desc)) { ids.set(desc, nextId); descs.set(nextId++, desc); }
    return ids.get(desc);
  };
  const players = [501, 502].map((profileId, i) => {
    const id = 0xff000001 + i;
    refs.set(id, { profileId, appearance: { name: 'Fixture ' + profileId },
      worldOrCellDesc: '16bb4:Skyrim.esm', pos: [0, 0, 0], inventory: { entries: [] } });
    return id;
  });
  for (const desc of [...inside, ...outside, '1b1f1:Skyrim.esm', '1b1f3:Skyrim.esm',
    ...jails.map(row => row[2]), EMBASSY_DOOR, 'abcdef:Skyrim.esm']) {
    refs.set(idOf(desc), { worldOrCellDesc: '16bb4:Skyrim.esm', pos: [0, 0, 0] });
  }
  const copy = value => value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  const mp = {
    makeProperty() {},
    get(id, name) {
      if (id === 0 && name === 'onlinePlayers') return players.slice();
      if (!refs.has(id)) throw new Error('unknown fixture reference');
      return copy(refs.get(id)[name]);
    },
    set(id, name, value) { if (!refs.has(id)) refs.set(id, {}); refs.get(id)[name] = copy(value); },
    getDescFromId: id => descs.get(id) || '',
    lookupEspmRecordById: () => null, getNeighborsByPosition: () => [],
    writeFileWhole(file, text) { fakeFs.writeFileSync(file, text); }
  };
  const box = {
    console: { log() {} }, mp, idOf,
    table: name => tables[name] || {},
    require: name => name === 'fs' ? fakeFs : require(name),
    notify() {}, say() {}, log() {}, guard: (name, fn) => fn,
    setInterval: () => 1, clearInterval() {}, BENCH_BY_BASE: {},
    __thornswoodEmbassy: { holds: building => building === EMBASSY, CLAIM_REFUSED: 'Reserved embassy' }
  };
  vm.createContext(box);
  vm.runInContext(doorSource, box, { filename: 'actual building-doors.ts' });
  vm.runInContext(propertySource, box, { filename: 'actual property.ts' });
  const property = box.__thornswoodProperty;
  function command(actor, word, parts = []) {
    const told = [];
    property.command(word, [word, ...parts], actor, refs.get(actor).profileId, (pid, text) => told.push(text));
    return told;
  }
  function look(actor, desc) { return command(actor, '/doorlook', [idOf(desc).toString(16)]); }
  return { property, refs, players, idOf, command, look };
}

for (const desc of [...inside, ...outside]) {
  const w = world(), [a, b] = w.players;
  w.look(a, desc);
  const line = w.refs.get(a).thornswoodDoorLine;
  yes(desc + ': an unclaimed gate offers Claim from this leaf', line && line.x === 'claim' && line.n === 'Riften Main Gate');
  yes(desc + ': the line covers every reciprocal gate leaf', line && [...inside, ...outside].every(d => line.d.includes(w.idOf(d).toString(16))));
  w.command(a, '/claim');
  yes(desc + ': the real claim route records the holder', w.property.holderOf(RIFT)?.by === 501);
  yes(desc + ': the claim hands over the named deed', w.refs.get(a).inventory.entries.some(e => String(e.name).includes('Riften Main Gate')));
  w.look(b, desc);
  yes(desc + ': another person cannot claim the held gate', w.refs.get(b).thornswoodDoorLine?.x === '');
  w.command(b, '/claim');
  yes(desc + ': a second press preserves the first holder', w.property.holderOf(RIFT)?.by === 501);
}

{
  const w = world(), [a, b] = w.players;
  w.look(a, outside[0]); w.command(a, '/claim'); w.command(a, '/lock');
  const locks = w.property.shutFor(b, 502);
  yes('a locked claim still governs both existing outside leaves', outside.every(d => locks.shut.includes(w.idOf(d))));
  yes('both inside leaves remain open for safe egress', inside.every(d => w.property.wayOut(d) && locks.open.includes(w.idOf(d)) && !locks.shut.includes(w.idOf(d))));
  yes('Whiterun keeps its existing shared property', w.property.buildingOf('1b1f1:Skyrim.esm') === WHITE && w.property.buildingOf('1b1f3:Skyrim.esm') === WHITE);
  yes('Whiterun keeps its inside egress leaf', w.property.wayOut('1b1f3:Skyrim.esm'));
}

for (const [label, setup, desc] of [
  ['distant', w => { w.refs.get(w.players[0]).pos = [10000, 0, 0]; }, inside[0]],
  ['another world', w => { w.refs.get(w.players[0]).worldOrCellDesc = '3c:Skyrim.esm'; }, inside[0]],
  ['unknown door', () => {}, 'abcdef:Skyrim.esm']
]) {
  const w = world(), a = w.players[0]; setup(w); w.look(a, desc); w.command(a, '/claim');
  yes(label + ' does not create a gate claim', !w.property.holderOf(RIFT) && !w.refs.get(a).thornswoodDoorLine);
}
for (const [hold, building, door] of jails) {
  const w = world(), a = w.players[0]; w.look(a, outside[0]); w.command(a, '/claim');
  yes(hold + ': active guard cell control stays separate from the gate claim',
    w.property.buildingOf(door) === building && w.property.jailHoldOf(door) === hold &&
    w.property.cellLocked(door) && !w.property.mayPassCell(a, 501, door));
}
{
  const w = world();
  yes('the unrelated embassy door keeps its original property mapping', w.property.buildingOf(EMBASSY_DOOR) === EMBASSY);
}
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
