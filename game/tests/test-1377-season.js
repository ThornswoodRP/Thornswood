const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const SRC = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const WEATHER_JSON = path.join(ROOT, 'game', 'data', 'weather.json');
const src = fs.readFileSync(SRC, 'utf8').split('\r').join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function between(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) { return null; }
  return src.slice(a, b);
}

function liftFn(name) {
  const token = 'function ' + name + '(';
  let a = src.indexOf(token);
  if (a < 0) { return null; }
  const open = src.indexOf('{', a);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (!depth) { return src.slice(a, i + 1); } }
  }
  return null;
}

const seasonSrc = between('// ==== thornswood season ====', '// ==== end thornswood season ====');
yes('the season block is in the gamemode', !!seasonSrc && seasonSrc.indexOf('g.__thornswoodSeason =') >= 0);
yes('the season block does not announce the next sky', !!seasonSrc && seasonSrc.indexOf('notify(') < 0);
yes('the season block does not follow the game month', !!seasonSrc && !/getMonth|GetMonth/.test(seasonSrc));

const weatherFile = JSON.parse(fs.readFileSync(WEATHER_JSON, 'utf8'));
const cathedral = { clear: [], cloudy: [], rain: [], snow: [] };
Object.keys(weatherFile.items).forEach(function (desc) {
  if (desc.indexOf('Cathedral Weathers.esp') < 0) { return; }
  const k = Number(weatherFile.items[desc].k) || 0;
  const kind = (k & 8) ? 'snow' : (k & 4) ? 'rain' : (k & 2) ? 'cloudy' : (k & 1) ? 'clear' : '';
  if (kind) { cathedral[kind].push(desc); }
});
yes('weather.json already has the nine Cathedral records',
  cathedral.clear.length === 1 && cathedral.cloudy.length === 1 &&
  cathedral.rain.length === 2 && cathedral.snow.length === 5);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-1377-'));
const prevCwd = process.cwd();
process.chdir(tmp);

function boot() {
  delete global.__thornswoodSeasonState;
  delete global.__thornswoodSeason;
  global.mp = {
    makeProperty: function () { },
    get: function () { return ''; },
    set: function () { }
  };
  global.idOf = function (desc) {
    const n = parseInt(String(desc).split(':')[0], 16);
    return n || 0;
  };
  global.WEATHER = { items: weatherFile.items };
  global.holdOfCell = function () { return null; };
  global.nearestCapital = function () { return null; };
  global.WORLDSPACES = { has: function () { return false; } };
  if (!seasonSrc) { return null; }
  eval(seasonSrc);
  return global.__thornswoodSeason;
}

const S = boot();
yes('the season block loads', !!S && typeof S.grownMs === 'function' && typeof S.odds === 'function');

const WEEK = S ? S.WEEK : 7 * 24 * 60 * 60 * 1000;
const EPOCH = 1700000000000;
if (S) { S.setEpoch(EPOCH); }

function seasonAt(t) { return S && S.seasonAt(t); }
yes('the first count is spring, and a week is 7 real days',
  !!S && WEEK === 7 * 24 * 60 * 60 * 1000 &&
  seasonAt(EPOCH) === 'spring' &&
  seasonAt(EPOCH + WEEK - 1) === 'spring' &&
  seasonAt(EPOCH + WEEK) === 'summer' &&
  seasonAt(EPOCH + 2 * WEEK) === 'autumn' &&
  seasonAt(EPOCH + 3 * WEEK) === 'winter' &&
  seasonAt(EPOCH + 4 * WEEK) === 'spring');
yes('time before the first count is spring', !!S && seasonAt(EPOCH - 1000) === 'spring');

yes('outdoor shifts are 0, +4, -2, -6',
  !!S && S.outdoorShift(EPOCH) === 0 &&
  S.outdoorShift(EPOCH + WEEK) === 4 &&
  S.outdoorShift(EPOCH + 2 * WEEK) === -2 &&
  S.outdoorShift(EPOCH + 3 * WEEK) === -6);

const outdoorSrc = liftFn('outdoorSeason');
const underSrc = liftFn('underSeason');
let outdoorSeason = null;
if (outdoorSrc && underSrc) {
  outdoorSeason = new Function('g', underSrc + '\n' + outdoorSrc + '\nreturn outdoorSeason;')(global);
}
if (S) { S.setEpoch(Date.now() - (3 * WEEK) - 1000); }
yes('indoors and a roof ignore the season shift, and winter outdoors is -6',
  !!outdoorSeason && !!S && S.seasonAt(Date.now()) === 'winter' &&
  outdoorSeason({ place: 'indoors' }) === 0 &&
  outdoorSeason({ place: 'outdoors', roof: true }) === 0 &&
  outdoorSeason({ place: 'outdoors' }) === -6 &&
  outdoorSeason({ place: 'snow' }) === -6 &&
  outdoorSeason({ place: 'rain' }) === -6 &&
  outdoorSeason({ place: 'water' }) === -6 &&
  outdoorSeason({ place: 'shallow' }) === -6 &&
  outdoorSeason({ place: 'fire' }) === 0);
