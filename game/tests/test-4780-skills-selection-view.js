'use strict';
// Actual page and front bridge: arrows preserve live nodes and request nearest
// visibility for their real selected row. Browser layout is checked separately.
const fs = require('fs'), path = require('path');
const makePage = require('../../tests/fixtures/panel-page');
const root = path.join(__dirname, '../..');
const source = fs.readFileSync(process.env.SKILLS_UI || path.join(root, 'game/ui/thornswood-skills.js'), 'utf8');
let pass = 0, fail = 0;
function yes(label, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + label); ok ? pass++ : fail++; }
function rig(patch) {
  const p = makePage(), scrolled = [];
  let now = 100000;
  const timers = [];
  p.win.Date = class extends Date { static now() { return now; } };
  p.win.setTimeout = (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; };
  p.advance = ms => {
    now += ms;
    for (const timer of timers) { if (!timer.done && timer.at <= now) { timer.done = true; timer.fn(); } }
  };
  const create = p.doc.createElement;
  p.doc.createElement = tag => { const node = create(tag); node.scrollIntoView = options => scrolled.push({node, options}); return node; };
  p.run('bridge', fs.readFileSync(path.join(root, 'game/ui/thornswood-bridge.js'), 'utf8'));
  p.run('skills', source);
  const state = Object.assign({class:'hunter', profession:'mage', schools:['destruction','restoration'], ranks:{destruction:'novice',restoration:'novice'}, tree:{}, points:3, creating:false}, patch);
  p.win.thornswoodSkills.setData(null, state); p.win.thornswoodSkills.open();
  p.body = p.doc.getElementById('ts-skills').querySelector('.body');
  p.click = node => node.onclick({target:node,currentTarget:node,stopPropagation(){},preventDefault(){}});
  p.nav = label => p.doc.querySelectorAll('.navrow').find(n => n.querySelector('.k').textContent === label).click();
  p.key = (key, more) => p.fire(p.doc.body, 'keydown', key, more);
  p.scrolled = scrolled; p.state = state;
  return p;
}
for (const section of [{name:'Skill tree', selector:'.skill'}, {name:'Spell book', selector:'.spell'}, {name:'Class', selector:'.card'},
    {name:'Staff spells', selector:'.spell', state:{profession:'enchanter',schools:[],staff:{spells:[['12:Skyrim.esm','First spell','novice'],['13:Skyrim.esm','Second spell','novice']],mine:[],points:2,rank:'novice'}}},
    {name:'Starting Location', selector:'.card', state:{creating:true,home:null,towns:[{key:'whiterun',name:'Whiterun'},{key:'solitude',name:'Solitude'}]}}]) {
  const p = rig(section.state); p.nav(section.name);
  const rows = p.body.querySelectorAll(section.selector), head = p.doc.querySelector('.head').firstChild;
  yes(section.name + ' has selectable real page rows', rows.length > 1);
  rows[0].focus(); const active = p.doc.activeElement;
  p.key('ArrowDown');
  const current = p.body.querySelectorAll(section.selector);
  yes(section.name + ' arrow changes only the existing highlight', current.length === rows.length && current.every((node, i) => node === rows[i]) && !rows[0].classList.contains('at') && rows[1].classList.contains('at'));
  yes(section.name + ' arrow preserves focused control and panel heading', p.doc.activeElement === active && p.doc.body.contains(active) && p.doc.querySelector('.head').firstChild === head);
  const request = p.scrolled.at(-1);
  yes(section.name + ' reveals the actual selected node with nearest alignment', request && request.node === rows[1] && request.options.block === 'nearest' && request.options.inline === 'nearest');
  p.win.thornswoodSkills.setData(null, p.state);
  yes(section.name + ' an unchanged authoritative update retains those nodes', p.body.querySelectorAll(section.selector).every((node, i) => node === rows[i]));
  p.key('ArrowUp'); p.key('ArrowUp');
  yes(section.name + ' wrapping up highlights and reveals the final row', rows.at(-1).classList.contains('at') && p.scrolled.at(-1)?.node === rows.at(-1));
  p.key('ArrowDown', {repeat:true});
  yes(section.name + ' held arrow navigation wraps to the first row without sending', rows[0].classList.contains('at') && p.scrolled.at(-1)?.node === rows[0] && !p.told.some(x => x.includes('skills:pick ')));
}
{
  const p = rig(); p.nav('Skill tree'); p.key('ArrowDown');
  p.key('Enter'); const first = p.told.filter(x => x.includes('skills:pick spend '));
  const q = rig(); q.nav('Skill tree'); q.click(q.body.querySelectorAll('.skill')[1].querySelector('.plus'));
  yes('Enter still spends the highlighted skill through the actual bridge', first.length === 1 && first[0] === q.told.filter(x => x.includes('skills:pick spend '))[0]);
  p.key('Enter', {repeat:true});
  yes('held Enter still cannot send a second spend', p.told.filter(x => x.includes('skills:pick spend ')).length === 1);
}
{
  const p = rig(); p.nav('Skill tree');
  p.key('Enter');
  yes('a pending spend disables the plus controls', p.body.querySelectorAll('.plus').every(n => n.classList.contains('off')));
  p.advance(30001);
  p.key('ArrowDown');
  p.advance(50);
  const plus = p.body.querySelectorAll('.skill')[1].querySelector('.plus');
  yes('moving the highlight before the spend timeout redraw still releases the plus controls',
      !plus.classList.contains('off') && plus.parentNode.classList.contains('at'));
}
{
  const p = rig(); p.nav('Skill tree'); p.key('ArrowDown');
  const row = p.body.querySelectorAll('.skill')[1];
  p.win.thornswoodSkills.setData(null, Object.assign({},p.state,{points:4}));
  yes('a changed authoritative view still redraws current controls and selection', p.body.querySelectorAll('.skill')[1] !== row && p.body.querySelectorAll('.skill')[1].classList.contains('at') && /4 points/.test(p.body.textContent));
}
{
  const p = rig(); p.nav('Spell book'); p.key('ArrowDown');
  const name = p.body.querySelectorAll('.spell')[1].querySelector('.spellname').textContent;
  p.key('Enter');
  yes('Enter still marks exactly the highlighted spell', p.body.querySelectorAll('.spell.on').some(n => n.querySelector('.spellname').textContent === name) && p.body.querySelectorAll('.spell.on').length === 1);
}
{
  const p = rig({class:null,profession:null,schools:[],creating:true}); p.nav('Profession');
  p.key('ArrowDown');
  yes('Profession still renders the selected card choices', p.body.querySelectorAll('.card')[1].classList.contains('at') && p.body.querySelectorAll('.card')[1].querySelector('.half'));
  yes('Profession restores visibility after its canonical detail redraw', p.scrolled.at(-1)?.node === p.body.querySelectorAll('.card')[1]);
}
{
  const p = rig(); p.nav('Skill tree');
  const input = p.doc.createElement('input'); p.body.appendChild(input); input.focus();
  p.fire(input, 'keydown', 'ArrowDown');
  yes('normal text-field arrow keys keep their focus and selection', p.body.querySelectorAll('.skill')[0].classList.contains('at') && p.doc.activeElement === input && p.scrolled.length === 0);
}
console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
