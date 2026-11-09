/*
  test-4361-hub-control-names.js

      node site\tests\test-4361-hub-control-names.js

  #4361: most of the staff hub's fields were named only by their placeholder,
  which a screen reader does not take as a name, and the pass, fail and skip
  buttons under a test did not say which one was chosen. This reads every
  control the hub ships, in index.html and in the scripts that build the rest
  of it, and holds:

    A. every input, select, textarea and button has a name a screen reader
       says: aria-label, aria-labelledby, a <label for> its id, or for a
       button, words of its own. A placeholder is not a name, and a button
       whose only content is a mark such as &times; is not either.
    B. a button the script makes with createElement is given words or a label.
    C. the pass, fail and skip buttons carry aria-pressed: true on the one
       chosen, false on the others, as drawn and again after a save. Run on
       the hub's own dressTests and saveResult.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = process.env.TS_REPO || path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8').split('\r\n').join('\n');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

// The hub's page and every script it loads from this site.
const HTML = 'site/public/index.html';
const html = read(HTML);
const scripts = [];
html.replace(/<script src="\/([^"]+)"><\/script>/g, function (m, f) {
  if (!/^marked-[\d.]+\.min\.js$/.test(f)) scripts.push('site/public/' + f);
  return m;
});
yes('the hub loads its own scripts (' + scripts.join(', ') + ')', scripts.indexOf('site/public/hub.js') >= 0);

// Comments say "<button>" in prose; only code builds controls.
function code(src, isHtml) {
  if (isHtml) return src.replace(/<!--[\s\S]*?-->/g, '');
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ------------------------------------------------------- A. every control --
function controls(file, src) {
  const out = [];
  const re = /<(input|select|textarea|button)\b/g;
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf('>', m.index);
    const tag = src.slice(m.index, end + 1);
    const line = src.slice(0, m.index).split('\n').length;
    let inner = '';
    if (m[1] === 'button') {
      const close = src.indexOf('</button>', end);
      inner = close > 0 ? src.slice(end + 1, close) : '';
    }
    out.push({ file: file, line: line, kind: m[1], tag: tag, inner: inner });
  }
  return out;
}

function named(c, labels) {
  if (/\baria-label(ledby)?="/.test(c.tag)) return true;
  if (c.kind === 'input' && /\btype="hidden"/.test(c.tag)) return true;
  const id = /\bid="([A-Za-z][\w-]*)"/.exec(c.tag);
  if (id && labels.indexOf(id[1]) >= 0) return true;
  if (c.kind === 'button') {
    // Words of its own: what is left once the string joins and any lone
    // HTML entities are taken away.
    const words = c.inner.replace(/&#?\w+;/g, '').replace(/['"+\s]/g, '');
    return /[A-Za-z]/.test(words);
  }
  return false;
}

const files = [HTML].concat(scripts.filter((f) => fs.existsSync(path.join(REPO, f))));
const sources = files.map((f) => ({ file: f, src: code(read(f), /\.html$/.test(f)) }));
const labels = [];
sources.forEach((s) => s.src.replace(/<label for="([\w-]+)"/g, function (m, id) { labels.push(id); return m; }));
let all = [];
sources.forEach((s) => { all = all.concat(controls(s.file, s.src)); });
const bare = all.filter((c) => !named(c, labels));
yes('A the hub ships controls to check (' + all.length + ' found)', all.length >= 30);
yes('A every input, select, textarea and button has a name a screen reader says' +
    (bare.length ? ' (none: ' + bare.map((c) => c.file + ':' + c.line + ' ' + c.tag.slice(0, 60)).join(' | ') + ')' : ''),
    bare.length === 0);

// ------------------------------------------- B. createElement'd controls --
const made = [];
sources.forEach((s) => {
  const re = /(\w+)\s*=\s*document\.createElement\('(input|select|textarea|button)'\)/g;
  let m;
  while ((m = re.exec(s.src))) {
    const after = s.src.slice(m.index, m.index + 600);
    const v = m[1].replace(/[$]/g, '\\$&');
    const ok = new RegExp('\\b' + v + '\\.textContent\\s*=\\s*\'[^\']*[A-Za-z]').test(after) ||
               new RegExp('\\b' + v + '\\.setAttribute\\(\'aria-label\'').test(after);
    made.push({ where: s.file + ':' + s.src.slice(0, m.index).split('\n').length, ok: ok });
  }
});
const unnamedMade = made.filter((x) => !x.ok);
yes('B every control the script makes itself is given words or a label (' + made.length + ' made' +
    (unnamedMade.length ? '; none: ' + unnamedMade.map((x) => x.where).join(', ') : '') + ')', unnamedMade.length === 0);

// ------------------------------------------------- C. pass, fail, skip --
const hub = read('site/public/hub.js');
function fnSource(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return '';
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(at, i + 1);
}
const pressedOf = (markup) => {
  const got = {};
  markup.replace(/<button\b[^>]*>/g, function (b) {
    const v = /data-v="(\w+)"/.exec(b), p = /aria-pressed="(\w+)"/.exec(b);
    if (v) got[v[1]] = p ? p[1] : 'none';
    return b;
  });
  return got;
};

function fakeButton(v) {
  return { dataset: { v: v }, className: 'mark', attrs: {}, setAttribute(k, x) { this.attrs[k] = String(x); } };
}

const sandbox = {
  S: { results: { 'test-one': { status: 'fail' } } },
  esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
  remember: () => '',
  tally: () => {},
  api: () => ({ then(fn) { fn(); return { catch() {} }; } }),
  JSON: JSON, Date: Date, String: String, Array: Array,
};
let bar = null;
const h = { textContent: 'Test one', nextSibling: null, parentNode: { insertBefore() {} } };
sandbox.document = { createElement: () => (bar = { className: '', innerHTML: '', querySelector: () => ({ value: '' }), querySelectorAll: () => [] }) };
sandbox.el = (id) => (id === 'body' ? { querySelectorAll: () => [h] } : null);
sandbox.each = (root, sel, fn) => Array.prototype.forEach.call(root.querySelectorAll(sel), fn);
const want = ['slug', 'dressTests', 'saveResult'].map((n) => fnSource(hub, n));
yes('C the hub has dressTests and saveResult', want.every(Boolean));
let drawn = {};
let saved = {}, cleared = {};
try {
  vm.createContext(sandbox);
  vm.runInContext(want.join('\n'), sandbox);
  vm.runInContext('dressTests()', sandbox);
  drawn = pressedOf(bar ? bar.innerHTML : '');
  const btns = ['pass', 'fail', 'skip'].map(fakeButton);
  const saveBar = { querySelectorAll: () => btns, querySelector: () => ({}) };
  sandbox.saveBar = saveBar;
  vm.runInContext("saveResult('test-one', { status: 'pass' }, saveBar)", sandbox);
  btns.forEach((b) => { saved[b.dataset.v] = b.attrs['aria-pressed'] || 'none'; });
  vm.runInContext("saveResult('test-one', { status: '' }, saveBar)", sandbox);
  btns.forEach((b) => { cleared[b.dataset.v] = b.attrs['aria-pressed'] || 'none'; });
} catch (e) {
  console.log('      ' + (e && e.message));
}
yes('C drawn with fail chosen, FAIL reads pressed and PASS and SKIP do not (' + JSON.stringify(drawn) + ')',
    drawn.fail === 'true' && drawn.pass === 'false' && drawn.skip === 'false');
yes('C after a save of pass, PASS reads pressed and the others do not (' + JSON.stringify(saved) + ')',
    saved.pass === 'true' && saved.fail === 'false' && saved.skip === 'false');
yes('C after the choice is taken off, none reads pressed (' + JSON.stringify(cleared) + ')',
    cleared.pass === 'false' && cleared.fail === 'false' && cleared.skip === 'false');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
