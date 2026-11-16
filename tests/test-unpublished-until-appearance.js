// test-unpublished-until-appearance.js
//
// A brand-new profile is not treated as chargen-finished, and is not on the
// social lists, until an appearance object is actually stored.
//
// MEASURED ON DEV, 3 Oct 2026 about 22:31 ET. Djinn picked new profile
// 598737699. The race menu never opened. He was in the world as the
// placeholder Adventurer. Voice worked. The trade/party menu named him
// "somebody". Patrick could not see a body.
//
// The walking path (MOVED_ENOUGH_MS, half a second) and the five-minute
// give-up both called beginChoosing while appearance was still missing.
// Neighbours then got an actor with no base (player 0x7 is omitted on
// purpose) and no face, so the client correctly refused a mesh. The trade
// name fell back because appearance.name was empty. Voice is keyed by
// profile id and is not this.
//
// This is the Thornswood half: never leave the face step without a stored
// appearance, and hide unpublished people from the social lists. The engine
// half (omit empty-appearance actors from onlinePlayers and from neighbor
// CreateActor) is a separate pull request on the fork. One side alone is
// not the whole fix.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function fnOf(head) {
  const a = src.indexOf(head);
  const b = a < 0 ? -1 : src.indexOf('\n}\n', a);
  return (a >= 0 && b >= 0) ? src.slice(a, b + 2) : null;
}
function num(name) {
  const m = new RegExp('\nconst ' + name + ' = (\\d+);').exec(src);
  return m ? Number(m[1]) : null;
}

const hasSrc = fnOf('function hasStoredAppearance(a) {');
const pubSrc = fnOf('function publishedForOthers(actorId) {');
const beginSrc = fnOf('function beginChoosing(actorId, state, why) {');
yes('hasStoredAppearance is in the gamemode', !!hasSrc);
yes('publishedForOthers is in the gamemode', !!pubSrc);
yes('beginChoosing is in the gamemode', !!beginSrc);

const hasStoredAppearance = hasSrc
  ? new Function('return ' + hasSrc)()
  : function () { return false; };

// ------------------------------------------------------- the gate itself
yes('null is not a stored appearance', hasStoredAppearance(null) === false);
yes('undefined is not a stored appearance', hasStoredAppearance(undefined) === false);
yes('a string is not a stored appearance', hasStoredAppearance('Adventurer') === false);
yes('an empty object is a stored appearance (the engine wrote a face)',
    hasStoredAppearance({}) === true);
yes('a blank name is still a stored appearance',
    hasStoredAppearance({ name: '' }) === true);
yes('a named face is a stored appearance',
    hasStoredAppearance({ name: 'Sera', raceId: 7 }) === true);
yes('the word Adventurer is not special-cased',
    hasSrc && !/Adventurer/.test(hasSrc));
yes('a blank name is not the gate',
    hasSrc && !/name/.test(hasSrc));

{
  const faces = {};
  const throws = {};
  const mp = {
    get: function (id, key) {
      if (key !== 'appearance') { return null; }
      if (throws[id]) { throw new Error('no appearance property'); }
      return faces[id];
    }
  };
  const publishedForOthers = new Function('mp', 'hasStoredAppearance',
    'return ' + pubSrc)(mp, hasStoredAppearance);
  yes('publishedForOthers is false while appearance is missing',
      publishedForOthers(1) === false);
  faces[1] = { name: '' };
  yes('publishedForOthers is true once an appearance object is stored, blank name included',
      publishedForOthers(1) === true);
  throws[2] = true;
  yes('a throwing appearance read is treated as published, so a returning character is not hidden',
      publishedForOthers(2) === true);
}

