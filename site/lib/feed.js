/*
  The launcher feeds the site serves: the deployed build, each channel's
  newest feed generation, the split launcher views, and the copies of a
  release's files on its GitHub Release.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { askReleaseCopies, assetLocation, feedFile, feedReleaseTag, feedSettings,
  feedMove, feedMoveVersion, feedView, nativePublished, nativeTag, newestSetup, readJsonQuiet, releaseAsset, releaseCopy,
  releaseList, releaseNotes, serverRevision, setupChannel };

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const { DATA, GITHUB_API, ROOT } = require('./base');
const DEPLOYED_BUILD = path.join(DATA, 'deployed-build.json');
/* THE FEED'S GENERATIONS (#2727). The store never replaces version.json: each
   feed a Ship or feed edit sends is a new file, <channel>\version\<8 digits>.json,
   one past the newest, and none is ever replaced or deleted
   (scripts\release\Feed-Store.ps1). Windows has no way to put one file in place
   of another by name without a moment where the name is missing: measured on
   the VPS, every way of doing it left opens finding nothing, so a launcher's
   check, a /watch tick or a join pass that landed in a Ship's swap found no
   feed. A generation's name only ever appears, and the one before it stays, so
   the newest one is always there to read. The folder is listed once; after
   that each call only asks whether the newest is still there (a folder put back
   by hand lists again) and whether the next number has appeared. Null while a
   channel has no feed. */
const feedNewest = {};
function feedGeneration(n) { return String(n).padStart(8, '0') + '.json'; }
/* THE FEED LAUNCHERS READ, IN TWO (#1050, Patrick's answer of 19 Oct). The
   store keeps every generation whole, and every script, backup and page reads
   it whole. What /feed[-dev]/version.json answers is feedView's: once the
   feed's minLauncher is at or above FEED_SPLIT_LAUNCHER, the first launcher
   that reads it this way (FeedSettings.cs, out of the launcher since #5608), version.json holds
   only what the update check needs, FEED_TOP, and names everything else as
   one more asset, "settings": { sha256 }, the rest of the feed as one line
   of JSON, answered at /feed[-dev]/assets/<sha256> from here. And every asset
   the feed names is named by its sha256 alone: the launcher finds it in the
   feed's own assets folder. A launcher reads the feed on every check, every
   thirty seconds in a session, and on 19 Oct main's was 4,928 bytes, almost
   none of which moves between releases. Below that minLauncher the file is
   answered as the store holds it, byte for byte. The launcher fields, and
   "packs" and "news" as the empty lists every launcher has read, stay in
   version.json either way, so a launcher from before this can still read
   that it is behind and update itself. Kept beside the generations because
   everything that answers the feed reads through both. */
const FEED_SPLIT_LAUNCHER = '1.2.6';
const FEED_TOP = ['launcherVersion', 'minLauncher', 'launcherUrl', 'launcherSha256', 'baseline', 'newsFile', 'packs', 'news'];
const feedViews = {};
function feedAtLeast(v, min) {
  const a = String(v || '').trim().split('.'), b = min.split('.');
  if (a.some((x) => !/^\d+$/.test(x))) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = Number(a[i] || 0), y = Number(b[i] || 0);
    if (x !== y) return x > y;
  }
  return true;
}
function feedHashOnly(o, keys) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return;
  for (const pair of keys) {
    if (/^[0-9a-f]{64}$/.test(String(o[pair[1]] || ''))) delete o[pair[0]];
  }
}
function feedSplit(doc) {
  const top = {}, rest = {};
  for (const k of Object.keys(doc)) (FEED_TOP.indexOf(k) >= 0 ? top : rest)[k] = doc[k];
  feedHashOnly(top.baseline, [['url', 'sha256']]);
  feedHashOnly(top.newsFile, [['url', 'sha256']]);
  feedHashOnly(rest.clientRuntime, [['url', 'sha256']]);
  feedHashOnly(rest.signedManifest, [['url', 'sha256'], ['catalogUrl', 'catalogSha256']]);
  const settings = Buffer.from(JSON.stringify(rest), 'utf8');
  const sha = require('crypto').createHash('sha256').update(settings).digest('hex');
  top.settings = { sha256: sha };
  return { body: Buffer.from(JSON.stringify(top), 'utf8'), sha: sha, settings: settings };
}
/* The answer for one generation file: { body, tag, sha, settings }, sha and
   settings null when it is answered whole. The tag is the file's size and
   time, as it always was, with "-split" on a split one, so turning the split
   on gives every launcher a new document once. The last four are kept per
   channel, so a launcher that read version.json just before a Ship still
   finds the settings it names. Throws when the file is gone. */
