'use strict';
/*
  test-4389-report-gallery-a11y.js

      node tests\test-4389-report-gallery-a11y.js

  Issue #4389. On the report and gallery pages a screen reader was not told a
  field's hint, often missed the first result message, and heard every
  gallery card's button as just "Report"; the gallery's placeholder text was
  too faint; and the rules and world pages lost their section nesting. This
  holds each of the five:

    A  HINTS. site\public\home.js run in a stand-in page at /report and at
       /gallery: every field with a hint names it with aria-describedby, and
       each id it names is on the page with words in it.
    B  THE FIRST MESSAGE. The result line on each page (rSaid, galSaid) is
       a live region that is on the page from the start, not hidden: a live
       region shown and filled in the same moment is not in the
       accessibility tree when its words arrive, so they are not read. And
       pressing Send (an empty gallery send, a report) fills it without
       ever setting hidden on it.
    C  THE REPORT BUTTONS. Each gallery card's Report button has a name of
       its own that names its picture, and no two are the same, the cards a
       "Load more" adds included.
    D  THE PLACEHOLDER. The gallery form's placeholder colour, read out of
       site\public\home.css, is 4.5 to 1 or more on its field's background.
    E  THE SECTIONS. /rules and /world served by a copy of the site have one
       h1 and never skip a heading level, a rule in the world part of the
       rules sits under "In the World", an article of the Accord sits under
       its heading; and the page script's own show(), which draws a page
       fetched after load, nests the same way.

  Nothing leaves the machine. The scratch folder is removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
const HOME_JS = fs.readFileSync(path.join(ROOT, 'site', 'public', 'home.js'), 'utf8');
const HOME_CSS = fs.readFileSync(path.join(ROOT, 'site', 'public', 'home.css'), 'utf8');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).trim().split('\n').join('\n      ') : '')); }
}
const tick = () => new Promise((ok) => setImmediate(ok));

/* ---- a stand-in page for home.js ------------------------------------------
   Anything the script asks of the page answers with a stand-in that takes any
   property and any call. Elements by id are kept, so what the script writes to
   one (its innerHTML, hidden, textContent, its listeners) can be read back,
   and every property it sets is written down in order. */
function anything(name) {
  const data = {};
  return new Proxy(function () { }, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');
      if (k === 'then') return undefined;
      if (Object.prototype.hasOwnProperty.call(data, k)) return data[k];
      return anything(name + '.' + String(k));
    },
    set(t, k, v) { data[k] = v; return true; },
    apply() { return anything(name + '()'); },
    construct() { return anything('new ' + name); }
  });
}
function element(id) {
  const e = { id: id, writes: [], listeners: {}, attrs: {} };
  // The few calls the pages make on an element. Any other property reads as
  // not set (undefined), the way a fresh element's disabled or value does.
  const base = {
    addEventListener(type, fn) { (e.listeners[type] = e.listeners[type] || []).push(fn); },
    setAttribute(k, v) { e.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; },
    insertAdjacentHTML(where, html) { e.added = (e.added || '') + html; },
    querySelector(sel) { return (e.kids[sel] = e.kids[sel] || element(id + ' ' + sel)).el; },
    querySelectorAll() { return []; },
    appendChild() { }, removeChild() { }, focus() { }, click() { }, blur() { },
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    style: {}, children: [], dataset: {}
  };
  e.kids = {};
  e.el = new Proxy({}, {
    get(t, k) {
      if (Object.prototype.hasOwnProperty.call(e, 'p_' + String(k))) return e['p_' + String(k)];
      if (Object.prototype.hasOwnProperty.call(base, k)) return base[k];
      return undefined;
    },
    set(t, k, v) { e['p_' + String(k)] = v; e.writes.push([String(k), v]); return true; }
  });
  return e;
}
async function runPage(pathname, answers) {
  const els = {};
  const byId = (id) => (els[id] = els[id] || element(id)).el;
  const calls = [];
  const fetchStub = (url) => {
    calls.push(String(url));
    const hit = Object.prototype.hasOwnProperty.call(answers, url) ? answers[url] : undefined;
    if (hit === undefined) return new Promise(() => { });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(hit))) });
  };
  const document = anything('document');
  const doc = new Proxy({}, {
    get(t, k) {
      if (k === 'getElementById') return byId;
      if (k === 'title') return 'Thornswood';
      if (k === 'cookie') return '';
      return document[k];
    },
    set() { return true; }
  });
  const win = anything('window');
  win.AbortController = AbortController;
  win.matchMedia = () => ({ matches: false });
  win.addEventListener = () => { };
  win.prompt = () => null;
  const ctx = {
    window: win, document: doc, fetch: fetchStub, console: { log() { }, error() { } },
    location: { pathname: pathname, hash: '', protocol: 'https:', reload() { } },
    localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
    navigator: anything('navigator'), setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() { },
    requestAnimationFrame() { }, AbortController, URL
  };
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(HOME_JS, ctx, { filename: 'home.js' }); } catch (e) { threw = e; }
  for (let i = 0; i < 20; i++) await tick();
  return { ctx, els, byId, calls, threw, el: (id) => els[id] };
}
// The tag of the element with this id in a piece of markup, or ''.
const tagOf = (html, id) => (new RegExp('<[a-z]+\\b[^>]*\\bid="' + id + '"[^>]*>', 'i').exec(html) || [''])[0];
const describedBy = (tag) => ((/\baria-describedby="([^"]*)"/.exec(tag) || [])[1] || '').split(/\s+/).filter(Boolean);
// The words of a piece of markup, its tags left out. Read a character at a
// time, not with a replace, so nothing is half taken out of it.
function textOf(html) {
  let out = '', inTag = false;
  for (const ch of html) {
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) out += ch;
  }
  return out.trim();
}
const wordsOf = (html, id) => {
  const m = new RegExp('<([a-z]+)\\b[^>]*\\bid="' + id + '"[^>]*>([\\s\\S]*?)</\\1>', 'i').exec(html);
  return m ? textOf(m[2]) : '';
};
function described(html, fieldId) {
  const ids = describedBy(tagOf(html, fieldId));
  return ids.length > 0 && ids.every((h) => wordsOf(html, h).length > 0);
}

