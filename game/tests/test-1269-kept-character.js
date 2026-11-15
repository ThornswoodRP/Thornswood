// test-1269-kept-character.js
//
// A person whose saved character the server could not read is made a new one
// and told once, on joining, that the old one was kept.
//
// WHY. Issue #1269. On the dev server ff000005 was skipped at every start
// because its race could not be read, and the next new character was given
// its id and saved over the file. Fork PR 33 keeps such a record on disk and
// never reuses its id; the fork's getUnreadableChangeForms(profileId) says
// which records of a profile were kept. Patrick, 5 October: the person gets a
// new character under a new id and is told once, on joining, that the old one
// was kept.
//
// This lifts the real tellKeptCharacter, its line and its property, and the
// real created() out of gamemode.js by text, and runs them against a stand-in
// mp: an engine with the binding, one without it, one whose binding throws,
// and a record write that does not stick. GM points it at another copy of the
// file, which is how it was shown to fail on the code before the change.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
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

function fnOf(head) {
  const a = src.indexOf(head);
  const b = a < 0 ? -1 : src.indexOf('\n}\n', a);
  return (a >= 0 && b >= 0) ? src.slice(a, b + 2) : null;
}
const tell = fnOf('function tellKeptCharacter(actorId) {');
const PROP = (/\nconst KEPT_PROPERTY = '([^']+)';/.exec(src) || [])[1] || null;
const LINE_SRC = (/\nconst KEPT_LINE =\n([\s\S]*?);\n/.exec(src) || [])[1] || null;
const LINE = LINE_SRC ? new Function('return ' + LINE_SRC + ';')() : null;
const createdAt = src.indexOf('  created: function (actorId) {');
const createdEnd = createdAt < 0 ? -1 : src.indexOf('\n  },\n', createdAt);
const created = createdAt >= 0 && createdEnd >= 0
  ? src.slice(createdAt + '  created: '.length, createdEnd + '\n  }'.length) : null;

yes('tellKeptCharacter is in gamemode.js', !!tell);
yes('and its property and its line', !!PROP && typeof LINE === 'string' && LINE.length > 0);
yes('and created(), which spawn calls when it makes a new character', !!created);
if (fail) { done(); }

/*
  The engine, as far as these calls reach it. kept is what the fork's
  getUnreadableChangeForms answers per profile; binding: 'yes', 'none' (an
  engine build before it), or 'throw'. write: 'ok', 'drop' or 'throw', for the
  record on the new character.
*/
function world(opts) {
  opts = opts || {};
  const props = {};
  const said = [];
  const lines = [];
  const asked = [];
  const made = { appearance: 0 };
  const copy = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
  const mp = {
    get(id, key) { return copy((props[id] || {})[key]); },
    set(id, key, value) {
      if (key === PROP && opts.write === 'drop') { return; }
      if (key === PROP && opts.write === 'throw') { throw new Error('no such property'); }
      (props[id] = props[id] || {})[key] = copy(value);
    },
  };
  if ((opts.binding || 'yes') === 'yes') {
    mp.getUnreadableChangeForms = function (pid) {
      asked.push(pid);
      return ((opts.kept || {})[pid] || []).slice();
    };
  } else if (opts.binding === 'throw') {
    mp.getUnreadableChangeForms = function () { throw new Error('engine said no'); };
  }
  const log = (...a) => lines.push(a.join(' '));
  const say = (id, text) => said.push({ id: id, text: text });
  const make = new Function('mp', 'log', 'say', 'KEPT_PROPERTY', 'KEPT_LINE', 'Date',
    'let keptUnaskableSaid = false;\n' + tell + '\nreturn tellKeptCharacter;');
  const clock = { now: 1790000000000 };
  const tellFn = make(mp, log, say, PROP, LINE, { now: () => clock.now });
  const createdFn = new Function('tellKeptCharacter', 'CHARGEN_ENABLED', 'chargenOf', 'firstSeen',
    'beginAppearance', 'dressNewCharacter', 'log', 'globalThis',
    'return ' + created + ';')(
    tellFn, opts.chargen !== false, () => null, new Map(),
    () => { made.appearance++; }, () => 0, log, {});
  return { mp, props, said, lines, asked, made, created: createdFn, tell: tellFn };
}
function owner(w, actorId, pid) { (w.props[actorId] = w.props[actorId] || {}).profileId = pid; }

