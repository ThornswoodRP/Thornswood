'use strict';
/*
  test-2193-hero-video.js

  #2193: the hero video on the front page (site/public/home.html) is
  decoration, and has to read that way to assistive technology, while the one
  control that moves it stays reachable and says what it does.

  A. The markup: the video is aria-hidden, out of the tab order, without
     controls or autoplay, muted, over the still under it, without the browser's own
     picture-in-picture and cast buttons, and without fallback text. The
     button is a real button, in the tab order, not inside anything hidden.
  B. home.js's banner code, run against a stand-in page: the button is shown,
     named for what a press will do, and kept in step with the video; with
     reduced motion asked for nothing plays until somebody presses it, and
     without it the video starts once the page has loaded (#2777), unless
     somebody pressed the button before that.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUB = path.join(__dirname, '..', '..', 'site', 'public');
const HTML = fs.readFileSync(path.join(PUB, 'home.html'), 'utf8');
const JS = fs.readFileSync(path.join(PUB, 'home.js'), 'utf8');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------- A. markup --
const vm1 = /<video\b[^>]*\bclass="art"[^>]*>([\s\S]*?)<\/video>/.exec(HTML);
yes('A0: the hero video is there', !!vm1);
const tag = vm1 ? /<video\b[^>]*>/.exec(vm1[0])[0] : '';
const attr = (n) => new RegExp('\\s' + n + '(?=[\\s>=])').test(tag);
yes('A1: it is hidden from assistive technology (aria-hidden="true")', /\saria-hidden="true"/.test(tag));
yes('A2: and out of the tab order (tabindex="-1")', /\stabindex="-1"/.test(tag));
yes('A3: with no controls of its own', !attr('controls'));
yes('A4: and no autoplay attribute, so reduced motion is asked first', !attr('autoplay'));
// The still is a picture of its own under the video now, at the width each
// screen needs (#3218), so the video has no poster and shows nothing until
// its first frame.
yes('A5: muted, looping and inline, with no poster over the still under it', attr('muted') && attr('loop') && attr('playsinline') && !attr('poster'));
const still = /<img\b[^>]*\bclass="art"[^>]*>/.exec(HTML);
yes('A5b: the still is before the video, so the video paints over it, and is hidden the same way',
    !!still && !!vm1 && still.index < vm1.index && /\salt=""/.test(still[0]) && /\saria-hidden="true"/.test(still[0]));
yes('A6: without the browser\'s picture-in-picture and cast buttons', attr('disablepictureinpicture') && attr('disableremoteplayback'));
yes('A7: and with no fallback text for a reader to find', vm1 && vm1[1].replace(/<source\b[^>]*>/g, '').replace(/<!--[\s\S]*?-->/g, '').trim() === '');
yes('A8: it has no accessible name, which a hidden decoration should not', !/\saria-label(ledby)?=/.test(tag) && !/\stitle=/.test(tag));

const bm = /<button\b[^>]*\bid="bannerMotion"[^>]*>([^<]*)<\/button>/.exec(HTML);
yes('A9: the motion control is a <button type="button">', !!bm && /\stype="button"/.test(bm[0]));
yes('A10: in the tab order (no tabindex -1) and not aria-hidden', !!bm && !/tabindex="-1"/.test(bm[0]) && !/aria-hidden/.test(bm[0]));
yes('A11: labelled by its own text before the script runs', !!bm && bm[1].trim() === 'Play background animation');
// Nothing that holds it hides it from assistive technology.
const before = bm ? HTML.slice(0, bm.index) : '';
const open = [];
for (const m of before.matchAll(/<(\/?)(div|main|section|header)\b([^>]*)>/g)) {
  if (m[1]) { open.pop(); } else { open.push(m[3]); }
}
yes('A12: and nothing that holds it is aria-hidden or inert', open.every((a) => !/aria-hidden="true"|\binert\b/.test(a)));

// ---------------------------------------------------------- B. home.js ----
function page(reduce) {
  const handlers = {};
  const video = {
    paused: true, plays: 0, pauses: 0,
    addEventListener(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    removeAttribute() {},
    play() { this.plays++; this.paused = false; (handlers.play || []).forEach((f) => f()); return Promise.resolve(); },
    pause() { this.pauses++; this.paused = true; (handlers.pause || []).forEach((f) => f()); },
  };
  const button = { hidden: true, textContent: 'Play background animation', clicks: [],
    addEventListener(ev, fn) { if (ev === 'click') { this.clicks.push(fn); } } };
  const docHandlers = {};
  const document = {
    querySelector(sel) { return sel === 'video.art' ? video : null; },
    getElementById(id) { return id === 'bannerMotion' ? button : null; },
    addEventListener(ev, fn) { (docHandlers[ev] = docHandlers[ev] || []).push(fn); },
    querySelectorAll() { return []; },
  };
  const winHandlers = {};
  const window = { matchMedia: (q) => ({ matches: reduce && /prefers-reduced-motion: reduce/.test(q), addEventListener() {} }),
    addEventListener(ev, fn) { (winHandlers[ev] = winHandlers[ev] || []).push(fn); } };
  // Only the banner code: from the top of home.js to the menu that follows it.
  const end = JS.indexOf("var burger = document.getElementById('burger')");
  vm.runInNewContext(JS.slice(0, end), { window: window, document: document, console: console });
  (docHandlers.DOMContentLoaded || []).forEach((f) => f());
  return { video, button, press: () => button.clicks.forEach((f) => f()),
           load: () => (winHandlers.load || []).forEach((f) => f()) };
}
const flush = () => new Promise((ok) => setImmediate(ok));

(async () => {
  let p = page(true);
  await flush();
  yes('B1: the button is shown once the script runs', p.button.hidden === false);
  yes('B2: with reduced motion asked for, nothing plays', p.video.plays === 0 && p.video.paused);
  yes('B3: and the button offers to play it: ' + p.button.textContent, p.button.textContent === 'Play background animation');
  p.press(); await flush();
  yes('B4: a press plays it, and the button now offers to pause: ' + p.button.textContent,
      p.video.plays === 1 && !p.video.paused && p.button.textContent === 'Pause background animation');
  p.press(); await flush();
  yes('B5: a second press pauses it, and the label goes back: ' + p.button.textContent,
      p.video.paused && p.button.textContent === 'Play background animation');

  p.load(); await flush();
  yes('B5a: and the page loading does not start it either', p.video.plays === 1 && p.video.paused);

  p = page(false);
  await flush();
  yes('B6a: without reduced motion it waits for the page to load, so the still has the line (#2777)', p.video.plays === 0 && p.video.paused);
  p.load(); await flush();
  yes('B6: then it starts by itself', p.video.plays === 1 && !p.video.paused);
  yes('B7: and the button offers to pause it: ' + p.button.textContent, p.button.textContent === 'Pause background animation');

  p = page(false);
  p.press(); await flush();
  p.press(); await flush();
  p.load(); await flush();
  yes('B8: somebody who played and paused it before the load keeps it paused', p.video.plays === 1 && p.video.paused);

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