if (S) { S.setEpoch(Date.now() - WEEK); }
yes('summer outdoors is 4 warmer',
  !!outdoorSeason && !!S && S.seasonAt(Date.now()) === 'summer' && outdoorSeason({ place: 'outdoors' }) === 4);
if (S) { S.setEpoch(Date.now() - 2 * WEEK); }
yes('autumn outdoors is 2 colder',
  !!outdoorSeason && !!S && outdoorSeason({ place: 'outdoors' }) === -2);
if (S) { S.setEpoch(Date.now()); }
yes('spring outdoors is 0',
  !!outdoorSeason && !!S && outdoorSeason({ place: 'outdoors' }) === 0);

const climates = ['open', 'WinterholdHoldLocation', 'PaleHoldLocation', 'mountains',
  'WhiterunHoldLocation', 'RiftHoldLocation', 'FalkreathHoldLocation', 'DLC2SolstheimLocation'];
const seasons = ['spring', 'summer', 'autumn', 'winter'];
let oddsOk = !!S;
let winterClear = false, summerSnow = false, snowyFloor = true, mildSummerSnow = null;
if (S) {
  seasons.forEach(function (season) {
    climates.forEach(function (climate) {
      const o = S.odds(season, climate);
      const sum = o.clear + o.cloudy + o.rain + o.snow;
      if (sum !== 100 || o.clear < 0 || o.cloudy < 0 || o.rain < 0 || o.snow < 0) { oddsOk = false; }
      if (climate === 'WinterholdHoldLocation' || climate === 'PaleHoldLocation' || climate === 'mountains') {
        if (o.clear < 10) { snowyFloor = false; }
      }
    });
  });
  const openWinter = S.odds('winter', 'open');
  const openSummer = S.odds('summer', 'open');
  winterClear = openWinter.clear > 0;
  summerSnow = openSummer.snow > 0;
  mildSummerSnow = S.odds('summer', 'WhiterunHoldLocation').snow;
  yes('written odds stay 100, snowy clear stays at least 10', oddsOk && snowyFloor);
  yes('winter can be clear and summer can snow', winterClear && summerSnow && openWinter.clear === 20 && openSummer.snow === 2);
  yes('a mild summer moves only the snow that exists, so snow can be 0', mildSummerSnow === 0 && S.odds('summer', 'WhiterunHoldLocation').clear === 42);
  yes('Solstheim uses the written table', S.odds('winter', 'DLC2SolstheimLocation').snow === 20 && S.odds('winter', 'DLC2SolstheimLocation').clear === 20);
} else {
  yes('written odds stay 100, snowy clear stays at least 10', false);
  yes('winter can be clear and summer can snow', false);
  yes('a mild summer moves only the snow that exists, so snow can be 0', false);
  yes('Solstheim uses the written table', false);
}

function queueUnit(list) {
  const q = list.slice();
  global.__thornswoodSeasonUnit = function () { return q.length ? q.shift() : 0; };
}
function rollDesc(kindUnit, recUnit) {
  S.resetRolls();
  queueUnit([kindUnit, recUnit, 0]);
  const row = S.ensureRoll('open', EPOCH);
  return row && row.desc;
}
if (S) { S.setEpoch(EPOCH); }
let poolOk = !!S;
if (S) {
  [['clear', 0], ['cloudy', 0.30], ['rain', 0.60], ['snow', 0.95]].forEach(function (pair) {
    const kind = pair[0];
    const list = cathedral[kind];
    list.forEach(function (desc, i) {
      const got = rollDesc(pair[1], (i + 0.01) / list.length);
      if (got !== desc) { poolOk = false; }
    });
  });
}
yes('each Cathedral record is used, and no record was added', poolOk);

