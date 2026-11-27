'use strict';
// test-7173-rank-bars.js
//
//     node game/tests/test-7173-rank-bars.js
//
// #7173 (Patrick, 26 Nov: in the K menu): a bar showing how far each
// profession half, school and class is toward its next rank. The lines above
// the Skill tree said it in words ("Advanced in 7 more"); each now has a bar
// beside the words, filled to the work done of the work the rank needs.
//
//   A. The real panel (game/ui/thornswood-skills.js, in the page stand-in),
//      given the progress the server sends: one bar per line, filled to done
//      of need, with the same numbers for a screen reader. A rank earned and
//      waiting (a sister half held for its Master) is a full bar.
//   B. A piece of work changes the bar in place: the same bar, filled further,
//      and the page is not rebuilt under the reader.
//   C. A line with no numbers to fill a bar (an old server's left) keeps its
//      words and draws no bar, and the server's ladder gives every rank above
//      novice a number, so every line it sends has its bar.
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

const source = process.env.SKILLS_UI ? fs.readFileSync(process.env.SKILLS_UI, 'utf8') : read('game/ui/thornswood-skills.js');
function base(progress) {
  return { creating: false, 'class': 'miner', profession: 'smith', half: 'platewright', schools: [],
    ranks: { miner: 'advanced', platewright: 'novice', edgewright: 'novice' }, tree: {}, placed: {}, points: 0,
    progress: progress };
}
function rig(progress) {
  const p = makePage();
  p.run('bridge', read('game/ui/thornswood-bridge.js'));
  p.run('skills', source);
  p.win.thornswoodSkills.setData(null, base(progress));
  p.win.thornswoodSkills.open();
  p.body = () => p.doc.getElementById('ts-skills').querySelector('.body');
  p.nav = (label) => p.doc.querySelectorAll('.navrow').find((n) => n.querySelector('.k').textContent === label).click();
  p.lines = () => p.body().querySelectorAll('.prow').map((row) => {
    const bar = row.querySelector('.pbar');
    const fill = bar ? bar.querySelector('.pfill') : null;
    return { k: row.querySelector('.pk').textContent, t: row.querySelector('.pv').textContent, bar: bar,
      width: fill ? fill.style.width : null, attrs: bar ? bar.attrs : {}, full: bar ? bar.classList.contains('done') : null };
  });
  return p;
}

const PROG = { platewright: { next: 'advanced', done: 3, need: 10 },
  miner: { next: 'expert', done: 25, need: 25 } };
{
  const p = rig(PROG);
  p.nav('Skill tree');
  const L = p.lines();
  const plate = L.find((l) => /platewright/i.test(l.k));
  const miner = L.find((l) => /miner/i.test(l.k));
  yes('A one line for each key that can climb, each with a bar', L.length === 2 && L.every((l) => !!l.bar), JSON.stringify(L.map((l) => l.k)));
  yes('A the half\'s bar is filled to 3 of 10, beside its words', !!plate && plate.width === '30%' && plate.t === 'Advanced in 7 more',
      plate && (plate.width + ' ' + plate.t));
  yes('A and it says the same to a screen reader', !!plate && plate.attrs.role === 'progressbar' && plate.attrs['aria-valuemin'] === '0' &&
      plate.attrs['aria-valuemax'] === '10' && plate.attrs['aria-valuenow'] === '3' && plate.attrs['aria-valuetext'] === 'Advanced in 7 more' &&
      /toward Advanced/.test(plate.attrs['aria-label']), plate && JSON.stringify(plate.attrs));
  yes('A a rank earned and held is a full bar, drawn as done', !!miner && miner.width === '100%' && miner.full && miner.t === 'Expert earned' &&
      !plate.full, miner && (miner.width + ' ' + miner.t));

  // B. one more piece of work on the half
  const before = plate.bar;
  const bodyBefore = p.body().querySelector('.progress');
  p.win.thornswoodSkills.setData(null, base({ platewright: { next: 'advanced', done: 4, need: 10 }, miner: PROG.miner }));
  const after = p.lines().find((l) => /platewright/i.test(l.k));
  yes('B a piece of work fills the same bar further, 4 of 10', !!after && after.bar === before && after.width === '40%' &&
      after.attrs['aria-valuenow'] === '4' && after.t === 'Advanced in 6 more', after && (after.width + ' ' + after.t));
  yes('B and the lines are not rebuilt under the reader', p.body().querySelector('.progress') === bodyBefore);
  // more work than the rank needs never draws past the end
  p.win.thornswoodSkills.setData(null, base({ platewright: { next: 'advanced', done: 14, need: 10 }, miner: PROG.miner }));
  const over = p.lines().find((l) => /platewright/i.test(l.k));
  yes('B work past the rank\'s need is a full bar, not past its end', !!over && over.width === '100%' && over.full, over && over.width);
}
{
  const p = rig({ platewright: { next: 'advanced', left: 4 } });
  p.nav('Skill tree');
  const L = p.lines();
  yes('C a line with only an old server\'s left keeps its words and draws no bar',
      L.length === 1 && !L[0].bar && L[0].t === 'Advanced in 4 more', JSON.stringify(L.map((l) => [l.t, !!l.bar])));
}
{
  const gm = require('../../tests/gamemode-tables.js').joined(read('game/gamemode.js'));
  const a = gm.indexOf('// ==== thornswood progression ====');
  const b = gm.indexOf('// ==== end thornswood progression ====');
  const box = { console: { log() {} } };
  box.globalThis = box;
  if (a >= 0 && b > a) { vm.runInNewContext(gm.slice(a, b), box); }
  const P = box.__thornswoodProgression;
  const per = P && P.TUNING && P.TUNING.workPerRank;
  yes('C the server\'s ladder gives every rank above novice a need, so each line it sends has a bar',
      !!per && ['advanced', 'expert', 'master'].every((r) => Number(per[r]) > 0), JSON.stringify(per));
  const character = read('game/gamemode/character.ts');
  yes('C and the server sends done and need on each line, leaving out one with nothing to climb',
      /out\[key\] = \{ next: next, done: P\.workDone\(s, key\), need: need \};/.test(character) && /if \(!need\) \{ continue; \}/.test(character));
}
done();
