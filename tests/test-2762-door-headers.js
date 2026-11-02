'use strict';
/*
  test-2762-door-headers.js

      node tests\test-2762-door-headers.js

  Every answer from thornswood.net carries HSTS, nosniff, Referrer-Policy and
  Permissions-Policy, because Caddy sets them at the door (#2762).

  WHY. Only site\server.js set security headers, so whatever else Caddy
  carried went out bare: on 19 Oct 2026 /voice/health answered with
  content-type and nothing else, on 25 Oct the 404s of /box/ and /github-app/
  were the same, and nothing anywhere sent Permissions-Policy.

  HOW. Reads scripts\deploy\Caddyfile with its comments taken out and checks
  that:
    1. the name has one site block, and every route is inside it;
    2. that block has a header block of its own, with no matcher, at its top
       level, so it covers every route rather than one;
    3. the header block defers, so it replaces a service's own copy rather
       than adding a second one, and sets the four headers to the values the
       site itself sends (site\server.js), so the two never disagree;
    4. nothing else in the file touches those four headers;
    5. server.js sends Permissions-Policy on every answer, and
       Setup-Domain.ps1 refuses a Caddyfile without the four.
  What the live box sends is checked after a deploy with curl, as the issue
  says; Check-ProdParity.ps1 says whether the live Caddyfile is this one.
*/
const fs = require('fs');
const path = require('path');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + what);
  if (condition) pass++; else fail++;
}

const caddyText = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy', 'Caddyfile'), 'utf8');
const server = siteFiles.source();
const setup = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy', 'Setup-Domain.ps1'), 'utf8');

const NAMES = ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy'];

// The Caddyfile with its comments out: a # at the start of a line or after
// a space starts one. No value in this file holds a #.
const lines = caddyText.split(/\r?\n/).map(function (l) { return l.replace(/(^|\s)#.*$/, '').replace(/\s+$/, ''); });

// Top level blocks: { ... } for the global options, then the sites.
function blocks(ls) {
  const out = [];
  let depth = 0, cur = null;
  ls.forEach(function (l) {
    const t = l.trim();
    if (!t) return;
    if (depth === 0) {
      if (/\{$/.test(t)) { cur = { head: t.replace(/\s*\{$/, ''), body: [] }; out.push(cur); depth = 1; }
      else out.push({ head: t, body: null, loose: true });
      return;
    }
    // depth is 1 for a line at the block's own top level.
    const opens = (t.match(/\{/g) || []).length, closes = (t.match(/\}/g) || []).length;
    const here = depth;
    depth += opens - closes;
    if (depth === 0) { cur = null; return; }
    cur.body.push({ depth: here, text: t });
  });
  return { blocks: out, balanced: depth === 0 };
}

const top = blocks(lines);
yes('the Caddyfile\'s braces balance', top.balanced);
yes('nothing sits loose outside a block', !top.blocks.some(function (b) { return b.loose; }));
const sites = top.blocks.filter(function (b) { return b.head !== ''; });
yes('there is exactly one site block, so every route is in it (' + sites.length + ')', sites.length === 1);
const site = sites[0] || { head: '', body: [] };
yes('  and it is the name and its www', site.head === 'thornswood.net, www.thornswood.net');

const routes = site.body.filter(function (l) { return /^(handle_path|reverse_proxy)\b/.test(l.text); });
yes('  and it holds the routes: voice, voice-dev, box, github-app and the site',
    ['handle_path /voice/*', 'handle_path /voice-dev/*', 'handle_path /box/*', 'handle_path /github-app/*', 'reverse_proxy 127.0.0.1:3001'].every(function (r) {
      return routes.some(function (l) { return l.text.indexOf(r) === 0; });
    }));

// The header block: "header {" at the site's top level, read up to its "}".
let at = -1;
site.body.forEach(function (l, i) { if (at < 0 && l.depth === 1 && l.text === 'header {') at = i; });
yes('the site block has a header block of its own, with no matcher, at its top level', at >= 0);
const set = {};
let deferred = false;
for (let i = at + 1; at >= 0 && i < site.body.length && site.body[i].text !== '}'; i++) {
  const t = site.body[i].text;
  if (t === 'defer') { deferred = true; continue; }
  const m = t.match(/^(\S+)\s+(.*)$/);
  if (m) set[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}
yes('  and it defers, so a service\'s own copy is replaced, never doubled', deferred);
NAMES.forEach(function (n) { yes('  and it sets ' + n, Object.prototype.hasOwnProperty.call(set, n)); });

// The values the site sends itself.
const hsts = (server.match(/setHeader\('Strict-Transport-Security', '([^']+)'\)/) || [])[1];
const perms = (server.match(/const PERMISSIONS_POLICY = '([^'\r\n]+)';/) || [])[1];
yes('server.js has a PERMISSIONS_POLICY', !!perms);
yes('Strict-Transport-Security is the site\'s own value (' + set['Strict-Transport-Security'] + ')',
    !!hsts && set['Strict-Transport-Security'] === hsts);
yes('  and lasts a year with the subdomains', /max-age=31536000/.test(set['Strict-Transport-Security'] || '') &&
    /includeSubDomains/.test(set['Strict-Transport-Security'] || ''));
yes('X-Content-Type-Options is nosniff', set['X-Content-Type-Options'] === 'nosniff');
yes('Referrer-Policy is the site\'s own value', set['Referrer-Policy'] === 'strict-origin-when-cross-origin' &&
    server.indexOf("setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')") >= 0);
yes('Permissions-Policy is the site\'s own value (' + set['Permissions-Policy'] + ')',
    !!perms && set['Permissions-Policy'] === perms);
yes('  and refuses the camera, the microphone and the location to every page and frame',
    ['camera=()', 'microphone=()', 'geolocation=()'].every(function (f) { return (perms || '').split(/,\s*/).indexOf(f) >= 0; }));

// Nothing else in the file sets, adds or takes away one of the four, in a
// route's own header block or as a reverse_proxy header_down.
const others = [];
lines.forEach(function (l, i) {
  const t = l.trim();
  if (/^header\b/.test(t) && t !== 'header {') others.push((i + 1) + ': ' + t);
  if (/^header_down\b/.test(t) && NAMES.some(function (n) { return t.toLowerCase().indexOf(n.toLowerCase()) >= 0; })) others.push((i + 1) + ': ' + t);
});
const headerBlocks = lines.filter(function (l) { return l.trim() === 'header {'; }).length;
yes('there is one header block in the file and nothing else touches the four' +
    (others.length ? ': ' + others.join('; ') : ''), headerBlocks === 1 && others.length === 0);

// The site's own answers carry it too, set before anything is read.
const handleAt = server.indexOf('async function handle(req, res) {');
const firstUrl = server.indexOf('const raw = String(req.url', handleAt);
const inHandle = handleAt >= 0 && firstUrl > handleAt ? server.slice(handleAt, firstUrl) : '';
yes('server.js sets Permissions-Policy at the top of handle(), on every answer',
    inHandle.indexOf("res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);") >= 0);
const sendAt = server.indexOf('function send(res, code, payload, type, extra) {');
const sendBody = sendAt >= 0 ? server.slice(sendAt, server.indexOf('\n}\n', sendAt)) : '';
yes('  and send() names it with the others', sendBody.indexOf("'Permissions-Policy': PERMISSIONS_POLICY") >= 0);

yes('Setup-Domain.ps1 sends no Caddyfile without the four headers',
    /foreach \(\$need in @\('Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy'\)\)/.test(setup) &&
    /sets no \$need header/.test(setup));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
