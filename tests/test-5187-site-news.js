'use strict';
// test-5187-site-news.js
//
//     node tests\test-5187-site-news.js
//
// #5187, #5801: the site writes its own News page. Until 11 Nov 2026 it read
// the main feed's news file, which only a Ship writes, and releases stopped
// going through a Ship on 2 Nov, so the page stayed on that day's Ship while
// main moved on. Now the page is the notes of the build Releases at or before
// the one main runs (the Release of main's setup program), read the way the
// launcher's News tab reads them (launcher\app\ReleaseNews.cs).
//
// The "news from the Release" block is lifted out of the site by its markers
// and run against a temp folder standing in for the site's data, with the
// Release list and main's setup program given here. Checks:
//   - a Release's body is a note as NoteOf reads it: first line the title,
//     "- " lines the details, other lines the text; empty or the old
//     nothing line is the quiet note;
//   - only published "Release <tag>" build Releases at or before main's go,
//     newest first by build number, date tags before 1.3.x, at most twelve;
//   - the launcher number is main's: main-build-1.3.20 is 1.3.20, and a date
//     tag reads as its date number;
//   - the date is Patrick's clock;
//   - the collection still comes from the feed at its revision (#4115);
//   - nothing is written before GitHub has answered; a new main writes a new
//     page, and the same one is not written again;
//   - the block reads no feed news file and asks GitHub nothing of its own;
//   - nothing else writes news.json: Publish-News.ps1 is gone and Ship and
//     Clear-News name it no more.
// Writes only under its own temp folder.
const fs = require('fs'), path = require('path'), os = require('os');
const siteFiles = require('./site-files');
const REPO = path.join(__dirname, '..');
const server = siteFiles.source();

let pass = 0, fail = 0;
function yes(what, cond) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + what);
  if (cond) pass++; else fail++;
}

const from = server.indexOf('/* ---- news from the Release (#5187) ----');
const to = server.indexOf('/* ---- end news from the Release ---- */');
yes('the news block is in the site, between its markers', from >= 0 && to > from);
if (from < 0 || to <= from) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
const block = server.slice(from, to);

function load(opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-5801-news-'));
  const env = {
    NEWS: path.join(root, 'news.json'),
    setup: opts.setup || null,
    releases: opts.releases || null,
    feed: opts.feed || null,
    newestSetup: (ch) => { env.askedSetup.push(ch); return env.setup; },
    releaseNotes: async () => env.releases,
    feedFile: () => (env.feed ? 'feed.json' : null),
    readJsonQuiet: () => env.feed,
    putJson: (p, o) => { env.writes++; fs.writeFileSync(p, JSON.stringify(o, null, 2)); return true; },
    askedSetup: [], writes: 0, log: []
  };
  const quiet = { log: (m) => env.log.push(m), error: (m) => env.log.push(m) };
  const make = new Function('env', 'console',
    'const { NEWS, newestSetup, releaseNotes, feedFile, readJsonQuiet, putJson } = env;\n' +
    block + '\nreturn { publicNews, refreshNews, noteOf, newsOf, newsKey, newsVersion, newsDate, NEWS_KEEP, NEWS_QUIET };');
  env.api = make(env, quiet);
  env.page = () => { try { return JSON.parse(fs.readFileSync(env.NEWS, 'utf8')); } catch (e) { return null; } };
  return env;
}
const rel = (tag, body, at, name) => ({ tag, name: name === undefined ? 'Release ' + tag : name, body, published_at: at });

