// test-site-render.js
//
// Entry 247: the site's written pages go out as HTML, rendered by server.js
// with the copy of marked in public/, and nothing on the two pages is loaded
// from another company.
//
// Until then the rules, the world, how to join and the rest were an empty page
// that the browser filled in with marked from cdnjs.cloudflare.com, in fonts
// from Google, with no integrity check on either. A search engine or a link
// preview saw an empty page, the page was blank whenever cdnjs could not be
// reached, and every visitor's address went to both.
//
// Four parts:
//   1. The files: marked is the real 12.0.2, the fonts are real woff2 files
//      that fonts.css names, and neither page reaches off the site.
//   2. The renderer, taken out of server.js between its markers and driven on
//      its own: headings come out, HTML typed into a page does not, a link
//      only goes to http, https, mailto or this site, and the real pages come
//      out exactly as marked has always drawn them.
//   3. home.html's own router, run against a stand-in page: a page the server
//      filled is not fetched and drawn again on top of itself.
//   4. The real server.js, run from a scratch copy on a spare loopback port:
//      /rules arrives with its headings in it, and an odd address (two
//      slashes, a backslash, an encoded slash or null) is a 301 to one slash,
//      a 404 or a 400, never a 500, and never a way to a file it should not
//      reach (#929).
//
// The entry's own check, curl /rules and look for <h2, passes on the old
// server too: the front page's sections are h2s, and they are in the file,
// hidden, on every address. Measured on 24 September: 8 before, 19 after. So
// part 4 looks for the rules inside the page body, which was empty before.
//
// Read only on the repo. The server runs in a temp folder with its own
// config, and is stopped at the end.
//
// Not strict, on purpose: the render block is eval'd here, and strict eval
// would keep its two functions to itself.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const siteFiles = require('../../tests/site-files');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const vm = require('vm');
const { spawn } = require('child_process');

const APP = path.join(REPO_DIR, 'site');
const PUBLIC = path.join(APP, 'public');
const MARKED = 'marked-12.0.2.min.js';

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
// Before the server is started, exit at once. After it, stop it and let the
// loop drain: process.exit while the child's pipes are still closing trips a
// libuv assertion on Windows, which the voice harnesses found first.
let started = false, finished = false, watchdog = null;
function done() {
  if (finished) return;
  finished = true;
  if (watchdog) clearTimeout(watchdog);
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (!started) process.exit(fail ? 1 : 0);
  process.exitCode = fail ? 1 : 0;
  stop();
}
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

// ------------------------------------------------------------------ files --
console.log('THE FILES');
const home = read(path.join(PUBLIC, 'home.html')) || '';
const homeScript = read(path.join(PUBLIC, 'home.js')) || '';
const hub = read(path.join(PUBLIC, 'index.html')) || '';
const serverText = siteFiles.source() || '';

// The file npm and cdnjs both publish as marked 12.0.2's marked.min.js,
// measured on 24 September 2026. Line endings are taken back to LF first,
// because git on Windows checks it out with CRLF.
const markedText = read(path.join(PUBLIC, MARKED));
yes('public/' + MARKED + ' is there', markedText !== null);
yes('and it is the file cdnjs served for marked 12.0.2, byte for byte',
    markedText !== null && crypto.createHash('sha256')
      .update(markedText.replace(/\r\n/g, '\n'), 'utf8').digest('hex') ===
      '15fabce5b65898b32b03f5ed25e9f891a729ad4c0d6d877110a7744aa847a894');

