'use strict';
// Actual bridge and browser-order dispatch. The pinned native chat clears its
// contentEditable only after consuming a send; refusal leaves the draft there.
const fs = require('fs'), path = require('path');
const makePage = require('../../tests/fixtures/panel-page');
const source = fs.readFileSync(process.env.BRIDGE || path.join(__dirname, '../ui/thornswood-bridge.js'), 'utf8');
let pass = 0, fail = 0;
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }

function page() {
  const p = makePage(), deferred = [], sent = [];
  let now = 1000, accepts = true, heard = 0;
  // This fixture's textContent already follows innerHTML clearing. For these
  // plain drafts it is also the contentEditable's visible innerText.
  Object.defineProperty(p.chatBox, 'innerText', {
    get() { return this.textContent; }, set(value) { this.textContent = value; }
  });
  p.win.Date = { now: () => now };
  p.win.setTimeout = (fn, ms) => { if (!ms) deferred.push(fn); return 1; };
  p.run('actual-bridge', source);
  p.chatBox.addEventListener('keydown', event => {
    if (event.code !== 'Enter' || event.shiftKey) return;
    heard++;
    event.preventDefault();
    if (accepts && p.chatBox.innerText) {
      sent.push(p.chatBox.innerText);
      p.chatBox.innerHTML = '';
    }
    // Native target listeners can stop bubbling; the bridge must still see
    // what happened after this listener rather than closing beforehand.
    event.stopPropagation();
  });
  return Object.assign(p, {
    sent, heard: () => heard,
    open(text = '') { p.win.thornswoodChat.focusInput(); p.chatBox.innerText = text; },
    accepts(on) { accepts = on; },
    advance(ms) { now += ms; },
    flush() { while (deferred.length) deferred.shift()(); },
    press(key, more) { p.fire(p.chatBox, 'keydown', key, Object.assign({ code: key }, more)); },
    off: () => p.told.filter(line => line === 'thornswood-front typing-off').length,
    typing: () => p.win.thornswoodTyping === true,
    focused: () => p.doc.activeElement === p.chatBox
  });
}
{
  const p = page(); p.open('the unsent line'); p.advance(500); p.accepts(false);
  p.press('Enter');
  yes('capture does not blur before the sender has handled Enter', p.typing() && p.focused() && p.heard() === 1);
  p.flush();
  yes('a refused Enter keeps the composer open', p.typing());
  yes('a refused Enter keeps keyboard focus in the draft', p.focused());
  yes('a refused Enter preserves the exact unsent text', p.chatBox.innerText === 'the unsent line');
  yes('refusal neither sends nor reports typing finished', p.sent.length === 0 && p.off() === 0);
  p.accepts(true); p.advance(1000); p.flush();
  yes('the bridge never retries an unsent line on its own', p.sent.length === 0);
  p.press('Enter'); p.flush();
  yes('a later explicit Enter sends the retained line exactly once', JSON.stringify(p.sent) === '["the unsent line"]');
  yes('the consumed draft then closes and releases focus once', !p.typing() && !p.focused() && p.off() === 1);
}
{
  const p = page(); p.open('an ordinary line'); p.advance(500); p.press('Enter');
  yes('a normal send is consumed before deferred blur', p.sent.length === 1 && p.typing());
  p.flush();
  yes('normal Enter still sends once, clears and closes', p.sent[0] === 'an ordinary line' && !p.chatBox.innerText && !p.typing() && p.off() === 1);
}
{
  const p = page(); p.open('a draft'); p.advance(500); p.press('Enter', { shiftKey: true }); p.flush();
  yes('Shift Enter neither sends nor closes', p.typing() && p.focused() && p.sent.length === 0 && p.off() === 0);
  p.press('Escape'); p.flush();
  yes('Escape remains an explicit way to release focus with a draft', !p.typing() && !p.focused() && p.off() === 1 && p.chatBox.innerText === 'a draft');
}
{
  const p = page(); p.open(); p.advance(500); p.press('Enter'); p.flush();
  yes('an empty Enter still closes without sending', !p.typing() && p.sent.length === 0 && p.off() === 1);
}
{
  const p = page(); p.open(); p.advance(200); p.press('Enter'); p.flush();
  yes('the existing opening-key guard keeps its new empty composer open', p.typing() && p.focused() && p.off() === 0);
}
console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