let sharedOk = false, lengthOk = false;
if (S) {
  S.resetRolls();
  let n = 0;
  global.__thornswoodSeasonUnit = function () { return n++ < 3 ? 0 : 0.99; };
  const a = S.ensureRoll('open', EPOCH);
  const a2 = S.ensureRoll('open', EPOCH);
  const b = S.ensureRoll('WinterholdHoldLocation', EPOCH);
  const a3 = S.ensureRoll('open', EPOCH);
  sharedOk = a && a2 && a3 && a.desc === a2.desc && a.until === a3.until && a !== b && a.until !== b.until;
  lengthOk = a.minutes === 20 && b.minutes === 60;
  S.resetRolls();
  global.__thornswoodSeasonUnit = function () { return 0; };
  const short = S.ensureRoll('open', EPOCH);
  S.resetRolls();
  global.__thornswoodSeasonUnit = function () { return 0.999999; };
  const long = S.ensureRoll('RiftHoldLocation', EPOCH);
  lengthOk = lengthOk && short.minutes === 20 && long.minutes === 60;
}
yes('one roll is shared by a climate and the next climate has its own', sharedOk);
yes('a roll lasts 20 to 60 whole minutes', lengthOk);

if (S) { S.setEpoch(Date.now()); global.__thornswoodSeasonUnit = function () { return 0; }; S.resetRolls(); }
const clearOverSnow = S && S.skyAdjust(1, { place: 'snow', high: 0 });
const clearOverBare = S && S.skyAdjust(2, { place: 'outdoors', high: 0 });
yes('a clear sky leaves ground snow as the snow place, and bare ground clear',
  !!clearOverSnow && clearOverSnow.kind === 'clear' && clearOverSnow.place === 'snow' &&
  !!clearOverBare && clearOverBare.place === 'outdoors' && clearOverBare.kind === 'clear');
if (S) {
  S.resetRolls();
  global.__thornswoodSeasonUnit = function () { return 0.95; };
}
const snowOverBare = S && S.skyAdjust(3, { place: 'outdoors', high: 0 });
yes('snow in the sky does not turn bare ground into the snow place',
  !!snowOverBare && snowOverBare.kind === 'snow' && snowOverBare.place === 'outdoors');
if (S) {
  S.resetRolls();
  global.__thornswoodSeasonUnit = function () { return 0.60; };
}
const rainOverBare = S && S.skyAdjust(4, { place: 'outdoors', high: 0 });
yes('rain may mark bare ground, and indoors drops the forced sky',
  !!rainOverBare && rainOverBare.kind === 'rain' && rainOverBare.place === 'rain' &&
  S.skyAdjust(5, { place: 'indoors', high: 9000 }).place === 'indoors' &&
  S.skyAdjust(5, { place: 'indoors', high: 9000 }).id === 0);

global.mp.get = function (id, key) {
  if (key === 'worldOrCellDesc') { return id === 7 ? '800:dragonborn.esm' : 'cell'; }
  if (key === 'pos') { return [0, 0, 0]; }
  return '';
};
global.holdOfCell = function () { return 'PaleHoldLocation'; };
global.nearestCapital = function () { return 'WhiterunHoldLocation'; };
global.WORLDSPACES = { has: function (cell) { return cell === '800:dragonborn.esm' || cell === 'world'; } };
const mountains = S && S.climateOf(1, { place: 'outdoors', high: 6001 });
const notQuite = S && S.climateOf(1, { place: 'outdoors', high: 6000 });
const indoorsHigh = S && S.climateOf(1, { place: 'indoors', high: 9000 });
const solstheim = S && S.climateOf(7, { place: 'outdoors', high: 0 });
const pale = S && S.climateOf(8, { place: 'outdoors', high: 0 });
global.holdOfCell = function () { return null; };
global.nearestCapital = function () { return null; };
const unknown = S && S.climateOf(9, { place: 'outdoors', high: 0 });
yes('height above 6,000 is the mountain climate, and 6,000 itself is not',
  mountains === 'mountains' && notQuite !== 'mountains' && indoorsHigh !== 'mountains');
yes('Solstheim, a hold, and an unknown climate resolve without a new table',
  solstheim === 'DLC2SolstheimLocation' && pale === 'PaleHoldLocation' && unknown === 'open');

if (S) { S.setEpoch(EPOCH); }
yes('winter grows nothing, for every rank, even across a warm spell the clock does not read',
  !!S && S.grownMs(EPOCH + 3 * WEEK, EPOCH + 4 * WEEK, 'novice') === 0 &&
  S.grownMs(EPOCH + 3 * WEEK, EPOCH + 4 * WEEK, 'expert') === 0 &&
  S.grownMs(EPOCH + 3 * WEEK, EPOCH + 4 * WEEK, 'master') === 0);