function feedView(channel, file) {
  const st = fs.statSync(file);
  const move = feedMove(channel);
  const moveSha = move ? move.sha256 : null;
  const list = feedViews[channel] || (feedViews[channel] = []);
  for (const v of list) if (v.file === file && v.size === st.size && v.mtimeMs === st.mtimeMs && v.moveSha === moveSha) return v;
  const raw = fs.readFileSync(file);
  const v = { file: file, size: st.size, mtimeMs: st.mtimeMs, moveSha: moveSha, body: raw, sha: null, settings: null,
              tag: '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"' };
  let doc = null;
  try { doc = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')); } catch (e) { doc = null; }
  const isDoc = doc && typeof doc === 'object' && !Array.isArray(doc);
  if (isDoc && move) {
    doc.launcherVersion = feedMoveVersion(doc.launcherVersion);
    doc.launcherUrl = move.url;
    doc.launcherSha256 = move.sha256;
    v.body = Buffer.from(JSON.stringify(doc), 'utf8');
    v.tag = v.tag.slice(0, -1) + '-move-' + move.sha256.slice(0, 16) + '"';
  }
  if (isDoc && feedAtLeast(doc.minLauncher, FEED_SPLIT_LAUNCHER)) {
    const s = feedSplit(doc);
    v.body = s.body; v.sha = s.sha; v.settings = s.settings;
    v.tag = v.tag.slice(0, -1) + '-split"';
  }
  list.unshift(v);
  if (list.length > 4) list.length = 4;
  return v;
}
/* THE OLD LAUNCHER MOVES ITSELF TO THE NEW ONE (2 Nov 2026). Patrick: "is
   there not a way to from the current launchers people have have it update
   to the new one or install the new one and delete the old". The launcher
   from before Velopack reads this feed and puts in the launcher it names,
   held to launcherSha256 and Thornswood's signature, by itself (automatic
   updates are on unless somebody switched them off, #3202). Once a channel
   has a Velopack setup program with the move program on the same Release
   (merge-release.yml; launcher\move\Program.cs), version.json names the move
   program as that launcher: launcherVersion one step past the feed's own,
   so every old launcher takes it, launcherUrl its Release download (a host
   the old launcher allows) and launcherSha256 GitHub's digest of it. The
   move program then installs the new launcher for that channel, hands it
   the install's folder and removes the old one. The store's file is not
   touched: Ship and every script still read it whole. 'feed' and 'feed-dev'
   are the feed folders; null while there is nothing to move to. */
function feedMove(channel) {
  const ch = channel === 'feed-dev' ? 'dev' : channel === 'feed' ? 'main' : '';
  if (!ch) return null;
  const setup = newestSetup(ch);
  return setup && setup.move ? setup.move : null;
}
// One step past the launcher the feed names, so the old launcher's IsNewer
// (dotted numbers, each compared) reads it as newer: 2026.1102.716 becomes
// 2026.1102.716.1. A feed without a number of its own gets 1.
function feedMoveVersion(was) {
  const v = String(was || '').trim();
  return /^\d+(\.\d+)*$/.test(v) ? v + '.1' : '1';
}
/* The settings a view of this channel names, or null. The newest generation
   is looked at first, for a site that restarted since the feed was read. */
function feedSettings(channel, sha) {
  const newest = feedFile(channel);
  if (newest) feedView(channel, newest);
  for (const v of feedViews[channel] || []) if (v.sha === sha) return v.settings;
  return null;
}
function feedFile(channel) {
  const dir = path.join(ROOT, channel, 'version');
  let n = feedNewest[channel] || 0;
  if (n && !fs.existsSync(path.join(dir, feedGeneration(n)))) n = 0;
  if (!n) {
    if (!fs.existsSync(dir)) return null;
    for (const name of fs.readdirSync(dir)) {
      if (/^\d{8}\.json$/.test(name)) n = Math.max(n, Number(name.slice(0, 8)));
    }
    if (!n) return null;
  }
  while (fs.existsSync(path.join(dir, feedGeneration(n + 1)))) n++;
  feedNewest[channel] = n;
  return path.join(dir, feedGeneration(n));
}
function readJsonQuiet(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; }
}

/* ---- release copies (#3686) ----
   DOWNLOADS COME FROM THIS REPOSITORY'S RELEASES (Patrick, 26 Oct, for going
   public). Every launcher of every age asks this site for its files, at
   /feed[-dev]/assets/<sha256>, and that never changes: a launcher from 1.2.6
   on builds each address from the feed's own folder (feedSplit, and Sync.cs
   AssetFolder for a record's files), and older ones were given these
   addresses in their feeds. What moves is where the bytes come from.
   release-files.yml puts every file a release names on a GitHub Release, on
   the release's own tag (release/main/<id>, release/dev/<id>), each named by
   its sha256. Here, once GitHub says that the Release of the feed's current
   release holds a file, under that name, with that sha256 as its own digest
   and with this site's size, the asset route answers 302 to where GitHub
   keeps those bytes (assetLocation, below) instead of sending them. Every
   launcher since before 25 Sep follows a redirect, and still checks the
   sha256 of what it gets.

   A Release that is still a draft being filled is not used, and the site's
   copy is what any release the Release does not hold is served from, and
   what is sent whenever GitHub cannot say where its copy is just now. A
   Release once seen is kept: release-files.yml publishes it only after every
   file is on it, and never replaces a file of a published one. One that is
   not there yet is asked about again RELEASE_LOOK_MS later, never sooner.
   The lookup never holds a download: the request that starts it is served
   from here. site/tests/test-release-copies.js drives this block, and the
   setup programs and the Release route below it.

   THE API'S ASSET ROUTE, SIGNED IN (#5608, Patrick's B on 9 Nov 2026). On
   9 Nov GitHub answered every anonymous request to github.com with 504 for
   hours, its Release downloads included, while api.github.com kept
   answering. Every address this site hands out for a file GitHub holds was a
   github.com download address, so new installs, launcher updates and old
   launchers' syncs all stopped although nothing of ours was down. Now no
   address this site gives out is on github.com. The site asks the API for
   the asset by its id, with Accept: application/octet-stream, and GitHub
   answers 302 to a short lived address on its storage
   (release-assets.githubusercontent.com), which the site answers in turn
   (assetLocation). The site asks signed in, with the read only token the box
   admin service makes for it (siteToken): five thousand calls an hour, where
   anonymous asking allows sixty. A box without the token asks without one,
   and says so once in its log. */
