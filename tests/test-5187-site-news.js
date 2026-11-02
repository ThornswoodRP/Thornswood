'use strict';
// test-5187-site-news.js
//
//     node tests\test-5187-site-news.js
//
// #5187: the site writes its own News page. It read data/news.json, which
// Publish-News.ps1 sent over ssh at the end of a main Ship, so a Ship stopped
// before that step left the page a release behind and nothing else could put
// it right. Now the site reads the main feed it serves and the news file that
// feed names (its own copy, or the release's GitHub Release copy when it does
// not hold one), cleans it for strangers and writes news.json itself.
//
// The "news from the Release" block is lifted out of site/server.js by its
// markers and run against a temp folder standing in for the site's root,
// with GitHub's download answered here. Checks:
//   - the cleaning Publish-News did, kept: no bare "Server updated", no load
//     order count, no "gamemode was rebuilt", no box address, no launcher
//     version or download size, no paths; near repeats once, the newest;
//     before 15 Sep 2026 left off; at most twelve; a lone detail still a
//     list; no file lists; the collection linked at its revision (#4115);
//   - the news file is read from the site's own copy when it is those bytes;
//   - else from the Release copy, checked by size and sha256, through GitHub's
//     redirect only to GitHub's hosts; a wrong one writes nothing;
//   - while the Release does not hold it the old page stays;
//   - the same feed is not read twice, and a new one is;
//   - nothing else writes news.json: Publish-News.ps1 is gone and Ship and
//     Clear-News name it no more.
// Writes only under its own temp folder.
const fs = require('fs'), path = require('path'), os = require('os');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const siteFiles = require('./site-files');
const REPO = path.join(__dirname, '..');
const server = siteFiles.source();

let pass = 0, fail = 0;
function yes(what, cond) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + what);
  if (cond) pass++; else fail++;
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const from = server.indexOf('/* ---- news from the Release (#5187) ----');
const to = server.indexOf('/* ---- end news from the Release ---- */');
yes('the news block is in server.js, between its markers', from >= 0 && to > from);
if (from < 0 || to <= from) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
const block = server.slice(from, to);

// GitHub, as the test says it answers: url -> { status, location?, body? }.
function fakeHttps(answer, calls) {
  return {
    get(u, opts, cb) {
      const url = String(u);
      calls.push(url);
      const a = answer(url) || { status: 404 };
      const res = new PassThrough();
      res.statusCode = a.status; res.headers = a.location ? { location: a.location } : {};
      const req = { on() { return req; }, destroy() { res.destroy(); } };
      setImmediate(() => { cb(res); res.end(a.body || Buffer.alloc(0)); });
      return req;
    }
  };
}

