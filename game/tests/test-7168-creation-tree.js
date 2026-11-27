'use strict';
// test-7168-creation-tree.js
//
//     node game/tests/test-7168-creation-tree.js
//
// #7168: while making a character, the skill tree did not show the points the
// class and profession picked there place. Those picks stay the panel's until
// Confirm, so the server's tree held none of them, and the tree filled in only
// once the character was in the world.
//
//   A. The server sends its own table of what each pick places, while
//      creating and only then.
//   B. The real panel (game/ui/thornswood-skills.js, in the page stand-in) is
//      given a creating state with that table. For every class, and every
//      profession with each of its halves or each pair of a mage's schools,
//      the picks are made on the panel, and the Skill tree's green pips are
//      what the server's own pickProfession and pickClass place for the same
//      picks.
//   C. A pick that is not whole places nothing yet. Out of creation, and with
//      a server that sends no table, nothing is added.
//
// Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join('');
const makePage = require('../../tests/fixtures/panel-page');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '  (' + String(why).replace(/[\r\n]+/g, ' ') + ')' : '')); }
}
function done() { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0; }

// ------------------------------------------------------------ the server
const gm = require('../../tests/gamemode-tables.js').joined(read('game/gamemode.js'));
const a = gm.indexOf('// ==== thornswood progression ====');
const b = gm.indexOf('// ==== end thornswood progression ====');
const box = { console: { log() {} } };
box.globalThis = box;
if (a >= 0 && b > a) { vm.runInNewContext(gm.slice(a, b), box); }
const P = box.__thornswoodProgression;
yes('the progression rules load out of the gamemode', !!P && !!P.TUNING && !!P.TUNING.placed);
if (!P || !P.TUNING) { done(); return; }

const character = read('game/gamemode/character.ts');
yes('A the panel view carries the placing table while creating, and nothing in the world',
    /placing: creating && P\.TUNING \? P\.TUNING\.placed : undefined,/.test(character));
yes('A and the built gamemode carries the same line', /placing: creating && P\.TUNING \? P\.TUNING\.placed : undefined/.test(gm));