const RELEASE_REPO = 'ThornswoodRP/Thornswood';
const RELEASE_LOOK_MS = 10 * 60 * 1000;
// A release id is its instant: yyyyMMdd-HHmmss with a Z, in UTC since
// #4950, -dev on dev. The ids already published (seconds with no Z, and
// the older minutes) still read, and a Z only ever follows the seconds.
const RELEASE_TAG_RE = /^release\/(main|dev)\/\d{8}-\d{4}(\d{2}Z?)?(-dev)?$/;
const releaseCopies = {};   // tag -> { files: { sha: { id, size } }, seen } once found; { at, busy } while not
const releaseTagOf = {};    // feed generation file -> the release tag it names, or ''
/* The site's GitHub token (#5608): an installation token of the box admin
   App with Contents read on this repository alone, which
   scripts/vps/admin/admin.js makes every half hour, for the hour GitHub gives
   it, into a folder only the site's own task besides SYSTEM, Administrators
   and that service may read (Install-AdminService.ps1). Read at each call,
   so a new one is used the moment it is written. Sent to api.github.com
   only: a copy of the site a harness starts points GITHUB_API elsewhere and
   never sends it. */
const SITE_TOKEN = process.env.THORNSWOOD_SITE_GITHUB_TOKEN || 'C:\\Thornswood-Admin\\for-site\\github-token.json';
let tokenSaid = '';
let githubSigned = false;   // whether the last call to GitHub went signed in
function tokenLog(line, bad) {
  if (line === tokenSaid) return;
  tokenSaid = line;
  (bad ? console.error : console.log)('[thornswood-docs] GitHub token: ' + line);
}
function siteToken() {
  if (GITHUB_API.hostname !== 'api.github.com') return '';
  if (!fs.existsSync(SITE_TOKEN)) {
    tokenLog('there is none at ' + SITE_TOKEN + ' (Install-AdminService.ps1 makes it), so GitHub is asked without one, sixty calls an hour', true);
    return '';
  }
  let doc;
  try { doc = JSON.parse(fs.readFileSync(SITE_TOKEN, 'utf8')); }
  catch (e) {
    tokenLog(SITE_TOKEN + ' did not read (' + e.message + '), so GitHub is asked without one', true);
    return '';
  }
  const token = doc && typeof doc.token === 'string' ? doc.token : '';
  const left = Date.parse(String((doc && doc.expires_at) || '')) - Date.now();
  if (!/^[A-Za-z0-9_]{20,255}$/.test(token) || !(left > 2 * 60 * 1000)) {
    tokenLog(SITE_TOKEN + ' holds no token with more than two minutes left, so GitHub is asked without one; the admin service writes a new one every half hour', true);
    return '';
  }
  tokenLog('signed in, from ' + SITE_TOKEN, false);
  return token;
}
/* One call to GitHub's API about this repository. JSON unless asset is set:
   then it asks for the asset's bytes and hands back where GitHub sends them,
   { status: 302, location }, without following it. */