function load(opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-5187-news-'));
  fs.mkdirSync(path.join(root, 'feed', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const env = {
    ROOT: root, NEWS: path.join(root, 'data', 'news.json'), path, fs, crypto,
    https: fakeHttps(opts.answer || (() => null), opts.calls || []),
    feed: null,
    feedFile: () => env.feed,
    readJsonQuiet: (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } },
    feedReleaseTag: () => opts.tag || '',
    releaseCopies: opts.copies || {},
    asked: [],
    askReleaseCopies: (t) => env.asked.push(t),
    putJson: (p, o) => { fs.writeFileSync(p, JSON.stringify(o, null, 2)); return true; },
    log: []
  };
  const quiet = { log: (m) => env.log.push(m), error: (m) => env.log.push(m) };
  const make = new Function('env', 'console',
    'const { ROOT, NEWS, path, fs, crypto, https, feedFile, readJsonQuiet, feedReleaseTag, releaseCopies, askReleaseCopies, putJson } = env;\n' +
    block + '\nreturn { publicNews, refreshNews, newsDay, NEWS_KEEP };');
  env.api = make(env, quiet);
  env.setFeed = (doc, n) => {
    const f = path.join(root, 'feed', 'version', String(n || 1).padStart(8, '0') + '.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(doc));
    env.feed = f;
  };
  env.page = () => { try { return JSON.parse(fs.readFileSync(env.NEWS, 'utf8')); } catch (e) { return null; } };
  return env;
}

async function main() {
  // ---- 1. the cleaning --------------------------------------------------
  const notes = [
    { date: '11-1-2026 10:11 AM', title: 'Server updated', body: 'The server at 203.0.113.7 was reinstalled and is answering.',
      details: ['Load order: 60 plugins server side'] },
    { date: '11-1-2026 9:00 AM', title: 'Your gear and your spells stay on across a relog',
      body: 'The server at 203.0.113.7 was reinstalled and is answering.',
      details: ['The gamemode was rebuilt: starting kits live in it', 'Load order: 60 plugins server side',
                'Nothing to download for this one. It is on the server, so it is already live.'],
      files: ['Data/SKSE/Plugins/x.ini'] },
    { date: '10-31-2026 8:00 PM', title: 'Your gear and spells stay on across a relog', details: ['An older copy.'] },
    { date: '10-30-2026 1:00 PM', title: 'The mod list has a new revision',
      body: 'Before you press Play, update the Thornswood collection in Vortex.',
      details: ['Launcher 1.1.80', '1 file to download, 0.0 MB', 'Launcher rebuilt: Updater.cs',
                'Data\\SKSE\\Plugins\\x.ini changed', 'The load order moved, so start a new character'] },
    { date: '23 Sep 2026', title: 'Doors you own open for you again', details: 'Your key works on your own door.' },
    { date: 'someday', title: 'A note with an odd date' },
    { date: '9-14-2026 1:00 PM', title: 'Development history before the cutoff' },
    { date: '9-20-2026', title: 'wip' }
  ];
  let t = load({});
  const doc = { launcherVersion: '2026.1101.1609', collectionUrl: 'https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf',
                collectionRevision: 6, news: [] };
  const page = t.api.publicNews(doc, notes, new Date('2026-11-01T21:00:00Z'));
  const titles = page.news.map((n) => n.title);
  const lines = [].concat(...page.news.map((n) => n.details));
  const words = JSON.stringify(page);
  yes('a bare Server updated and a "wip" do not reach the page', !titles.includes('Server updated') && !titles.includes('wip'));
  yes('the named server release does, with the line people want', titles[0] === 'Your gear and your spells stay on across a relog' &&
      page.news[0].details.length === 1 && /Nothing to download/.test(page.news[0].details[0]));
  yes('and its body is empty rather than a note to whoever ran it', page.news[0].body === '');
  yes('a near repeat of a release is shown once, the newest', !titles.includes('Your gear and spells stay on across a relog'));
  yes('no load order count, no "gamemode was rebuilt", no launcher version, size, build note or path',
      !lines.some((l) => /^\s*Load order\s*:|gamemode was rebuilt|^Launcher \d|files? to download|Launcher rebuilt|[\\/]SKSE[\\/]/i.test(l)));
  yes('no address of any server is on the page', !/\b\d{1,3}(\.\d{1,3}){3}\b/.test(words));
  yes('a line for the reader that names the load order still goes out', lines.includes('The load order moved, so start a new character'));
  yes('a body written for people still goes out', page.news.some((n) => n.body === 'Before you press Play, update the Thornswood collection in Vortex.'));
  const doors = page.news.find((n) => n.title === 'Doors you own open for you again');
  yes('a lone detail is a list of one', doors && Array.isArray(doors.details) && doors.details.length === 1);
  yes('a note with an odd date is kept, one before 15 Sep 2026 is not', titles.includes('A note with an odd date') &&
      !titles.includes('Development history before the cutoff'));
  yes('no file list goes', !page.news.some((n) => 'files' in n));
  yes('the launcher, and the collection at the revision the server was built against (#4115)',
      page.launcher === '2026.1101.1609' && page.collectionRevision === 6 &&
      page.collection === 'https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf/revisions/6');
  const many = Array.from({ length: 20 }, (_, i) => ({ date: '10-' + (i + 1) + '-2026', title: 'Note ' + i + ' ' + 'apple pear plum fig lime kiwi date yuzu sloe quince lemon melon grape olive peach cherry mango guava papaya'.split(' ')[i] }));
  yes('at most twelve', t.api.publicNews({ news: many }, [], new Date()).news.length === t.api.NEWS_KEEP && t.api.NEWS_KEEP === 12);
  yes('"news" in the feed comes first and a note in both is shown once', (() => {
    const p = t.api.publicNews({ news: [notes[3]] }, [notes[3], notes[4]], new Date());
    return p.news.length === 2 && p.news[0].title === notes[3].title; })());
  yes('a month-first date, an ISO date and "23 Sep 2026" all read', t.api.newsDay('11-1-2026 10:11 AM') === Date.UTC(2026, 10, 1) &&
      t.api.newsDay('2026-09-15') === Date.UTC(2026, 8, 15) && t.api.newsDay('23 Sep 2026') === Date.UTC(2026, 8, 23));

  // ---- 2. the site's own copy of the news file ---------------------------
  const file = Buffer.from(JSON.stringify(notes));
  const S = sha(file);
  let calls = [];
  t = load({ calls, tag: 'release/main/20261101-101056' });
  fs.writeFileSync(path.join(t.ROOT, 'feed', 'assets', S), file);
  t.setFeed(Object.assign({}, doc, { newsFile: { sha256: S, count: notes.length } }), 1);
  await t.api.refreshNews();
  yes('with the site holding the news file, the page is written from it and GitHub is not asked',
      t.page() && t.page().news[0].title === 'Your gear and your spells stay on across a relog' && calls.length === 0 && t.asked.length === 0);
  fs.unlinkSync(t.NEWS);
  await t.api.refreshNews();
  yes('the same feed is not read again', t.page() === null);
  t.setFeed(Object.assign({}, doc, { launcherVersion: '2026.1101.1700', newsFile: { sha256: S, count: notes.length } }), 2);
  await t.api.refreshNews();
  yes('a new feed is', t.page() && t.page().launcher === '2026.1101.1700');

  // ---- 3. the Release's copy ---------------------------------------------
  const TAG = 'release/main/20261101-101056';
  const DL = 'https://github.com/ThornswoodRP/Thornswood/releases/download/' + TAG + '/' + S;
  const CDN = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/x?sig=y';
  calls = [];
  t = load({ calls, tag: TAG, copies: {},
    answer: (u) => u === DL ? { status: 302, location: CDN } : u === CDN ? { status: 200, body: file } : null });
  t.setFeed(Object.assign({}, doc, { newsFile: { sha256: S, count: notes.length } }), 1);
  fs.writeFileSync(t.NEWS, JSON.stringify({ launcher: 'old', news: [{ title: 'The last release' }] }));
  await t.api.refreshNews();
  yes('while the Release does not hold the news file, the page stays as it was and the Release is asked about',
      t.page().launcher === 'old' && t.asked[0] === TAG && calls.length === 0);
  t.releaseCopies[TAG] = { files: { [S]: { url: DL, size: file.length } } };
  await t.api.refreshNews();
  yes('once it does, the file is fetched through GitHub\'s redirect and the page written', t.page().launcher === '2026.1101.1609' &&
      calls.length === 2 && calls[0] === DL && calls[1] === CDN);

  for (const [what, answer, size] of [
    ['bytes that are not its sha256', (u) => u === DL ? { status: 200, body: Buffer.from('[]') } : null, 2],
    ['another size than the Release says', (u) => u === DL ? { status: 200, body: file } : null, file.length - 1],
    ['a redirect off GitHub\'s hosts', (u) => u === DL ? { status: 302, location: 'https://evil.example/news' } : null, file.length]]) {
    calls = [];
    t = load({ calls, tag: TAG, copies: { [TAG]: { files: { [S]: { url: DL, size } } } }, answer });
    t.setFeed(Object.assign({}, doc, { newsFile: { sha256: S } }), 1);
    await t.api.refreshNews();
    yes('a Release copy with ' + what + ' writes nothing, and says why', t.page() === null &&
        t.log.some((l) => /news: release\/main/.test(l)) && !calls.some((u) => new URL(u).host === 'evil.example'));
  }
  const site = siteFiles.source();
  yes('the site asks for its news every minute and once it starts', /setInterval\(refreshNews, NEWS_LOOK_MS\)/.test(site) &&
      /setImmediate\(refreshNews\)/.test(site) && /const NEWS_LOOK_MS = 60 \* 1000;/.test(site));

  // ---- 4. nothing else writes it -----------------------------------------
  yes('Publish-News.ps1 is gone', !fs.existsSync(path.join(REPO, 'scripts', 'ops', 'Publish-News.ps1')));
  for (const f of ['scripts/release/Ship.ps1', 'scripts/release/Clear-News.ps1', 'scripts/release/Publish-PostShip.ps1']) {
    const text = fs.readFileSync(path.join(REPO, f), 'utf8');
    yes(f + ' runs no Publish-News', !/Publish-News\.ps1'/.test(text) && !/& \$news(Script)?\b/.test(text));
  }
}

main().then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}, (e) => { console.log('FAIL  ' + (e && e.stack)); process.exit(1); });
