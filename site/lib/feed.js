/*
  The launcher feeds the site serves: the deployed build, each channel's
  newest feed generation, the split launcher views, and the copies of a
  release's files on its GitHub Release.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { askReleaseCopies, feedFile, feedReleaseTag, feedSettings,
  feedView, nativePublished, nativeTag, newestSetup, readJsonQuiet, releaseCopy };

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const { DATA, ROOT } = require('./base');
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
   that reads it this way (launcher\app\FeedSettings.cs), version.json holds
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
  const list = feedViews[channel] || (feedViews[channel] = []);
  for (const v of list) if (v.file === file && v.size === st.size && v.mtimeMs === st.mtimeMs) return v;
  const raw = fs.readFileSync(file);
  const v = { file: file, size: st.size, mtimeMs: st.mtimeMs, body: raw, sha: null, settings: null,
              tag: '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"' };
  let doc = null;
  try { doc = JSON.parse(raw.toString('utf8').replace(/^﻿/, '')); } catch (e) { doc = null; }
  if (doc && typeof doc === 'object' && !Array.isArray(doc) && feedAtLeast(doc.minLauncher, FEED_SPLIT_LAUNCHER)) {
    const s = feedSplit(doc);
    v.body = s.body; v.sha = s.sha; v.settings = s.settings;
    v.tag = v.tag.slice(0, -1) + '-split"';
  }
  list.unshift(v);
  if (list.length > 4) list.length = 4;
  return v;
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
   its sha256. Here, once GitHub says publicly that the Release of the feed's
   current release holds a file, under that name, with that sha256 as its own
   digest and with this site's size, the asset route answers 302 to the
   Release's copy instead of sending the bytes. Every launcher since before
   25 Sep follows a redirect and allows github.com and its download hosts
   (Updater.cs AllowedHosts), and still checks the sha256 of what it gets.

   Only what GitHub answers without a token counts, so while the repository
   is private, or the Release is still a draft being filled, the answer is
   404 and the site sends the bytes itself, as it always has; the site's copy
   is also what any release the Release does not hold is served from. A
   Release once seen is kept: release-files.yml publishes it only after every
   file is on it, and never replaces a file of a published one. One that is
   not there yet is asked about again RELEASE_LOOK_MS later, never sooner,
   which keeps the site inside GitHub's sixty unsigned calls an hour. The
   lookup never holds a download: the request that starts it is served from
   here. site/tests/test-release-copies.js drives this block, and the setup
   programs below it. */
