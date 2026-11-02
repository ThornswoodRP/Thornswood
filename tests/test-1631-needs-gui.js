// test-1631-needs-gui.js
//
// #1631. Rest, needs and the bard are done in the game, not typed.
//
// Patrick, 4 Oct: "no more commands for things [people] do, only for dev and
// staff commands; everything else takes buttons and GUI". So:
//
//   /rest   the plugin's line, sent when somebody sits down, lies down or
//           gets up (#1603). Sit on the emote wheel counts as sitting on the
//           ground, by what the server sees: the last animation the game sent
//           for the person, which the engine clears when they move.
//   /needs  gone with #1631, and back as a line of text for somebody who
//           hid the bars (Patrick, 11 Oct, #2267): one of the words people
//           are told, and tests/test-2267-needs-text.js holds what it says.
//           The four bars, and the Body page on K, still say it all.
//   /eat, /drink  gone. They fed and watered with no item at all; eating and
//           drinking is the item (/ate). Said on #1382 before it went.
//   /bard   gone. Patrick's answer on #1631: playing the lute, flute or drum
//           emote, which needs the instrument, counts as the bard's word, and
//           a new Sing emote counts too. The server reads the animation and
//           the pack itself.
//
// The needs block and the property block's beds are run as they stand, over
// a stand-in mp and a clock turned by hand. The K panel's Body page is lifted
// out of thornswood-skills.js and drawn into a stand-in page.
//
// Read only, apart from its own temp folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = function () {
  return fs.readFileSync(path.join.apply(path, [ROOT].concat([].slice.call(arguments))), 'utf8').split(CR).join('');
};
const gm = require('./gamemode-tables.js').joined(read('game', 'gamemode.js'));
/*
  One topic of the help panel (#1633), as a fresh install reads it: /help's
  topics moved out of the gamemode into game/ui/thornswood-help.js, each a
  list of paragraphs made from the key names.
*/
function helpTopic(id) {
  const page = fs.readFileSync(path.join(ROOT, 'game', 'ui', 'thornswood-help.js'), 'utf8')
    .split(String.fromCharCode(13)).join('');
  const a = page.indexOf('  var TOPICS = [');
  const b = a < 0 ? -1 : page.indexOf('\n  ];\n', a);
  const k = /var keys = (\{[\s\S]*?\});/.exec(page);
  if (a < 0 || b < 0 || !k) { return ''; }
  try {
    const topics = new Function('return ' + page.slice(page.indexOf('[', a), b + 4))();
    const t = topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.text(new Function('return ' + k[1])()).join(' ') : '';
  } catch (e) { return ''; }
}
const skills = read('game', 'ui', 'thornswood-skills.js');
const emotes = read('game', 'plugins', 'thornswood-emotes.js');

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
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function list(name) {
  const m = new RegExp('^const ' + name + ' = (\\[[\\s\\S]*?\\]);$', 'm').exec(gm);
  try { return m ? new Function('return ' + m[1])() : null; } catch (e) { return null; }
}
/* One function by its whole first line, only if that line is there once. */
function lift(src, first, indent) {
  const from = '\n' + indent + first;
  const a = src.indexOf(from);
  if (a < 0 || src.indexOf(from, a + 1) >= 0) { return null; }
  const end = '\n' + indent + '}\n';
  const b = src.indexOf(end, a + 1);
  return b < 0 ? null : src.slice(a + 1, b + end.length);
}

