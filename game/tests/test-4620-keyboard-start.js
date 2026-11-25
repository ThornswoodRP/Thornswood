'use strict';
const fs = require('fs'), path = require('path');
const makePage = require('../../tests/fixtures/panel-page.js');
const source = fs.readFileSync(process.env.SELECT || path.join(__dirname, '../ui/thornswood-select.js'), 'utf8');
let pass = 0, fail = 0;
function yes(label, value, detail) { console.log((value ? 'PASS ' : 'FAIL ') + label); if (!value && detail) console.log(JSON.stringify(detail)); value ? pass++ : fail++; }
function rig() {
  const p = makePage(); let now = 10000; const timers = [];
  class Clock extends Date { static now() { return now; } }
  p.win.Date = Clock;
  p.win.setTimeout = (fn, ms) => { timers.push({ fn, ms, active: true }); return timers.length; };
  p.win.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].active = false; };
  p.messages = [];
  p.win.skyrimPlatform.sendMessage = (...args) => p.messages.push(args);
  p.win.THORNSWOOD_SELECT = { slots: 2, characters: [{ profileId: 11, name: 'Aldis' }, { profileId: 22, name: 'Sera' }] };
  p.run('select', source);
  p.api = p.win.thornswoodSelect;
  p.node = selector => p.doc.querySelector('#ts-select ' + selector);
  p.key = (key, extra) => p.fire(p.doc.activeElement, 'keydown', key, extra);
  p.advance = ms => { now += ms; };
  p.expireAsk = () => timers.filter(t => t.active && t.ms === 1000).forEach(t => { t.active = false; t.fn(); });
  p.ask = () => {
    const message = p.messages.filter(m => m[0] === 'thornswood-front' && /^select:keycheck /.test(m[1])).at(-1);
    return message ? Number(message[1].split(' ').at(-1)) : 0;
  };
  p.opened = () => /opening/.test(p.node('.intro').className);
  p.continued = () => p.messages.some(m => m[0] === 'thornswood' && m[1] === 'choosing');
  p.pickCount = () => p.messages.filter(m => (m[0] === 'thornswood' && m[1] === 'select') ||
    (m[0] === 'thornswood-front' && /^select:want /.test(m[1]))).length;
  return p;
}
{
  const p = rig(); p.key('Enter');
  yes('before any native keyboard proof the seal stays closed without a mouse', !p.opened());
  p.api.keys(false); p.key('Enter'); p.key(' ');
  yes('keys reported as belonging to another window do not open the scroll', !p.opened());
  p.api.keys(true); p.key('Enter');
  yes('fresh native foreground proof permits Enter to open the scroll without a mouse', p.opened());
  yes('the opened scroll focuses its own checkbox', p.doc.activeElement === p.node('.skipnext'));
  p.key(' ');
  yes('Space toggles the scroll checkbox', p.node('.skipnext').checked === true);
  p.key(' ', { repeat: true });
  yes('a held Space does not keep toggling the checkbox', p.node('.skipnext').checked === true);
  p.key('Tab');
  yes('Tab reaches Continue', p.doc.activeElement === p.node('.go'));
  p.key('Tab', { shiftKey: true });
  yes('Shift Tab returns to the checkbox', p.doc.activeElement === p.node('.skipnext'));
  p.key('Tab'); p.key('Enter');
  yes('Enter on Continue uses the normal choosing message', p.continued());
  yes('continuing preserves the existing skip-scroll setting', p.messages.some(m => m[1] === 'select:intro off'));
  p.key('ArrowDown'); p.key('Enter');
  yes('the keyboard pick still asks the front for a seat before joining',
    p.messages.some(m => m[1] === 'select:want 22') && !p.messages.some(m => m[0] === 'thornswood' && m[1] === 'select'));
  p.api.go(); // The existing native front's seat response, not a second pick.
  yes('the same keyboard can pick the second character after the scroll',
    p.messages.some(m => m[0] === 'thornswood' && m[1] === 'select' && m[2] === 22), p.messages);
  const hint = /<div class="hint">([^<]*)<\/div>/.exec(p.doc.getElementById('ts-select').innerHTML);
  yes('the rendered character-list hint names arrow, number and Enter keys',
    !!hint && /arrow/i.test(hint[1]) && /[1-9]/.test(hint[1]) && /Enter/.test(hint[1]));
}
{
  const p = rig(); p.api.keys(true); p.advance(200); p.key('Enter');
  yes('a stale positive answer holds the opening key and asks the native front again', !p.opened() && p.ask() > 0);
  p.api.keys(true, p.ask() + 1);
  yes('an unrelated positive answer cannot release the held opening key', !p.opened());
  p.api.keys(false, p.ask());
  yes('a fresh refusal drops the held opening key', !p.opened());
  p.api.keys(true); p.advance(200); p.key('Enter'); p.api.keys(true, p.ask());
  yes('the matching fresh positive answer opens the scroll', p.opened());
}
{
  const p = rig(); p.api.keys(true); p.advance(200); p.key('Enter'); p.expireAsk();
  p.api.keys(true, p.ask());
  yes('a native answer after the held-key deadline cannot open the scroll', !p.opened());
}
{
  const p = rig(); p.api.keys(true); p.key('Enter'); p.key('Tab');
  p.advance(200); p.key('Enter');
  yes('Continue also waits for fresh native proof', !p.continued() && p.ask() > 0);
  p.api.keys(false, p.ask());
  yes('typing Enter in another window cannot continue', !p.continued());
}
{
  const p = rig(); p.api.keys(true); p.advance(200); p.key('Enter');
  p.node('.closed').onclick(); p.node('.go').onclick();
  const picks = p.pickCount();
  p.api.keys(true, p.ask());
  yes('an opening key held before mouse navigation cannot become a character pick',
    p.pickCount() === picks);
}
{
  const p = rig(); p.api.keys(true);
  p.key('Enter', { ctrlKey: true }); p.key('Enter', { altKey: true }); p.key('Escape');
  yes('modified Enter and Escape cannot skip the sealed scroll', !p.opened());
  p.key(' '); p.key(' ', { repeat: true });
  yes('Space opens the seal once without continuing or toggling a checkbox', p.opened() && !p.continued() && !p.node('.skipnext').checked);
  p.advance(200); p.key(' ');
  p.node('.go').focus(); p.api.keys(true, p.ask());
  yes('a held checkbox key cannot activate a different control after focus changes', !p.continued() && !p.node('.skipnext').checked);
}
{
  const p = rig(); p.api.keys(true); p.key('Enter'); p.key('Tab'); p.key('Enter');
  const picks = p.pickCount();
  p.key('Enter', { repeat: true });
  p.advance(200); p.key('Enter', { repeat: true }); p.api.keys(true, p.ask());
  yes('holding Continue Enter cannot play a character until Enter is pressed again',
    p.continued() && p.pickCount() === picks);
  p.api.keys(true); p.key('ArrowDown', { repeat: true }); p.key('Enter');
  yes('repeated arrows and a fresh Enter still choose a character',
    p.messages.some(m => m[1] === 'select:want 22'));
}
console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
