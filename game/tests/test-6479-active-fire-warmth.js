'use strict';
// Actual queued burn/place/refresh paths and saved needs, plus a stalled
// server-clock interval to verify the existing curve across fire expiry.
const fs = require('fs'), path = require('path');
const standIn = require('../../tests/stand-in-server');
const t = standIn.checks(), yes = t.yes;
const w = standIn.world({ name: '6479-fire-warmth', settings: { thornswoodServer: 'main' } });
const actors = Array.from({ length: 5 }, (_, i) => w.person(0xff006490 + i, {
  profileId: 1000 + i, name: 'Brenna ' + i, cell: '3c:Skyrim.esm', pos: [i * 1000, 0, 0]
}));
const approach = (temp, target, ms) => target + (temp - target) * Math.pow(0.5, ms / (target > temp ? 30000 : 90000));
const close = (actual, expected) => Math.abs(actual - expected) < 0.00001;
yes('the whole gamemode loads', w.boot());
if (w.loaded()) {
  actors.forEach(w.arrive); w.run(30000);
  const box = w.box(), N = box.__thornswoodNeeds;
  let now = w.now();
  // Stop the thermal clock between explicit advances while the real command
  // relay runs. This also models an event-loop stall without replaying timers.
  box.Date.now = () => now;
  const raw = actor => w.prop(actor, 'thornswoodNeeds');
  function reset(actor, temp = 20, fire = -1) {
    N.clearBurning(actor);
    const n = N.settle(actor);
    Object.assign(n, { at: now, temp, place: 'indoors', roof: true, night: false, fire, sky: '', high: 0,
      food: 80, drink: 80, rest: 80, mealHelp: '', mealHelpUntil: 0, wetFrom: 0 });
    box.mp.set(actor, 'thornswoodNeeds', n);
    w.row(actor).equipment = { inv: { entries: [] } };
  }
  function say(actor, line) { w.say(actor, line); w.run(2100); }
  function panel(actor) { say(actor, '/pick refresh'); return w.prop(actor, 'thornswoodCharacter').panel.needs; }
  function bodyText(view) {
    const src = fs.readFileSync(path.join(__dirname, '../ui/thornswood-skills.js'), 'utf8').replace(/\r/g, '');
    const block = src.slice(src.indexOf('  var BAND_WORDS ='), src.indexOf('\n  /*\n    THE ALCHEMY JOURNAL'));
    function el(tag, cls, text) { return { text: text || '', children: [], appendChild(n) { this.children.push(n); } }; }
    const body = el(), draw = new Function('bodyView', 'el', 'elBody', 'tempWord', 'tell', block + ';return drawNeeds;')(
      () => view, el, body, n => String(n), () => {});
    draw();
    const text = node => node.text + ' ' + node.children.map(text).join(' ');
    return text(body);
  }

  const a = actors[0]; reset(a); const before = raw(a);
  now += 60000; say(a, '/burn 1');
  const started = raw(a), ambient = approach(20, 58, 60000);
  yes('starting fire settles the preceding minute at the old ambient target', close(started.temp, ambient) && started.at === now && before.at < now);
  let view = panel(a);
  yes('actual burning away from a nearby fire raises the warmth target by the existing fire-at-feet worth', view.tempTarget === 92 && view.burning === true);
  yes('the current temperature is not snapped to its newly raised target', view.temp === Math.round(ambient) && view.temp < view.tempTarget);
  yes('the actual Body renderer distinguishes current temperature, warming target and fire on the body',
    bodyText(view).includes('Warming toward 92.') && /You are on fire/.test(bodyText(view)));
  for (let i = 0; i < 10; i++) { now += 3000; say(a, '/burn 1'); }
  const half = approach(ambient, 92, 30000);
  yes('a sustained reported fire covers exactly half the remaining gap in thirty seconds', close(raw(a).temp, half));
  view = panel(a);
  yes('Read again returns the current saved temperature and the active target', view.temp === Math.round(half) && view.tempTarget === 92 && view.burning === true);
  now += 2000; say(a, '/burn 0');
  const stopped = approach(half, 92, 2000);
  yes('the real stop report settles the final burning interval before ending heat', close(raw(a).temp, stopped));
  view = panel(a);
  yes('the Body view immediately returns to the ambient target after fire stops', view.tempTarget === 58 && view.burning === false && !/You are on fire/.test(bodyText(view)));
  now += 3000; N.settle(a);
  yes('time after fire stops uses the existing ambient curve', close(raw(a).temp, approach(stopped, 58, 3000)));

  const b = actors[1]; reset(b); say(b, '/burn 1');
  now += 10000; N.settle(b);
  const expired = approach(approach(20, 92, 6000), 58, 4000);
  yes('a delayed settle splits exactly six seconds of fire from the remaining ambient interval', close(raw(b).temp, expired));
  view = panel(b);
  yes('a silent fire expires without leaving a warming target or Body label', view.tempTarget === 58 && view.burning === false);
  reset(b, 80); say(b, '/burn 1'); now += 10000; N.settle(b);
  yes('expiry can change warming to the original ninety-second cooling curve within one delayed settle',
    close(raw(b).temp, approach(approach(80, 92, 6000), 58, 4000)));
  reset(b); say(b, '/burn 1'); now += 6000; N.settle(b);
  yes('settling exactly at expiry includes the full burning interval and no later heat', close(raw(b).temp, approach(20, 92, 6000)) && panel(b).burning === false);

  const c = actors[2]; reset(c, 20, 0); say(c, '/burn 1');
  yes('burning at a known fire uses the stronger contribution instead of adding two fires', panel(c).tempTarget === 92);
  say(c, '/burn 0');
  yes('ending a body fire does not remove the known nearby fire', panel(c).tempTarget === 92);
  say(c, '/place indoors - 0 1 0 -');
  yes('the real place report still removes nearby-fire warmth independently', panel(c).tempTarget === 58);

  const d = actors[3]; reset(d); now += 30000; N.settle(d);
  yes('with no fire the original thirty-second warming half-gap is unchanged', close(raw(d).temp, 39));
  const warmth = require('../data/warmth.json').items;
  const fur = Object.entries(warmth).find(([desc, row]) => desc.endsWith(':Skyrim.esm') && row.m === 'fur' && row.c === 'body');
  yes('the shipped table contains an identified fur body piece', !!fur);
  if (fur) {
    w.record(fur[0], 'ARMO');
    w.row(d).equipment = { inv: { entries: [{ baseId: w.idOf(fur[0]), count: 1, worn: true }] } };
    const clothed = panel(d);
    yes('the actual worn-ID path counts its named warmth piece and changes the target',
      clothed.cover > 0 && clothed.worn.some(row => row.known && row.worth > 0) && clothed.tempTarget > 58);
  }
  reset(d, 80); now += 90000; N.settle(d);
  yes('with no fire the original ninety-second cooling half-gap is unchanged', close(raw(d).temp, 69));
  reset(c); say(c, '/burn 1'); w.die(c, 0, null); w.row(c).isDead = false;
  yes('canonical death and immediate revival cannot retain the old fire warmth', panel(c).tempTarget === 58 && panel(c).burning === false);
  reset(b); say(b, '/burn 1');
  const saved = raw(b).temp; w.leave(b); now += 60000; w.run(2500); w.arrive(b);
  yes('rejoining does not apply the former burning interval to time spent away', close(N.settle(b).temp, saved));
  const refused = actors[4]; reset(refused); now += 60000;
  const setter = box.mp.set;
  let failures = 0;
  box.mp.set = function (id, key, next) {
    if (id === refused && key === 'thornswoodNeeds' && !failures) { failures++; throw Error('injected first fire-bank save failure'); }
    return setter(id, key, next);
  };
  try { say(refused, '/burn 1'); } finally { box.mp.set = setter; }
  yes('the failed-write case rejects the earliest actual needs bank save', failures === 1);
  yes('a later successful needs write cannot heat the idle minute before the real fire started', close(raw(refused).temp, approach(20, 58, 60000)));
  reset(refused); now += 60000;
  let active = false, refusedBanks = 0;
  box.mp.set = function (id, key, next) {
    if (id === refused && key === 'thornswoodBurnVisual' && next.on) { active = true; }
    if (id === refused && key === 'thornswoodNeeds' && !active) { refusedBanks++; throw Error('injected pre-fire bank refusal'); }
    return setter(id, key, next);
  };
  try { say(refused, '/burn 1'); } finally { box.mp.set = setter; }
  yes('the real pre-fire saves can all fail before canonical burning activates', refusedBanks > 0 && active);
  yes('even when all pre-fire banks fail a successful later settle preserves the old ambient interval',
    close(raw(refused).temp, approach(20, 58, 60000)));
  yes('a failed needs bank does not disable the canonical fire report or its active warmth target',
    w.prop(refused, 'thornswoodBurnVisual').on === true && panel(refused).tempTarget === 92);
  const beforeProjection = Object.assign(N.fresh(), { at: now - 10000, temp: 20, place: 'indoors', roof: true, fire: -1 });
  const untouched = JSON.stringify(beforeProjection), getter = box.mp.get;
  const environment = { workMultiplier: () => 1, restingGain: () => 0, outdoorCooling: () => 1,
    warmthTarget: (n, onFire) => onFire ? 92 : 58, burningFrom: now - 8000, burningUntil: now - 2000 };
  let staged;
  box.mp.get = box.mp.set = () => { throw Error('pure projection must not touch runtime state'); };
  try { staged = N.project(beforeProjection, now, false, environment); }
  finally { box.mp.get = getter; box.mp.set = setter; }
  const pure = approach(approach(approach(20, 58, 2000), 92, 6000), 58, 2000);
  yes('pure projection stages all three thermal segments from explicit environment without runtime reads or writes',
    close(staged.needs.temp, pure) && JSON.stringify(beforeProjection) === untouched);
  N.clearBurning(refused);
  yes('the same captured projection environment is independent of later live fire changes',
    JSON.stringify(N.project(beforeProjection, now, false, environment)) === JSON.stringify(staged));

  reset(a); N.setBurning(a, true);
  w.row(a)._skympNpcLifeGeneration = 1;
  now += 3000;
  yes('a settle before the burn tick cannot warm a different life using the old fire',
    close(N.settle(a).temp, approach(20, 58, 3000)));
  reset(d); N.setBurning(d, true);
  w.row(d)._skympNpcLifeGeneration = 1;
  now += 3000;
  N.setBurning(d, true);
  const newLifeAmbient = approach(20, 58, 3000);
  yes('the first report from a replacement life starts its own warmth interval',
    close(raw(d).temp, newLifeAmbient));
  now += 3000;
  yes('the replacement life warms normally after its own report',
    close(N.settle(d).temp, approach(newLifeAmbient, 92, 3000)));

  reset(a); N.setBurning(a, true);
  w.row(a)._skympNpcLifeGeneration = 2;
  const beforeCleanup = raw(a);
  now += 3000;
  N.clearBurning(a);
  yes('clearing a replaced life never writes its old fire into new needs',
    JSON.stringify(raw(a)) === JSON.stringify(beforeCleanup));

  reset(d); N.setBurning(d, true);
  now += 2000;
  const readClock = box.Date.now;
  const failedBank = new Error('injected fire clock failure');
  let reported;
  box.Date.now = () => { throw failedBank; };
  try { N.clearBurning(d); }
  catch (error) { reported = error; }
  finally { box.Date.now = readClock; }
  yes('an error while banking fire warmth reaches the caller', reported === failedBank);
  yes('a failed bank still clears the stopped fire visual', w.prop(d, 'thornswoodBurnVisual').on === false);
  now += 2000;
  yes('a stopped fire cannot apply warmth during a later settle after a failed bank',
    close(N.settle(d).temp, approach(20, 58, 4000)));
}
t.done(w);
