// test-journal-scale.js
//
// The journal behind J scales with the screen. Issue 958.
//
// Patrick on dev, 28 September: "it doesn't scale the menu size for bigger
// screens or is just too small". The panel was a fixed 1040 by 660 box in
// CSS pixels inside a browser the size of the screen, so the bigger the
// screen the smaller it looked: under a third of the width at 3440 by 1440.
//
// WHAT THIS RUNS. The whole of game/ui/thornswood-journal.js, in a stand-in
// document that records the style the script puts on the panel, at 1920 by
// 1080, 2560 by 1440, 3440 by 1440 and 3840 by 2160, and at a small window.
// For each it works out the box as drawn (1040 by 660 times the scale) and
// checks it takes the same share of the screen as at 1920 by 1080 on a 16:9
// screen, and never runs past the edge on any.
//
// Run it against the page before the change with JOURNAL=<that file>: every
// big screen fails there, because nothing scaled the panel.
//
// Read only.
const fs = require('fs');
const path = require('path');
const SRC = process.env.JOURNAL || path.join(__dirname, '..', '..', 'game', 'ui', 'thornswood-journal.js');
const src = fs.readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// The panel's size in CSS pixels, read from the page's own stylesheet.
const pw = /\.panel\{width:(\d+)px/.exec(src);
const ph = /\.panel\{[^']*'[^']*height:(\d+)px/.exec(src) || /;height:(\d+)px;/.exec(src);
const W = pw ? Number(pw[1]) : 0;
const H = ph ? Number(ph[1]) : 0;
yes('the panel is 1040 by 660 in the stylesheet', W === 1040 && H === 660);

function element(tag) {
  const el = {
    tagName: tag, style: {}, id: '', className: '', children: [], listeners: {},
    textContent: '', value: '',
    appendChild: function (c) { this.children.push(c); return c; },
    addEventListener: function (n, f) { (this.listeners[n] = this.listeners[n] || []).push(f); },
    querySelectorAll: function () { return []; }
  };
  const found = {};
  el.querySelector = function (sel) { return found[sel] || (found[sel] = element('div')); };
  let html = '';
  Object.defineProperty(el, 'innerHTML', { get: function () { return html; }, set: function (v) { html = v; } });
  return el;
}

function open(width, height) {
  const winListeners = {};
  const doc = {
    head: element('head'), body: element('body'),
    createElement: element, activeElement: null,
    addEventListener: function () { }
  };
  const win = {
    innerWidth: width, innerHeight: height,
    skyrimPlatform: { sendMessage: function () { } },
    addEventListener: function (n, f) { (winListeners[n] = winListeners[n] || []).push(f); }
  };
  new Function('window', 'document', src)(win, doc);
  const root = doc.body.children[0];
  win.thornswoodJournal.open();
  const panel = root.querySelector('.panel');
  const m = /scale\(([\d.]+)\)/.exec(String(panel.style.transform || ''));
  return {
    win: win, panel: panel, listeners: winListeners,
    scale: m ? Number(m[1]) : 1
  };
}

const at1080 = open(1920, 1080);
const share = W / 1920;
yes('at 1920 by 1080 it is drawn as it was, scale 1', at1080.scale === 1);

[[2560, 1440, 1.333], [3440, 1440, 1.333], [3840, 2160, 2]].forEach(function (c) {
  const r = open(c[0], c[1]);
  const w = W * r.scale, h = H * r.scale;
  yes('at ' + c[0] + ' by ' + c[1] + ' it is scaled ' + c[2] + ' (got ' + r.scale + ')',
      Math.abs(r.scale - c[2]) < 0.01);
  yes('at ' + c[0] + ' by ' + c[1] + ' the drawn box, ' + Math.round(w) + ' by ' + Math.round(h) + ', fits the screen',
      w <= c[0] - 48 && h <= c[1] - 48);
  if (c[0] / c[1] === 16 / 9) {
    yes('at ' + c[0] + ' by ' + c[1] + ' it takes the same share of the width as at 1080p',
        Math.abs(w / c[0] - share) < 0.01);
  }
  yes('at ' + c[0] + ' by ' + c[1] + ' it is scaled about its centre',
      r.panel.style.transformOrigin === 'center center');
});

{
  const r = open(1280, 720);
  yes('a window smaller than 1080p is not shrunk below 1: max-width keeps it on screen there',
      r.scale === 1 && /max-width:calc\(100vw - 48px\)/.test(src) && /max-height:calc\(100vh - 48px\)/.test(src));
}
{
  const r = open(1920, 1080);
  r.win.innerWidth = 3840; r.win.innerHeight = 2160;
  (r.listeners.resize || []).forEach(function (f) { f(); });
  const m = /scale\(([\d.]+)\)/.exec(String(r.panel.style.transform || ''));
  yes('a window that grows is scaled again on resize', !!m && Number(m[1]) === 2);
}
{
  const r = open(8000, 4000);
  yes('and never past 2.4', r.scale === 2.4);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
