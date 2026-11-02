/*
  test-1050-feed-split.js

      node .\launcher\tests\test-1050-feed-split.js
      node .\launcher\tests\test-1050-feed-split.js --emit <whole.json> <out folder>

  What /feed[-dev]/version.json answers once a channel's minLauncher reads
  the split (#1050, Patrick's answer of 19 Oct): the update fields alone, the
  rest of the feed as one more asset named by its sha256 ("settings"), and
  every asset by its sha256 without its address. The store keeps the feed
  whole; site\server.js feedView makes what launchers are answered.

  It lifts the generations block (feedFile, feedView, feedSettings) and the
  version, watch and asset routes out of site\server.js by text and serves
  them on a loopback port against generations in a temp folder, the way
  test-feed-serve.js does:
    - below the gate the generation is answered byte for byte, with the tag
      it always had
    - at the gate version.json holds the update fields and "settings", with
      "packs" and "news" as the empty lists every launcher reads
    - the settings answer at /feed/assets/<sha256>, hash to it, and are every
      other field, so the two together are the whole feed again
    - baseline, newsFile, clientRuntime and signedManifest carry no address,
      only their sha256; launcherUrl keeps its address for launchers from
      before this
    - the ETag 304s, /watch hands out the same tag, a new generation moves
      it, and the settings of the generation before stay answerable
    - the main and dev channels are apart

  --emit writes what the site would answer for one whole feed, version.json
  and settings.json beside it, for launcher\tests\test-1050-feed-split.ps1, which reads
  them with the launcher and with Join-FeedSettings.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const siteFiles = require('../../tests/site-files');

const CR = String.fromCharCode(13);
const SRC = path.join(__dirname, '..', '..', 'site', 'server.js');
const src = siteFiles.source(SRC).split(CR).join('');
const CSP_HEADER = JSON.parse(src.match(/const CSP_HEADER = ("[^"\r\n]*");/)[1]);
// send() names it beside the CSP (#2762).
const PERMISSIONS_POLICY = src.match(/const PERMISSIONS_POLICY = '([^'\r\n]*)';/)[1];

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function block(at) {
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return i + 1; }
  }
  throw new Error('unbalanced braces in site/server.js');
}
function grab(head) {
  const at = src.indexOf(head);
  return at < 0 ? '' : src.slice(at, block(at));
}
function route(first, guard) {
  const at = src.indexOf(first);
  if (at < 0) return '';
  const g = src.indexOf(guard, at);
  return g < 0 ? '' : src.slice(at, block(g));
}
function generations() {
  const at = src.indexOf('const feedNewest = {};');
  if (at < 0) return '';
  const fn = src.indexOf('function feedFile(', at);
  return fn < 0 ? '' : src.slice(at, block(fn));
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let ROOT = '';
const genSrc = generations();
const gen = eval('(function () {\n' + genSrc + '\nreturn { feedFile: feedFile, feedView: feedView, feedSettings: feedSettings, FEED_SPLIT_LAUNCHER: FEED_SPLIT_LAUNCHER };\n})()');
const feedFile = gen.feedFile, feedView = gen.feedView, feedSettings = gen.feedSettings;

if (process.argv[2] === '--emit') {
  // The view of one whole feed, for the launcher harness.
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-split-emit-'));
  fs.mkdirSync(path.join(ROOT, 'feed', 'version'), { recursive: true });
  const f = path.join(ROOT, 'feed', 'version', '00000001.json');
  fs.copyFileSync(process.argv[3], f);
  const v = feedView('feed', f);
  fs.mkdirSync(process.argv[4], { recursive: true });
  fs.writeFileSync(path.join(process.argv[4], 'version.json'), v.body);
  if (v.settings) fs.writeFileSync(path.join(process.argv[4], 'settings.json'), v.settings);
  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(0);
}

ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-feed-split-'));
for (const c of ['feed', 'feed-dev']) {
  fs.mkdirSync(path.join(ROOT, c, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, c, 'version'), { recursive: true });
}

yes('server.js has the generations block with feedView and feedSettings', /function feedView\(/.test(genSrc) && /function feedSettings\(/.test(genSrc));
yes('the split starts at minLauncher 1.2.6, the number after 1.2.5', gen.FEED_SPLIT_LAUNCHER === '1.2.6');
eval(grab('function send('));
// send() and rangeReply() put each answer's nonce into the CSP (#3216).
eval(grab('function cspFor('));
eval(grab('function rangeReply('));
const verSrc = route('const feedVer = p.match(', "if (feedVer && req.method === 'GET')");
const watchSrc = route('const feedWatch = p.match(', "if (feedWatch && req.method === 'GET')");
const assetSrc = route('const feedAsset = p.match(', "if (feedAsset && req.method === 'GET')");
yes('the version, watch and asset routes are where this expects them', !!verSrc && !!watchSrc && !!assetSrc);
yes('version.json and /watch both answer feedView\'s tag', /feedView\(feedVer\[1\], file\)/.test(verSrc) && /feedView\(channel, file\)/.test(watchSrc));
const verRoute = eval('(function (p, req, res, head) {\n' + verSrc + '\n})');
const watchRoute = eval('(function (p, req, res, head) {\n' + watchSrc + '\n})');
const assetRoute = eval('(function (p, req, res, head) {\n' + assetSrc + '\n})');

const A = (c) => 'https://thornswood.net/' + c + '/assets/';
const H = (ch) => ch.repeat(64);
function whole(channel, min) {
  // The shape of main's feed on 19 Oct, every field it carries.
  return {
    launcherVersion: min, launcherUrl: A(channel) + H('1'), launcherSha256: H('1'),
    serverAddress: '203.0.113.7', serverPort: '7777', message: '', packs: [], news: [], voicePort: '7778',
    collectionUrl: 'https://www.nexusmods.com/games/skyrimspecialedition/collections/x', maxOnline: 0, mainVersion: '',
    voiceUrl: '', discordAppId: '123456789012345678', siteUrl: 'https://thornswood.net',
    presenceImage: 'https://thornswood.net/i.png', collectionRevision: 1,
    clientRuntime: { url: A(channel) + H('2'), sha256: H('2'), bytes: 6607137, forkCommit: '0714e444', notice: 1 },
    updateFeedUrl: 'https://thornswood.net/' + channel + '/version.json', expectedExeBytes: '37157144', newerExeBytes: '37691928',
    depots: [{ id: '489831', manifest: '8442952117333549665' }],
    baseline: { id: '20261017-205912', sha256: H('3'), url: A(channel) + H('3'), entries: 743, notes: 'The holds, the boards' },
    launcherInputs: H('4'), minLauncher: min,
    release: { id: '20261017-205912', channel: channel === 'feed' ? 'main' : 'dev', launcherVersion: min, packs: [], baseline: '20261017-205912', commit: 'abc', branch: 'main', uncommitted: 0, tag: 'release/main/20261017-205912' },
    signedManifest: { url: A(channel) + H('5'), sha256: H('5'), catalogUrl: A(channel) + H('6'), catalogSha256: H('6') },
    newsFile: { url: A(channel) + H('7'), sha256: H('7'), count: 40 }
  };
}
let n = { feed: 0, 'feed-dev': 0 };
function ship(channel, doc) {
  n[channel]++;
  const f = path.join(ROOT, channel, 'version', String(n[channel]).padStart(8, '0') + '.json');
  fs.writeFileSync(f, JSON.stringify(doc));
  return f;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  const head = req.method === 'HEAD';
  if (head) req.method = 'GET';
  try {
    verRoute(p, req, res, head);
    if (!res.headersSent) watchRoute(p, req, res, head);
    if (!res.headersSent && !/\/watch$/.test(p)) assetRoute(p, req, res, head);
  } catch (e) {
    if (!res.headersSent) { res.writeHead(500); res.end(String(e && e.message)); }
    return;
  }
  if (!res.headersSent && !/\/watch$/.test(p)) { res.writeHead(404); res.end('no'); }
});
function ask(p, headers) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: p, method: 'GET',
                               headers: headers || {}, agent: false }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => resolve({ code: res.statusCode, h: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', (e) => resolve({ code: 0, h: {}, body: Buffer.alloc(0), error: e.message }));
    req.end();
  });
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  // ---- below the gate: the generation as it is
  const old = ship('feed', whole('feed', '1.2.5'));
  const o = await ask('/feed/version.json');
  yes('a feed whose minLauncher is 1.2.5 is answered byte for byte', o.code === 200 && o.body.equals(fs.readFileSync(old)));
  const st = fs.statSync(old);
  yes('with the tag it always had', o.h.etag === '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"');
  yes('and names no settings', !('settings' in JSON.parse(o.body)));

  // ---- at the gate: the update fields and the settings they name
  const wholeDoc = whole('feed', '1.2.6');
  const f2 = ship('feed', wholeDoc);
  const v = await ask('/feed/version.json');
  const top = JSON.parse(v.body);
  yes('a feed whose minLauncher is 1.2.6 is answered split', v.code === 200 && !!top.settings && /^[0-9a-f]{64}$/.test(top.settings.sha256));
  yes('version.json holds the update fields and settings, nothing else', JSON.stringify(Object.keys(top).sort()) ===
      JSON.stringify(['baseline', 'launcherSha256', 'launcherUrl', 'launcherVersion', 'minLauncher', 'news', 'newsFile', 'packs', 'settings']));
  yes('packs and news are the empty lists every launcher reads', Array.isArray(top.packs) && top.packs.length === 0 && Array.isArray(top.news) && top.news.length === 0);
  yes('launcherUrl keeps its address, for launchers from before this', top.launcherUrl === A('feed') + H('1'));
  yes('baseline and newsFile carry their sha256 and no address', !('url' in top.baseline) && top.baseline.sha256 === H('3') &&
      top.baseline.notes === 'The holds, the boards' && !('url' in top.newsFile) && top.newsFile.count === 40);
  console.log('      version.json is ' + v.body.length + ' bytes; the whole feed is ' + fs.statSync(f2).size);
  yes('version.json is under 700 bytes', v.body.length < 700);
  yes('the tag says it is the split one', /-split"$/.test(v.h.etag || ''));

  const s = await ask('/feed/assets/' + top.settings.sha256);
  yes('the settings answer at /feed/assets/<sha256>', s.code === 200 && /^application\/json/.test(s.h['content-type'] || ''));
  yes('and hash to their name', sha(s.body) === top.settings.sha256);
  yes('immutable, like every asset', s.h['cache-control'] === 'public, max-age=31536000, immutable');
  const rest = JSON.parse(s.body);
  yes('the settings carry none of the update fields', ['launcherVersion', 'minLauncher', 'launcherUrl', 'launcherSha256', 'baseline', 'newsFile', 'packs', 'news', 'settings'].every((k) => !(k in rest)));
  yes('clientRuntime and signedManifest carry their sha256 and no address', !('url' in rest.clientRuntime) && rest.clientRuntime.sha256 === H('2') &&
      !('url' in rest.signedManifest) && !('catalogUrl' in rest.signedManifest) && rest.signedManifest.catalogSha256 === H('6'));
  // The two together are the whole feed again, once every address is the
  // assets folder plus the sha256.
  const back = Object.assign({}, rest, top);
  delete back.settings;
  for (const o2 of [back.baseline, back.newsFile, back.clientRuntime]) o2.url = A('feed') + o2.sha256;
  back.signedManifest.url = A('feed') + back.signedManifest.sha256;
  back.signedManifest.catalogUrl = A('feed') + back.signedManifest.catalogSha256;
  const sorted = (x) => Array.isArray(x) ? x.map(sorted) : (x && typeof x === 'object')
    ? Object.keys(x).sort().reduce((a, k) => { a[k] = sorted(x[k]); return a; }, {}) : x;
  const norm = (d) => JSON.stringify(sorted(d));
  yes('version.json and the settings together are the whole feed', norm(back) === norm(wholeDoc));

  const again = await ask('/feed/version.json', { 'If-None-Match': v.h.etag });
  yes('the same tag back is a 304', again.code === 304 && again.body.length === 0);
  const w = await ask('/feed/watch');
  yes('/watch hands out the same tag version.json does', w.code === 200 && JSON.parse(w.body).etag === v.h.etag);

  // ---- a release later: a new tag, and the settings before still answer
  const next = whole('feed', '1.2.6');
  // A port of another length, so the new generation's size moves too: the
  // tag is a generation's size and time, and a fast runner writes both of
  // these inside one millisecond, which a real Ship never does.
  next.serverPort = '17779';
  ship('feed', next);
  const v3 = await ask('/feed/version.json', { 'If-None-Match': v.h.etag });
  const top3 = JSON.parse(v3.body);
  yes('a new generation is a 200 with a new tag', v3.code === 200 && v3.h.etag !== v.h.etag);
  yes('whose settings moved with it', top3.settings.sha256 !== top.settings.sha256);
  const s2 = await ask('/feed/assets/' + top.settings.sha256);
  yes('the settings of the generation before still answer, for a launcher that read it just before', s2.code === 200 && sha(s2.body) === top.settings.sha256);
  const s3 = await ask('/feed/assets/' + top3.settings.sha256);
  yes('and the new ones do', s3.code === 200 && JSON.parse(s3.body).serverPort === '17779');

  // ---- channels apart, and a sha nobody named
  ship('feed-dev', whole('feed-dev', '1.2.5.6'));
  const d = await ask('/feed-dev/version.json');
  yes('dev below the gate is answered whole while main is split', d.code === 200 && 'serverAddress' in JSON.parse(d.body));
  const cross = await ask('/feed-dev/assets/' + top3.settings.sha256);
  yes('main\'s settings are not answered on /feed-dev/', cross.code === 404);
  const none = await ask('/feed/assets/' + H('9'));
  yes('a sha256 that is neither a file nor settings is 404', none.code === 404);

  // ---- a site that restarted: the views are made again from the newest
  const fresh = eval('(function () {\n' + genSrc + '\nreturn { feedSettings: feedSettings };\n})()');
  const b = fresh.feedSettings('feed', top3.settings.sha256);
  yes('after a restart the newest settings are found from the generation alone', !!b && sha(b) === top3.settings.sha256);
  void feedView; void feedSettings;

  server.close();
  fs.rmSync(ROOT, { recursive: true, force: true });
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.log('FAIL  the harness threw: ' + (e && e.stack)); process.exit(1); });