// ----------------------------------------------- beginChoosing refuses
{
  const logs = [];
  const states = {};
  let shift = 0, closed = 0, opened = 0, said = 0;
  const faces = {};
  const mp = {
    get: function (id, key) { return key === 'appearance' ? (faces[id] || null) : null; }
  };
  const beginChoosing = new Function(
    'mp', 'log', 'hasStoredAppearance', 'setChargen', 'giveShift',
    'closeRaceMenu', 'openCreation', 'tellOnce', 'CHOOSE_REMIND_MS', 'Date',
    'return ' + beginSrc)(
    mp,
    function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    hasStoredAppearance,
    function (id, s) { states[id] = s; },
    function () { shift++; },
    function () { closed++; },
    function () { opened++; return true; },
    function () { said++; },
    30000,
    { now: function () { return 1000; } }
  );

  const fresh = { stage: 'appearance', at: 1 };
  beginChoosing(7, fresh, 'on their feet');
  yes('beginChoosing without a stored appearance leaves them on the face step',
      fresh.stage === 'appearance' && !states[7]);
  yes('and does not dress them, close the race menu, or open the panel',
      shift === 0 && closed === 0 && opened === 0 && said === 0);
  yes('and the log says they are not leaving the face step',
      logs.join(' ').indexOf('no appearance is stored yet') !== -1);

  faces[8] = { name: '' };
  const ready = { stage: 'appearance', at: 1 };
  beginChoosing(8, ready, 'the face arrived');
  yes('beginChoosing with a stored appearance (blank name) moves them to choosing',
      ready.stage === 'choosing' && states[8] && states[8].stage === 'choosing');
  yes('and then dresses them and opens the panel',
      shift === 1 && opened === 1 && said === 1);
}

// ------------------------------------- appearance stage, the real text
const START = "    if (state.stage === 'appearance') {";
const a = src.indexOf(START);
const END = '\n    }\n';
const b = a < 0 ? -1 : src.indexOf(END, a);
const stage = (a >= 0 && b >= 0) ? src.slice(a, b + END.length) : '';
yes('the appearance stage is in the gamemode', stage.length > 0 && /GIVEUP_MS/.test(stage));

const NUDGE_MS = num('NUDGE_MS');
const GIVEUP_MS = num('GIVEUP_MS');
const MOVED_ENOUGH_MS = num('MOVED_ENOUGH_MS');
const MOVED_UNITS = num('MOVED_UNITS');
const MOVED_DEGREES = num('MOVED_DEGREES');
const FACE_SEEN_MS = num('FACE_SEEN_MS');
const FACE_CAP_MS = num('FACE_CAP_MS');

const AGAIN = "Your character creation menu didn't open. Opening it again.";
const RELOG = 'The character creation menu still did not open. Relog, and if it ' +
  'still does not open, contact staff.';

function tick(opts) {
  const out = { chose: null, asks: 0, said: [], log: [], state: opts.state };
  const actorId = 0xff000056;
  const now = opts.now;
  const firstSeen = new Map([[actorId, opts.state.seenAt || 1]]);
  const appearance = opts.appearance === undefined ? null : opts.appearance;
  const state = opts.state;
  const mp = {
    get: function (id, key) {
      if (key === 'pos') { return opts.pos || [0, 0, 0]; }
      if (key === 'angle') { return opts.angle || [0, 0, 0]; }
      return null;
    },
    setRaceMenuOpen: function () { out.asks++; }
  };
  const tellOnce = function (id, step, text) {
    if (!state.told) { state.told = {}; }
    if (state.told[step]) { return false; }
    state.told[step] = now;
    out.said.push(text);
    return true;
  };
  const fn = new Function(
    'actorId', 'now', 'firstSeen', 'appearance', 'state', 'mp', 'log',
    'setChargen', 'faceMark', 'beginChoosing', 'hasStoredAppearance', 'tellOnce',
    'NUDGE_MS', 'GIVEUP_MS', 'MOVED_ENOUGH_MS', 'MOVED_UNITS', 'MOVED_DEGREES',
    'FACE_SEEN_MS', 'FACE_CAP_MS',
    'do {\n' + stage + '\n} while (false);');
  fn(actorId, now, firstSeen, appearance, state, mp,
     function () { out.log.push(Array.prototype.join.call(arguments, ' ')); },
     function (id, s) { out.state = s; },
     function (ap) { return (ap && ap.mark) ? String(ap.mark) : ''; },
     function (id, s, why) { out.chose = why; },
     hasStoredAppearance, tellOnce,
     NUDGE_MS, GIVEUP_MS, MOVED_ENOUGH_MS, MOVED_UNITS, MOVED_DEGREES,
     FACE_SEEN_MS, FACE_CAP_MS);
  return out;
}

function stuck(at) {
  return { stage: 'appearance', at: at, seenAt: 1, askedAt: at, faceWas: '' };
}