const fontsCss = read(path.join(PUBLIC, 'fonts.css'));
yes('public/fonts.css is there', fontsCss !== null);
const faces = (fontsCss || '').match(/url\(\/[A-Za-z0-9._-]+\.woff2\)/g) || [];
yes('it names six font files, one Cinzel and five Spectral', faces.length === 6);
faces.forEach(function (u) {
  const name = u.slice(5, -1);
  let head = null;
  try { head = fs.readFileSync(path.join(PUBLIC, name)).slice(0, 4).toString('latin1'); } catch (e) { }
  yes(name + ' is in public/ itself, where Deploy-Docs sends from, and is a woff2', head === 'wOF2');
});
yes('fonts.css names nothing on another site', !/url\(\s*['"]?(https?:)?\/\//i.test(fontsCss || ''));

// The search entry 247 is done on, plus the font host itself.
[['home.html', home], ['index.html', hub]].forEach(function (pair) {
  const name = pair[0], t = pair[1];
  yes(name + ' is there', t.length > 1000);
  yes(name + ' says nothing of cdnjs, fonts.googleapis, fonts.gstatic or integrity=',
      !/cdnjs|fonts\.googleapis|fonts\.gstatic|integrity=/i.test(t));
  yes(name + ' loads no script, picture or anything else by src from another site',
      !/\ssrc\s*=\s*["']?(https?:)?\/\//i.test(t) && !/url\(\s*['"]?(https?:)?\/\//i.test(t));
  yes(name + ' loads no stylesheet or preconnect from another site',
      !/<link[^>]*\shref\s*=\s*["']?(https?:)?\/\/[^>]*>/i.test(t.replace(/<link[^>]*rel="icon"[^>]*>/gi, '')) &&
      !/rel\s*=\s*["']?preconnect/i.test(t));
  yes(name + ' takes its fonts from /fonts.css', /<link rel="stylesheet" href="\/fonts\.css">/.test(t));
});
yes('the front page needs no markdown library, because the server renders',
    !/\bmarked\b/.test(home));
yes('the hub still has marked, from this site', hub.indexOf('<script src="/' + MARKED + '"></script>') >= 0);

// The two lists of written pages are one list kept in two places.
const clientPages = (/var PAGES = \{([^}]*)\}/.exec(homeScript) || [])[1] || '';
const clientList = (clientPages.match(/'\/[a-z-]+'/g) || []).map(function (s) { return s.slice(1, -1); }).sort();
const serverPages = (/const MD_PAGES = \[([^\]]*)\]/.exec(serverText) || [])[1] || '';
const serverList = (serverPages.match(/'\/[a-z-]+'/g) || []).map(function (s) { return s.slice(1, -1); }).sort();
// Not a fixed count: /cookies made it ten (#794) and the next page will make
// it eleven. What matters is that neither list is empty or short of the other.
yes('home.html PAGES and server.js MD_PAGES name the same ' + clientList.length + ' pages',
    clientList.length >= 9 && clientList.join(',') === serverList.join(','));

// --------------------------------------------------------------- renderer --
console.log('');
console.log('THE RENDERER');
const a = serverText.indexOf('// ==== thornswood page render ====');
const b = serverText.indexOf('// ==== end thornswood page render ====');
yes('the page render block is in server.js between its markers', a >= 0 && b > a);
if (!(a >= 0 && b > a) || markedText === null) { done(); }
eval(serverText.slice(a, b));
// The pages are served through the open switch (#428), which takes out the
// <!-- alpha --> and <!-- open --> marker lines and the other mode's words,
// so they are compared as served, in both modes.
const sa = serverText.indexOf('// ==== thornswood open switch ====');
const sb = serverText.indexOf('// ==== end thornswood open switch ====');
yes('the open switch block is in server.js between its markers', sa >= 0 && sb > sa);
const forMode = (sa >= 0 && sb > sa)
  ? new Function('cfg', serverText.slice(sa, sb) + '\nreturn forMode;')({ open: false })
  : function (md) { return md; };
const lib = require(path.join(PUBLIC, MARKED));
const render = makePageRenderer(lib);

// What a browser would do with an address: decode character references once,
// drop the tabs and line breaks the URL parser ignores, and read the scheme.
function decodeOnce(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n' };
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z]+);?/g, function (all, e) {
    if (e[0] === '#') {
      const n = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch (x) { return all; }
    }
    const k = e.toLowerCase();
    return Object.prototype.hasOwnProperty.call(named, k) ? named[k] : all;
  });
}
function schemeOf(v) {
  const u = decodeOnce(v).replace(/^[\x00-\x20]+/, '').replace(/[\t\n\r]/g, '');
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(u);
  return m ? m[1].toLowerCase() : '';
}
// A tag's attributes the way a browser splits them, quotes and all, so a
// quoted title with " onmouseover=" inside it is one value and not a handler.
function attrsOf(tag) {
  const out = [];
  const body = tag.replace(/^<[A-Za-z][A-Za-z0-9-]*/, '').replace(/\/?>$/, '');
  const re = /([^\s"'>\/=]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(body))) {
    out.push({ name: m[1].toLowerCase(),
               value: m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : '' });
  }
  return out;
}
// Everything that would make a rendered page run something.
function unsafe(html) {
  const why = [];
  (html.match(/<[A-Za-z][^>]*>/g) || []).forEach(function (tag) {
    const name = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(tag)[1].toLowerCase();
    if (/^(script|iframe|frame|frameset|object|embed|style|svg|math|form|base|meta|link)$/.test(name)) {
      why.push('a <' + name + '> tag');
    }
    attrsOf(tag).forEach(function (at) {
      if (/^on/.test(at.name)) why.push('an event handler, ' + at.name);
      if (at.name === 'style') why.push('a style attribute');
      if (/^(href|src|srcset|action|formaction|xlink:href|background|poster)$/.test(at.name)) {
        const s = schemeOf(at.value);
        if (s && s !== 'http' && s !== 'https' && s !== 'mailto') why.push('a ' + s + ': address');
      }
    });
  });
  return why;
}

const heads = render('# Rules\n\nTwo lists.\n\n## Be decent\n\n### One\n\ntext');
yes('a heading comes out as a heading', heads.indexOf('<h1>Rules</h1>') >= 0 && heads.indexOf('<h2>Be decent</h2>') >= 0 &&
    heads.indexOf('<h3>One</h3>') >= 0);
yes('a table comes out as a table', /<table>[\s\S]*<td>1<\/td>/.test(render('| a | b |\n|---|---|\n| 1 | 2 |')));
yes('a link to another site is kept', render('[Nexus](https://www.nexusmods.com/x "the \\"collection\\"")')
  .indexOf('<a href="https://www.nexusmods.com/x" title="the &quot;collection&quot;">Nexus</a>') >= 0);
yes('a link on this site is kept', render('[the Accord](/world#accord)').indexOf('<a href="/world#accord">the Accord</a>') >= 0);
yes('a mail link is kept', render('[mail](mailto:someone@example.com)').indexOf('href="mailto:someone@example.com"') >= 0);
yes('an address with & in it keeps working', render('[q](https://example.com/?a=1&b=2)').indexOf('href="https://example.com/?a=1&amp;b=2"') >= 0);
yes('a picture on this site is kept, words escaped', render('![a "view" <b>](/og.png)').indexOf('<img src="/og.png" alt="a &quot;view&quot; &lt;b&gt;">') >= 0);
yes('the empty anchor above the Accord is kept', render("---\n\n<a id='accord'></a>\n\n# The White Harbour Accord").indexOf('<a id="accord"></a>') >= 0);
yes('text with a dollar in it stays a dollar', render('It costs $1 and $& and $$.').indexOf('It costs $1 and $&amp; and $$.') >= 0);

// Somebody typing into a document is not somebody writing the front page.
const hostile = [
  ['a picture with an error handler', '<img src=x onerror=alert(1)>'],
  ['a script block', '<script>alert(1)</script>'],
  ['a script inline', 'hello <script>alert(1)</script> there'],
  ['a frame', '<iframe src="https://example.com"></iframe>'],
  ['an svg with an onload', '<svg onload=alert(1)>'],
  ['a block of html', '<div onclick="alert(1)">\nhi\n</div>'],
  ['a link to javascript:', '[click](javascript:alert(1))'],
  ['in capitals', '[click](JaVaScRiPt:alert(1))'],
  ['with the colon as an entity', '[click](javascript&#58;alert(1))'],
  ['with the colon as a named entity', '[click](javascript&colon;alert(1))'],
  ['with a tab inside the word', '[click](java\tscript:alert(1))'],
  ['a data: page', '[click](data:text/html,<script>alert(1)</script>)'],
  ['vbscript:', '[click](vbscript:msgbox(1))'],
  ['a reference link to javascript:', '[click][x]\n\n[x]: javascript:alert(1)'],
  ['an autolink to javascript:', '<javascript:alert(1)>'],
  ['a picture from javascript:', '![x](javascript:alert(1))'],
  ['a title that tries to close the attribute', '[x](/a "a\\" onmouseover=\\"alert(1)")'],
  ['an anchor that is not empty', "<a id='x' onclick='alert(1)'></a>"],
  ['an anchor with an address', "<a id='x' href='javascript:alert(1)'></a>"],
  ['raw mode opened by pre', '<pre>\n\n<img/src=x onerror=alert(1)>'],
  ['raw mode opened by kbd, inline', 'a <kbd><img/src=x onerror=alert(1)></kbd> b'],
  ['raw mode opened by script', '<script>x <img/src=x onerror=alert(1)>'],
  ['a comment hiding a tag', '<!-- --><img src=x onerror=alert(1)>'],
  ['an html entity smuggling a tag', '&lt;img src=x onerror=alert(1)&gt;']
];
hostile.forEach(function (c) {
  let out = '';
  try { out = render(c[1]); } catch (e) { out = '<script>threw ' + e.message; }
  const why = unsafe(out);
  yes('safe: ' + c[0] + (why.length ? '  (' + why.join('; ') + ' in ' + JSON.stringify(out.trim()) + ')' : ''),
      why.length === 0);
});
yes('the typed tag is shown as text rather than dropped',
    render('<img src=x onerror=alert(1)>').indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0);
yes('a refused link keeps its words', render('[click here](javascript:alert(1))').indexOf('click here') >= 0);

// The real pages come out exactly as marked 12.0.2 has always drawn them in
// the browser, apart from the quotes on the one anchor. So refusing HTML
// changed nothing anybody can see on a page that exists.
const plain = new lib.Marked({ gfm: true, breaks: false });
const pages = [];
try {
  fs.readdirSync(path.join(APP, 'data', 'site')).filter(function (f) { return /\.md$/.test(f); })
    .forEach(function (f) { pages.push(path.join(APP, 'data', 'site', f)); });
} catch (e) { }
pages.push(path.join(APP, 'data', 'help.md'));
// Known Issues is written from the bot's lists (#3140), here one made up the
// way the bot writes it, with HTML typed into a comment on the board.
const LISTS = {
  at: '2026-10-26T08:05:00Z',
  known: [{ title: 'Doors stick', text: 'A door sticks shut. <img src=x onerror=alert(1)> Push it **twice**.', where: ['Main', 'Dev'] }],
  roadmap: { lanes: [
    { name: 'Being built now', rows: [{ title: 'Property you own', text: 'Claim it at the door. <script>alert(1)</script>' }] },
    { name: 'Next', rows: [] }, { name: 'Later', rows: [] },
    { name: 'Done', rows: [{ title: 'The emote wheel', text: 'On G.' }] }] }
};
const KNOWN_PAGE = require('../../tests/fixtures/known-page').knownPage(null, LISTS);
// The browser's drawing passes HTML through and ours does not, so the page
// compared with it below is written from words with none in them.
const KNOWN_PLAIN = require('../../tests/fixtures/known-page').knownPage(null, {
  at: LISTS.at, known: [{ title: 'Doors stick', text: 'A door sticks shut. Push it **twice**.', where: ['Main'] }] });
pages.push('known page');
yes('there are real pages to draw, ' + pages.length + ' of them', pages.length >= 9);
pages.forEach(function (p) {
  const raw = p === 'known page' ? KNOWN_PLAIN : read(p);
  if (raw === null) { yes(path.basename(p) + ' reads', false); return; }
  [false, true].forEach(function (open) {
    const md = forMode(raw, open);
    const ours = render(md);
    const theirs = plain.parse(md).replace(/<a id='([A-Za-z0-9_-]+)'><\/a>/g, '<a id="$1"></a>');
    yes(path.basename(p) + ' comes out the same as the browser drew it, and safe' +
        (open ? ', with the switch on' : ''),
        ours === theirs && unsafe(ours).length === 0 && ours.indexOf('&lt;!--') < 0);
  });
});

// fillPage against the real home.html.
const filled = fillPage(home, '<h1>Rules</h1><h2>Be decent</h2><p>$& $1</p>');
yes('fillPage hides the front', filled.indexOf('<div id="landing" hidden>') >= 0);
yes('and shows the page with its body in it',
    filled.indexOf('<div class="page" id="page"><div class="wrap" id="pagebody"><h1>Rules</h1><h2>Be decent</h2><p>$& $1</p></div></div>') >= 0);
yes('and names the tab after the first heading', filled.indexOf('<title>Rules · Thornswood</title>') >= 0);
yes('and leaves nothing of the empty page behind', filled.indexOf('id="page" hidden') < 0);
yes('a heading with emphasis is named as plain words',
    fillPage(home, '<h1>The <em>free</em> Skyrim</h1>').indexOf('<title>The free Skyrim · Thornswood</title>') >= 0);

// ------------------------------------------------------------ page script --
// home.html's router, run against a stand-in page. A page the server already
// filled must not be fetched and drawn a second time over the top of itself.
function runRouter(pathname, prefilled, answers) {
  const router = homeScript;
  const els = {};
  const noop = function () { };
  function el(id) {
    if (!els[id]) {
      els[id] = { id: id, hidden: false, innerHTML: '', textContent: '', className: '', style: {},
        children: { length: 0 }, setAttribute: noop, getAttribute: function () { return null; },
        addEventListener: noop, querySelectorAll: function () { return []; },
        querySelector: function () { return null; }, appendChild: noop, insertAdjacentHTML: noop };
    }
    return els[id];
  }
  el('pagebody').children.length = prefilled ? 3 : 0;
  const calls = [];
  const box = {
    document: { getElementById: el, querySelector: function () { return null; },
                querySelectorAll: function () { return []; }, addEventListener: noop,
                createElement: function () { return el('made' + calls.length + Math.random()); }, title: '' },
    location: { pathname: pathname, hash: '' },
    fetch: function (u) {
      calls.push(u);
      const a = answers && answers[u];
      return a ? Promise.resolve({ ok: true, json: function () { return Promise.resolve(a); } })
               : new Promise(noop);
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    requestAnimationFrame: function (f) { f(); },
    matchMedia: function () { return { matches: false }; },
    addEventListener: noop
  };
  box.window = box;
  if (router) vm.runInNewContext(router, box);
  return { router: router, calls: calls, body: el('pagebody') };
}
const tick = function () { return new Promise(function (r) { setTimeout(r, 30); }); };

// ------------------------------------------------------------------ server --
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-site-render-'));
let srv = null;
const clean = function () { try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { } };
// The folder goes once the server has let go of its log in it.
function stop() {
  if (!srv) return;
  const s = srv;
  srv = null;
  s.once('exit', clean);
  try { s.kill(); } catch (e) { }
}
process.on('exit', function () {
  if (srv) { try { srv.kill(); } catch (e) { } }
  clean();
});

function copy(rel) {
  const to = path.join(work, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(APP, rel), to);
}
siteFiles.copy(work);
['home.html', 'home.js', 'index.html', MARKED, 'fonts.css'].forEach(function (f) { copy(path.join('public', f)); });
faces.forEach(function (u) { copy(path.join('public', u.slice(5, -1))); });
fs.readdirSync(path.join(APP, 'data', 'site')).forEach(function (f) { copy(path.join('data', 'site', f)); });
copy(path.join('data', 'help.md'));
// Its own config: a secret so nothing is written, and a game port nothing
// listens on, so it never knocks on a real server on this machine.
fs.writeFileSync(path.join(work, 'config.json'), JSON.stringify({
  secret: 'a test secret, not the real one',
  gameCheckPort: 1,
  onlineFile: path.join(work, 'online.json')
}));
// A page somebody has typed HTML into, and the bot's lists (#3140).
fs.writeFileSync(path.join(work, 'data', 'site', 'terms.md'),
  '# Terms\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))\n\nIt costs $1 and $&.\n');
fs.writeFileSync(path.join(work, 'data', 'board.json'), '{}');
fs.mkdirSync(path.join(work, 'data', 'from-bot'), { recursive: true });
fs.writeFileSync(path.join(work, 'data', 'from-bot', 'lists.json'), JSON.stringify(LISTS));

function freePort() {
  return new Promise(function (resolve, reject) {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', function () {
      const p = s.address().port;
      s.close(function () { resolve(p); });
    });
  });
}
/*
  Waits for the site's own "[thornswood-docs] listening on ...:port" line, so
  nothing is asked of the port before this run's site holds it (#1727). The
  port came from the system and was let go again, and builds run side by side
  on the VPS: if something takes it in between, the site stops on EADDRINUSE,
  and polling the port would have read whatever holds it as this site. The
  error says which, with what the site printed.
*/
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => {
      out += d;
      const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out);
      if (m && Number(m[1]) === port) { end(null); }
    };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the site did not say it was listening on ' + port +
                                                ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('close', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('close', gone);
  });
}

