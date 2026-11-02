// test-3290-hub-faint-contrast.js
//
//     node site\tests\test-3290-hub-faint-contrast.js
//
// Issue #3290. Lighthouse failed color-contrast on the hub's sign in page: the
// "Back to thornswood.net" link was #616B53 on #0B0E0A, 3.45 to 1 at 13px,
// under the 4.5 to 1 WCAG 2.2 1.4.3 asks for. The link was not the cause, the
// colour was: hub.css's --faint is the hub's small print (the way back, the
// sidebar groups, counts, dates, labels, placeholders), and every one of them
// was under the line. So this reads hub.css as it ships and holds:
//
//   1. --faint is 4.5 to 1 or more on every ground the hub draws it on:
//      --ink, --panel, --raised and both stops of .card.lead's gradient;
//   2. every rule that colours text --faint sits on one of those grounds,
//      so a new ground cannot slip in unmeasured;
//   3. --dim still stands out more than --faint on every one of them, so the
//      two did not become one colour;
//   4. the measure goes red on the old #616B53, so it cannot pass by reading
//      nothing.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO_DIR = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const css = fs.readFileSync(path.join(REPO_DIR, 'site', 'public', 'hub.css'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const MIN = 4.5;
function rgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function lin(v) { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
function contrast(a, b) { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const root = /:root\{([^}]*)\}/.exec(noComments);
const vars = {};
if (root) {
  const re = /--([\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g;
  let m;
  while ((m = re.exec(root[1]))) vars[m[1]] = m[2];
}
yes(':root names --ink, --panel, --raised, --dim and --faint',
  ['ink', 'panel', 'raised', 'dim', 'faint'].every((n) => !!vars[n]));

const lead = /\.card\.lead\{background:linear-gradient\(\d+deg,(#[0-9A-Fa-f]{6}),(#[0-9A-Fa-f]{6})\)/.exec(noComments);
yes('.card.lead\'s gradient is read (' + (lead ? lead[1] + ' to ' + lead[2] : 'not found') + ')', !!lead);

const grounds = { '--ink': vars.ink, '--panel': vars.panel, '--raised': vars.raised };
if (lead) { grounds['.card.lead top'] = lead[1]; grounds['.card.lead bottom'] = lead[2]; }

function low(faint) {
  return Object.keys(grounds).filter((g) => grounds[g] && contrast(faint, grounds[g]) < MIN)
    .map((g) => g + ' ' + contrast(faint, grounds[g]).toFixed(2));
}

// ---- 1. --faint reads on every ground -------------------------------------
if (vars.faint) {
  const l = low(vars.faint);
  yes('--faint ' + vars.faint + ' is 4.5 to 1 or more on every ground' + (l.length ? ' (not on ' + l.join(', ') + ')' : ''), l.length === 0);
  yes('the sign in\'s way back is --faint on --ink at ' + contrast(vars.faint, vars.ink || '#000000').toFixed(2) + ' to 1',
    /#gate\{[^}]*background:var\(--ink\)/.test(noComments) && /#gate \.backhome a\{[^}]*color:var\(--faint\)/.test(noComments) &&
    contrast(vars.faint, vars.ink) >= MIN);
}

// ---- 2. every --faint rule is on a measured ground ------------------------
// The rules that colour text --faint, and the ground each one sits on. A rule
// not named here fails, so its ground is looked at before it ships.
const KNOWN = {
  '#gate .backhome a': '--ink', '#gate .or': '--ink',
  'nav .group': '--panel', 'nav .backout': '--panel', 'nav .out': '--panel',
  '.card .n': '.card.lead top', '.section-label': '--ink', '.latest .when': '--panel',
  '.pf .lab': '--panel', '.person .chev': '--panel', '.keptBy': '--panel', '.prov b': '--panel',
  '.logf .sz': '--panel', '.logf .chev': '--panel', '.crumb': '--ink',
  'input[type=search]::placeholder,input[type=text]::placeholder': '--panel',
  '.sechead .count': '--ink', '.empty-note': '--raised', 'table.board th .x': '--raised',
  'table.board tr.done .cell': '--panel', '.issues .ihead': '--panel', '.issues .i .d': '--panel',
  'td.rowacts button': '--panel', 'tr.adder input::placeholder': '--panel', 'tr.adder .plus': '--panel',
  'table.board td[data-label]::before': '--panel', '.res .when': '--panel', '.form label': '--panel',
  '.entry .when': '--panel', '.entry details ul': '--panel', '.note .m': '--panel',
};
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
const faintRules = [];
let r;
while ((r = ruleRe.exec(noComments))) {
  if (/(^|;|\s)color:var\(--faint\)/.test(r[2])) faintRules.push(r[1].trim().replace(/\s+/g, ' '));
}
yes('hub.css colours text --faint in ' + faintRules.length + ' rules', faintRules.length >= 20);
const unknown = faintRules.filter((s) => !(s in KNOWN));
yes('every one of them is on a ground measured here' + (unknown.length ? ' (not known: ' + unknown.join(' | ') + ')' : ''), unknown.length === 0);
const missing = Object.keys(KNOWN).filter((s) => faintRules.indexOf(s) < 0);
const under = Object.keys(KNOWN).filter((s) => faintRules.indexOf(s) >= 0 && vars.faint &&
  !(grounds[KNOWN[s]] && contrast(vars.faint, grounds[KNOWN[s]]) >= MIN));
yes('each is 4.5 to 1 or more on its own ground' + (under.length ? ' (not: ' + under.join(' | ') + ')' : ''), under.length === 0);
yes('and every rule named here is still in hub.css' + (missing.length ? ' (gone: ' + missing.join(' | ') + ')' : ''), missing.length === 0);

// ---- 3. --dim stays above --faint -----------------------------------------
if (vars.dim && vars.faint) {
  const flat = Object.keys(grounds).filter((g) => grounds[g] && contrast(vars.dim, grounds[g]) <= contrast(vars.faint, grounds[g]));
  yes('--dim stands out more than --faint on every ground' + (flat.length ? ' (not on ' + flat.join(', ') + ')' : ''), flat.length === 0);
}

// ---- 4. the measure goes red on the old colour ----------------------------
const old = low('#616B53');
yes('the measure finds the old #616B53 under 4.5 to 1 on --ink (' + old.length + ' grounds)', old.some((s) => s.startsWith('--ink 3.4')));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
