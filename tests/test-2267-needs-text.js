// test-2267-needs-text.js
//
// #2267. /needs (and /need) says the four needs bars as one line of text.
//
// Patrick, 11 Oct 2026, on the board sweep's list: planned, not ruled out.
// /needs is for people who choose to hide their needs bars (the launcher's
// Settings, "Show the needs bars on screen", and Settings in the game since
// #3126) and want a quick text version of
// them. It is another view of something with a button already, the Body page
// on K, so it is his exception to "buttons, not chat commands", like the
// commands that rule already lists, and docs/GAME-SYSTEMS.md "Buttons, not
// commands" says so.
//
// The needs block is run as it stands, over a stand-in mp and a clock turned
// by hand, and the /needs branch of handle() is lifted out of the gamemode
// and run against it. The pages that name the command are read as files.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
function read() {
  return fs.readFileSync(path.join.apply(path, [ROOT].concat([].slice.call(arguments))), 'utf8').split(CR).join('');
}
const gm = read('game', 'gamemode.js');

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

const needsBlock = slice(gm, '// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
const branch = slice(gm, "    if (word === '/needs' || word === '/need') {\n", '\n    }\n');
yes('the needs block and the /needs branch of handle() are in the gamemode', !!needsBlock && !!branch);
if (!needsBlock || !branch) { done(); }

// ======================================================== A. the word lists
{
  const W = list('WORDS') || [];
  const PW = list('PLAYER_WORDS') || [];
  yes('A1 the server answers /needs and /need', W.indexOf('/needs') !== -1 && W.indexOf('/need') !== -1);
  yes('A2 /needs is on the list everybody is told, which /help reads, and /need is not named twice',
      PW.indexOf('/needs') !== -1 && PW.indexOf('/need') === -1);
  yes('A3 the branch reads the needs block\'s textView and nothing else',
      /needsSaid\.textView\(actorId\)/.test(branch) && !/\.(ate|resting|worked|place|bard)\(/.test(branch));
}

// ======================================================= B. what it says
const ids = {};
let nextId = 0x07000000;
function idOf(desc) {
  desc = String(desc || '');
  if (!desc) { return 0; }
  if (!ids[desc]) { ids[desc] = nextId++; }
  return ids[desc];
}
const HOUR = 3600000, MIN = 60000;
const clock = { t: Date.UTC(2026, 9, 11, 20, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }

let refs = {};
let online = [];
let creating = {};
function person(id, cell) {
  refs[id] = { worldOrCellDesc: cell, pos: [0, 0, 0], inventory: { entries: [] }, profileId: id & 0xffff,
               appearance: { name: 'P' + (id & 0xff) }, lastAnimEvent: null, equipment: { inv: { entries: [] } } };
  if (online.indexOf(id) === -1) { online.push(id); }
}

function needsRig() {
  const g = { __thornswoodChargen: { inCreation: function (id) { return !!creating[id]; } } };
  const fake = {
    makeProperty: function () { },
    getDescFromId: function () { return ''; },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
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
  return fn(g, fake, FakeDate, { log: function () { } },
            function () { return 0; }, function () { },
            function (n, f) { return f; }, function () { }, function () { }, idOf);
}

/* The /needs branch, run as handle() runs it. */
function typed(N, word, actorId) {
  const said = [];
  const g = { __thornswoodNeeds: N };
  new Function('globalThis', 'word', 'profileId', 'actorId', 'toProfile', 'needCharacter',
    branch + '\nreturn false;')(
    g, word, 7, actorId, function (p, t) { said.push(t); }, function () { return !!actorId; });
  return said;
}

{
  refs = {}; online = []; creating = {};
  const N = needsRig();
  yes('B0 the needs block runs and hands out textView', !!N && typeof N.textView === 'function');

  const A = 0xff000a01;
  person(A, 'inn:X.esm');
  N.settle(A);
  const first = typed(N, '/needs', A);
  yes('B1 a fresh character is told all four bars in one line: "' + (first[0] || '') + '"',
      first.length === 1 &&
      /^Hunger 100% \(fine\), Thirst 100% \(fine\), Rest 100% \(fine\), Temp Fine 50\. /.test(first[0]));
  yes('B1 and the line names the Body page on K for what sets each one', /Body page on K/.test(first[0] || ''));
  yes('B1 /need is the same word', JSON.stringify(typed(N, '/need', A)) === JSON.stringify(first));

  // 55 minutes on, with nothing eaten or drunk: thirst is bad (under 25 from
  // just after 54 minutes), hunger is still fine. The same per cents the bars
  // draw, rounded the same.
  clock.t += 55 * MIN;
  const later = typed(N, '/needs', A)[0] || '';
  const v = N.view(A);
  yes('B2 55 minutes later it says the same numbers the bars draw: "' + later.slice(0, 80) + '"',
      later.indexOf('Hunger ' + v.food + '% (' + v.foodBand + '), Thirst ' + v.drink + '% (' + v.drinkBand +
                    '), Rest ' + v.rest + '% (' + v.restBand + ')') === 0 &&
      v.drinkBand === 'bad' && v.foodBand === 'fine');

  // Indoors, the warmth climbs toward 58, and the line says which way.
  N.place(A, 'indoors', '-', '0', '1', '0', '-');
  clock.t += 10 * 1000;
  const warming = typed(N, '/needs', A)[0] || '';
  yes('B3 the Temp part says the HUD\'s word and number and where it is heading: "' +
      (/Temp [^.]*\./.exec(warming) || [''])[0] + '"', /Temp Fine \d+, warming toward 58\./.test(warming));

  // Resting: the line says where, in the Body page's words.
  N.resting(A, 'campfire');
  yes('B4 resting, it says where: by a fire', /You are resting, sitting by a fire\./.test(typed(N, '/needs', A)[0] || ''));
  N.resting(A, '');
  yes('B4 and nothing about resting when they are up', !/resting/.test(typed(N, '/needs', A)[0] || ''));

  // It reads; it does not move a meter beyond the clock that every read settles.
  const before = JSON.stringify(refs[A].needs);
  typed(N, '/needs', A);
  yes('B5 asking twice at the same moment changes nothing', JSON.stringify(refs[A].needs) === before);

  // In creation the bars are off and nothing moves; so is this.
  const C = 0xff000a02;
  person(C, 'hall:X.esm');
  creating[C] = true;
  const hall = typed(N, '/needs', C);
  yes('B6 in creation it says the needs start in the town, and names no number: "' + (hall[0] || '') + '"',
      hall.length === 1 && /leave the hall/.test(hall[0]) && !/\d/.test(hall[0]));

  // No character, no answer but the usual one.
  yes('B7 with no character in the world it is needCharacter\'s answer, nothing else', typed(N, '/needs', 0).length === 0);
}

// ====================================== C. the same words as the bars
{
  // hudScript writes the HUD as an array of quoted lines; these are its own.
  const lines = gm.split('\n');
  const from = lines.findIndex(function (l) { return /^\s*'    function tempWord\(v\) \{',$/.test(l); });
  const to = from < 0 ? -1 : lines.findIndex(function (l, i) { return i > from && /^\s*'    \}',$/.test(l); });
  const hud = (from >= 0 && to > from) ? lines.slice(from, to + 1).map(function (l) {
    const m = /^\s*'(.*)',$/.exec(l); return m ? m[1] : '';
  }).join('\n') : '';
  let hudWord = null;
  try { hudWord = hud ? new Function(hud + '\nreturn tempWord;')() : null; } catch (e) { hudWord = null; }
  const mine = slice(needsBlock, '  function tempWord(v) {\n', '\n  }\n');
  const myWord = mine ? new Function(mine + '\nreturn tempWord;')() : null;
  let same = !!hudWord && !!myWord;
  for (let t = 0; same && t <= 100; t++) { same = hudWord(t) === myWord(t); }
  yes('C1 Temp is said with the HUD\'s own word at every reading from 0 to 100', same);
  const rest = /var REST_SAID = (\{[\s\S]*?\});/.exec(needsBlock);
  const skills = read('game', 'ui', 'thornswood-skills.js');
  const page = /var REST_WORDS = (\{[\s\S]*?\});/.exec(skills);
  let a = null, b = null;
  try { a = new Function('return ' + rest[1])(); b = new Function('return ' + page[1])(); } catch (e) { a = b = null; }
  yes('C2 where somebody rests is said in the Body page\'s words, kind for kind',
      !!a && !!b && JSON.stringify(a) === JSON.stringify(b));
}

// ======================================== D. where people are told
{
  const help = read('game', 'ui', 'thornswood-help.js');
  yes('D1 the help panel\'s Living names /needs for the bars as text',
      /\/needs in the chat says all four as a line of text/.test(help));
  // The needs bars are shown or hidden on Settings in the game since #3126.
  const settingsPage = read('game', 'ui', 'thornswood-settings.js');
  yes('D3 the line under the needs bars on Settings in the game names it',
      /data-bars="0"[\s\S]{0,400}\/needs in the chat says them as a line of text\./.test(settingsPage));
  const systems = read('docs', 'GAME-SYSTEMS.md');
  const buttons = slice(systems, '## Buttons, not commands', '\n## ') || '';
  yes('D4 docs/GAME-SYSTEMS.md "Buttons, not commands" says /needs stays a command, and why',
      /`\/needs`/.test(buttons) && /11 Oct/.test(buttons) && /#2267/.test(buttons) && /hid the bars/.test(buttons));
  // The rule is the last part of the guide's rules page, so it runs to the end.
  const guide = read('docs', 'guide', 'rules.md');
  const at = guide.indexOf('\n## Buttons, not chat commands\n');
  const rule = at < 0 ? '' : guide.slice(at);
  yes('D5 docs/guide/rules.md "Buttons, not chat commands" names it beside the other exceptions', /`\/needs`/.test(rule) && /#2267/.test(rule));
  // D5b, CLAUDE.md's list, left with CLAUDE.md for the private ops repo
  // (#3693), whose tests/test-ops-docs.js holds it.
  const commands = read('docs', 'systems', 'commands.md');
  yes('D6 docs/systems/commands.md has its row: anybody, on the list, stays a command',
      /^\| `\/needs`, `\/need` \| Anybody \|[^\n]*\| The list;[^\n]*\| Stays a command[^\n]*\| #2267 \|$/m.test(commands));
  const all = [help, settingsPage, buttons, rule].join('\n');
  yes('D7 none of it says the word the house rules forbid, or has an em dash',
      !/\bplayers?\b/i.test(textOf(branch) + textOf(slice(needsBlock, '  function textView(actorId) {', '\n  }\n') || '')) &&
      all.indexOf(String.fromCharCode(0x2014)) === -1);
}
function textOf(src) { return (String(src || '').match(/'(?:[^'\\\n]|\\.)*'/g) || []).join(' '); }

done();