function releaseGitHub(apiPath, asset) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const token = siteToken();
    githubSigned = !!token;
    const headers = { 'user-agent': 'thornswood-site', accept: asset ? 'application/octet-stream' : 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28' };
    if (token) headers.authorization = 'Bearer ' + token;
    const req = (GITHUB_API.protocol === 'http:' ? require('http') : https).get({
      hostname: GITHUB_API.hostname, port: GITHUB_API.port || undefined, path: '/repos/' + RELEASE_REPO + apiPath, headers
    }, (res) => {
      if (asset) {
        res.resume();
        if (res.statusCode === 302) return settle({ status: 302, location: String(res.headers.location || '') });
        return settle({ status: res.statusCode, why: 'GitHub answered ' + res.statusCode });
      }
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { out += d; });
      res.on('error', (e) => settle({ status: 0, why: e.message }));
      res.on('end', () => {
        if (res.statusCode !== 200) return settle({ status: res.statusCode, why: 'GitHub answered ' + res.statusCode });
        try { settle({ status: 200, body: JSON.parse(out) }); }
        catch (e) { settle({ status: 0, why: 'GitHub\'s answer did not read' }); }
      });
    });
    const timer = setTimeout(() => { settle({ status: 0, why: 'GitHub did not answer inside ten seconds' }); req.destroy(); }, 10000);
    req.on('error', (e) => settle({ status: 0, why: 'could not reach GitHub: ' + e.message }));
  });
}
// The files of one published Release, by their asset ids. Only an asset
// whose name is the sha256 GitHub itself measured on it counts.
async function lookReleaseCopies(tag) {
  // The newest Releases rather than /releases/tags/<tag>, which a tag with
  // slashes in it does not suit; a feed's current release is always among
  // them, since release-files.yml makes its Release just after its Ship.
  const list = await releaseGitHub('/releases?per_page=30');
  if (list.status !== 200 || !Array.isArray(list.body)) return { found: false, why: list.why || 'the Release list did not read' };
  const r = list.body.find((x) => x && x.tag_name === tag && !x.draft && Number.isInteger(x.id));
  if (!r) return { found: false, why: '' };
  const files = {};
  for (let page = 1; page <= 10; page++) {
    const got = await releaseGitHub('/releases/' + r.id + '/assets?per_page=100&page=' + page);
    if (got.status !== 200 || !Array.isArray(got.body)) return { found: false, why: got.why || 'the asset list did not read' };
    for (const a of got.body) {
      if (!a || a.state !== 'uploaded' || typeof a.name !== 'string') continue;
      if (!Number.isInteger(a.id) || a.id <= 0) continue;
      const m = /^sha256:([0-9a-f]{64})$/.exec(String(a.digest || ''));
      if (!m || !Number.isInteger(a.size)) continue;
      if (a.name === m[1]) files[m[1]] = { id: a.id, size: a.size };
    }
    if (got.body.length < 100) break;
  }
  return { found: true, files };
}
function askReleaseCopies(tag) {
  const had = releaseCopies[tag];
  if (had && (had.files || had.busy || Date.now() - had.at < RELEASE_LOOK_MS)) return;
  releaseCopies[tag] = { at: Date.now(), busy: true };
  lookReleaseCopies(tag).then((v) => {
    if (v.found) {
      releaseCopies[tag] = { files: v.files, seen: Date.now() };
      console.log('[thornswood-docs] release copies: ' + tag + ' holds ' + Object.keys(v.files).length + ' file(s)');
    } else {
      releaseCopies[tag] = { at: Date.now(), busy: false };
      if (v.why && !/ 404$/.test(v.why)) console.error('[thornswood-docs] release copies: ' + tag + ': ' + v.why);
    }
  }, (e) => {
    releaseCopies[tag] = { at: Date.now(), busy: false };
    console.error('[thornswood-docs] release copies: ' + tag + ': ' + (e && e.message));
  });
}
// The tag of the release a channel's newest feed names, or ''. A generation
// file is never rewritten (#2727), so its tag is read once.
function feedReleaseTag(channel) {
  const file = feedFile(channel);
  if (!file) return '';
  if (!(file in releaseTagOf)) {
    const doc = readJsonQuiet(file);
    const tag = String((doc && doc.release && doc.release.tag) || '');
    releaseTagOf[file] = RELEASE_TAG_RE.test(tag) ? tag : '';
  }
  return releaseTagOf[file];
}
// The asset id of the Release's copy of a feed asset of this size, which
// assetLocation turns into where GitHub keeps it, or 0 when there is none.
function releaseCopy(channel, sha, size) {
  const tag = feedReleaseTag(channel);
  if (!tag) return 0;
  askReleaseCopies(tag);
  const c = releaseCopies[tag];
  const f = c && c.files && c.files[sha];
  return f && f.size === size ? f.id : 0;
}
/* WHERE GITHUB KEEPS AN ASSET (#5608): the address on its storage the API's
   asset route answers 302 to, for the asset with this id, as { url }, or
   { why } when GitHub could not say. Only an https address on GitHub's two
   storage hosts is taken, the ones every launcher since before 25 Sep lists
   as where its downloads come from (Updater.cs AllowedHosts). GitHub signs the address for a
   few minutes, so one is kept ASSET_KEEP_MS and handed to everybody asking
   for that asset meanwhile: a launcher's sync asks for many files one after
   another, and an update's are asked by every launcher at once. */