{
  const t0 = 1000000;
  const walk = stuck(t0);
  walk.liveSince = t0;
  const out = tick({ state: walk, now: t0 + MOVED_ENOUGH_MS + 100 });
  yes('walking half a second with no stored face does not publish them',
      out.chose === null);
  yes('and asks for the race menu once', out.asks === 1);
}

{
  const t0 = 2000000;
  const walk = stuck(t0);
  walk.liveSince = t0;
  // Same mark as at the start, so this is walking with a face already stored,
  // not the "the face arrived" branch.
  walk.faceWas = 'stored';
  const out = tick({
    state: walk, now: t0 + MOVED_ENOUGH_MS + 100,
    appearance: { mark: 'stored', name: '' }
  });
  yes('walking with a stored face (blank name) still leaves the face step',
      out.chose === 'on their feet');
}

{
  const t0 = 3000000;
  const out = tick({ state: stuck(t0), now: t0 + GIVEUP_MS + 1000 });
  yes('the five-minute give-up without a stored face does not publish them',
      out.chose === null);
  yes('and the log says staying unpublished',
      out.log.join(' ').indexOf('staying unpublished') !== -1);
  yes('and that lost request is asked once', out.asks === 1);
}

{
  const t0 = 4000000;
  const out = tick({
    state: stuck(t0), now: t0 + GIVEUP_MS + 1000,
    appearance: { mark: 'late-face' }
  });
  yes('the five-minute give-up with a stored face still moves them on',
      out.chose !== null);
}

{
  const t0 = 5000000;
  const at = t0 + FACE_CAP_MS + 60000;
  const st = stuck(t0);
  st.faceOpenAt = t0 + 5000;
  st.faceSeenAt = at - 10000;
  const out = tick({ state: st, now: at });
  yes('FACE_CAP without a stored face does not publish them', out.chose === null);
  yes('and a reported-up menu is not sent another open', out.asks === 0);
}

{
  const t0 = 6000000;
  const st = stuck(t0);
  st.faceDone = true;
  const out = tick({ state: st, now: t0 + 2000 });
  yes('the plugin closing the race menu without a store does not publish them',
      out.chose === null);
  yes('and the closed-without-a-face case is asked once', out.asks === 1);
}

{
  const t0 = 7000000;
  const out = tick({
    state: stuck(t0), now: t0 + 2000,
    appearance: { mark: 'the-face-arrived' }
  });
  yes('a face that actually arrives still ends the stage at once',
      out.chose === 'the face arrived');
  yes('and a stored face is not asked to open the race menu', out.asks === 0);
}

{
  const t0 = 8000000;
  let st = stuck(t0);
  const said = [];
  let asks = 0;
  function step(at) {
    const out = tick({ state: st, now: at });
    st = out.state;
    asks += out.asks;
    for (let i = 0; i < out.said.length; i++) { said.push(out.said[i]); }
    return out;
  }
  step(t0 + NUDGE_MS + 1);
  step(t0 + 2 * NUDGE_MS + 1);
  step(t0 + 3 * NUDGE_MS + 1);
  const fourth = step(t0 + 4 * NUDGE_MS + 1);
  yes('a lost request is asked on each two-minute interval', asks === 4 && fourth.asks === 1);
  yes('the two player lines are each that one sentence, once',
      said.length === 2 && said[0] === AGAIN && said[1] === RELOG);
  const up = stuck(t0);
  up.faceOpenAt = t0 + 5000;
  up.faceSeenAt = t0 + 3 * NUDGE_MS;
  const held = tick({ state: up, now: t0 + 3 * NUDGE_MS + 1 });
  yes('a reported-up race menu is not asked again', held.asks === 0 && held.chose === null);

  const quiet = stuck(t0);
  quiet.faceOpenAt = t0 + 5000;
  quiet.faceSeenAt = t0 + 5000;
  const silent = tick({ state: quiet, now: t0 + 4 * NUDGE_MS + 1 });
  yes('a quiet-but-still-open menu is not asked again',
      silent.asks === 0 && silent.chose === null);
  const lost = tick({ state: stuck(t0), now: t0 + 4 * NUDGE_MS + 1 });
  yes('a truly lost request (no report ever) is still asked',
      lost.asks === 1 && lost.chose === null);

  const aDown = src.indexOf('  faceDown: function (actorId) {');
  const bDown = aDown < 0 ? -1 : src.indexOf('\n  },\n', aDown);
  yes('faceDown is in the chargen block', aDown >= 0 && bDown > aDown);
  if (aDown >= 0 && bDown > aDown) {
    const body = src.slice(aDown + '  faceDown: '.length, bDown + 4);
    const store = {};
    const faceDown = new Function('chargenOf', 'setChargen', 'log',
      'return ' + body + ';')(
      function (id) { return store[id] || null; },
      function (id, s) { store[id] = s; },
      function () { });
    const shut = stuck(t0);
    shut.faceOpenAt = t0 + 5000;
    shut.faceSeenAt = t0 + 5000;
    store[0xff000056] = shut;
    faceDown(0xff000056);
    yes('an unreported close does not leave the menu marked open forever',
        !shut.faceOpenAt && !shut.faceSeenAt && !shut.faceDone);
    const asked = tick({ state: shut, now: t0 + 4 * NUDGE_MS + 1 });
    yes('and a still-connected player with no stored face is asked again',
        asked.asks === 1 && asked.chose === null);
  }
}

