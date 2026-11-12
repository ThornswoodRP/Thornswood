/*
  test-4421-hub-focus-and-words.js

      node site/tests/test-4421-hub-focus-and-words.js

  #4421: after any staff hub action (an inbox button, a note, ban or PK on
  Linked accounts, Accept or Delete in the gallery queue) the hub redrew the
  whole area, so the button that had focus was thrown away and keyboard focus
  fell back to the top of the page; the result went into a line inside that
  same redrawn area with no live role, so a screen reader said nothing; the
  inbox buttons did not say which report they act on; and the inbox's Delete
  question did not name the report.

  This runs the whole of site/public/hub.js, as the browser does, against a
  small stand-in document made from site/public/index.html, with the site's
  answers scripted, and presses the buttons as a keyboard does (focus, then
  press):

    A. the inbox: every button names its report; Not doing this keeps focus on
       that row; Delete asks with the report's name and puts focus on the row
       that took its place; a save the site refuses, and one that never
       reaches it, leave the row as it was, with focus on it, and say so.
    B. Linked accounts: Add note keeps focus on that account's button.
    C. the gallery queue: Accept and Delete put focus on the next picture,
       and Delete asks with the picture's name.

  Each result must be said in a live region that is not part of the redrawn
  area, since a region that is drawn again with its words already in it is
  not read.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = process.env.TS_REPO || path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8').split('\r\n').join('\n');
const HUB = read('site/public/hub.js');
const HTML = read('site/public/index.html');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------- a small stand-in document --
// Elements are read from the HTML the page writes, start tag by start tag,
// with their attributes. That is all the hub's code asks of them here.
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
let doc = null;
function node(tag, attrs) {
  const n = {
    tag: tag.toLowerCase(), attrs: Object.assign({}, attrs), kids: [], _html: '', _text: '',
    value: attrs.value !== undefined ? attrs.value : '', disabled: false, hidden: false, onclick: null,
    oninput: null, onchange: null, onkeydown: null, style: {}, tabIndex: -1,
    get id() { return this.attrs.id || ''; },
    get className() { return this.attrs.class || ''; },
    set className(v) { this.attrs.class = String(v); },
    get dataset() {
      const d = {};
      for (const k of Object.keys(this.attrs)) {
        if (k.indexOf('data-') === 0) d[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = this.attrs[k];
      }
      return d;
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { setHtml(this, String(v)); },
    insertAdjacentHTML(where, h) { setHtml(this, h + this._html); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
    focus() { if (doc && all(doc).indexOf(this) >= 0) doc.activeElement = this; },
    blur() { if (doc && doc.activeElement === this) doc.activeElement = doc.body; },
    querySelectorAll(sel) { return all(this).filter((e) => matches(e, sel)); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    appendChild(c) { this.kids.push(c); return c; },
    addEventListener() {}, setSelectionRange() {}, scrollIntoView() {}
  };
  return n;
}
function parse(html) {
  const out = [];
  // Comments are cut by position, not by a pattern, so nothing between a
  // comment's start and end is ever read as a tag.
  let bare = '';
  for (let at = 0; at < html.length;) {
    const open = html.indexOf('<!--', at);
    if (open < 0) { bare += html.slice(at); break; }
    bare += html.slice(at, open);
    const shut = html.indexOf('-->', open + 4);
    at = shut < 0 ? html.length : shut + 3;
  }
  html = bare;
  const re = /<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const ar = /([\w:-]+)(?:="([^"]*)")?/g;
    let a;
    while ((a = ar.exec(m[2]))) attrs[a[1].toLowerCase()] = a[2] === undefined ? '' : unesc(a[2]);
    const e = node(m[1], attrs);
    const close = html.indexOf('<', re.lastIndex);
    e._text = unesc(html.slice(re.lastIndex, close < 0 ? html.length : close));
    out.push(e);
  }
  return out;
}
function all(n) {
  let out = [];
  for (const k of n.kids) out = out.concat([k], all(k));
  return out;
}
function setHtml(n, html) {
  const gone = all(n);
  n._html = html;
  n.kids = parse(html);
  // What had focus inside was thrown away with the old HTML.
  if (doc && gone.indexOf(doc.activeElement) >= 0) doc.activeElement = doc.body;
}
function matchOne(e, s) {
  const m = /^([a-z0-9]+)?((?:\.[\w-]+)*)(?:#([\w-]+))?((?:\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(s.trim());
  if (!m) return false;
  if (m[1] && e.tag !== m[1].toLowerCase()) return false;
  const classes = (e.attrs.class || '').split(/\s+/);
  for (const c of (m[2] || '').split('.').filter(Boolean)) if (classes.indexOf(c) < 0) return false;
  if (m[3] && e.attrs.id !== m[3]) return false;
  const ar = /\[([\w-]+)(?:="([^"]*)")?\]/g;
  let a;
  while ((a = ar.exec(m[4] || ''))) {
    if (!Object.prototype.hasOwnProperty.call(e.attrs, a[1])) return false;
    if (a[2] !== undefined && e.attrs[a[1]] !== a[2]) return false;
  }
  return true;
}
const matches = (e, sel) => sel.split(',').some((s) => matchOne(e, s));

// ------------------------------------------------------------ the hub, run --
const said = { confirm: [], alert: [] };
let answer = () => null; // the scripted site: (path, opts) => { status, body } or 'down'
const calls = [];
function makeHub() {
  const body = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('</body>'));
  doc = node('#document', {});
  doc.body = node('body', {});
  doc.kids = parse(body);
  doc.activeElement = doc.body;
  doc.getElementById = (id) => all(doc).filter((e) => e.attrs.id === id)[0] || null;
  doc.addEventListener = () => {};
  doc.createElement = (t) => node(t, {});
  doc.title = '';
  const sandbox = {
    document: doc,
    window: {},
    location: { pathname: '/hub', search: '', href: '/hub' },
    history: { pushState() {}, replaceState() {} },
    localStorage: { getItem: () => '', setItem() {} },
    URLSearchParams,
    marked: { setOptions() {}, use() {}, parse: (s) => String(s) },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    confirm: (t) => { said.confirm.push(String(t)); return true; },
    alert: (t) => { said.alert.push(String(t)); },
    setTimeout, clearTimeout,
    fetch: (p, opts) => {
      calls.push([p, opts || {}]);
      if (p === '/api/hello') return new Promise(() => {});
      const a = answer(p, opts || {});
      if (!a || a === 'down') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({
        ok: a.status >= 200 && a.status < 300, status: a.status,
        json: () => Promise.resolve(a.body === undefined ? {} : a.body)
      });
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HUB, sandbox, { filename: 'hub.js' });
  return sandbox;
}
async function settle() { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); }
/* A live region the redraw does not replace: in the document, outside #page. */
function spoken() {
  const page = doc.getElementById('page');
  const inPage = page ? all(page) : [];
  return all(doc).filter((e) => (e.attrs['aria-live'] === 'polite' || e.attrs['aria-live'] === 'assertive') &&
    inPage.indexOf(e) < 0).map((e) => e.textContent).join(' | ');
}
const focused = () => doc.activeElement;
const page = () => doc.getElementById('page');
const btn = (sel) => page().querySelector(sel);
function press(b) { b.focus(); b.onclick.call(b); }

