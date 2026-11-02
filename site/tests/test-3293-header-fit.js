// test-3293-header-fit.js
//
//     node site\tests\test-3293-header-fit.js
//
// Issue #3293. Between 901 and about 1080 wide the front page's header squeezed
// THORNSWOOD's box (182 for 210 of text) so the name ran into RULES, and the
// links ran past the bar: at 901 Download ended at 996, 119 past the bar's
// right edge, where overflow-x:hidden cut Discord and Download off. The cause
// was the fold width: the burger took over at 900, but the name and the eight
// links need about 1050 across (headless Chromium, 768 tall: name 210, links
// 764, gap 26, page margins 48). So this reads home.css and home.js as they
// ship and holds:
//
//   1. .mark never shrinks, so the name is never narrower than its text;
//   2. the menu folds at one width, 1080, in every home.css rule that moves
//      the nav, the burger or the narrow Download button, and home.js
//      narrow() asks the same width, so the burger and the stylesheet agree;
//   3. no rule for the header still folds at the old 900.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO_DIR = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read(f) { return fs.readFileSync(path.join(REPO_DIR, 'site', 'public', f), 'utf8').split(CR).join(''); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const FOLD = 1080;
const css = read('home.css').replace(/\/\*[\s\S]*?\*\//g, '');
const js = read('home.js');

// Top level rules and @media blocks, in order, as { media, selector, body }.
function rules(text) {
  const out = [];
  let i = 0;
  const top = /([^{}]+)\{/g;
  while (i < text.length) {
    top.lastIndex = i;
    const m = top.exec(text);
    if (!m) break;
    const head = m[1].trim();
    let depth = 1, j = top.lastIndex;
    while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    const inner = text.slice(top.lastIndex, j - 1);
    if (/^@media/.test(head)) {
      const r = /([^{}]+)\{([^{}]*)\}/g;
      let n;
      while ((n = r.exec(inner))) out.push({ media: head.replace(/\s+/g, ''), selector: n[1].trim(), body: n[2] });
    } else out.push({ media: '', selector: head, body: inner });
    i = j;
  }
  return out;
}
const all = rules(css);

// ---- 1. the name never shrinks --------------------------------------------
const mark = all.filter((r) => !r.media && r.selector === '.mark');
yes('home.css has one base .mark rule', mark.length === 1);
yes('.mark never shrinks (flex-shrink:0) and does not wrap',
  mark.length === 1 && /flex-shrink:0/.test(mark[0].body) && /white-space:nowrap/.test(mark[0].body));

// ---- 2. one fold width ----------------------------------------------------
const HEADER = /^(header \.bar|nav\.top\b|\.burger|\.mobile-cta)/;
const headerMedia = all.filter((r) => r.media && r.selector.split(',').some((s) => HEADER.test(s.trim())));
yes('home.css has rules that fold the header (' + headerMedia.length + ' found)', headerMedia.length >= 6);
const widths = Array.from(new Set(headerMedia.map((r) => r.media)));
yes('every one of them folds at max-width:' + FOLD + 'px (found ' + widths.join(' ') + ')',
  widths.length === 1 && widths[0] === '@media(max-width:' + FOLD + 'px)');
const nj = /function narrow\(\)\{ return window\.matchMedia\('\(max-width:(\d+)px\)'\)\.matches; \}/.exec(js);
yes('home.js narrow() asks max-width:' + FOLD + 'px (it asks ' + (nj ? nj[1] : 'nothing found') + ')', !!nj && Number(nj[1]) === FOLD);
for (const sel of ['nav.top', '.burger', '.mobile-cta', 'header .bar']) {
  yes(sel + ' has a rule at the fold', headerMedia.some((r) => r.selector.split(',').some((s) => s.trim() === sel)));
}

// ---- 3. nothing in the header folds at 900 --------------------------------
const old = headerMedia.filter((r) => /max-width:900px/.test(r.media)).map((r) => r.selector);
yes('no header rule folds at the old 900' + (old.length ? ' (' + old.join(' | ') + ')' : ''), old.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