const ASSET_KEEP_MS = 60 * 1000;
const assetPlaces = {};     // asset id -> { url, at }
function storageAddress(u) {
  let x;
  try { x = new URL(u); } catch (e) { return false; }
  return x.protocol === 'https:' && !x.username && !x.password && !x.port && /^(objects|release-assets)\.githubusercontent\.com$/i.test(x.hostname);
}
async function assetLocation(id) {
  if (!Number.isInteger(id) || id <= 0) return { why: 'no asset id' };
  const had = assetPlaces[id];
  if (had && Date.now() - had.at < ASSET_KEEP_MS) return { url: had.url };
  const got = await releaseGitHub('/releases/assets/' + id, true);
  if (got.status !== 302) return { why: got.why || ('GitHub answered ' + got.status) };
  if (!storageAddress(got.location)) return { why: 'GitHub sent the asset somewhere other than its storage' };
  assetPlaces[id] = { url: got.location, at: Date.now() };
  return { url: got.location };
}
/* THE SETUP PROGRAMS (#4824). The download is Velopack's setup program, which
   merge-release.yml makes and signs with the launcher's package inside it.
   Main's, Thornswood-Setup.exe, goes on a Release main-<tag> of its own once
   Patrick approves that build (#5181); dev's, Thornswood-Dev-Setup.exe, is on
   every build Release <tag> that made a package (build-YYYYMMDD.N). Each
   channel's is the one on the newest published Release of its kind, under
   that name, with GitHub's own sha256 digest and a whole size beside it, and
   /file/<name> answers 302 to where GitHub keeps it (assetLocation, #5608).
   Until GitHub has said so there is no setup
   program to offer: the Downloads page says the installer is not published
   yet and /file/<name> answers 404. The site's own downloads folder never
   serves either name (downloadServed): the old installer Publish-Installer put
   there went with that pipeline.

   The same list as the release copies, asked the same way: again
   RELEASE_LOOK_MS after the last answer and never sooner, without
   holding the request that started it. A look that fails keeps what the last
   one found. The list is walked a hundred Releases a page, because a main
   Release is made only on an approval and can be older than the newest thirty
   build Releases. */
// Both kinds of build tag while the date numbers give way to 1.3.x (Patrick,
// 8 Nov 2026): the newest published Release is taken either way, by its time.
const SETUP_KINDS = {
  main: { tag: /^main-build-(?:\d{8}\.\d+|1\.3\.\d+)$/, name: 'Thornswood-Setup.exe', move: 'Thornswood-Move.exe' },
  dev: { tag: /^build-(?:\d{8}\.\d+|1\.3\.\d+)$/, name: 'Thornswood-Dev-Setup.exe', move: 'Thornswood-Dev-Move.exe' }
};
const SETUP_PAGES = 5;
const setups = { main: null, dev: null, at: 0, busy: false };
async function lookSetups() {
  const out = { main: null, dev: null };
  for (let page = 1; page <= SETUP_PAGES && !(out.main && out.dev); page++) {
    const list = await releaseGitHub('/releases?per_page=100&page=' + page);
    if (list.status !== 200 || !Array.isArray(list.body)) return { found: false, why: list.why || 'the Release list did not read' };
    const rs = list.body.filter((r) => r && !r.draft && typeof r.tag_name === 'string' && Array.isArray(r.assets))
      .sort((a, b) => (Date.parse(b.published_at || '') || 0) - (Date.parse(a.published_at || '') || 0));
    for (const ch of Object.keys(SETUP_KINDS)) {
      const k = SETUP_KINDS[ch];
      for (const r of rs) {
        if (out[ch]) break;
        if (!k.tag.test(r.tag_name)) continue;
        const a = r.assets.find((x) => x && x.name === k.name && x.state === 'uploaded');
        if (!a) continue;
        const m = /^sha256:([0-9a-f]{64})$/.exec(String(a.digest || ''));
        if (!Number.isInteger(a.id) || a.id <= 0 || !m || !Number.isInteger(a.size) || a.size <= 0) continue;
        out[ch] = { name: k.name, id: a.id, size: a.size, sha256: m[1], tag: r.tag_name, at: Date.parse(r.published_at || '') || 0,
                    move: setupMove(r, k.move) };
      }
    }
    if (list.body.length < 100) break;
  }
  return { found: true, main: out.main, dev: out.dev };
}
// The move program on the same Release as a setup program (feedMove), as
// { name, id, url, size, sha256 }, or null when that Release has none. Its url is
// this site's Release route (#5608), which the old launcher allows and
// follows on to GitHub's storage.
function setupMove(r, name) {
  const a = r.assets.find((x) => x && x.name === name && x.state === 'uploaded');
  if (!a) return null;
  const m = /^sha256:([0-9a-f]{64})$/.exec(String(a.digest || ''));
  if (!Number.isInteger(a.id) || a.id <= 0 || !m || !Number.isInteger(a.size) || a.size <= 0) return null;
  if (!RELEASE_ROUTE_TAG.test(r.tag_name)) return null;
  return { name, id: a.id, url: SITE_ORIGIN + releaseRoute(r.tag_name, name), size: a.size, sha256: m[1] };
}
function askSetups() {
  if (setups.busy || (setups.at && Date.now() - setups.at < RELEASE_LOOK_MS)) return;
  setups.busy = true;
  lookSetups().then((v) => {
    setups.busy = false;
    setups.at = Date.now();
    if (!v.found) {
      if (v.why && !/ 404$/.test(v.why)) console.error('[thornswood-docs] setup programs: ' + v.why);
      return;
    }
    for (const ch of Object.keys(SETUP_KINDS)) {
      const was = setups[ch], now = v[ch];
      if (now && (!was || was.id !== now.id)) console.log('[thornswood-docs] setup programs: ' + ch + ' is ' + now.name + ' on ' + now.tag);
      setups[ch] = now;
    }
  }, (e) => {
    setups.busy = false;
    setups.at = Date.now();
    console.error('[thornswood-docs] setup programs: ' + (e && e.message));
  });
}
// The channel, 'main' or 'dev', whose setup program goes by this file name,
// or '' for any other name. A function, so /file/ can ask it however the
// modules load (a const is not there yet when module.exports is given).
function setupChannel(name) {
  for (const ch of Object.keys(SETUP_KINDS)) { if (SETUP_KINDS[ch].name === name) return ch; }
  return '';
}
// The newest setup program of a channel, 'main' or 'dev', as GitHub last said
// it, or null: { name, id, size, sha256, tag, at, move }.
function newestSetup(channel) {
  askSetups();
  return setups[channel] || null;
}
/* THE RELEASE ROUTE (#5608). The launcher holds no token, and asked without
   one GitHub allows sixty calls an hour from an address, which a household
   of launchers sharing one would spend on a single update. So the launcher
   asks GitHub nothing: it reads the list of Releases from this site
   (/api/launcher/releases, releaseList) and fetches each file of a Release
   from /release/<tag>/<name> here, which answers 302 to where GitHub keeps
   it (releaseAsset, then assetLocation). Its Velopack feed and packages, the
   signed release record and its lists (VeloUpdate.cs, VeloRecord.cs), and an
   old launcher's move program (feedMove) all go this way. Only a tag of
   letters, digits, dots, hyphens and underscores has a route, which every
   build and main Release has.

   Which asset a name is comes from what GitHub already said: the list of the
   newest hundred Releases (releaseList) and the setup programs' Releases
   (newestSetup). Only a build Release older than both, the record of a main
   release promoted from far behind dev, is asked for by its tag, kept
   RELEASE_KEEP_MS whatever GitHub answered. Any other tag is a 404 without
   asking GitHub, so nobody can spend the site's calls on names. */
