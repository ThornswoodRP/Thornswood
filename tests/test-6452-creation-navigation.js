// Creation's footer follows the same sections as its sidebar. Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../game/ui/thornswood-skills.js'), 'utf8').replace(/\r/g, '');
function lift(name) {
  const start = src.indexOf('\n  function ' + name + '(');
  assert(start >= 0, name + ' exists');
  return src.slice(start, src.indexOf('\n  }\n', start) + 5);
}
const c = {
  section: 'profession', sections: ['profession', 'class', 'tree', 'guides', 'home', 'review'],
  picked: {}, later: {}, mine: { towns: [{ key: 'whiterun', name: 'Whiterun' }] }, cr: true,
  creating() { return c.cr; }, haveProf() { return false; }, haveClass() { return false; }, haveHome() { return false; },
  rowOf(sec, key) { return ({ warrior: { name: 'Warrior', pick: 1 }, mage: { name: 'Mage', pick: 2 }, hunter: { name: 'Hunter' } })[key]; },
  nameOf(sec, key) { return key; },
  elBack: { style: {} }, elNext: { style: {} }, draws: 0,
  elBody: { focus() {} },
  goTo(sec) { c.section = sec; }, draw() { c.draws++; c.drawCreationNav(); }
};
vm.createContext(c);
vm.runInContext(['softProf', 'softClass', 'softHome', 'canCreationNext', 'drawCreationNav', 'creationStep'].map(lift).join('\n'), c);
c.drawCreationNav();
assert.equal(c.elBack.style.display, 'none', 'no Back on the first tab');
assert.equal(c.elNext.disabled, true, 'Next disabled until profession is chosen or deferred');
c.creationStep(1); assert.equal(c.section, 'profession', 'a disabled Next cannot navigate programmatically');
c.picked.profession = { row: 'warrior', subs: [] };
assert.equal(c.canCreationNext(), false, 'profession without its half is incomplete');
c.picked.profession = { row: 'mage', subs: ['destruction'] };
assert.equal(c.canCreationNext(), false, 'a mage needs both schools');
c.picked.profession.subs.push('restoration');
assert.equal(c.canCreationNext(), true);
c.picked.profession = null; c.later.profession = true;
c.creationStep(1); assert.equal(c.section, 'class'); assert.equal(c.cr, true);
assert.equal(c.elBack.style.display, '', 'Back appears after the first tab');
assert.equal(c.elNext.disabled, true, 'class requires a choice or deferral');
c.picked.class = { row: 'hunter' }; assert.equal(c.canCreationNext(), true);
c.picked.class = null; c.later.class = true;
c.creationStep(1); assert.equal(c.section, 'tree'); assert.equal(c.elNext.disabled, false);
c.creationStep(1); assert.equal(c.section, 'guides'); assert.equal(c.elNext.disabled, false);
c.creationStep(1); assert.equal(c.section, 'home'); assert.equal(c.elNext.disabled, true);
c.creationStep(1); assert.equal(c.section, 'home', 'location cannot be skipped');
c.later.home = true; assert.equal(c.canCreationNext(), false, 'a location cannot be deferred');
c.picked.home = { row: 'not-a-town' }; assert.equal(c.canCreationNext(), false);
c.picked.home = { row: 'whiterun' }; c.creationStep(1);
assert.equal(c.section, 'review'); assert.equal(c.elNext.style.display, 'none', 'Review offers final Confirm instead of Next');
c.creationStep(1); assert.equal(c.section, 'review', 'Next never wraps or finishes creation');
for (const sec of ['home', 'guides', 'tree', 'class', 'profession']) { c.creationStep(-1); assert.equal(c.section, sec); }
c.creationStep(-1); assert.equal(c.section, 'profession');
c.sections.splice(1, 0, 'spells'); c.creationStep(1);
assert.equal(c.section, 'spells', 'conditional sidebar tabs are also visited');
assert.equal(c.elNext.disabled, false, 'spell book does not require marking anything');
c.cr = false; c.drawCreationNav();
assert.equal(c.elBack.style.display, 'none'); assert.equal(c.elNext.style.display, 'none');
c.creationStep(1); assert.equal(c.section, 'spells', 'navigation is creation-only');
assert.match(src, /home:\s*\{\s*title:\s*'Starting Location'/);
assert.match(src, /data-act="back"[\s\S]*data-act="next"[\s\S]*data-act="close"/, 'navigation sits beside Close Skyrim');
assert.match(src, /<button[^>]*data-act="next"/, 'Next uses native disabled button semantics');
assert.match(src, /elBack\.onclick = function \(\) \{ creationStep\(-1\); \};/);
assert.match(src, /elNext\.onclick = function \(\) \{ creationStep\(1\); \};/);
console.log('PASS creation navigation: ordered tabs, choice gates, deferrals, boundaries and footer controls');