const RELEASE_REPO = 'ThornswoodRP/Thornswood';
const RELEASE_DOWNLOAD = 'https://github.com/' + RELEASE_REPO + '/releases/download/';
const RELEASE_LOOK_MS = 10 * 60 * 1000;
const RELEASE_TAG_RE = /^release\/(main|dev)\/\d{8}-\d{4,6}(-dev)?$/;
const releaseCopies = {};   // tag -> { files: { sha: { url, size } }, seen } once found; { at, busy } while not
const releaseTagOf = {};    // feed generation file -> the release tag it names, or ''
function releaseGitHub(apiPath) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const req = https.get({
      hostname: 'api.github.com', path: '/repos/' + RELEASE_REPO + apiPath,
      headers: { 'user-agent': 'thornswood-site', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
    }, (res) => {
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
// The files of one published Release, from GitHub without a token. Only an
// asset whose name is the sha256 GitHub itself measured on it counts.
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
      const url = String(a.browser_download_url || '');
      if (!url.startsWith(RELEASE_DOWNLOAD) || !url.endsWith('/' + a.name) || /[\s"'<>]/.test(url)) continue;
      const m = /^sha256:([0-9a-f]{64})$/.exec(String(a.digest || ''));
      if (!m || !Number.isInteger(a.size)) continue;
      if (a.name === m[1]) files[m[1]] = { url, size: a.size };
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
// Where a feed asset of this size can be fetched instead of here, or ''.
function releaseCopy(channel, sha, size) {
  const tag = feedReleaseTag(channel);
  if (!tag) return '';
  askReleaseCopies(tag);
  const c = releaseCopies[tag];
  const f = c && c.files && c.files[sha];
  return f && f.size === size ? f.url : '';
}
/* THE SETUP PROGRAMS (#4824). The download is Velopack's setup program, which
   merge-release.yml makes and signs with the launcher's package inside it.
   Main's, Thornswood-Setup.exe, goes on a Release main-<tag> of its own once
   Patrick approves that build (#5181); dev's, Thornswood-Dev-Setup.exe, is on
   every build Release <tag> that made a package (build-YYYYMMDD.N). Each
   channel's is the one on the newest published Release of its kind, under
   that name, with GitHub's own sha256 digest and a whole size beside it, and
   /file/<name> answers 302 to it. Until GitHub has said so there is no setup
   program to offer: the Downloads page says the installer is not published
   yet and /file/<name> answers 404. The site's own downloads folder never
   serves either name (downloadServed): the old installer Publish-Installer put
   there went with that pipeline.

   The same list as the release copies, asked the same way: without a token,
   again RELEASE_LOOK_MS after the last answer and never sooner, without
   holding the request that started it. A look that fails keeps what the last
   one found. The list is walked a hundred Releases a page, because a main
   Release is made only on an approval and can be older than the newest thirty
   build Releases. */
const SETUP_KINDS = {
  main: { tag: /^main-build-\d{8}\.\d+$/, name: 'Thornswood-Setup.exe' },
  dev: { tag: /^build-\d{8}\.\d+$/, name: 'Thornswood-Dev-Setup.exe' }
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
        const url = String(a.browser_download_url || '');
        const m = /^sha256:([0-9a-f]{64})$/.exec(String(a.digest || ''));
        if (url !== RELEASE_DOWNLOAD + r.tag_name + '/' + k.name || !m || !Number.isInteger(a.size) || a.size <= 0) continue;
        out[ch] = { name: k.name, url, size: a.size, sha256: m[1], tag: r.tag_name, at: Date.parse(r.published_at || '') || 0 };
      }
    }
    if (list.body.length < 100) break;
  }
  return { found: true, main: out.main, dev: out.dev };
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
      if (now && (!was || was.url !== now.url)) console.log('[thornswood-docs] setup programs: ' + ch + ' is ' + now.name + ' on ' + now.tag);
      setups[ch] = now;
    }
  }, (e) => {
    setups.busy = false;
    setups.at = Date.now();
    console.error('[thornswood-docs] setup programs: ' + (e && e.message));
  });
}
// The newest setup program of a channel, 'main' or 'dev', as GitHub last said
// it, or null: { name, url, size, sha256, tag, at }.
function newestSetup(channel) {
  askSetups();
  return setups[channel] || null;
}
/* THE LAUNCHERS A CHANNEL LETS IN, SINCE VELOPACK (#4825). The launcher goes
   out only through Velopack: merge-release.yml packs it as version
   <yyyy>.<M*100+d>.<n> on the build Release build-<yyyyMMdd>.<n>
   (MergeRelease.ps1, New-MergeReleaseNames), and promote-main.yml puts main's
   package of the same number on main-build-<yyyyMMdd>.<n>. The launcher says
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
// number is not a Velopack one (an old launcher's 1.x, or nonsense).
function nativeTag(channel, said) {
  const m = /^(20\d\d)\.(\d{3,4})\.(\d{1,9})$/.exec(String(said || ''));
  if (!m) return '';
  const md = Number(m[2]), month = Math.floor(md / 100), day = md % 100;
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const tag = 'build-' + m[1] + String(month).padStart(2, '0') + String(day).padStart(2, '0') + '.' + Number(m[3]);
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
/* ---- end release copies ---- */

Object.assign(module.exports, { DEPLOYED_BUILD, releaseCopies });