const SITE_ORIGIN = 'https://thornswood.net';   // public.js PUBLIC_ORIGIN; feed.js loads first
const RELEASE_ROUTE_TAG = /^[A-Za-z0-9._-]{1,100}$/;
const RELEASE_ROUTE_NAME = /^[A-Za-z0-9._-]{1,200}$/;
const RELEASE_BUILD_TAG = /^(?:main-)?build-1\.3\.\d{1,5}$/;
const RELEASE_KEEP_MS = 10 * 60 * 1000;
const releaseFiles = {};    // tag -> { files: { name: id } or null when GitHub says there is no such Release, at }
function releaseRoute(tag, name) {
  return '/release/' + tag + '/' + name;
}
// The asset id of a file of a published Release, by its tag, or 0.
function knownAsset(tag, name) {
  const held = releaseListHeld.files[tag];
  if (held && Object.prototype.hasOwnProperty.call(held, name)) return held[name];
  for (const ch of Object.keys(SETUP_KINDS)) {
    const st = setups[ch];
    if (!st || st.tag !== tag) continue;
    if (st.name === name) return st.id;
    if (st.move && st.move.name === name) return st.move.id;
  }
  const looked = releaseFiles[tag];
  if (looked && looked.files && Object.prototype.hasOwnProperty.call(looked.files, name)) return looked.files[name];
  return 0;
}
// Where a file of a published Release is: { url }, { missing: true } when
// GitHub says the Release or the file is not there, or { why } when GitHub
// could not be asked.
async function releaseAsset(tag, name) {
  if (!RELEASE_ROUTE_TAG.test(String(tag)) || !RELEASE_ROUTE_NAME.test(String(name))) return { missing: true };
  if (releaseListHeld.body === null) await askReleaseList();
  askSetups();
  let id = knownAsset(tag, name);
  if (!id && RELEASE_BUILD_TAG.test(tag) && !releaseListHeld.files[tag]) {
    const had = releaseFiles[tag];
    if (!had || Date.now() - had.at >= RELEASE_KEEP_MS) {
      const got = await releaseGitHub('/releases/tags/' + encodeURIComponent(tag));
      if (got.status === 200 && got.body && typeof got.body === 'object') {
        const r = got.body;
        releaseFiles[tag] = { files: r.tag_name === tag && !r.draft && Array.isArray(r.assets) ? assetIds(r.assets) : null, at: Date.now() };
      } else if (got.status === 404) {
        releaseFiles[tag] = { files: null, at: Date.now() };
      } else {
        return { why: got.why || 'the Release did not read' };
      }
      id = knownAsset(tag, name);
    }
  }
  if (!id) return { missing: true };
  return assetLocation(id);
}
// name -> asset id, of the files GitHub has finished taking.
function assetIds(assets) {
  const files = {};
  for (const a of assets) {
    if (a && a.state === 'uploaded' && typeof a.name === 'string' && RELEASE_ROUTE_NAME.test(a.name) &&
        Number.isInteger(a.id) && a.id > 0) files[a.name] = a.id;
  }
  return files;
}
/* The Releases as the launcher reads them (/api/launcher/releases): the
   newest hundred, published, each with its tag, when it was published and
   its files, each file's address this site's Release route. GitHub's own
   shape, so Velopack's GithubSource reads it as it is (VeloUpdate.cs
   ChannelSource). Asked again at most every LIST_SIGNED_MS while the site
   holds its token, and every RELEASE_LOOK_MS without one, so a new Release
   reaches launchers within a minute and never spends the anonymous sixty.
   Until the first answer the caller waits for it; after that the list held
   is answered and a new one asked for behind it. A look that fails keeps the
   list the last one found. null when GitHub has not answered yet. */