async function main() {
  // ---- 1. one Release as a note -----------------------------------------
  let t = load({});
  const n = t.api.noteOf('Restarts are announced on Discord\n- Before the server restarts, #updates says when.\nAnd one plain line.\r\n- A second change.\n',
    '2026-11-11T21:20:11Z');
  yes('the first line is the title, "- " lines the details, any other line the text',
      n.title === 'Restarts are announced on Discord' && n.details.length === 2 && n.details[1] === 'A second change.' &&
      n.body === 'And one plain line.');
  yes('the date is Patrick\'s clock, month first, 12 hour', n.date === '11-11-2026 2:20 PM');
  yes('a morning time reads AM', t.api.newsDate('2026-11-11T11:46:09Z') === '11-11-2026 4:46 AM');
  yes('an empty body is the quiet note', t.api.noteOf('', null).title === t.api.NEWS_QUIET && t.api.noteOf('', null).date === '');
  yes('the old nothing line is the quiet note', t.api.noteOf('Nothing people would notice in this one.', null).title === t.api.NEWS_QUIET);
  yes('the quiet note is merge-release.yml\'s', t.api.NEWS_QUIET === 'Various bug fixes and improvements' &&
      fs.readFileSync(path.join(REPO, 'launcher', 'app', 'ReleaseNews.cs'), 'utf8').includes('QuietNote = "Various bug fixes and improvements"'));

  // ---- 2. which Releases go ---------------------------------------------
  const list = [
    rel('main-build-1.3.20', 'Main\'s launcher and game files from build-1.3.20.', '2026-11-11T18:12:16Z', 'Main build-1.3.20'),
    rel('agent-v1.0.131', 'The box deploy agent.', '2026-11-11T21:44:52Z', 'Deploy agent 1.0.131'),
    rel('build-1.3.26', 'Clearer install guide on the site', '2026-11-11T22:34:46Z'),
    rel('build-1.3.21', '', '2026-11-11T06:24:59Z'),
    rel('build-1.3.20', 'The launcher knows which collection revision the server runs\n- From the Release.', '2026-11-11T04:46:09Z'),
    rel('build-1.3.9', 'Front page stays still', '2026-11-09T15:36:19Z'),
    rel('build-1.3.10', 'Ten', '2026-11-09T16:00:00Z'),
    rel('build-1.3.8', 'A gamemode only build', '2026-11-09T13:00:00Z', 'Gamemode build-1.3.8'),
    rel('build-20261108.2', 'Sharper eyes', '2026-11-08T19:16:00Z'),
    rel('build-20261102.7', 'The character choice', '2026-11-02T17:11:00Z'),
    rel('release/main/20261031-144725', 'The files of a main release.', '2026-10-31T14:47:25Z', 'Thornswood main release 20261031-144725')
  ];
  let news = t.api.newsOf(list, 'build-1.3.20');
  yes('only build Releases at or before main\'s, newest first by number (1.3.10 after 1.3.9), date tags last',
      JSON.stringify(news.map((x) => x.title)) === JSON.stringify(['The launcher knows which collection revision the server runs', 'Ten',
        'Front page stays still', 'Sharper eyes', 'The character choice']));
  yes('a newer dev build is not on main\'s page', !news.some((x) => /Clearer install guide/.test(x.title)) &&
      !news.some((x) => x.title === t.api.NEWS_QUIET));
  yes('a Release not titled "Release <tag>" is left out (gamemode builds, main\'s, the agent\'s, the old release copies)',
      !news.some((x) => /gamemode|Main's|agent|files of/i.test(x.title)));
  news = t.api.newsOf(list, 'build-1.3.26');
  yes('a quiet Release is on the page as the quiet note: every release is news', news[0].title === 'Clearer install guide on the site' &&
      news[1].title === t.api.NEWS_QUIET);
  const many = Array.from({ length: 20 }, (_, i) => rel('build-1.3.' + i, 'Note ' + i, '2026-11-10T00:00:00Z'));
  news = t.api.newsOf(many, 'build-1.3.19');
  yes('at most twelve, the newest', t.api.NEWS_KEEP === 12 && news.length === 12 && news[0].title === 'Note 19' && news[11].title === 'Note 8');
  yes('a tag that is no build tag gives no notes', t.api.newsOf(list, 'v2026.1102.716').length === 0);
  yes('a build number and a date number sort the way the Releases were made',
      t.api.newsKey('build-1.3.0') > t.api.newsKey('build-20261108.9') && t.api.newsKey('build-1.3.10') > t.api.newsKey('build-1.3.9') &&
      t.api.newsKey('build-20261108.2') > t.api.newsKey('build-20261102.7') && t.api.newsKey('main-build-1.3.2') === -1n);
  yes('the launcher number is the build\'s', t.api.newsVersion('build-1.3.20') === '1.3.20' && t.api.newsVersion('build-20261108.2') === '2026.1108.2');

  // ---- 3. the page ------------------------------------------------------
  const feed = { launcherVersion: '2026.1102.716', collectionUrl: 'https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf',
                 collectionRevision: 8, news: [{ date: '11-2-2026 12:16 PM', title: 'From the feed' }],
                 newsFile: { sha256: 'a'.repeat(64) } };
  const page = t.api.publicNews(list, 'main-build-1.3.20', feed, new Date('2026-11-11T23:00:00Z'));
  yes('main\'s launcher, not the feed\'s', page.launcher === '1.3.20');
  yes('no note from the feed', !page.news.some((x) => x.title === 'From the feed') && page.news.length === 5);
  yes('the collection from the feed at its revision (#4115)', page.collectionRevision === 8 &&
      page.collection === 'https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf/revisions/8');
  const bare = t.api.publicNews(list, 'main-build-1.3.20', null, new Date());
  yes('with no feed the notes and the launcher are still there, and no collection', bare.news.length === 5 && bare.launcher === '1.3.20' &&
      bare.collection === '' && bare.collectionRevision === 0);

  // ---- 4. writing it ----------------------------------------------------
  t = load({ releases: list, feed });
  fs.writeFileSync(t.NEWS, JSON.stringify({ launcher: 'old', news: [{ title: 'The last page' }] }));
  await t.api.refreshNews();
  yes('before GitHub has said what main runs, the page stays as it was', t.page().launcher === 'old' && t.askedSetup[0] === 'main');
  t.setup = { tag: 'main-build-1.3.20' };
  t.releases = null;
  await t.api.refreshNews();
  yes('before the Release list has been read, the page stays as it was', t.page().launcher === 'old');
  t.releases = list;
  await t.api.refreshNews();
  yes('once both have, the page is written from main\'s Release', t.page().launcher === '1.3.20' &&
      t.page().news[0].title === 'The launcher knows which collection revision the server runs' && t.writes === 1);
  await t.api.refreshNews();
  yes('the same page is not written again', t.writes === 1);
  t.setup = { tag: 'main-build-1.3.26' };
  await t.api.refreshNews();
  yes('a new main is', t.writes === 2 && t.page().launcher === '1.3.26' && t.page().news[0].title === 'Clearer install guide on the site');
  t.releases = [rel('build-1.3.26', 'Clearer install guide on the site\n- Edited on GitHub.', '2026-11-11T22:34:46Z')].concat(list.slice(3));
  await t.api.refreshNews();
  yes('and so is a note edited on its Release', t.writes === 3 && t.page().news[0].details[0] === 'Edited on GitHub.');

  yes('the block reads no feed news file and asks GitHub nothing of its own',
      !/newsFile|askReleaseCopies|assetLocation|https\.get|releaseGitHub/.test(block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
  const site = siteFiles.source();
  yes('the site makes its page every minute and once it starts', /setInterval\(refreshNews, NEWS_LOOK_MS\)/.test(site) &&
      /setImmediate\(refreshNews\)/.test(site) && /const NEWS_LOOK_MS = 60 \* 1000;/.test(site));
  yes('the Release list keeps each Release\'s title, note and time for it (feed.js releaseNotes)',
      /notes\.push\(\{ tag: r\.tag_name, name: [^\n]*body: [^\n]*\n\s*published_at: r\.published_at/.test(site) &&
      /async function releaseNotes\(\)/.test(site));

  // ---- 5. nothing else writes it -----------------------------------------
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