const needsBlock = slice(gm, '// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
const chatBlock = slice(gm, '// ==== thornswood chat commands ====', '// ==== end thornswood chat commands ====');
const charBlock = slice(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====');
yes('the needs, property, chat commands and character blocks are in the gamemode',
    !!needsBlock && !!propBlock && !!chatBlock && !!charBlock);
if (!needsBlock || !propBlock || !chatBlock || !charBlock) { done(); }

// ==================================================== A. nothing is typed
const GONE = ['/eat', '/drink', '/bard'];
{
  const W = list('WORDS');
  const PW = list('PLAYER_WORDS');
  yes('A1 the server still answers /rest, the line sitting, lying down and getting up send',
      !!W && W.indexOf('/rest') !== -1 && gm.indexOf("    if (word === '/rest') {") !== -1);
  yes('A1 and answers none of /eat, /drink or /bard: typed, they are unknown words',
      !!W && GONE.every(function (w) { return W.indexOf(w) === -1; }) &&
      GONE.every(function (w) { return gm.indexOf("word === '" + w + "'") === -1; }));
  yes('A2 none of them, nor /rest, is on the list named to everybody, which /help reads',
      !!PW && PW.indexOf('/helpme') !== -1 &&
      GONE.concat(['/rest']).every(function (w) { return PW.indexOf(w) === -1; }));
  yes('A2 and /needs is, answered as /needs and /need (Patrick, 11 Oct, #2267)',
      !!PW && PW.indexOf('/needs') !== -1 && W.indexOf('/needs') !== -1 && W.indexOf('/need') !== -1);
  yes('A3 nothing in the chat commands gives food or drink without an item',
      !/needs\.ate\(/.test(chatBlock) && !/\.ate\(actorId, '(food|drink|ale)'\)/.test(chatBlock));
  /*
    Eating or drinking the item is still valued, from the engine's own
    record of it (mp.onEatItem hands it to eaten, #3136), and from no line
    the client sends: /ate was a meal anybody could type.
  */
  yes('A3 and eating or drinking the item is still valued, from mp.onEatItem and never a chat word',
      W.indexOf('/ate') === -1 && gm.indexOf("word === '/ate'") === -1 &&
      /function eaten\(actorId, baseId\)[\s\S]{0,800}?return consumed\(actorId, baseId\);/.test(needsBlock) &&
      /mp\.onEatItem = guard\('onEatItem'[\s\S]{0,3000}?needsApi\.eaten\(actorId, Number\(baseId\) \|\| 0\)/.test(gm) &&
      read('game', 'plugins', 'thornswood-front.js').indexOf("'/ate '") === -1);

  // Every quoted string in the gamemode: none tells anybody to type them.
  const said = (gm.match(/'(?:[^'\\\n]|\\.)*'/g) || []).filter(function (s) {
    return /\/(eat|drink|bard)\b/.test(s);
  });
  yes('A4 no line the server says names /eat, /drink or /bard' +
      (said.length ? ' (' + said.slice(0, 3).join(' | ') + ')' : ''), said.length === 0);

  // The help is a panel since #1633: its Living topic, as a fresh install reads it.
  const text = helpTopic('living');
  yes('A5 the help panel\'s Living names the Body page on K, Sit on the emote wheel, the instruments and Sing',
      /Body page on K/.test(text) && /Sit on the emote wheel/.test(text) &&
      /lute, flute or drum/.test(text) && /Sing/.test(text));
  yes('A5 and names no word to type but /needs, for the bars as text (#2267)',
      text.length > 0 && (text.match(/\/[a-z]*/g) || []).every(function (w) { return w === '/needs'; }));


  // The pages the issue names. Patrick's own words are quoted on some of them
  // and say /bard; a word to type is written as code.
  const pages = [['docs', 'systems', 'exhaustion.md'], ['docs', 'systems', 'thirst.md'],
    ['docs', 'systems', 'hunger.md'], ['docs', 'systems', 'temperature.md'], ['docs', 'systems', 'emotes.md'],
    ['docs', 'systems', 'people.md'], ['docs', 'systems', 'chat.md'], ['site', 'data', 'site', 'classes.md'],
    ['known page']];
  const stale = [];
  pages.forEach(function (p) {
    // Known Issues is the page /known writes, from the bot's list since #3140 (#2414).
    const t = p[0] === 'known page' ? (require('./fixtures/known-page').knownPage() || '') : read.apply(null, p);
    if (/`\/(eat|drink|bard)\b|`\/rest bed`/.test(t) || /\/needs gives/.test(t)) { stale.push(p[p.length - 1]); }
  });
  yes('A7 no page the issue names tells anybody to type them' + (stale.length ? ' (' + stale.join(', ') + ')' : ''),
      stale.length === 0);

  // #1743: the launcher's Settings page. The line under "Show the needs bars
  // on screen", and what Settings logs when the bars are turned off, both
  // said to type /needs, which the server no longer answers. Since #3126
  // they are on Settings in the game: the note under the Shown and Hidden
  // buttons, and the line the front says back when the bars go off.
  const front = read('game', 'plugins', 'thornswood-front.js');
  const settingsPage = read('game', 'ui', 'thornswood-settings.js');
  const offLine = (/said = shown \? 'The needs bars are shown\.' : ('[^;]*);/.exec(front) || [])[1] || '';
  const boxLine = (/'<p class="note">Hunger, Thirst, Rest and Temp\.[\s\S]*?<\/p>';/.exec(settingsPage) || [])[0] || '';
  yes('A8 the Settings needs bars line, and the line said when they go off, are there',
      offLine.length > 0 && boxLine.length > 0);
  yes('A8 and the line under the buttons names /needs, the bars as text (#2267)', /\/needs in the chat/.test(boxLine));
  yes('A8 and both send people to the Body page on the skills key, K unless it is moved',
      /Body page on ' \+ keyName\(SKILLS_KEY\)/.test(offLine) && /Body page on ' \+\s*esc\(nameOf\([^\n]*SkillsKey[^\n]*: 37\)\)/.test(boxLine));
}

// ================================================ B. the bard, as it plays
const LUTE = '1d9b:PlayFluteLuteDrum.esp', FLUTE = 'd62:PlayFluteLuteDrum.esp', DRUM = '287f:PlayFluteLuteDrum.esp';
const ids = {};
let nextId = 0x07000000;
function idOf(desc) {
  desc = String(desc || '');
  if (!desc) { return 0; }
  if (!ids[desc]) {
    const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(desc);
    ids[desc] = m ? parseInt(m[1], 16) : (nextId++);
  }
  return ids[desc];
}

const HOUR = 3600000, MIN = 60000;
const clock = { t: Date.UTC(2026, 9, 4, 20, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }

let refs = {};
let online = [];
function person(id, cell) {
  refs[id] = { worldOrCellDesc: cell, pos: [0, 0, 0], inventory: { entries: [] }, profileId: id & 0xffff,
               appearance: { name: 'P' + (id & 0xff) }, lastAnimEvent: null };
  if (online.indexOf(id) === -1) { online.push(id); }
}
function carry(id, desc) { refs[id].inventory.entries.push({ baseId: idOf(desc), count: 1 }); }
function anim(id, ev) { refs[id].lastAnimEvent = ev; }

function needsRig() {
  const g = {};
  const timers = [];
  const fake = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (key === 'thornswoodNeeds') { return refs[id] ? refs[id].needs : undefined; }
      if (!refs[id]) { throw new Error('no reference ' + id); }
      const v = refs[id][key];
      return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    },
    set: function (id, key, v) {
      if (key === 'thornswoodNeeds') { refs[id].needs = JSON.parse(JSON.stringify(v)); return; }
      refs[id][key] = v;
    }
  };
  const fn = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', needsBlock + '\nreturn globalThis.__thornswoodNeeds;');
  const api = fn(g, fake, FakeDate, { log: function () { } },
                 function (f, ms) { timers.push({ f: f, ms: ms }); return timers.length; }, function () { },
                 function (n, f) { return f; }, function () { }, function () { }, idOf);
  // The meters' own tick, by its 20 seconds; the burning has a timer too.
  const meters = timers.filter(function (t) { return t.ms === 20000; });
  api.tick = meters.length === 1 ? meters[0].f : null;
  return api;
}

{
  refs = {}; online = [];
  const N = needsRig();
  yes('B0 the needs block runs and its tick is on a timer', !!N && !!N.playing && !!N.bardSeen && typeof N.tick === 'function');

  const A = 0xff000a01;
  person(A, 'inn:X.esm');
  function plays(ev, carried) {
    refs[A].inventory.entries = [];
    (carried || []).forEach(function (d) { carry(A, d); });
    anim(A, ev);
    return N.playing(A);
  }
  yes('B1 the lute emote with a lute in the pack is playing', plays('IdleLuteStart', [LUTE]) === true);
  yes('B1 the lute emote with no lute is not', plays('IdleLuteStart', []) === false);
  yes('B1 the flute emote with only a lute is not', plays('IdleFluteStart', [LUTE]) === false);
  yes('B1 the flute and the drum with their own instruments are',
      plays('IdleFluteStart', [FLUTE]) === true && plays('IdleDrumStart', [DRUM]) === true);
  yes('B1 Sing needs nothing in the pack', plays('IdleDialogueHappyStart', []) === true);
  yes('B1 Sit, standing up, another emote, and having moved are not',
      plays('IdleSitCrossLeggedEnter', [LUTE]) === false && plays('IdleForceDefaultState', [LUTE]) === false &&
      plays('IdleWave', [LUTE]) === false && plays(null, [LUTE]) === false);

  /*
    Somebody resting at the inn, minute by minute through the real tick, with
    and without a bard. Tired first, so the rest is nowhere near the cap.
  */
  function restOver(minutes, setUp, each) {
    refs = {}; online = [];
    const R = needsRig();
    const t = R.tick;
    const ME = 0xff000b01, BARD = 0xff000b02;
    person(ME, 'inn:X.esm');
    R.settle(ME);
    clock.t += 18 * HOUR;
    R.settle(ME);
    if (setUp) { person(BARD, 'inn:X.esm'); setUp(BARD); }
    R.resting(ME, 'inn');
    const from = R.settle(ME).rest;
    const steps = [];
    for (let i = 0; i < minutes; i++) {
      if (each && setUp) { each(i, BARD); }
      clock.t += MIN; t();
      steps.push(R.settle(ME).rest);
    }
    return { gain: R.settle(ME).rest - from, steps: steps, from: from };
  }
  const alone = restOver(4);
  yes('B2 four minutes at the inn are worth something on their own', alone.gain > 0);
  const lute = restOver(4, function (b) { carry(b, LUTE); anim(b, 'IdleLuteStart'); });
  yes('B2 somebody playing the lute in the same cell makes the rest better', lute.gain > alone.gain + 1e-9);
  const noLute = restOver(4, function (b) { anim(b, 'IdleLuteStart'); });
  yes('B2 the lute emote with no lute in the pack does nothing', Math.abs(noLute.gain - alone.gain) < 1e-9);
  const sing = restOver(4, function (b) { anim(b, 'IdleDialogueHappyStart'); });
  yes('B2 Sing does it with an empty pack', sing.gain > alone.gain + 1e-9);
  const away = restOver(4, function (b) { carry(b, LUTE); anim(b, 'IdleLuteStart'); refs[b].worldOrCellDesc = 'road:X.esm'; });
  yes('B2 a bard in another cell does not', Math.abs(away.gain - alone.gain) < 1e-9);

  // Plays for a minute, then stands up: counts for 5 minutes after, then not.
  const base = restOver(10);
  const stops = restOver(10, function (b) { carry(b, LUTE); anim(b, 'IdleLuteStart'); },
                         function (i, b) { if (i === 1) { anim(b, 'IdleForceDefaultState'); } });
  function minuteGain(r, i) { return r.steps[i] - (i ? r.steps[i - 1] : r.from); }
  yes('B3 four minutes after the lute stops, the bard still counts',
      minuteGain(stops, 4) > minuteGain(base, 4) + 1e-9);
  yes('B3 and seven minutes after, it does not', Math.abs(minuteGain(stops, 8) - minuteGain(base, 8)) < 1e-9);
  const plays10 = restOver(10, function (b) { carry(b, LUTE); anim(b, 'IdleLuteStart'); });
  yes('B3 a bard who keeps playing keeps counting past 5 minutes, the word said again on every tick',
      minuteGain(plays10, 8) > minuteGain(base, 8) + 1e-9);
}

// ======================================= C. Sit on the wheel, on the ground
{
  refs = {}; online = [];
  const N = needsRig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1631-sit-'));
  fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
  fs.mkdirSync(path.join(dir, 'private'));
  fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({ claims: {} }));
  const told = [];
  const CHAIR = 'c003:Skyrim.esm';
  const RECORDS = {};
  RECORDS[idOf(CHAIR)] = { record: { type: 'FURN', editorId: 'CommonChair01', fields: [] } };
  const INN_CHAIR = 0x00c00001;
  refs[INN_CHAIR] = { baseDesc: CHAIR, worldOrCellDesc: 'inn:X.esm', pos: [500, 0, 0] };
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (!refs[id]) { throw new Error('no reference ' + id); }
      const v = refs[id][key];
      return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    },
    set: function (id, key, v) { refs[id][key] = JSON.parse(JSON.stringify(v)); },
    getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
    lookupEspmRecordById: function (id) { return RECORDS[id] || null; }
  };
  const box = {
    console: { log: function () { } }, require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, idOf: idOf,
    notify: function (id, text) { told.push({ id: id, text: text }); },
    say: function (id, text) { told.push({ id: id, text: text }); },
    guard: function (n, f) { return f; },
    setInterval: function () { return 1; }, clearInterval: function () { }, log: function () { },
    __thornswoodNeeds: N,
    __thornswoodCharacter: { stateOf: function () { return { v: 1 }; }, writeState: function () { } }
  };
  box.globalThis = box;
  const was = process.cwd();
  process.chdir(dir);
  try { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); }
  catch (e) { console.log('  (' + e.message + ')'); }
  finally { process.chdir(was); }
  const B = box.__thornswoodBeds;
  yes('C0 the property block runs and publishes the beds', !!B && typeof B.tick === 'function');
  if (!B) { done(); }
  function tick() { process.chdir(dir); try { B.tick(); } finally { process.chdir(was); } }
  function resting(id) { return N.settle(id).resting; }

  const SAM = 0xff000c01, TOM = 0xff000c02;
  person(SAM, 'tundra:X.esm');
  person(TOM, 'inn:X.esm');
  tick();   // both seen once
  N.settle(SAM); N.settle(TOM);
  told.length = 0;

  anim(SAM, 'IdleSitCrossLeggedEnter');
  tick();
  yes('C1 Sit on the wheel is sitting: the seat\'s rate, with nothing typed', resting(SAM) === 'sit');
  yes('C1 and sitting down is not news', told.length === 0);

  N.place(SAM, 'outdoors', '-', '1', '0', 0, 150);
  tick();
  yes('C2 a fire in reach makes it the campfire', resting(SAM) === 'campfire');
  N.place(SAM, 'outdoors', '-', '1', '0', 0, '-');
  tick();
  yes('C2 and leaving the fire makes it a seat again', resting(SAM) === 'sit');

  anim(SAM, 'IdleForceDefaultState');
  tick();
  yes('C3 standing up ends it, on the next measure', resting(SAM) === '');
  anim(SAM, 'IdleSitCrossLeggedEnter');
  tick();
  anim(SAM, null);   // the engine clears it the moment they move
  tick();
  yes('C3 and so does walking off', resting(SAM) === '');
  anim(SAM, 'IdleWave');
  tick();
  yes('C3 and another emote is not sitting', resting(SAM) === '');
  yes('C3 none of it is said', told.length === 0);

  // The word is not believed: nothing pressed, nothing sat on.
  let line = '';
  process.chdir(dir);
  try { line = B.rest(SAM, refs[SAM].profileId); } finally { process.chdir(was); }
  yes('C4 /rest with nothing pressed and no Sit is refused, and rests nobody',
      /nothing here to rest on/.test(line) && resting(SAM) === '');

  // A chair stays a chair, and the ground gives way to it.
  anim(TOM, 'IdleSitCrossLeggedEnter');
  tick();
  yes('C5 on the ground at the inn first', resting(TOM) === 'sit' && !!B.state.lying[TOM] && B.state.lying[TOM].ground);
  refs[TOM].pos = [500, 0, 0];
  B.touched(TOM, INN_CHAIR, CHAIR);
  anim(TOM, 'IdleChairFrontEnter');
  process.chdir(dir);
  try { B.rest(TOM, refs[TOM].profileId); } finally { process.chdir(was); }
  tick();
  yes('C5 then on a chair, which the server saw pressed, and the ground no longer counts',
      resting(TOM) === 'sit' && !B.state.lying[TOM].ground && B.state.lying[TOM].ref === INN_CHAIR);
}

// ===================================================== D. the Body page on K
{
  const ws = slice(charBlock, '  function writeState(actorId, s, redraw) {', '\n  }\n') || '';
  const sigAt = ws.indexOf('var sig = drawn(view);');
  const bodyAt = ws.indexOf('view.body = N.view(actorId)');
  const sendAt = ws.indexOf('if (sending) {');
  yes('D1 writeState puts the needs block\'s view on the panel as body, only on a panel that is going',
      sigAt >= 0 && sendAt > sigAt && bodyAt > sendAt && /!view\.creating && N && N\.view/.test(ws));
  yes('D1 and the signature is taken before it, so the body\'s numbers alone never send the panel',
      bodyAt > sigAt && !/body/.test(slice(charBlock, '  function drawn(view) {', '\n  }\n') || 'body'));

  yes('D2 K has a Body section in the world, never while creating, with no Confirm',
      /if \(!creating\(\) && bodyView\(\)\) sections\.push\('body'\);/.test(skills) &&
      /section !== 'apprentice' && (?:section !== 'hairdye' && )?section !== 'body'(?: && section !== 'alchemy')?(?: && section !== 'college')?\);/.test(skills) &&
      /if \(section === 'body'\) return 0;/.test(skills));

  const parts = ['function bodyView() {', 'function bodyWorries(v) {', 'function tempWord(t) {', 'function drawNeeds() {']
    .map(function (f) { return lift(skills, f, '  '); });
  const words = slice(skills, '  var BAND_WORDS = {', '\n  };\n');
  const rest = ['  var REST_WORDS = {', '  var PLACE_WORDS = {'].map(function (f) { return slice(skills, f, '\n  };\n'); });
  yes('D3 the Body page\'s functions lift out of the panel', parts.every(Boolean) && !!words && rest.every(Boolean));
  function node(tag, cls, text) {
    return { tag: tag, className: cls || '', text: text || '', kids: [], onclick: null,
             appendChild: function (k) { this.kids.push(k); return k; } };
  }
  function textOf(n) { return [n.text].concat(n.kids.map(textOf)).join(' '); }
  function find(n, text) {
    if (n.text === text) { return n; }
    for (let i = 0; i < n.kids.length; i++) { const f = find(n.kids[i], text); if (f) { return f; } }
    return null;
  }
  const told = [];
  const elBody = node('div');
  const draw = new Function('mine', 'el', 'elBody', 'tell',
    [words].concat(rest, parts).join('\n') + '\nreturn { draw: drawNeeds, worries: bodyWorries, view: bodyView };');
  const view = { food: 64, drink: 22, rest: 80, temp: 44, foodBand: 'fine', drinkBand: 'bad', restBand: 'fine',
                 tempBand: 'fine', resting: 'campfire', place: 'snow', roof: false, night: true, fireAway: 120,
                 fireWorth: 30, tempTarget: 58, exposure: -12, cover: 41,
                 worn: [{ name: 'Fur Armor', worth: 31, known: true }, { name: 'Odd Hat', worth: 0, known: false }] };
  const page = draw({ body: view }, node, elBody, function (w) { told.push(w); });
  page.draw();
  const t = textOf(elBody);
  yes('D4 it shows the meters and their bands', /Hunger/.test(t) && /64 of 100/.test(t) && /Thirst/.test(t) &&
      /22 of 100/.test(t) && /\bbad\b/.test(t) && /Rest/.test(t));
  yes('D4 where you are resting', /Resting now, sitting by a fire\./.test(t));
  yes('D4 the warmth with its target and what sets it',
      /Warming toward 58/.test(t) && /out in the snow/.test(t) && /with no roof/.test(t) && /at night/.test(t) &&
      /a fire 120 away, worth 30/.test(t) && /worth -12/.test(t) && /covers 41 per cent/.test(t));
  yes('D4 and what is counted as worn, and what the warmth table does not know',
      /Fur Armor/.test(t) && /31%/.test(t) && /Odd Hat/.test(t) && /not in the warmth table/.test(t));
  const again = find(elBody, 'Read again');
  if (again && again.onclick) { again.onclick({ stopPropagation: function () { } }); }
  yes('D5 Read again asks the server for the panel again, the line K sends as it opens',
      told.length === 1 && told[0] === 'refresh');
  yes('D6 the section list names what is wrong, in words', page.worries(view).join(',') === 'thirsty');
  const none = node('div');
  draw({ body: Object.assign({}, view, { worn: [] }) }, node, none, function () { }).draw();
  yes('D6 a body the server holds no clothes for says so', /no record of anything on you/.test(textOf(none)));
  const creating = node('div');
  draw({ creating: true }, node, creating, function () { }).draw();
  yes('D6 and no body, nothing drawn', creating.kids.length === 0);
}

// ================================== E. the wheel and the server agree on names
{
  const a = emotes.indexOf('const EMOTES = [');
  const b = a < 0 ? -1 : emotes.indexOf('\n];', a);
  let EMOTES = [];
  try { EMOTES = new Function('return ' + emotes.slice(a + 'const EMOTES = '.length, b + 2) + ';')(); } catch (e) { EMOTES = []; }
  const by = {};
  EMOTES.forEach(function (e) { by[e.name] = e.event; });
  const names = EMOTES.map(function (e) { return e.name; });
  yes('E1 the wheel has Sing, and the list is still in alphabetical order',
      by.Sing === 'IdleDialogueHappyStart' &&
      names.join('|') === names.slice().sort(function (x, y) { return x.toLowerCase() < y.toLowerCase() ? -1 : 1; }).join('|'));
  const plays = /var BARD_PLAYS = (\{[\s\S]*?\});/.exec(needsBlock);
  let P = null;
  try { P = plays ? new Function('return ' + plays[1])() : null; } catch (e) { P = null; }
  const inst = /const INSTRUMENTS = (\{[\s\S]*?\n\});/.exec(emotes);
  let I = null;
  try { I = inst ? new Function('return ' + inst[1])() : null; } catch (e) { I = null; }
  const fileM = /const INSTRUMENT_FILE = '([^']+)';/.exec(emotes);
  function descOf(k) { return I && I[k] && fileM ? I[k].id.toString(16) + ':' + fileM[1] : ''; }
  yes('E3 the server\'s bard is the wheel\'s Lute, Flute, Drum and Sing, by their events',
      !!P && Object.keys(P).sort().join(',') ===
        [by.Lute, by.Flute, by.Drum, by.Sing].map(function (e) { return String(e).toLowerCase(); }).sort().join(','));
  yes('E3 and each instrument is the one the wheel asks for',
      !!P && P[by.Lute.toLowerCase()] === descOf('lute') && P[by.Flute.toLowerCase()] === descOf('flute') &&
      P[by.Drum.toLowerCase()] === descOf('drum') && P[by.Sing.toLowerCase()] === '');
  const sit = /var GROUND_SIT = '([^']+)';/.exec(propBlock);
  yes('E4 the server\'s ground seat is the wheel\'s Sit', !!sit && !!by.Sit && sit[1] === by.Sit.toLowerCase());
}

done();