const LIST_SIGNED_MS = 60 * 1000;
const releaseListHeld = { body: null, files: {}, notes: null, at: 0, busy: null };
function listFromGitHub(list) {
  const out = [], files = {}, notes = [];
  for (const r of list) {
    if (!r || r.draft || typeof r.tag_name !== 'string' || !RELEASE_ROUTE_TAG.test(r.tag_name) || !Array.isArray(r.assets)) continue;
    // What the News page reads of it (news.js): its title, its note and when
    // it went out.
    notes.push({ tag: r.tag_name, name: typeof r.name === 'string' ? r.name : '', body: typeof r.body === 'string' ? r.body : '',
                 published_at: r.published_at || null });
    const ids = assetIds(r.assets);
    files[r.tag_name] = ids;
    const assets = [];
    for (const a of r.assets) {
      if (!a || !Object.prototype.hasOwnProperty.call(ids, a.name) || ids[a.name] !== a.id) continue;
      const at = releaseRoute(r.tag_name, a.name);
      assets.push({ name: a.name, size: Number.isInteger(a.size) ? a.size : 0, url: at, browser_download_url: at });
    }
    out.push({ name: typeof r.name === 'string' ? r.name : r.tag_name, tag_name: r.tag_name, prerelease: !!r.prerelease,
               published_at: r.published_at || null, assets });
  }
  return { body: JSON.stringify(out), files, notes };
}
function askReleaseList() {
  if (releaseListHeld.busy) return releaseListHeld.busy;
  const every = githubSigned ? LIST_SIGNED_MS : RELEASE_LOOK_MS;
  if (releaseListHeld.at && Date.now() - releaseListHeld.at < every) return Promise.resolve();
  releaseListHeld.busy = releaseGitHub('/releases?per_page=100&page=1').then((got) => {
    releaseListHeld.busy = null;
    releaseListHeld.at = Date.now();
    if (got.status === 200 && Array.isArray(got.body)) {
      const made = listFromGitHub(got.body);
      releaseListHeld.body = made.body;
      releaseListHeld.files = made.files;
      releaseListHeld.notes = made.notes;
    } else {
      console.error('[thornswood-docs] the Release list for launchers: ' + (got.why || 'did not read'));
    }
  }, (e) => {
    releaseListHeld.busy = null;
    releaseListHeld.at = Date.now();
    console.error('[thornswood-docs] the Release list for launchers: ' + (e && e.message));
  });
  return releaseListHeld.busy;
}
async function releaseList() {
  const asking = askReleaseList();
  if (releaseListHeld.body === null) await asking;
  return releaseListHeld.body;
}
// The same newest hundred published Releases as the News page reads them
// (news.js): [{ tag, name, body, published_at }], newest first as GitHub
// lists them, or null when GitHub has not answered yet. One list, one call,
// for the launchers and the page.
async function releaseNotes() {
  const asking = askReleaseList();
  if (releaseListHeld.notes === null) await asking;
  return releaseListHeld.notes;
}
/* THE LAUNCHERS A CHANNEL LETS IN, SINCE VELOPACK (#4825). The launcher goes
   out only through Velopack: merge-release.yml packs it as version 1.3.<n>
   on the build Release build-1.3.<n> (MergeRelease.ps1,
   New-MergeReleaseNames; from 1 to 8 Nov 2026 the numbers were
   <yyyy>.<M*100+d>.<n> on build-<yyyyMMdd>.<n>), and promote-main.yml puts
   main's package of the same number on main-build-1.3.<n>. The launcher says
   that number at Play (Updater.Version), and a channel lets it in when its
   Release is out on GitHub with that channel's Velopack feed on it,
   releases.dev.json or releases.main.json, since that is the only way a
   launcher reaches the number. Velopack moves a launcher forward at its
   start, so any number the channel published is let in; the update feed's
   launcherVersion and minLauncher are the old launcher's, which nothing writes
   any more, and are read only while a channel has no Velopack setup program
   out (newestSetup). Once it has one, a launcher from before Velopack is told
   to install the new one from the Downloads page.

   Asked of GitHub without a token, like the setup programs: a number found is
   kept, since a published Release stays published. A number not found is
   asked again only RELEASE_LOOK_MS later, and a number nobody has asked about
   yet is asked at most once every NATIVE_ASK_MS, which keeps the site inside
   GitHub's sixty unsigned calls an hour even when a linked account sends a
   new number at every Play. The launcher can only be on a number after its
   Release is published, so the first Play on a new number finds it. */
