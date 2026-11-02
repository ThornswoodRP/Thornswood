'use strict';
// test-5190-cloudflare-cache.js
//
//     node tests\test-5190-cloudflare-cache.js
//
// #5190: Cloudflare's free plan keeps the site's public pages for a few
// minutes, and nothing else. Two halves have to agree:
//   - site/server.js marks each public page (PUBLIC_PAGES) with
//     Cloudflare-CDN-Cache-Control: max-age=PUBLIC_EDGE_SECONDS, a header only
//     Cloudflare reads and strips (tests/test-3218-site-cache.js asks a
//     running copy for it);
//   - records/cloudflare-cache-rules.json is the zone's cache rule: those
//     paths and no others are eligible, and its Edge TTL keeps only what the
//     site marks (bypass_by_default), so the hub, the APIs and anything that
//     says who is asking can never be kept at the edge.
// This reads both and fails when they drift. Read only.
const fs = require('fs'), path = require('path');
const siteFiles = require('./site-files');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function yes(what, c) { console.log((c ? 'PASS  ' : 'FAIL  ') + what); if (c) pass++; else fail++; }

const server = siteFiles.source();
const m = server.match(/const PUBLIC_PAGES = (\[[\s\S]*?\]);/);
let pages = [];
try { pages = m ? eval(m[1].replace(/\/\/.*$/mg, '')) : []; } catch (e) { pages = []; }
yes('server.js lists its public pages', pages.length >= 10);
const secs = (server.match(/const PUBLIC_EDGE_SECONDS = (\d+);/) || [])[1];
yes('and how long Cloudflare keeps them, a few minutes (' + secs + ' s)', secs && +secs >= 60 && +secs <= 900);
yes('the public pages carry it in Cloudflare-CDN-Cache-Control',
  server.includes("'Cloudflare-CDN-Cache-Control': 'max-age=' + PUBLIC_EDGE_SECONDS"));
yes('and nothing else in server.js does', (server.match(/Cloudflare-CDN-Cache-Control'/g) || []).length === 1);

let rec = null;
try { rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'cloudflare-cache-rules.json'), 'utf8')); } catch (e) { rec = null; }
yes('records/cloudflare-cache-rules.json reads', !!rec && !!rec.rule);
if (rec && rec.rule) {
  const r = rec.rule;
  yes('it is the zone\'s cache settings rule for thornswood.net', rec.zone === 'thornswood.net' && rec.phase === 'http_request_cache_settings' && r.action === 'set_cache_settings' && r.enabled === true);
  const set = (r.expression.match(/http\.request\.uri\.path in \{([^}]*)\}/) || [])[1] || '';
  const paths = (set.match(/"[^"]*"/g) || []).map((s) => s.slice(1, -1));
  const missing = pages.filter((p) => !paths.includes(p)), extra = paths.filter((p) => !pages.includes(p));
  yes('its paths are exactly PUBLIC_PAGES' + (missing.length ? ', missing ' + missing.join(' ') : '') + (extra.length ? ', extra ' + extra.join(' ') : ''),
    paths.length > 0 && !missing.length && !extra.length);
  yes('GET only, on thornswood.net and www', /http\.request\.method eq "GET"/.test(r.expression) && /http\.host in \{"thornswood\.net" "www\.thornswood\.net"\}/.test(r.expression));
  const ap = r.action_parameters || {};
  yes('it keeps only what the site marks: eligible, and bypassed when the site says nothing', ap.cache === true && ap.edge_ttl && ap.edge_ttl.mode === 'bypass_by_default' && !('default' in ap.edge_ttl));
  yes('and leaves the browser to the site\'s own Cache-Control', ap.browser_ttl && ap.browser_ttl.mode === 'respect_origin');
  yes('the hub and the APIs are not in it', !/\/hub|\/api|\/feed|\/auth/.test(r.expression));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
