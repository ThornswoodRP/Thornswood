'use strict';
/*
  test-site-escaping.js

      node .\site\tests\test-site-escaping.js

  The two markdown renderers that turn staff and player text into HTML, held
  to the payloads an attacker would try, and the content security policy that
  backs them up. Found by the escaping pass of 10 October: every place player
  or Discord text reaches HTML in site\server.js, home.js and hub.js goes
  through one of these renderers or an esc(), and nothing in those three files
  failed; this keeps it that way.

    site\server.js makePageRenderer  the public markdown pages (/rules, /join
                                     and the rest), which admins edit.
    site\public\hub.js hardenMarked  every board cell, board intro and doc on
                                     the hub, which staff edit and which take
                                     bug titles and details moved off the inbox.

  Each payload must come out with no element that runs script: no <script>,
  <iframe>, <object>, <embed>, <svg> or <style> tag, no on...= handler inside
  a tag, and no href or src with a scheme other than http, https or mailto.
  The text itself may still show, escaped.

  Offline: the renderers run in this process against the site's own copy of
  marked (site\public\marked-12.0.2.min.js). No new packages.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const SERVER = siteFiles.source();
const HUB = fs.readFileSync(path.join(ROOT, 'site', 'public', 'hub.js'), 'utf8');
const MARKED_FILE = path.join(ROOT, 'site', 'public', 'marked-12.0.2.min.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function block(src, startAt) {
  const at = src.indexOf(startAt);
  if (at < 0) throw new Error('not found: ' + startAt);
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced: ' + startAt);
}

function freshMarked() {
  const ctx = { console };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(MARKED_FILE, 'utf8'), ctx);
  return ctx;
}

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">x</a>',
  '[click](javascript:alert(1))',
  '[click](JaVaScRiPt:alert(1))',
  '[click](java\tscript:alert(1))',
  '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[click](vbscript:msgbox(1))',
  '![x](javascript:alert(1))',
  '![x" onerror="alert(1)](/a.png)',
  '[x](/a "t\\" onmouseover=\\"alert(1))',
  '[x](https://ok.example/"onmouseover="alert(1))',
  '<style>body{display:none}</style>',
  '<object data=x></object><embed src=x>',
  '<a id="x" onclick="alert(1)"></a>',
  '`<script>alert(1)</script>`',
  '```\n<script>alert(1)</script>\n```',
  '<details open ontoggle=alert(1)>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '[x](&#106;avascript:alert(1))',
  '[x](javascript&#58;alert(1))'
];

function bad(html) {
  const why = [];
  if (/<\s*(script|iframe|object|embed|svg|style|details)\b/i.test(html)) why.push('dangerous tag');
  // Quoted attribute values emptied first: text inside alt="..." is not a handler.
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html.replace(/"[^"]*"/g, '""'))) why.push('event handler');
  const urls = [];
  html.replace(/\s(?:href|src)\s*=\s*"([^"]*)"/gi, (m, u) => { urls.push(u); return m; });
  for (const u of urls) {
    const plain = u.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
                   .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
                   .replace(/&colon;/gi, ':').replace(/[\x00-\x20]/g, '');
    const s = /^([^:/?#]*):/.exec(plain);
    if (s && !/^(https?|mailto)$/i.test(s[1])) why.push('scheme ' + s[1]);
  }
  return why;
}

// ---- the server's renderer ---------------------------------------------------
console.log('site\\server.js makePageRenderer:');
const mk = new Function('return (' + block(SERVER, 'function makePageRenderer(lib)') + ')')();
const serverRender = mk(freshMarked().marked);
for (const p of PAYLOADS) {
  const out = serverRender(p);
  const why = bad(out);
  yes(JSON.stringify(p).slice(0, 70) + ' renders inert' + (why.length ? ' (' + why.join(', ') + ': ' + out.trim().slice(0, 120) + ')' : ''), !why.length);
}
yes('a plain https link still renders as a link', /<a href="https:\/\/thornswood\.net\/rules">rules<\/a>/.test(serverRender('[rules](https://thornswood.net/rules)')));
yes('the empty anchor world.md uses still renders', serverRender('<a id="accord"></a>').indexOf('<a id="accord"></a>') >= 0);

// ---- the hub's renderer ------------------------------------------------------
console.log('\nsite\\public\\hub.js hardenMarked:');
const hubCtx = freshMarked();
vm.runInContext(block(HUB, '(function hardenMarked()') + ')();', hubCtx);
const hubRender = (s) => hubCtx.marked.parse(s);
const hubInline = (s) => hubCtx.marked.parseInline(s);
for (const p of PAYLOADS) {
  const a = hubRender(p), b = hubInline(p);
  const why = bad(a).concat(bad(b));
  yes(JSON.stringify(p).slice(0, 70) + ' renders inert, block and inline' + (why.length ? ' (' + why.join(', ') + ': ' + (a + ' | ' + b).trim().slice(0, 160) + ')' : ''), !why.length);
}
yes('a mailto link still renders as a link', /href="mailto:a@b\.c"/.test(hubInline('[mail](mailto:a@b.c)')));

// ---- the esc helpers the pages build with ------------------------------------
console.log('\nthe esc helpers:');
const hubEsc = new Function('return ' + /var esc = (function \(s\) \{[\s\S]*?\n\};)/.exec(HUB)[1].replace(/;$/, ''))();
yes('hub esc escapes the characters that end text and double-quoted attributes',
    hubEsc('<a href="x">&') === '&lt;a href=&quot;x&quot;&gt;&amp;');
const singleQuoted = /=\\'[^']*'\s*\+/.test(HUB) ||
  /=\\'\s*\+/.test(fs.readFileSync(path.join(ROOT, 'site', 'public', 'home.js'), 'utf8'));
yes('no attribute in hub.js or home.js is single quoted, which hub esc would not close', !singleQuoted);

// ---- the CSP ---------------------------------------------------------------
console.log('\nthe content security policy:');
const csp = (/const CSP_HEADER = "([^"]+)"/.exec(SERVER) || [])[1] || '';
const dir = {};
csp.split(';').forEach((d) => { const p = d.trim().split(/\s+/); if (p[0]) dir[p[0]] = p.slice(1); });
// Cloudflare Web Analytics is one other source, by Patrick's answer on
// 22 Oct 2026 (#3218): its beacon script, and where it reports to. Cloudflare
// Turnstile on the report form is the other (#3216): its script and its frame.
yes('script-src is the site itself, Cloudflare\'s analytics beacon and Turnstile, with no unsafe-inline, unsafe-eval or wildcard',
    (dir['script-src'] || []).join(' ') === "'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com");
yes('frame-src is Turnstile\'s frame and nothing else',
    (dir['frame-src'] || []).join(' ') === 'https://challenges.cloudflare.com');
yes('connect-src is the site itself and where that beacon reports',
    (dir['connect-src'] || []).join(' ') === "'self' https://cloudflareinsights.com");
yes('object-src is none', (dir['object-src'] || []).join(' ') === "'none'");
yes('base-uri is self, so an injected <base> cannot move relative scripts', (dir['base-uri'] || []).join(' ') === "'self'");
yes('frame-ancestors is self', (dir['frame-ancestors'] || []).join(' ') === "'self'");
yes('default-src is self', (dir['default-src'] || []).join(' ') === "'self'");
yes('every answer path sends it: send(), the range replies and handle(), each with that answer\'s nonce (#3216)',
    (SERVER.match(/['"]Content-Security-Policy['"]\s*[:,]\s*cspFor\(res\)/gi) || []).length >= 4);
yes('the nonce goes into script-src only, next to self',
    /CSP_HEADER\.replace\("script-src 'self'", "script-src 'self' 'nonce-" \+ n \+ "'"\)/.test(SERVER));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