async function get(port, route) {
  const r = await fetch('http://127.0.0.1:' + port + route);
  return { status: r.status, type: r.headers.get('content-type') || '',
           cache: r.headers.get('cache-control') || '', text: await r.text() };
}

// Starts the scratch server on a spare port and waits until it answers. An
// earlier one is stopped first, and waited for.
async function boot() {
  if (srv) {
    const s = srv;
    srv = null;
    if (s.exitCode === null && s.signalCode === null) {
      await new Promise(function (r) { s.once('exit', r); try { s.kill(); } catch (e) { r(); } });
    }
  }
  const port = await freePort();
  const out = { port: port, log: '', up: false };
  srv = spawn(process.execPath, ['server.js'], {
    cwd: work,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_DOCS_PORT: String(port)
    })
  });
  started = true;
  srv.stdout.on('data', function (d) { out.log += d; });
  srv.stderr.on('data', function (d) { out.log += d; });
  try { await listening(srv, port); out.up = true; } catch (e) { out.log = e.message; }
  return out;
}
// What the server wrote to its own log, which it does before it listens.
const siteLog = function () { return read(path.join(work, 'site.log')) || ''; };

(async function () {
  watchdog = setTimeout(function () {
    yes('the scratch server answered inside 30 seconds', false);
    done();
  }, 30000);

  console.log('');
  console.log('THE PAGE\'S OWN SCRIPT');
  const filledRun = runRouter('/rules', true, null);
  yes('home.html has its router to run', filledRun.router.length > 0);
  yes('a page the server filled is not fetched again',
      filledRun.calls.indexOf('/api/page/rules') < 0 && filledRun.body.innerHTML === '');
  const emptyRun = runRouter('/rules', false,
    { '/api/page/rules': { md: '# Rules', html: '<h1>Rules</h1><h2>One</h2>' } });
  await tick();
  yes('a page that came without its body fetches it and shows the server\'s drawing',
      emptyRun.calls.indexOf('/api/page/rules') >= 0 && emptyRun.body.innerHTML === '<h1>Rules</h1><h2>One</h2>');
  const oldRun = runRouter('/rules', false, { '/api/page/rules': { md: '# Rules <b>' } });
  await tick();
  yes('from a server too old to draw it, the words come as escaped text',
      oldRun.body.innerHTML === '<pre class="pre-wrap"># Rules &lt;b&gt;</pre>');
  const roadRun = runRouter('/roadmap', false,
    { '/api/roadmap': { intro: '**x**', introHtml: '<p><strong>x</strong></p>', sections: [] } });
  await tick();
  yes('the roadmap shows the intro the server drew',
      roadRun.body.innerHTML.indexOf('<h1>Roadmap</h1><p><strong>x</strong></p>') === 0);

  console.log('');
  console.log('THE SERVER');
  const one = await boot();
  const port = one.port;
  yes('the real server.js came up on 127.0.0.1:' + port, one.up);
  if (!one.up) { console.log(one.log); done(); return; }
  yes('and loaded marked from public/ without complaint', siteLog().indexOf('did not load') < 0);

  const rules = await get(port, '/rules');
  yes('/rules answers 200 as HTML', rules.status === 200 && /text\/html/.test(rules.type));
  yes('/rules arrives with real headings in it (the curl check in entry 247)', /<h2[ >]/.test(rules.text));
  yes('with the rules shown and the front hidden',
      rules.text.indexOf('<div class="page" id="page"><div class="wrap" id="pagebody"><h1>Rules</h1>') >= 0 &&
      rules.text.indexOf('<div id="landing" hidden>') >= 0);
  yes('named Rules in the tab', rules.text.indexOf('<title>Rules · Thornswood</title>') >= 0);
  yes('and nothing on the page reaches another company',
      !/cdnjs|fonts\.googleapis|fonts\.gstatic/i.test(rules.text));
  // Patrick, 29 September (#1010): rule 2 says staff can end a character for good.
  const rule2 = rules.text.slice(rules.text.indexOf('Nobody dies without agreeing to'),
                                 rules.text.indexOf('Fights start freely'));
  yes('rule 2 is drawn saying staff can end a character for good, for serious rule breaking or in an event its owner agreed to',
      /<strong>Staff can end a character for good\.<\/strong> They do it for serious rule breaking,\s+or in an event its owner agreed to\./.test(rule2));

  const world = await get(port, '/world');
  yes('/world carries the anchor the footer points at', world.text.indexOf('<a id="accord"></a>') >= 0);
  const help = await get(port, '/help');
  yes('/help comes from the data folder and is drawn too', /<div class="wrap" id="pagebody"><h1>/.test(help.text));
  // #3140: /known is written from the issue board, by way of the bot's lists.
  const known = await get(port, '/known');
  const knownBody = (/<div class="wrap" id="pagebody">([\s\S]*?)<\/div><\/div>/.exec(known.text) || [])[1] || '';
  yes('/known is drawn from the bot\'s lists', known.status === 200 &&
      knownBody.indexOf('<h1>Known Issues</h1>') >= 0 &&
      /<h3[^>]*>Doors stick<\/h3>[\s\S]*Found on main and the dev server\./.test(knownBody) &&
      knownBody.indexOf('26 Oct 2026, 8:05 AM UTC') >= 0);
  yes('and HTML typed into the comment on the board is text there', unsafe(knownBody).length === 0 &&
      knownBody.indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0);
  let kapi = {};
  try { kapi = JSON.parse((await get(port, '/api/page/known')).text); } catch (e) { }
  yes('and /api/page/known hands out the same page the lists write', !!KNOWN_PAGE && kapi.md === KNOWN_PAGE);

  const terms = await get(port, '/terms');
  const termsBody = (/<div class="wrap" id="pagebody">([\s\S]*?)<\/div><\/div>/.exec(terms.text) || [])[1] || '';
  yes('a page somebody typed HTML into is served drawn', termsBody.indexOf('<h1>Terms</h1>') >= 0);
  yes('and what they typed is text, not a tag or a javascript: link', unsafe(termsBody).length === 0 &&
      termsBody.indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0);
  yes('and a dollar in it is still a dollar', termsBody.indexOf('It costs $1 and $&amp;.') >= 0);

  const front = await get(port, '/');
  yes('the front page is still the front page',
      front.text.indexOf('<div id="landing">') >= 0 &&
      front.text.indexOf('<div class="page" id="page" hidden><div class="wrap" id="pagebody"></div></div>') >= 0);
  const roadmap = await get(port, '/roadmap');
  yes('the roadmap has useful initial HTML before the API responds',
      roadmap.text.indexOf('<div class="wrap" id="pagebody"><h1>Roadmap</h1>') >= 0);
  yes('and that HTML is the bot\'s roadmap, lanes in order, Done last, with when it was read',
      /Being built now[\s\S]*Property you own[\s\S]*<h2>Done<\/h2>[\s\S]*The emote wheel/.test(roadmap.text) &&
      roadmap.text.indexOf('<h2>Next</h2>') < 0 && roadmap.text.indexOf('26 Oct 2026, 8:05 AM UTC') >= 0);
  yes('and what was typed into a comment on the board is text there',
      roadmap.text.indexOf('<script>alert(1)</script>') < 0 && roadmap.text.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;') >= 0);
  yes('an async public page does not flash the home landing while it loads',
      roadmap.text.indexOf('<div id="landing" hidden>') >= 0);

  let api = {};
  try { api = JSON.parse((await get(port, '/api/page/rules')).text); } catch (e) { }
  yes('/api/page still hands out the markdown', /^# Rules/.test(api.md || ''));
  yes('and the same page drawn, for a front page served without it', /<h2[ >]/.test(api.html || ''));
  const missing = await get(port, '/api/page/nothing-here');
  yes('/api/page for a page that is not there is still 404', missing.status === 404);
  const notes = await get(port, '/api/page/lines');
  yes('/api/page does not hand out lines.md, which is no page and holds the team\'s notes (#3656)',
      notes.status === 404 && notes.text.indexOf('Hints and lore lines') < 0);

  let rm = {};
  try { rm = JSON.parse((await get(port, '/api/roadmap')).text); } catch (e) { }
  yes('/api/roadmap hands out its intro, drawn too, and the lanes as sections',
      /Nothing here has a date/.test(rm.intro || '') && /^<p>/.test(rm.introHtml || '') &&
      (rm.sections || []).map(function (x) { return x.name; }).join('|') === 'Being built now|Next|Later|Done' &&
      rm.unread === false && rm.at === '26 Oct 2026, 8:05 AM UTC');
  yes('and the drawn intro is safe', unsafe(rm.introHtml || '').length === 0);
  // A site the bot has not written for yet says so, rather than an empty roadmap.
  fs.unlinkSync(path.join(work, 'data', 'from-bot', 'lists.json'));
  rm = {};
  try { rm = JSON.parse((await get(port, '/api/roadmap')).text); } catch (e) { }
  yes('with no lists.json, /api/roadmap says it was not read', rm.unread === true && (rm.sections || []).length === 0);
  const unreadPage = await get(port, '/roadmap');
  yes('and /roadmap says so in words', unreadPage.text.indexOf('could not be read from the issue board') >= 0);
  const unreadKnown = await get(port, '/known');
  yes('and so does /known, with no list drawn', unreadKnown.text.indexOf('could not be read from the issue board') >= 0 &&
      unreadKnown.text.indexOf('Broken right now') < 0);

  const js = await get(port, '/' + MARKED);
  yes('/' + MARKED + ' is served as script, cached', js.status === 200 && /javascript/.test(js.type) && /max-age/.test(js.cache));
  const css = await get(port, '/fonts.css');
  yes('/fonts.css is served as a stylesheet, cached', css.status === 200 && /text\/css/.test(css.type) && /max-age/.test(css.cache));
  const woff = await get(port, faces.length ? faces[0].slice(4, -1) : '/cinzel.woff2');
  yes('a font file is served as font/woff2, cached', woff.status === 200 && /font\/woff2/.test(woff.type) && /max-age/.test(woff.cache));

  // ------------------------------------------------------ odd addresses --
  // #929: https://thornswood.net// answered 500. The handler read the address
  // with new URL(req.url, base), which takes a leading // as the start of a
  // host name: // and /// threw Invalid URL, and //rules, //config.json and
  // ///x were all the front page. Asked over plain http with the path sent
  // exactly as written, because fetch would tidy the backslashes first and
  // follow the redirects.
  console.log('');
  console.log('ODD ADDRESSES');
  const SHA = 'ab'.repeat(32);
  fs.mkdirSync(path.join(work, 'feed', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(work, 'feed', 'version'), { recursive: true });
  fs.writeFileSync(path.join(work, 'feed', 'version', '00000001.json'), '{"launcherVersion":"1.0.0"}');
  fs.writeFileSync(path.join(work, 'feed', 'assets', SHA), 'a pack');
  const BS = String.fromCharCode(92);
  function raw(p, method) {
    return new Promise(function (resolve) {
      const r = require('http').request({ host: '127.0.0.1', port: port, path: p, method: method || 'GET',
        headers: { accept: 'text/html' } }, function (res) {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', function (d) { text += d; });
        res.on('end', function () { resolve({ status: res.statusCode, where: res.headers.location || '', text: text }); });
      });
      r.on('error', function (e) { resolve({ status: 0, where: '', text: String(e.message) }); });
      r.end();
    });
  }
  const moved = [
    ['//', '/'], ['///', '/'], ['///x', '/x'], ['//rules', '/rules'], ['//rules?a=b', '/rules?a=b'],
    ['//fonts.css', '/fonts.css'], ['/feed//version.json', '/feed/version.json'],
    ['/feed/assets//' + SHA, '/feed/assets/' + SHA], ['//config.json', '/config.json'],
    ['//..//config.json', '/config.json'], ['/' + BS + 'example.com', '/example.com'], ['/' + BS + BS, '/']
  ];
  for (const m of moved) {
    const r = await raw(m[0]);
    yes(JSON.stringify(m[0]) + ' is a 301 to ' + m[1] + ' (was ' + r.status + ' ' + r.where + ')',
        r.status === 301 && r.where === m[1]);
  }
  const head2 = await raw('//rules', 'HEAD');
  yes('a HEAD for //rules is the same 301', head2.status === 301 && head2.where === '/rules');
  const post2 = await raw('//api/hello', 'POST');
  yes('a POST to //api/hello is not redirected, it is 404', post2.status === 404);

  // Where each one lands, and the addresses that were already right.
  const lands = [
    ['/', 200], ['/rules', 200], ['/rules//', 200], ['/fonts.css', 200], ['/x', 404],
    ['/feed/version.json', 200], ['/feed/assets/' + SHA, 200],
    ['/config.json', 404], ['/example.com', 404], ['/data/board.json', 404], ['/server.js', 404],
    ['/site.log', 404], ['/feed/assets/' + SHA.toUpperCase(), 404], ['/feed/assets/' + SHA + '0', 404],
    ['/feed/assets/..%2Fversion%2F00000001.json', 404], ['/feed/assets/%2E%2E%2F..%2Fconfig.json', 404],
    ['/feed/assets/' + SHA.slice(0, 60) + '%2F..', 404], ['/..%2Fconfig.json', 404], ['/%2E%2E/config.json', 404],
    ['/%2Fexample.com', 404], ['/%00', 404], ['/rules%00', 404], ['/fonts.css%00', 404],
    ['/%5C', 404], ['/%5Cconfig.json', 404], ['/%', 400], ['//%', 400], ['/%2F', 200]
  ];
  for (const l of lands) {
    const r = await raw(l[0]);
    yes(JSON.stringify(l[0]) + ' answers ' + l[1] + ' (was ' + r.status + ')', r.status === l[1]);
  }
  const pack = await raw('/feed/assets/' + SHA);
  yes('and the pack by its 64 hex name is the pack', pack.text === 'a pack');
  const cfgLeak = await raw('//config.json');
  yes('nothing odd hands out config.json', cfgLeak.text.indexOf('a test secret') < 0);
  yes('no odd address made the handler throw', siteLog().indexOf('handler threw') < 0);

  // A deploy that lost the library must not lose the rules with it.
  fs.unlinkSync(path.join(work, 'public', MARKED));
  const two = await boot();
  yes('with public/' + MARKED + ' gone the server still comes up', two.up);
  yes('and says in its log why the pages are plain', siteLog().indexOf(MARKED + ' did not load') >= 0);
  const bare = await get(two.port, '/rules');
  yes('and /rules still carries its words, as escaped plain text',
      bare.status === 200 &&
      bare.text.indexOf('<div class="wrap" id="pagebody"><h1>Rules</h1><pre class="pre-wrap"># Rules') >= 0);

  done();
})().catch(function (e) {
  yes('the server part ran without throwing: ' + (e && e.message), false);
  done();
});
