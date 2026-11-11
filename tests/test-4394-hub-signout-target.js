'use strict';
/*
  test-4394-hub-signout-target.js

      node tests\test-4394-hub-signout-target.js

  #4394. Two things on the staff and member hub were hard to use by touch:

    - the sign out button was only as big as its 12px text, about 42 by 14
      pixels, under the 24 by 24 WCAG 2.2 2.5.8 asks for, because hub.css
      set its padding to 0 and nothing else gave it a size;
    - at phone width the tab row scrolls sideways with its scrollbar hidden,
      and nothing else showed that a tab was past the edge.

  This reads site/public/hub.css as it ships and works out, at each width
  from a wide desktop down to a small phone, which rules reach the sign out
  button and the tab row:

    A. the sign out button's box is 24 by 24 pixels or more at every width
       (the text's own height is taken generously, at 1.35 times the font
       size, so a pass does not lean on a small guess);
    B. hub.js still draws the button with the class those rules are for;
    C. wherever the tab row scrolls with its scrollbar hidden, its own
       background shows an edge where there is more to scroll to: a cover in
       the nav's colour that scrolls with the tabs (attachment local) over a
       shade that stays at each edge (attachment scroll), so the shade shows
       only on a side with tabs past it.

  It reads CSS rules, it does not draw them. No browser runs here, so what
  a screen shows is for a person to see.

  Read only. Nothing leaves the machine.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HUB_CSS = fs.readFileSync(path.join(ROOT, 'site', 'public', 'hub.css'), 'utf8').split('\r\n').join('\n');
const HUB_JS = fs.readFileSync(path.join(ROOT, 'site', 'public', 'hub.js'), 'utf8').split('\r\n').join('\n');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* ------------------------------------------------- the sheet, as rules -- */
/*
  Each rule with the media query it sits in (one level deep, which is all
  hub.css uses), in the order the sheet gives them, comments taken out.
*/
function rulesOf(css) {
  let text = '';
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
      continue;
    }
    text += css[i];
  }
  const out = [];
  let media = null, start = 0, depth = 0, head = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      const before = text.slice(start, i).trim();
      if (depth === 0 && before.indexOf('@media') === 0) { media = before.slice(6).trim(); depth = 1; start = i + 1; continue; }
      head = before; start = i + 1; depth++;
    } else if (c === '}') {
      if (depth === 1 && media !== null && head === '') { media = null; depth = 0; start = i + 1; continue; }
      out.push({ media: media, sel: head, body: text.slice(start, i) });
      head = ''; depth--; start = i + 1;
    }
  }
  return out;
}
const RULES = rulesOf(HUB_CSS);

// A media query holds at a width when each of its min-width and max-width
// does. One that asks anything else (motion, colour) is not about size and
// is left out, so it can neither make nor break a size here.
function holds(media, width) {
  if (media === null) return true;
  const parts = media.match(/\([^)]*\)/g) || [];
  let any = false;
  for (const p of parts) {
    const m = /^\(\s*(min|max)-width\s*:\s*([\d.]+)px\s*\)$/.exec(p);
    if (!m) return false;
    any = true;
    const n = parseFloat(m[2]);
    if (m[1] === 'min' && width < n) return false;
    if (m[1] === 'max' && width > n) return false;
  }
  return any;
}

// What one selector is given at one width, later rules over earlier ones.
function declsFor(selector, width) {
  const got = {};
  for (const r of RULES) {
    const sels = r.sel.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (sels.indexOf(selector) < 0 || !holds(r.media, width)) continue;
    for (const d of r.body.split(';')) {
      const at = d.indexOf(':');
      if (at < 0) continue;
      got[d.slice(0, at).trim().toLowerCase()] = d.slice(at + 1).trim();
    }
  }
  return got;
}

function px(v, fontSize) {
  if (v === undefined || v === null || v === '') return null;
  const m = /^(-?[\d.]+)(px|em|rem)?$/.exec(String(v).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] === 'em') return n * fontSize;
  if (m[2] === 'rem') return n * 16;
  return n;
}
// padding: one to four lengths, as CSS reads them.
function sides(v, fontSize) {
  if (!v) return [0, 0, 0, 0];
  const p = v.trim().split(/\s+/).map((x) => px(x, fontSize) || 0);
  if (p.length === 1) return [p[0], p[0], p[0], p[0]];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  if (p.length === 3) return [p[0], p[1], p[2], p[1]];
  return p;
}