yes('autumn grows novice and advanced, and an expert or a master waits',
  !!S && S.grownMs(EPOCH + 2 * WEEK, EPOCH + 3 * WEEK, 'novice') === WEEK &&
  S.grownMs(EPOCH + 2 * WEEK, EPOCH + 3 * WEEK, 'advanced') === WEEK &&
  S.grownMs(EPOCH + 2 * WEEK, EPOCH + 3 * WEEK, 'expert') === 0 &&
  S.grownMs(EPOCH + 2 * WEEK, EPOCH + 3 * WEEK, 'master') === 0);
yes('spring and summer grow every rank, including time from before the first count',
  !!S && S.grownMs(EPOCH, EPOCH + WEEK, 'master') === WEEK &&
  S.grownMs(EPOCH + WEEK, EPOCH + 2 * WEEK, 'expert') === WEEK &&
  S.grownMs(EPOCH - WEEK, EPOCH, 'novice') === WEEK);
yes('a plot paused in winter resumes from where the clock stopped',
  !!S && S.grownMs(EPOCH + 3 * WEEK - 1000, EPOCH + 4 * WEEK + 2500, 'novice') === 3500 &&
  S.grownMs(EPOCH + 3 * WEEK - 1000, EPOCH + 4 * WEEK + 2500, 'expert') === 2500);

const hiveSrc = liftFn('hive');
const isHiveSrc = liftFn('isHive');
const hivesLine = src.indexOf("const HIVES = {") >= 0;
let hiveApi = null;
if (hiveSrc && isHiveSrc) {
  const hives = src.slice(src.indexOf('const HIVES = {'), src.indexOf('function isHive('));
  hiveApi = new Function(
    'classGate', 'addItem', 'creditWork', 'cooldownLeft', 'stampCooldown', 'waitWord', 'ITEMS', 'HARVEST_COOLDOWN_MS',
    'function economyGathered() { }\n' + hives + '\n' + isHiveSrc + '\n' + hiveSrc + '\nreturn { hive: hive, isHive: isHive, HIVES: HIVES };'
  )(
    function (actorId) { return actorId === 2 ? 'Only a farmer can bring a crop in. Ask one.' : null; },
    function (actorId, desc, n) { hiveApi && hiveApi.given.push({ actorId: actorId, desc: desc, n: n }); return true; },
    function (actorId, key) { hiveApi && hiveApi.work.push(key); return null; },
    function () { return hiveApi && hiveApi.wait; },
    function () { hiveApi && hiveApi.stamped.push(1); },
    function (ms) { return Math.ceil(ms / 60000) + ' minutes'; },
    { honeycomb: 'b08c5:Skyrim.esm' },
    600000
  );
  hiveApi.given = [];
  hiveApi.work = [];
  hiveApi.stamped = [];
  hiveApi.wait = 0;
}
const HIVE = 'dbf8b3:Thornswood-Content.esp';
yes('hive() is a farmer verb on the placed hive only',
  !!hiveApi && hiveApi.isHive(HIVE) === true && hiveApi.hive(1, 9, 'flower') === null);
const handed = hiveApi && hiveApi.hive(1, 9, HIVE);
yes('a farmer takes 1 Honeycomb, one piece of farm work, and no rank gate',
  handed && handed.indexOf('You take 1 Honeycomb.') === 0 &&
  hiveApi.given.length === 1 && hiveApi.given[0].desc === 'b08c5:Skyrim.esm' && hiveApi.given[0].n === 1 &&
  hiveApi.work.length === 1 && hiveApi.work[0] === 'farm' &&
  hiveSrc.indexOf('classGate(actorId, \'farm\')') >= 0 &&
  !/rankOf|ladder|expert|advanced/.test(hiveSrc));
const refused = hiveApi && hiveApi.hive(2, 9, HIVE);
yes('someone who is not a farmer gets the farm refusal, not an empty answer',
  refused === 'Only a farmer can bring a crop in. Ask one.');
hiveApi && (hiveApi.wait = 600000);
const waiting = hiveApi && hiveApi.hive(1, 9, HIVE);
yes('the hive waits 10 minutes',
  !!hiveSrc && /HARVEST_COOLDOWN_MS/.test(hiveSrc) &&
  waiting && waiting.indexOf('10 minutes') >= 0);
const handlerAt = src.indexOf('else if (isHive(baseDesc))');
const plantAt = src.indexOf('else if (isPlant(baseDesc))');
const churnAt = src.indexOf('else if (isChurn(baseDesc))');
yes('the activate chain answers the hive as the farmer, after the churn and before a plant',
  hivesLine && handlerAt > churnAt && handlerAt < plantAt &&
  src.indexOf('message = hive(') > 0);

process.chdir(prevCwd);
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
