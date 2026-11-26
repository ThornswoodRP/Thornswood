'use strict';
// Actual K page and bridge, with only the browser clock and transport held.
const fs = require('fs'), path = require('path');
const makePage = require('../../tests/fixtures/panel-page');
const root = path.join(__dirname, '../..');
let pass = 0, fail = 0;
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
function rig() {
  const p = makePage(), timers = [];
  let now = 100000;
  p.win.Date = class extends Date { static now() { return now; } };
  p.win.setTimeout = (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; };
  p.advance = ms => {
    now += ms;
    for (const timer of timers) { if (!timer.done && timer.at <= now) { timer.done = true; timer.fn(); } }
  };
  p.doc.createElementNS = (_, tag) => p.doc.createElement(tag);
  for (const name of ['bridge', 'skills']) {
    p.run(name, fs.readFileSync(path.join(root, 'game/ui/thornswood-' + name + '.js'), 'utf8'));
  }
  p.api = p.win.thornswoodSkills;
  p.state = { class: 'hunter', profession: 'smith', half: 'edgewright', ranks: {}, tree: {}, points: 0,
    officePage: { staff: true, door: { name: 'A house', by: 'Brenna', ours: true, staff: true },
      world: { stage: { id: 'peace', name: 'Peace' }, stages: [],
        pending: { id: 'landing', name: 'A landing', at: 25 } },
      company: { fields: [], pending: { at: 30, changes: [] } } } };
  p.show = () => p.api.setData(null, { panel: p.state });
  p.show(); p.api.open();
  p.office = () => p.doc.querySelectorAll('.navrow').find(n => n.textContent.includes('Office')).click();
  p.office();
  p.buttons = text => p.doc.querySelectorAll('.stop').filter(n => n.textContent === text);
  p.evict = () => p.doc.querySelectorAll('.stop').find(n => n.textContent === 'Evict' || n.textContent === "Press again to end Brenna's claim");
  return p;
}
{
  const p = rig(), b = p.buttons('Evict')[0];
  yes('the real Office page exposes Evict', !!b);
  b.click();
  yes('first press arms without sending', p.sent.length === 0 && /Press again/.test(b.textContent));
  p.advance(5001);
  yes('expiration restores the original button label', b.textContent === 'Evict');
  b.click();
  yes('a late single press only arms again', p.sent.length === 0);
  b.click();
  yes('a fresh second press sends once', p.sent.length === 1 && p.sent[0] === '/evict');
  yes('sending immediately restores the original label', b.textContent === 'Evict');
  b.click();
  yes('a later single press cannot repeat an earlier send', p.sent.length === 1);
}
{
  const p = rig(), evict = p.buttons('Evict')[0], confirm = p.buttons('Confirm');
  evict.click(); confirm[0].click();
  yes('another confirmation disarms the previous action', evict.textContent === 'Evict' && p.sent.length === 0);
  confirm[1].click();
  yes('only the current Office action stays armed', confirm[0].textContent === 'Confirm' && /Press again/.test(confirm[1].textContent));
  p.buttons('Drop')[0].click();
  yes('an ordinary Office action disarms a pending confirmation', confirm[1].textContent === 'Confirm' && p.sent.length === 1);
}
{
  const p = rig(), b = p.buttons('Evict')[0]; b.click();
  p.api.close(); p.api.open(); p.office();
  p.evict().click();
  yes('closing and reopening needs two fresh presses', p.sent.length === 0);
  p.state.officePage.company.pending.at = 31;
  p.show(); p.office(); p.evict().click();
  yes('an authoritative redraw cannot carry an armed action forward', p.sent.length === 0);
}
{
  const p = rig(), b = p.buttons('Evict')[0], company = p.buttons('Confirm')[1]; b.click();
  p.advance(4000); p.buttons('Confirm')[0].click();
  const current = p.buttons('Press again to move the world to A landing')[0];
  p.advance(1001);
  yes('an old action timeout cannot disarm the newly armed action', !!current && /Press again/.test(current.textContent));
  current.click();
  yes('world confirmation still sends its displayed proposal identity', p.sent.join() === '/world confirm landing 25');
  company.click(); company.click();
  yes('company confirmation still sends its displayed proposal identity', p.sent[1] === '/companyterms confirm 30');
}
console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