// -------------------------- onUpdateAppearanceAttempt, when the tick cannot see them
{
  const hook = src.indexOf('mp.onUpdateAppearanceAttempt = guard(\'onUpdateAppearanceAttempt\'');
  yes('onUpdateAppearanceAttempt is still the body-shape hook', hook >= 0);
  yes('and it moves a waiting character to choosing when a face is actually stored',
      hook >= 0 &&
      /hasStoredAppearance\(appearance\)/.test(src.slice(hook, hook + 500)) &&
      /beginChoosing\(actorId, st, 'the face arrived'\)/.test(src.slice(hook, hook + 500)));
}

// ------------------------------------------------------ social lists hide them
{
  const social = (function () {
    const i = src.indexOf('// ==== thornswood social:');
    const j = src.indexOf('// ==== end thornswood social ====', i);
    return (i >= 0 && j > i) ? src.slice(i, j) : null;
  })();
  yes('the social block is in the gamemode', !!social);

  const store = {};
  const clock = { now: 1700000000000 };
  const g = {};
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') {
        return Object.keys(store).filter(function (k) { return store[k].here; }).map(Number);
      }
      const row = store[id];
      return row ? row[key] : undefined;
    },
    set: function (id, key, v) {
      if (!store[id]) { store[id] = {}; }
      store[id][key] = v;
    }
  };
  new Function(
    'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'say', 'notify',
    social)(
    g, mp, { now: function () { return clock.now; } },
    { log: function () { } },
    function () { return 1; },
    function () { },
    function (n, f) { return f; },
    function () { },
    function () { });

  store[0xff000001] = {
    here: true, profileId: 101, appearance: { name: 'Bjorn' },
    worldOrCellDesc: 'town:X.esm', pos: [0, 0, 0]
  };
  store[0xff000099] = {
    here: true, profileId: 598737699, appearance: null,
    worldOrCellDesc: 'town:X.esm', pos: [50, 0, 0]
  };

  // Lifted social-only, no chargen helper: the filter is a no-op so existing
  // tests that never attach one keep seeing everybody.
  g.__thornswoodSocial.nearTick();
  yes('without the chargen helper the near list still includes a missing face',
      !!((store[0xff000001].thornswoodNear || {}).w || {})['ff000099']);

  // The chargen block's own test of a stored face, which the social block
  // asks of the appearance it read once this pass (#1721).
  g.__thornswoodChargen = { hasStoredAppearance: hasStoredAppearance };
  g.__thornswoodSocial.nearTick();
  yes('with the helper, a missing appearance is not on the near list',
      !((store[0xff000001].thornswoodNear || {}).w || {})['ff000099']);

  store[0xff000099].appearance = { name: '' };
  g.__thornswoodSocial.nearTick();
  const shown = ((store[0xff000001].thornswoodNear || {}).w || {})['ff000099'];
  yes('after a face is stored they are on the list', !!shown);
  yes('and the empty name still falls back to somebody',
      !!shown && shown.n === 'somebody');
}

// --------------------------------- things this must not rewrite
yes('the somebody fallback string is still the trade/party name when the name is empty',
    /return 'somebody';/.test(src));
yes('voice is still keyed by profile id, not by appearance',
    /profileId/.test(src) && !/function voice/.test(hasSrc || ''));
yes('closeRaceMenu still uses the stored-object check, not a name',
    /has = !!\(a && typeof a === 'object'\)/.test(src));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