/* ------------------------------------- A. the sign out button's box -- */
/*
  A button with no font size of its own is 13.33px in every browser, and
  with no line height it is 'normal', which no common face draws taller than
  about 1.2 times the size. 1.35 is used, so the measure gives the old rule
  more than it had. 'sign out' is eight characters at no more than 0.55 em
  each. A border of 0 adds nothing.
*/
const WIDTHS = [2400, 1600, 1280, 1000, 901, 900, 768, 561, 560, 414, 375, 320];
const LABEL = 'sign out';
function outBox(width) {
  const d = declsFor('nav .out', width);
  const fs_ = px(d['font-size'], 16) || 13.33;
  const lh = d['line-height'] && /^[\d.]+$/.test(d['line-height']) ? parseFloat(d['line-height']) * fs_
    : (px(d['line-height'], fs_) || 1.35 * fs_);
  const [pt, pr, pb, pl] = sides(d['padding'], fs_);
  const h = Math.max(px(d['min-height'], fs_) || 0, px(d['height'], fs_) || 0, lh + pt + pb);
  const w = Math.max(px(d['min-width'], fs_) || 0, px(d['width'], fs_) || 0, LABEL.length * 0.55 * fs_ + pl + pr);
  return { w: w, h: h, d: d };
}
const small = [];
for (const w of WIDTHS) {
  const b = outBox(w);
  if (b.w < 24 || b.h < 24) small.push(w + 'px wide: ' + b.w.toFixed(1) + ' by ' + b.h.toFixed(1));
}
yes('A1 the sign out button is 24 by 24 pixels or more at every width' +
  (small.length ? ' (not at ' + small.join('; ') + ')' : ''), small.length === 0);
const phone = outBox(375);
yes('A2 and at phone width, 375 pixels, it is ' + phone.w.toFixed(1) + ' by ' + phone.h.toFixed(1),
  phone.w >= 24 && phone.h >= 24);
const nothing = WIDTHS.filter((w) => Object.keys(declsFor('nav .out', w)).length === 0);
yes('A3 the measure read a rule for the button at every width' + (nothing.length ? ' (none at ' + nothing.join(', ') + ')' : ''),
  nothing.length === 0);
// A display that makes min-height do nothing would make A1 a reading of
// the sheet, not of the page.
const inline = WIDTHS.filter((w) => /^inline$/.test(declsFor('nav .out', w).display || ''));
yes('A4 and the button is never set display:inline, where a minimum height does nothing', inline.length === 0);

/* --------------------------------------------------- B. the markup -- */
const buttons = HUB_JS.match(/<button class="out" id="out">sign out<\/button>/g) || [];
yes('B1 hub.js draws sign out as button.out, the rules A measured (' + buttons.length + ' places)', buttons.length >= 1);

/* ------------------------------------------------- C. the tab row -- */
const cueGone = [];
const scrolls = [];
for (const w of WIDTHS) {
  const d = declsFor('#tabs', w);
  if (!/^(auto|scroll)$/.test(d['overflow-x'] || '')) continue;
  scrolls.push(w);
  const bar = declsFor('#tabs::-webkit-scrollbar', w);
  const hidden = d['scrollbar-width'] === 'none' || bar.display === 'none';
  if (!hidden) continue;
  const bg = d.background || d['background-image'] || '';
  const attach = d.background ? bg : (d['background-attachment'] || '');
  const gradients = (bg.match(/linear-gradient|radial-gradient/g) || []).length;
  const local = (attach.match(/\blocal\b/g) || []).length;
  const fixedToEdge = (attach.match(/\bscroll\b/g) || []).length;
  const cover = /linear-gradient\(\s*to right\s*,\s*var\(--panel\)/.test(bg) && /linear-gradient\(\s*to left\s*,\s*var\(--panel\)/.test(bg);
  if (gradients < 4 || local < 2 || fixedToEdge < 2 || !cover) {
    cueGone.push(w + 'px (' + gradients + ' gradients, ' + local + ' local, ' + fixedToEdge + ' at the edge, ' +
      (cover ? 'covered' : 'no cover in the nav\'s colour') + ')');
  }
}
yes('C1 the tab row scrolls sideways at phone width (' + scrolls.length + ' widths)', scrolls.indexOf(375) >= 0);
yes('C2 and wherever its scrollbar is hidden, it shows an edge where there is more to scroll to' +
  (cueGone.length ? ' (not at ' + cueGone.join('; ') + ')' : ''), cueGone.length === 0);
const navGround = declsFor('nav', 375).background || '';
yes('C3 the cover is the colour of the nav it sits on (' + navGround + ')', /var\(--panel\)/.test(navGround));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