const NATIVE_ASK_MS = 90 * 1000;
const nativeSeen = {};   // '<channel> <number>' -> { ok: true } once found; { at } while not
let nativeAskedAt = 0;
// The Release tag a launcher number is from, for a channel, or '' when the
// number is not a Velopack one (an old launcher's, or nonsense). 1.3.<n> is
// Velopack's: v1.2.16 was the last launcher before it, and no old launcher
// was ever numbered 1.3 (VeloRecord.TagOf reads them the same
// way). A date number, 2026.1108.2, is the Release build-20261108.2.
function nativeTag(channel, said) {
  const s = String(said || '');
  let tag = '';
  const v = /^1\.3\.(\d{1,5})$/.exec(s);
  if (v) {
    tag = 'build-1.3.' + Number(v[1]);
  } else {
    const m = /^(20\d\d)\.(\d{3,4})\.(\d{1,9})$/.exec(s);
    if (!m) return '';
    const md = Number(m[2]), month = Math.floor(md / 100), day = md % 100;
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    tag = 'build-' + m[1] + String(month).padStart(2, '0') + String(day).padStart(2, '0') + '.' + Number(m[3]);
  }
  return channel === 'main' ? 'main-' + tag : tag;
}
// Whether a channel published this Velopack launcher number: 'yes', 'no', or
// 'unknown' when GitHub could not be asked just now.
async function nativePublished(channel, said) {
  const tag = nativeTag(channel, said);
  if (!tag) return 'no';
  const key = channel + ' ' + said;
  const had = nativeSeen[key];
  if (had && had.ok) return 'yes';
  if (had && Date.now() - had.at < RELEASE_LOOK_MS) return 'no';
  if (Date.now() - nativeAskedAt < NATIVE_ASK_MS) return 'unknown';
  nativeAskedAt = Date.now();
  const got = await releaseGitHub('/releases/tags/' + encodeURIComponent(tag));
  if (got.status === 404) { nativeSeen[key] = { at: Date.now() }; return 'no'; }
  if (got.status !== 200 || !got.body) return 'unknown';
  const r = got.body;
  const feedName = 'releases.' + channel + '.json';
  const ok = r.tag_name === tag && !r.draft && Array.isArray(r.assets) &&
    r.assets.some((a) => a && a.name === feedName && a.state === 'uploaded');
  nativeSeen[key] = ok ? { ok: true } : { at: Date.now() };
  if (ok) console.log('[thornswood-docs] launcher ' + said + ' is published on ' + channel + ' (' + tag + ')');
  return ok ? 'yes' : 'no';
}
/* THE SERVERS' COLLECTION REVISION (#5767). The revision a channel's servers
   run is the one in the signed manifest of the Release that channel is on
   (New-SignedManifest.ps1 writes collectionRevision from the commit's
   records/collection-plugins.json): main's promoted build, by the tag of
   main's setup program (main-build-1.3.<n> is build-1.3.<n>), and dev's newest
   build. Until 11 Nov the Downloads page took it from the feed, which only a
   Ship writes, and releases stopped going through a Ship: revision 8 sat
   behind 7 from 8 to 11 Nov. A manifest never changes, so each is read once;
   0 until it has been, or for a record from before the field. The page reads
   only the number; launchers hold the record to its signature (VeloRecord.cs). */
const revisionOf = {};   // build tag -> the collectionRevision its manifest names
const revisionBusy = {};
function serverRevision(channel) {
  const st = newestSetup(channel);
  if (!st || typeof st.tag !== 'string') return 0;
  const tag = st.tag.replace(/^main-/, '');
  if (Object.prototype.hasOwnProperty.call(revisionOf, tag)) return revisionOf[tag];
  if (!revisionBusy[tag]) {
    revisionBusy[tag] = true;
    readManifestRevision(tag).then((n) => {
      revisionOf[tag] = n;
      console.log('[thornswood-docs] ' + channel + ' runs ' + tag + ', collection revision ' + n);
    }, (e) => {
      console.error('[thornswood-docs] the collection revision of ' + tag + ': ' + (e && e.message));
    }).then(() => { revisionBusy[tag] = false; });
  }
  return 0;
}
async function readManifestRevision(tag) {
  const where = await releaseAsset(tag, 'manifest.json');
  if (!where.url) throw new Error(where.missing ? 'it has no manifest.json' : (where.why || 'its manifest.json could not be found'));
  const text = await new Promise((resolve, reject) => {
    const req = https.get(where.url, { headers: { 'user-agent': 'thornswood-site' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('GitHub\'s storage answered ' + res.statusCode)); return; }
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { out += d; if (out.length > 1048576) req.destroy(new Error('manifest.json is over 1 MB')); });
      res.on('end', () => resolve(out));
      res.on('error', reject);
    });
    req.setTimeout(10000, () => req.destroy(new Error('GitHub\'s storage did not answer inside ten seconds')));
    req.on('error', reject);
  });
  const doc = JSON.parse(text);
  if (!doc || doc.tag !== tag) throw new Error('its manifest.json names another Release');
  const n = Number(doc.collectionRevision);
  return Number.isInteger(n) && n > 0 ? n : 0;
}
/* ---- end release copies ---- */

Object.assign(module.exports, { DEPLOYED_BUILD, releaseCopies });