// ------------------------------------------- the profile with a kept record
{
  const w = world({ kept: { 902356861: [0xff000005] } });
  owner(w, 0xff000007, 902356861);
  w.created(0xff000007);
  yes('the engine is asked about the new character\'s own profile',
    w.asked.length === 1 && w.asked[0] === 902356861);
  yes('the person is told, in one line, that the earlier one was kept',
    w.said.length === 1 && w.said[0].id === 0xff000007 && w.said[0].text === LINE);
  const rec = w.props[0xff000007][PROP];
  yes('the kept id is written on the new character, with its profile and when it was told',
    !!rec && rec.profileId === 902356861 && rec.kept.length === 1 && rec.kept[0] === 'ff000005' &&
    typeof rec.told === 'number' && rec.told > 0);
  yes('the log names the new character, the profile and the kept id',
    w.lines.some(l => /^kept ff000007 .*902356861.*ff000005.*told once/.test(l)));
  yes('and creation goes on', w.made.appearance === 1);

  // created() runs once per new character. Should anything call it again,
  // or the telling again, the record already says it was told.
  w.created(0xff000007);
  w.tell(0xff000007);
  yes('it is said once, however often it is asked', w.said.length === 1);
}

// --------------------------------------- with two kept, and the hall turned off
{
  const w = world({ kept: { 55: [0xff000002, 0xff000009] }, chargen: false });
  owner(w, 0xff00000a, 55);
  w.created(0xff00000a);
  yes('with "thornswoodChargen": false the person is still told',
    w.said.length === 1 && w.made.appearance === 0);
  yes('and every kept id is written', JSON.stringify(w.props[0xff00000a][PROP].kept) ===
    JSON.stringify(['ff000002', 'ff000009']));
}

// -------------------------------------------------- nothing kept, nothing said
{
  const w = world({ kept: { 77: [0xff000003] } });
  owner(w, 0xff000004, 12);
  w.created(0xff000004);
  yes('a profile with nothing kept is told nothing', w.said.length === 0);
  yes('and nothing is written on it', !(PROP in (w.props[0xff000004] || {})));
  yes('and nothing is logged for it', !w.lines.some(l => /^kept /.test(l)));
}

// --------------------------------------- an engine build without the binding
{
  const w = world({ binding: 'none' });
  owner(w, 0xff000011, 5);
  owner(w, 0xff000012, 6);
  let threw = null;
  try { w.created(0xff000011); w.created(0xff000012); } catch (e) { threw = e; }
  yes('an engine without getUnreadableChangeForms does not stop creation',
    threw === null && w.made.appearance === 2);
  yes('nobody is told anything', w.said.length === 0);
  const missing = w.lines.filter(l => /getUnreadableChangeForms/.test(l));
  yes('the log says, once, that this engine build cannot say which were kept',
    missing.length === 1 && /no getUnreadableChangeForms/.test(missing[0]));
}

// ------------------------------------------------------- a binding that throws
{
  const w = world({ binding: 'throw' });
  owner(w, 0xff000013, 5);
  let threw = null;
  try { w.created(0xff000013); } catch (e) { threw = e; }
  yes('a binding that throws does not stop creation', threw === null && w.made.appearance === 1);
  yes('nothing is said, and the log says why',
    w.said.length === 0 && w.lines.some(l => /could not ask .* profile 5 .*engine said no/.test(l)));
}

// --------------------------------------------- a record write that does not stick
for (const how of ['drop', 'throw']) {
  const w = world({ kept: { 9: [0xff000001] }, write: how });
  owner(w, 0xff000014, 9);
  w.created(0xff000014);
  w.created(0xff000014);
  yes('a record write that does not stick (' + how + ') says nothing, rather than saying it every time',
    w.said.length === 0);
  yes('and the log says the kept id and that nothing was said (' + how + ')',
    w.lines.some(l => /ff000001.*nothing was said/.test(l)));
}

// ------------------------------------------------------------- the words
{
  yes('the line says the earlier character was kept', /kept as it was/.test(LINE));
  yes('and names /helpme, the way to reach staff', /\/helpme\b/.test(LINE));
  yes('and does not claim a cause it cannot know (the race)', !/\brace\b/i.test(LINE));
  yes('no em dash', LINE.indexOf(String.fromCharCode(0x2014)) < 0);
  yes('no banned word', !/play[e]r/i.test(LINE));
  yes('short enough for one chat line', LINE.length <= 400);
}

// ----------------------------------------------------- the property is made
{
  const m = new RegExp("mp\\.makeProperty\\(KEPT_PROPERTY, \\{\\s*isVisibleByOwner: false, " +
    "isVisibleByNeighbors: false,").exec(src);
  yes('the record is a registered property, seen by neither its owner nor neighbours', !!m);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const body = code.slice(code.indexOf('created: function (actorId) {'));
  yes('created() tells before the chargen switch can return',
    body.indexOf('tellKeptCharacter(actorId)') >= 0 &&
    body.indexOf('tellKeptCharacter(actorId)') < body.indexOf('CHARGEN_ENABLED'));
}

done();
