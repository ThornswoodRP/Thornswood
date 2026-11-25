'use strict';
// Real repair page and bridge, followed by the canonical durability handler.
const fs = require('fs'), path = require('path'), vm = require('vm');
const makePage = require('../../tests/fixtures/panel-page.js');
const root = path.join(__dirname, '../..');
const source = fs.readFileSync(process.env.DURABILITY_SOURCE || path.join(root, 'game/gamemode/durability.ts'), 'utf8');
const box = { console: { log() {} } }; box.globalThis = box;
vm.runInNewContext(source, box);
let pass = 0, fail = 0;
function yes(label, value) { console.log((value ? 'PASS ' : 'FAIL ') + label); value ? pass++ : fail++; }
const SWORD = 0x100001, KIT = 0x100002, ME = 0xff000001;
function world(name, options = {}) {
  const w = { writes: 0, pack: [{ baseId: SWORD, count: 1, name: name + ' (40%)', enchantmentId: 91 },
    { baseId: KIT, count: 2 }], views: [] };
  w.api = box.__thornswoodDurabilityCreate({
    inventory: () => structuredClone(w.pack),
    setInventory: (id, entries) => { w.writes++; w.pack = structuredClone(entries); return true; },
    recipes: () => ({ sword: { out: '111:Skyrim.esm', owner: 'Smith' } }),
    benchAccess: () => ({ forge: { name: 'CraftingSmithingForge', rows: ['sword'] } }),
    benchesHere: () => options.away ? [] : ['forge'],
    descOf: id => id === SWORD ? '111:Skyrim.esm' : '',
    idOf: desc => desc === '154b0:Thornswood-Content.esp' ? KIT : 0,
    nameOf: () => 'Iron Sword', recordOf: id => ({ type: id === SWORD ? 'WEAP' : 'MISC', fields: [] }),
    isTool: () => false, stateOf: () => ({ prof: options.wrongTrade ? 'cook' : 'smith', half: 'edgewright', ranks: { edgewright: 'master' } }),
    worn: () => [], record: () => null, setRecord: () => true,
    now: () => 1, random: () => 1, later() {}, show: (id, view) => w.views.push(view), say() {}, log() {}
  });
  w.api.panel(ME, []);
  w.page = makePage();
  w.page.run('bridge', fs.readFileSync(path.join(root, 'game/ui/thornswood-bridge.js'), 'utf8'));
  w.page.run('repair', fs.readFileSync(path.join(root, 'game/ui/thornswood-repair.js'), 'utf8'));
  w.page.win.thornswoodRepair.setData(w.views.at(-1));
  w.send = () => {
    const button = w.page.doc.querySelector('button[data-n]');
    yes('the actual panel exposes a Mend button for the eligible piece', !!button);
    if (button) button.onclick.call(button);
    return w.page.sent.at(-1);
  };
  w.handle = line => w.api.panel(ME, line.trim().split(/\s+/).slice(1));
  return w;
}
for (const name of ['Iron  Sword', '  Iron Sword', 'Iron Sword  ', 'Iron\t Sword', 'Iron\nSword', 'Lydia "Red" % Sword', 'Épée  雪']) {
  const w = world(name), line = w.send();
  yes('the bridge sends the versioned exact-name request', typeof line === 'string' && line.startsWith('/repair mend-name-v1 '));
  const answer = line ? w.handle(line) : '';
  yes('the named piece is mended without collapsing its name: ' + JSON.stringify(name),
    w.writes === 1 && w.pack.some(e => e.name === name + ' (120%)' && e.enchantmentId === 91 && e.count === 1) &&
    w.pack.some(e => e.baseId === KIT && e.count === 1) && /is at 120% now/.test(answer));
  const after = JSON.stringify(w.pack);
  if (line) w.handle(line);
  yes('replaying that displayed repair uses no second kit', w.writes === 1 && JSON.stringify(w.pack) === after);
}
{
  const w = world('Iron  Sword');
  w.pack.unshift({ baseId: SWORD, count: 1, name: 'Iron Sword (40%)', enchantmentId: 92 });
  w.handle('/repair mend-name-v1 100001 40 Iron%20%20Sword');
  yes('a similarly named piece keeps its exact name and condition',
    w.pack.some(e => e.name === 'Iron Sword (40%)' && e.enchantmentId === 92) &&
    w.pack.some(e => e.name === 'Iron  Sword (120%)' && e.enchantmentId === 91));
}
for (const suffix of ['100001 40 %ZZ', '100001 40 %E0%A4', '100001 40 Iron%20Sword extra',
  '100001junk 40 Iron%20Sword', '0 40 Iron%20Sword', '100001 NaN Iron%20Sword', '100001 40.5 Iron%20Sword', '100001 121 Iron%20Sword', '100001 40']) {
  const w = world('Iron Sword'), before = JSON.stringify(w.pack);
  const reply = w.handle('/repair mend-name-v1 ' + suffix);
  yes('a malformed exact-name request refuses before any inventory write: ' + suffix,
    w.writes === 0 && JSON.stringify(w.pack) === before && /could not be read/.test(reply));
}
for (const options of [{ away: true }, { wrongTrade: true }]) {
  const w = world('Iron  Sword', options), before = JSON.stringify(w.pack);
  const reply = w.handle('/repair mend-name-v1 100001 40 Iron%20%20Sword');
  yes('the canonical bench and profession rules still refuse ineligible repairs',
    w.writes === 0 && JSON.stringify(w.pack) === before && /mended/.test(reply));
}
for (const name of [' '.repeat(2700), '\ud800']) {
  const w = world(name), before = JSON.stringify(w.pack);
  w.send();
  yes('a name that cannot fit the request is not truncated or sent',
    w.page.sent.length === 0 && w.writes === 0 && JSON.stringify(w.pack) === before);
}
{
  const w = world('Iron  Sword'); w.pack[1].count = 0;
  const reply = w.handle('/repair mend-name-v1 100001 40 Iron%20%20Sword');
  yes('an exact name grants no repair kit', w.writes === 0 && /you have none/.test(reply));
}
{
  const w = world('Iron  Sword'), line = w.send();
  w.pack[0].name = 'Another Sword (40%)';
  const before = JSON.stringify(w.pack), reply = w.handle(line);
  yes('a stale displayed name cannot mend a different piece',
    w.writes === 0 && JSON.stringify(w.pack) === before && /not in your pack/.test(reply));
}
{
  const w = world('Iron Sword'); w.handle('/repair mend 100001 40 Iron Sword');
  yes('the legacy plain-name route remains usable by an older panel', w.writes === 1 && w.pack[1].count === 1);
}
{
  const w = world('Iron  Sword'), line = w.send();
  // The old handler recognizes only mend; a distinct verb must never become
  // a different piece's legacy request after whitespace reconstruction.
  yes('the new request cannot be mistaken for legacy mend', !!line && line.split(/\s+/)[1] !== 'mend');
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