// ------------------------------------------------------------ the panel
const source = process.env.SKILLS_UI ? fs.readFileSync(process.env.SKILLS_UI, 'utf8') : read('game/ui/thornswood-skills.js');
const TABLE = JSON.parse(JSON.stringify(P.TUNING.placed));
function rig(patch) {
  const p = makePage();
  p.run('bridge', read('game/ui/thornswood-bridge.js'));
  p.run('skills', source);
  const state = Object.assign({ creating: true, 'class': null, profession: null, schools: [], ranks: {}, tree: {}, placed: {}, points: 0,
    placing: TABLE, towns: [{ key: 'whiterun', name: 'Whiterun' }] }, patch);
  p.win.thornswoodSkills.setData(null, state);
  p.win.thornswoodSkills.open();
  p.body = () => p.doc.getElementById('ts-skills').querySelector('.body');
  p.click = (node) => node.onclick({ target: node, currentTarget: node, stopPropagation() {}, preventDefault() {} });
  p.nav = (label) => p.doc.querySelectorAll('.navrow').find((n) => n.querySelector('.k').textContent === label).click();
  p.card = (name) => p.body().querySelectorAll('.card').find((c) => c.querySelector('.name').textContent.indexOf(name) === 0);
  p.half = (name) => p.body().querySelectorAll('.half').find((h) => h.querySelector('.hn').textContent === name);
  // The green pips on the Skill tree, by the skill's name as the panel draws it.
  p.tree = () => {
    p.nav('Skill tree');
    const out = {};
    p.body().querySelectorAll('.skill').forEach((row) => {
      const given = row.querySelectorAll('.pip').filter((x) => x.classList.contains('given')).length;
      const lit = row.querySelectorAll('.pip').filter((x) => x.classList.contains('lit')).length;
      if (given || lit) { out[row.querySelector('.sn').textContent.toLowerCase()] = [given, lit]; }
    });
    return out;
  };
  return p;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function serverPlaced(prof, subs, cls) {
  let s = P.fresh();
  const r1 = P.pickProfession(s, prof, prof === 'mage' ? subs : subs[0]);
  if (!r1.ok) { return null; }
  const r2 = P.pickClass(r1.state, cls);
  if (!r2.ok) { return null; }
  const out = {};
  for (const k of Object.keys(r2.state.placed || {})) { if (r2.state.placed[k]) { out[k] = [r2.state.placed[k], r2.state.placed[k]]; } }
  return out;
}
const SCHOOLS = ['destruction', 'restoration', 'alteration', 'conjuration', 'illusion'];
const PROFS = ['warrior', 'mage', 'alchemist', 'cook', 'smith', 'enchanter', 'tailor', 'woodworker'];
const combos = [];
for (const prof of PROFS) {
  if (prof === 'mage') {
    for (let i = 0; i < SCHOOLS.length; i++) for (let j = i + 1; j < SCHOOLS.length; j++) combos.push([prof, [SCHOOLS[i], SCHOOLS[j]]]);
  } else {
    for (const h of P.halvesOf(prof) || []) combos.push([prof, [h]]);
  }
}
const CLASSES = Object.keys(TABLE.classes);
let checked = 0, wrong = [];
const NAMES = {};
for (const prof of PROFS) {
  if (prof !== 'mage') { for (const h of P.halvesOf(prof) || []) { NAMES[h] = h; } }
}
for (const cls of CLASSES) {
  for (const [prof, subs] of combos) {
    const want = serverPlaced(prof, subs, cls);
    if (!want) { wrong.push(prof + '/' + subs.join('+') + '/' + cls + ': the server refused'); continue; }
    const p = rig();
    p.nav('Class');
    const c = p.card(cap(cls));
    if (!c) { wrong.push('no ' + cls + ' card'); continue; }
    p.click(c);
    p.nav('Profession');
    const pc = p.card(cap(prof));
    if (!pc) { wrong.push('no ' + prof + ' card'); continue; }
    p.click(pc);
    let missing = '';
    for (const sub of subs) {
      const h = p.half(cap(sub));
      if (!h) { missing = sub; break; }
      p.click(h);
    }
    if (missing) { wrong.push('no ' + missing + ' under ' + prof); continue; }
    const got = p.tree();
    checked++;
    if (JSON.stringify(got, Object.keys(got).sort()) !== JSON.stringify(want, Object.keys(want).sort())) {
      wrong.push(prof + '/' + subs.join('+') + '/' + cls + ': drew ' + JSON.stringify(got) + ', the server places ' + JSON.stringify(want));
    }
  }
}
yes('B every class with every profession and half or pair of schools (' + checked + ') shows, while creating, the points the server places for them',
    checked === CLASSES.length * combos.length && wrong.length === 0, wrong.slice(0, 3).join('; '));

{
  const p = rig();
  p.nav('Skill tree');
  yes('B with nothing picked the tree shows nothing placed', Object.keys(p.tree()).length === 0);
  p.nav('Class'); p.click(p.card('Hunter'));
  const t = p.tree();
  yes('B a class alone shows its point at once, in green', JSON.stringify(t) === JSON.stringify({ precision: [1, 1] }), JSON.stringify(t));
  yes('B and the line above the tree says the points come with Confirm',
      /One point comes with the class and profession chosen here, in green, once Confirm sends them\./.test(p.body().querySelector('.lead').textContent));
}
{
  const p = rig();
  p.nav('Profession'); p.click(p.card('Mage')); p.click(p.half('Destruction'));
  const t = p.tree();
  yes('C a mage with one school of two places nothing yet', Object.keys(t).length === 0, JSON.stringify(t));
}
{
  const p = rig({ placing: undefined });
  p.nav('Class'); p.click(p.card('Hunter'));
  yes('C a server that sends no table adds nothing', Object.keys(p.tree()).length === 0);
}
{
  const p = rig({ creating: false, towns: [] });
  p.nav('Class'); p.click(p.card('Hunter'));
  yes('C in the world a pick not yet sent adds nothing: the server\'s tree is the tree', Object.keys(p.tree()).length === 0);
}
{
  // A class the server already holds is in its tree and placed: not counted twice.
  const p = rig({ 'class': 'hunter', ranks: { hunter: 'novice' }, tree: { precision: 1 }, placed: { precision: 1 } });
  p.nav('Profession'); p.click(p.card('Warrior')); p.click(p.half('Berserker'));
  const t = p.tree();
  yes('C a pick the server holds is not added again',
      JSON.stringify(t, Object.keys(t).sort()) === JSON.stringify({ might: [2, 2], precision: [1, 1], vitality: [1, 1] }), JSON.stringify(t));
}
done();