/* ---- contrast ------------------------------------------------------------ */
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/* ---- headings ------------------------------------------------------------ */
function heads(html) {
  const out = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ n: Number(m[1]), text: textOf(m[2]) });
  return out;
}
function skips(list) {
  const bad = [];
  for (let i = 1; i < list.length; i++) if (list[i].n > list[i - 1].n + 1) bad.push(list[i - 1].text + ' (h' + list[i - 1].n + ') then ' + list[i].text + ' (h' + list[i].n + ')');
  return bad;
}
const parentOf = (list, text) => {
  const i = list.findIndex((h) => h.text === text);
  if (i < 0) return null;
  for (let j = i - 1; j >= 0; j--) if (list[j].n < list[i].n) return list[j];
  return null;
};
function nests(html, what) {
  const h = heads(html);
  yes(what + ': one h1 (' + h.filter((x) => x.n === 1).length + ')', h.filter((x) => x.n === 1).length === 1);
  const s = skips(h);
  yes(what + ': no heading level is skipped', s.length === 0, s.join('\n'));
  return h;
}

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
function get(port, where) {
  return new Promise((done) => {
    http.get({ host: '127.0.0.1', port: port, path: where, agent: false }, (res) => {
      let t = ''; res.setEncoding('utf8');
      res.on('data', (d) => { t += d; });
      res.on('end', () => done({ status: res.statusCode, text: t }));
    }).on('error', (e) => done({ status: 0, text: String(e) }));
  });
}