(async function main() {
  try {
    // -------------------------------------------------------------- A. inbox --
    console.log('A. the inbox:');
    let hub = makeHub();
    const now = Date.now();
    const rows = () => [
      { id: 'i1', kind: 'bug', title: 'a door in Whiterun will not open', state: 'new', at: now - 3000 },
      { id: 'i2', kind: 'bug', title: 'the cart to Riften is late', state: 'new', at: now - 2000 },
      { id: 'i3', kind: 'idea', title: 'more lanterns in Falkreath', state: 'not doing this', at: now - 1000 }
    ];
    vm.runInContext('S.me = { admin: true, dev: true, member: true, name: "Aela" }; S.at = "inbox";', hub);
    hub.S.inbox = rows();
    hub.draw();
    const d1 = btn('[data-dismiss="i1"]');
    yes('the inbox draws Not doing this for the first report', !!d1);
    yes('  and that button says which report it is for',
        !!d1 && /a door in Whiterun will not open/.test(d1.getAttribute('aria-label') || ''));
    const f3 = btn('[data-forget="i3"]');
    yes('  and so does Delete on a report already dealt with',
        !!f3 && /more lanterns in Falkreath/.test(f3.getAttribute('aria-label') || ''));

    answer = (p, o) => p === '/api/inbox' ? { status: 200, body: { ok: true,
      inbox: [Object.assign(rows()[0], { state: 'not doing this' }), rows()[1], rows()[2]] } } : null;
    press(d1);
    await settle();
    const f1 = focused();
    yes('after Not doing this, focus is on that report\'s row (' + (f1.tag + ' ' + JSON.stringify(f1.attrs)) + ')',
        f1 !== doc.body && (f1.getAttribute('data-reopen') === 'i1' || f1.getAttribute('data-forget') === 'i1'));
    yes('  and a live region outside the page says what was done, and to which report (' + spoken() + ')',
        /a door in Whiterun will not open/.test(spoken()));

    answer = (p) => p === '/api/inbox' ? { status: 200, body: { ok: true, inbox: [rows()[1], rows()[2]] } } : null;
    said.confirm.length = 0;
    press(btn('[data-forget="i1"]'));
    await settle();
    yes('Delete asks with the report\'s name (' + said.confirm.join(' | ') + ')',
        said.confirm.length === 1 && /a door in Whiterun will not open/.test(said.confirm[0]));
    const f2 = focused();
    yes('  and focus goes to the report that took its place (' + JSON.stringify(f2.attrs) + ')',
        f2 !== doc.body && f2.getAttribute('data-dismiss') === 'i2');
    yes('  and the live region says it was deleted (' + spoken() + ')',
        /delet/i.test(spoken()) && /a door in Whiterun will not open/.test(spoken()));

    hub.S.inbox = [rows()[1], rows()[2]];
    hub.draw();
    answer = (p) => p === '/api/inbox' ? { status: 500, body: { error: 'could not save' } } : null;
    press(btn('[data-dismiss="i2"]'));
    await settle();
    yes('a save the site refuses leaves the report as it was', hub.S.inbox[0].state === 'new' && !!btn('[data-dismiss="i2"]'));
    yes('  with focus on it', focused().getAttribute && focused().getAttribute('data-dismiss') === 'i2');
    yes('  and says it was not saved (' + spoken() + ')', /not saved/i.test(spoken()) && /the cart to Riften is late/.test(spoken()));

    answer = () => 'down';
    press(btn('[data-dismiss="i2"]'));
    await settle();
    yes('a save that never reaches the site leaves the report as it was', hub.S.inbox[0].state === 'new' && !!btn('[data-dismiss="i2"]'));
    yes('  with focus on it', focused().getAttribute && focused().getAttribute('data-dismiss') === 'i2');
    yes('  and says it was not saved (' + spoken() + ')', /not saved/i.test(spoken()) && /the cart to Riften is late/.test(spoken()));

    // ---------------------------------------------------- B. linked accounts --
    console.log('\nB. linked accounts:');
    hub = makeHub();
    vm.runInContext('S.me = { admin: true, dev: true, member: true, name: "Aela" }; S.at = "linked";', hub);
    const linked = [{ id: '333333333333333333', name: 'Bjorn', profiles: [2002] }];
    hub.S.linked = linked;
    hub.draw();
    const note = btn('button[data-act="note"]');
    const box = btn('.notetext');
    yes('Linked accounts draws Add note', !!note && !!box);
    box.value = 'seen at the gate';
    answer = (p) => {
      if (p === '/api/staff/note') return { status: 200, body: { ok: true } };
      if (p === '/api/all') return { status: 200, body: { linked, records: { bans: {}, notes: {}, pk: {}, names: {} } } };
      return null;
    };
    press(note);
    await settle();
    const fl = focused();
    yes('after Add note, focus is on that account\'s Add note again (' + JSON.stringify(fl.attrs) + ')',
        fl !== doc.body && fl.getAttribute('data-act') === 'note' && fl.getAttribute('data-id') === '333333333333333333');
    yes('  and the live region says the note was added (' + spoken() + ')', /note/i.test(spoken()) && /Bjorn/.test(spoken()));

    // --------------------------------------------------- C. the gallery queue --
    console.log('\nC. the gallery queue:');
    hub = makeHub();
    vm.runInContext('S.me = { admin: true, dev: true, member: true, name: "Aela" }; S.at = "uploads";', hub);
    let waiting = [{ name: 'a-shot.png', by: 'Bjorn', at: now }, { name: 'b-shot.png', by: 'Aela', at: now }];
    answer = (p) => {
      if (p === '/api/gallery/pending') return { status: 200, body: { pending: waiting } };
      if (p === '/api/public') return { status: 200, body: { gallery: [] } };
      if (p === '/api/gallery/approve') { waiting = waiting.slice(1); return { status: 200, body: { ok: true, approved: true } }; }
      if (p === '/api/gallery/approved') { waiting = []; return { status: 200, body: { ok: true } }; }
      return null;
    };
    hub.draw();
    await settle();
    const ok = btn('[data-galok="a-shot.png"]');
    yes('the queue draws Accept for the first picture', !!ok);
    press(ok);
    await settle();
    const fg = focused();
    yes('after Accept, focus is on the next picture (' + JSON.stringify(fg.attrs) + ')',
        fg !== doc.body && [fg.getAttribute('data-galok'), fg.getAttribute('data-galdel'), fg.getAttribute('data-galcopy')].indexOf('b-shot.png') >= 0);
    yes('  and the live region says it was accepted (' + spoken() + ')', /accept/i.test(spoken()) && /a-shot\.png/.test(spoken()));
    said.confirm.length = 0;
    press(btn('[data-galdel="b-shot.png"]'));
    await settle();
    yes('Delete asks with the picture\'s name', said.confirm.length === 1 && /b-shot\.png/.test(said.confirm[0]));
    yes('  and with the queue empty, focus is still on the page, not thrown to the top (' + JSON.stringify(focused().attrs) + ')',
        focused() !== doc.body && all(page()).indexOf(focused()) >= 0);
    yes('  and the live region says it was deleted (' + spoken() + ')', /delet/i.test(spoken()) && /b-shot\.png/.test(spoken()));
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
