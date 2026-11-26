'use strict';
// Whole gamemode: pack-validated onEatItem -> cooked meal -> bed press ->
// the front plugin's queued rest report -> saved withered state and effects.
const standIn = require('../../tests/stand-in-server.js');
const groups = require('../data/food-groups.json');
const t = standIn.checks(), yes = t.yes;
const first = group => Object.keys(groups.items).find(desc => groups.items[desc] === group);
const dishes = { cooked: first('cooked'), soup: first('soup'), feast: first('feast'), raw: first('raw'), prepared: '65c98:Skyrim.esm', potion: 'f84b0:Skyrim.esm' };
const w = standIn.world({ name: '6239-meal-bed', settings: { thornswoodServer: 'main' } });
Object.values(dishes).forEach(desc => w.record(desc, 'ALCH'));
const raceData = Buffer.alloc(48);
[36, 40, 44].forEach(offset => raceData.writeFloatLE(100, offset));
w.record('13746:Skyrim.esm', 'RACE', { fields: [{ type: 'DATA', data: Array.from(raceData) }] });
w.record('7:Skyrim.esm', 'NPC_', { race: '13746:Skyrim.esm', fields: [{ type: 'ACBS', data: new Array(22).fill(0) }] });
const cell = '3c:Skyrim.esm', at = [1000, 0, 0];
w.record('d1b0b:Skyrim.esm', 'FURN', { editorId: 'CommonBed01' });
w.record('d1b0c:Skyrim.esm', 'FURN', { editorId: 'Bedroll01' });
w.record('d1b0d:Skyrim.esm', 'FURN', { editorId: 'CommonChair01' });
const bed = w.ref(0xff220100, { base: 'd1b0b:Skyrim.esm', cell, pos: at });
const roll = w.ref(0xff220101, { base: 'd1b0c:Skyrim.esm', cell, pos: at });
const chair = w.ref(0xff220102, { base: 'd1b0d:Skyrim.esm', cell, pos: at });
const actors = Array.from({ length: 12 }, (_, n) => w.person(0xff006230 + n, {
  profileId: 1000 + n, name: 'Brenna ' + n, prof: 'smith', half: 'platewright', cell, pos: [1030, 0, 0],
  inventory: { entries: Object.entries(dishes).map(([kind, desc]) => ({ baseId: w.idOf(desc), count: kind === 'potion' ? 15 : 3 })) }
}));
yes('whole gamemode loads', w.boot());
if (w.loaded()) {
  actors.forEach(w.arrive); w.run(30000);
  const box = w.box(), N = box.__thornswoodNeeds, L = box.__thornswoodCollege;
  function stomach(actor, food = 40) { const n = N.settle(actor); n.food = food; n.eatUntil = 0; box.mp.set(actor, 'thornswoodNeeds', n); }
  actors.forEach(actor => stomach(actor));
  const record = actor => w.prop(actor, L.WITHERED_PROPERTY);
  function wither(actor) { for (let n = 0; n < 5; n++) w.eat(actor, w.idOf(dishes.potion)); return L.isWithered(actor); }
  function eat(actor, kind = 'cooked') { return w.eat(actor, w.idOf(dishes[kind])); }
  function rest(actor, furniture = bed) { w.activate(furniture, actor); w.say(actor, '/rest bed'); }
  function up(actor) { w.say(actor, '/rest up'); }

  const naturalTimers = [], timeout = box.setTimeout;
  box.setTimeout = function (fn, delay, ...args) {
    if (delay >= 30 * 60000 && delay < 30 * 60000 + 1000) naturalTimers.push(fn);
    return timeout(fn, delay, ...args);
  };
  const a = actors[0];
  yes('five actual potions from the pack start the normal thirty-minute withering', wither(a));
  const penalties = L.effects(a, w.now(), {});
  yes('the real race/base-value path applies the withered health and magicka penalties', penalties && penalties.health < 0 && penalties.magicka < 0);
  const deadline = record(a).until;
  eat(a); w.run(9000);
  yes('a cooked meal alone keeps withered and its original timeout', L.isWithered(a) && record(a).until === deadline);
  rest(a);
  yes('a cooked meal followed by actual bed rest clears saved withered before timeout', !L.isWithered(a) && record(a).until === 0 && w.now() < deadline);
  yes('the withered health and magicka effects leave together', !L.effects(a, w.now(), {}));
  const heard = w.heard(a).length;
  naturalTimers[0]();
  yes('the superseded natural-expiry callback gives no duplicate recovery', w.heard(a).length === heard);
  box.setTimeout = timeout;

  for (const [actor, dish, furniture] of [[actors[1], 'soup', bed], [actors[2], 'feast', bed], [actors[3], 'cooked', roll]]) {
    wither(actor); eat(actor, dish); w.run(9000); rest(actor, furniture);
    yes(dish + ' then ' + (furniture === roll ? 'bedroll' : 'bed') + ' uses the existing cooked and bed classifications', !L.isWithered(actor));
  }
  for (const [actor, dish] of [[actors[4], 'raw'], [actors[5], 'prepared'], [actors[6], 'potion']]) {
    wither(actor); eat(actor, dish); w.run(9000); rest(actor);
    yes(dish + ' followed by a bed does not cure withered', L.isWithered(actor));
  }
  const standing = actors[7];
  wither(standing); eat(standing); w.run(9000); w.say(standing, '/rest bed');
  yes('a rest word while standing without a bed press does not cure', L.isWithered(standing));
  rest(standing, chair);
  yes('a chair after a cooked meal does not cure', L.isWithered(standing));

  const backwards = actors[8];
  wither(backwards); rest(backwards); eat(backwards); w.run(9000); w.say(backwards, '/rest bed');
  yes('being in bed before the meal and replaying the rest report does not reverse the required order', L.isWithered(backwards));
  up(backwards); rest(backwards);
  yes('getting up and starting a new bed rest after the meal does cure', !L.isWithered(backwards));

  const stale = actors[9];
  eat(stale); wither(stale); w.run(9000); rest(stale);
  yes('a meal eaten before the withered episode cannot cure the new episode', L.isWithered(stale));
  const rejected = actors[10];
  wither(rejected); eat(rejected, 'raw'); eat(rejected); w.run(9000); rest(rejected);
  yes('a cooked meal rejected inside the eight-second meal window does not qualify', L.isWithered(rejected));
  const full = actors[11];
  stomach(full, 95); wither(full); eat(full); w.run(9000); rest(full);
  yes('a cooked meal rejected on a full stomach does not qualify', L.isWithered(full));
  yes('one character recovering does not clear another character', L.isWithered(stale) && !L.isWithered(a));

  up(a); wither(a); rest(a);
  yes('a later withered episode cannot reuse a meal from an earlier recovery', L.isWithered(a));
  up(a); stomach(a); eat(a); wither(a); rest(a);
  yes('a new threshold while already withered resets its qualifying meal', L.isWithered(a));

  const failed = actors[4];
  up(failed); stomach(failed); eat(failed); w.run(9000);
  const beforeFailure = JSON.stringify(record(failed)), failureHeard = w.heard(failed).length;
  const set = box.mp.set;
  box.mp.set = function (id, key, value) {
    if (id === failed && key === L.WITHERED_PROPERTY && value.until === 0) throw new Error('injected recovery write failure');
    return set(id, key, value);
  };
  try { rest(failed); } finally { box.mp.set = set; }
  yes('a failed recovery save keeps the condition and meal without reporting a cure',
    JSON.stringify(record(failed)) === beforeFailure && L.isWithered(failed) &&
    !w.heardSince(failed, failureHeard).some(line => /cleared the withering/.test(line)));
  up(failed); rest(failed);
  yes('a later validated rest can use the meal after a refused save', !L.isWithered(failed));

  const burntActor = actors[5], burnt = N.burntMeal();
  w.record(w.descOf(burnt), 'ALCH'); w.give(burntActor, burnt, 1);
  up(burntActor); stomach(burntActor); w.eat(burntActor, burnt); w.run(9000); rest(burntActor);
  yes('a burnt meal does not qualify as the cooked meal', L.isWithered(burntActor));
  const fineDesc = Object.keys(groups.items).find(desc => N.isFine(w.idOf(desc)) && ['cooked', 'soup'].includes(groups.items[desc]));
  yes('the authoritative food groups contain a fine cooked dish', !!fineDesc);
  if (fineDesc) {
    const fineActor = actors[1];
    up(fineActor); stomach(fineActor); wither(fineActor);
    w.record(fineDesc, 'ALCH'); w.give(fineActor, w.idOf(fineDesc), 1);
    w.eat(fineActor, w.idOf(fineDesc)); w.run(9000); rest(fineActor);
    yes('a fine cooked meal retains its cooked classification for recovery', !L.isWithered(fineActor));
  }

  const returning = actors[6];
  up(returning); stomach(returning); eat(returning); w.run(9000);
  const beforeRestart = record(returning);
  w.leave(returning);
  yes('server restart preserves the qualifying meal and withered deadline',
    w.restart().loaded && JSON.stringify(w.prop(returning, 'thornswoodWithered')) === JSON.stringify(beforeRestart));
  w.arrive(returning); w.run(2000);
  yes('logging back in does not itself clear withered', w.box().__thornswoodCollege.isWithered(returning));
  rest(returning);
  yes('a new bed rest after restart can complete the saved meal sequence', !w.box().__thornswoodCollege.isWithered(returning));
}
t.done(w);