(async () => {
  // ---- A, B: the report page ---------------------------------------------
  const rep = await runPage('/report', {});
  yes('home.js runs at /report in the stand-in page' + (rep.threw ? ' (' + rep.threw.message + ')' : ''), !rep.threw);
  const repHtml = String((rep.el('pagebody') || { p_innerHTML: '' }).p_innerHTML || '');
  yes('and draws the report form', /id="rep"/.test(repHtml));
  for (const f of ['rTitle', 'rDetail', 'rBy', 'rWho']) {
    yes('A1 report: ' + f + ' names its hint with aria-describedby (' + (describedBy(tagOf(repHtml, f)).join(' ') || 'none') + ')',
      described(repHtml, f), tagOf(repHtml, f));
  }
  const rSaid = tagOf(repHtml, 'rSaid');
  yes('B1 report: the result line is a live region on the page from the start, not hidden',
    /aria-live="polite"/.test(rSaid) && /role="status"/.test(rSaid) && !/\bhidden\b/.test(rSaid), rSaid);
  const submit = ((rep.els.rep || { listeners: {} }).listeners.submit || []).slice(-1)[0];
  if (submit) { try { submit({ preventDefault() { } }); } catch (e) { yes('the report form\'s submit ran (' + e.message + ')', false); } }
  const rs = rep.els.rSaid || { writes: [] };
  yes('B2 report: Send fills the result line and never sets hidden on it',
    !!submit && rs.writes.some((w) => w[0] === 'textContent' && String(w[1]).length > 0) && !rs.writes.some((w) => w[0] === 'hidden'),
    JSON.stringify(rs.writes));

  // ---- A, B, C: the gallery page ------------------------------------------
  const shot = (n, by) => ({ name: n + '.png', url: '/shot/' + n + '.png', by: by });
  const gal = await runPage('/gallery', {
    '/api/gallery/who': { signed: true, canSubmit: true, staff: false, admin: false, name: 'Ama', asked: true },
    '/api/public?galleryLimit=24': { gallery: [shot('a', 'Ama'), shot('b', 'Ama'), shot('c', 'Bo')], galleryNext: 3 },
    '/api/gallery?offset=3': { gallery: [shot('d', 'Ama')], next: null }
  });
  yes('home.js runs at /gallery in the stand-in page' + (gal.threw ? ' (' + gal.threw.message + ')' : ''), !gal.threw);
  const galHtml = String((gal.el('pagebody') || { p_innerHTML: '' }).p_innerHTML || '');
  yes('and draws the send form and three cards', /id="galSend"/.test(galHtml) && (galHtml.match(/data-galreport=/g) || []).length === 3);
  for (const f of ['galPick', 'galBy', 'galNote']) {
    yes('A2 gallery: ' + f + ' names its hint with aria-describedby (' + (describedBy(tagOf(galHtml, f)).join(' ') || 'none') + ')',
      described(galHtml, f), tagOf(galHtml, f));
  }
  const gSaid = tagOf(galHtml, 'galSaid');
  yes('B3 gallery: the result line is a live region on the page from the start, not hidden',
    /aria-live="polite"/.test(gSaid) && /role="status"/.test(gSaid) && !/\bhidden\b/.test(gSaid), gSaid);
  const sendClick = ((gal.els.galSend || { listeners: {} }).listeners.click || []).slice(-1)[0];
  if (sendClick) { try { sendClick({}); } catch (e) { yes('the gallery Send ran (' + e.message + ')', false); } }
  const gs = gal.els.galSaid || { writes: [] };
  yes('B4 gallery: Send with nothing chosen fills the result line and never sets hidden on it',
    !!sendClick && gs.writes.some((w) => w[0] === 'textContent' && /Choose a picture/.test(String(w[1]))) && !gs.writes.some((w) => w[0] === 'hidden'),
    JSON.stringify(gs.writes));

  const buttons = (html) => (html.match(/<button\b[^>]*data-galreport="[^"]*"[^>]*>/g) || []);
  const label = (b) => (/\baria-label="([^"]*)"/.exec(b) || [])[1] || '';
  const first = buttons(galHtml);
  yes('C1 every Report button has a name of its own beyond "Report" (' + first.map(label).join(' | ') + ')',
    first.length === 3 && first.every((b) => /^Report\b/.test(label(b)) && label(b).length > 'Report'.length));
  yes('C2 the name says which picture: whose it is', first.every((b, i) => label(b).indexOf(['Ama', 'Ama', 'Bo'][i]) >= 0));
  const moreClick = ((gal.els.galMore || { listeners: {} }).listeners.click || []).slice(-1)[0];
  if (moreClick) { try { moreClick({}); } catch (e) { yes('Load more ran (' + e.message + ')', false); } }
  for (let i = 0; i < 20; i++) await tick();
  const added = buttons(String((gal.els.galleryCards || {}).added || ''));
  const all = first.concat(added).map(label);
  yes('C3 and no two are the same, the card Load more adds included (' + all.join(' | ') + ')',
    added.length === 1 && new Set(all).size === all.length && all.every((l) => l.length > 'Report'.length));

  // ---- D: the placeholder -------------------------------------------------
  const vars = {};
  for (const m of HOME_CSS.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]] = m[2];
  const colourOf = (v) => { const m = /var\(--([a-z0-9-]+)\)/.exec(v || ''); return m ? vars[m[1]] : (/^#[0-9a-f]{6}$/i.test(v || '') ? v : null); };
  const rule = (sel) => { const at = HOME_CSS.indexOf(sel + '{'); return at < 0 ? '' : HOME_CSS.slice(at + sel.length + 1, HOME_CSS.indexOf('}', at)); };
  const field = rule('.gal-box .form input[type=text]');
  const ph = rule('.gal-box .form input[type=text]::placeholder');
  const fg = colourOf((/(?:^|;)\s*color:\s*([^;]+)/.exec(ph) || [])[1]);
  const bgs = [(/background:\s*([^;]+)/.exec(field) || [])[1], (/background:\s*([^;]+)/.exec(rule('.gal-box .form input[type=text]:hover')) || [])[1],
    (/background:\s*([^;]+)/.exec(rule('.gal-box .form input[type=text]:focus')) || [])[1]].map(colourOf).filter(Boolean);
  const worst = fg && bgs.length ? Math.min.apply(null, bgs.map((b) => ratio(fg, b))) : 0;
  yes('D1 the gallery placeholder (' + fg + ') is 4.5 to 1 or more on its field at rest, hovered and focused (' + worst.toFixed(2) + ' to 1)',
    !!fg && bgs.length === 3 && worst >= 4.5);

  // ---- E: the sections ----------------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4389-'));
  let srv = null;
  try {
    siteFiles.copy(dir);
    fs.mkdirSync(path.join(dir, 'data', 'site'), { recursive: true });
    for (const n of ['rules.md', 'world.md']) fs.copyFileSync(path.join(ROOT, 'site', 'data', 'site', n), path.join(dir, 'data', 'site', n));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    for (const n of fs.readdirSync(path.join(ROOT, 'site', 'public'))) {
      const p = path.join(ROOT, 'site', 'public', n);
      if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(dir, 'public', n));
    }
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: crypto.randomBytes(12).toString('hex'),
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: crypto.randomBytes(16).toString('hex'), admins: [], secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }));
    const port = await freePort();
    let out = '';
    srv = spawn(process.execPath, ['server.js'], {
      cwd: dir, env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1',
        THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
    });
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 200 && out.indexOf('listening on ') < 0 && srv.exitCode === null; i++) await new Promise((ok) => setTimeout(ok, 50));
    yes('a copy of the site starts', out.indexOf('listening on ') >= 0, out);
    const body = (t) => ((/<div class="wrap" id="pagebody">([\s\S]*?)<\/div><\/div>/.exec(t) || [])[1] || '');
    const rules = body((await get(port, '/rules')).text);
    const rh = nests(rules, 'E1 /rules');
    yes('E2 /rules: "In the World" is a section of the page (h2)', (rh.find((h) => h.text === 'In the World') || {}).n === 2);
    const p1 = parentOf(rh, '1. Your character knows what your character knows');
    yes('E3 /rules: its rule 1 sits under "In the World" (' + (p1 ? p1.text : 'nothing') + ')', !!p1 && p1.text === 'In the World');
    const world = body((await get(port, '/world')).text);
    const wh = nests(world, 'E4 /world');
    const art = parentOf(wh, 'Article the First: On the Crown');
    yes('E5 /world: an article sits under "The White Harbour Accord" (' + (art ? art.text + ', h' + art.n : 'nothing') + ')',
      !!art && art.text === 'The White Harbour Accord' && art.n === 2);
    const war = parentOf(wh, 'The War, and the end of it');
    yes('E6 /world: the history keeps its place under the page title', !!war && war.n === 1);

    // The page script's show(), for a page fetched after load.
    const page = await runPage('/gallery', {});
    let shown = '';
    try {
      page.ctx.show(rules.replace(/<h2\b/g, '<h1').replace(/<\/h2>/g, '</h1>').replace(/<h3\b/g, '<h2').replace(/<\/h3>/g, '</h2>')
        .replace(/<h4\b/g, '<h3').replace(/<\/h4>/g, '</h3>'));
      shown = String(page.el('pagebody').p_innerHTML || '');
    } catch (e) { shown = ''; }
    const sh = nests(shown, 'E7 the page script\'s show(), given the rules as written (every section an h1)');
    const sp = parentOf(sh, '1. Your character knows what your character knows');
    yes('E8 and its rule 1 sits under "In the World" there too', !!sp && sp.text === 'In the World');
  } finally {
    if (srv) await new Promise((ok) => { srv.on('exit', ok); try { srv.kill(); } catch (e) { ok(); } setTimeout(ok, 3000); });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the harness itself threw: ' + (e && e.stack || e)); process.exit(1); });
