/*
  The News page, which the site writes itself from the notes of the build
  Releases main has reached (#5187, #5801).
*/

'use strict';

const { DATA } = require('./base');
const path = require('path');
const { feedFile, newestSetup, readJsonQuiet, releaseNotes } = require('./feed');
const { putJson } = require('./store');

/* The site's News page, /api/public's news and the Downloads page's launcher
   number read this file, and the site writes it itself. Before #5187,
   Publish-News.ps1 sent it over ssh at the end of a main Ship. */
const NEWS = path.join(DATA, 'news.json');

/* ---- news from the Release (#5187) ----
   NEWS COMES FROM THE BUILD RELEASES (#5801). Every merge that changes what
   Thornswood ships makes one build Release on GitHub, "Release build-1.3.<n>",
   whose body is the note people read (merge-release.yml, THE NOTES), and a
   promotion Patrick approves puts main on one of them (promote-main.yml, the
   Release main-build-1.3.<n>, which carries main's setup program). The page
   is the notes of the build Releases at or before the one main runs, newest
   first: the list a main launcher's News tab shows (launcher\app\ReleaseNews.cs),
   read the same way (newsOf, noteOf).

   Until 11 Nov 2026 the page was the main feed's news file, which only a Ship
   wrote. Releases stopped going through a Ship when the launcher moved to
   Velopack on 2 Nov, so the page stopped at that day's Ship ("Launcher
   2026.1102.716 is current") while build-1.3.4, 1.3.7 and 1.3.20 went to main
   after it. The same cause stalled the collection revision (#5767).

   Which release main runs is the site's one answer to that, the Release of
   main's setup program (feed.js newestSetup), which the Downloads page hands
   out and whose record the collection revision comes from (serverRevision).
   The launcher asks the Deployment to Main instead; the site's token reads
   contents only, and promote-main.yml makes the Release and the Deployment in
   the same step. The notes come from the list of the newest hundred Releases
   the site already holds for launchers (feed.js releaseNotes), so the page
   asks GitHub nothing of its own. Each NEWS_LOOK_MS the page is made again
   from what is held, and written only when it changed. While GitHub has not
   answered yet the last page stays.

   The collection link on the Downloads page still takes the collection's
   address from the main feed, the one thing left there, and its revision from
   main's Release (serverRevision); #5783 takes the feed off the site. */
const NEWS_KEEP = 12;
const NEWS_LOOK_MS = 60 * 1000;
// merge-release.yml's QUIET_NOTE: every release is news (Patrick, 9 Nov), and
// an empty body, or the line Releases before 9 Nov carried, reads as this.
const NEWS_QUIET = 'Various bug fixes and improvements';
const NEWS_WAS_NOTHING = /^\s*nothing people would notice\b/i;
const NEWS_NUMBER_TAG = /^build-1\.3\.(\d{1,5})$/;
const NEWS_DATE_TAG = /^build-(\d{8})\.(\d{1,9})$/;
// Patrick's clock, the one the page always showed (the Ships ran on One).
const NEWS_ZONE = 'America/Denver';

// A build tag as a number that sorts the way the Releases were made, as
// ReleaseNews.cs BuildKey: build-1.3.<n> by n, after every
// build-<yyyyMMdd>.<n> from 1 to 8 Nov 2026, those by the day, then the
// day's count. -1n for anything else.
function newsKey(tag) {
  const s = String(tag || '');
  let m = NEWS_NUMBER_TAG.exec(s);
  if (m) return 100000000000000000n + BigInt(m[1]);
  m = NEWS_DATE_TAG.exec(s);
  if (m) return BigInt(m[1]) * 1000000000n + BigInt(m[2]);
  return -1n;
}
// The launcher number a build tag is: build-1.3.20 is 1.3.20, and
// build-20261108.2 is 2026.1108.2 (feed.js nativeTag, the other way).
function newsVersion(tag) {
  const s = String(tag || '');
  let m = NEWS_NUMBER_TAG.exec(s);
  if (m) return '1.3.' + Number(m[1]);
  m = NEWS_DATE_TAG.exec(s);
  if (m) return m[1].slice(0, 4) + '.' + Number(m[1].slice(4, 8)) + '.' + Number(m[2]);
  return '';
}
// When a Release went out, "11-11-2026 4:46 AM" in NEWS_ZONE, or '' when
// GitHub gave no time.
function newsDate(published) {
  const t = Date.parse(String(published || ''));
  if (!Number.isFinite(t)) return '';
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: NEWS_ZONE, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(t))) parts[p.type] = p.value;
  return parts.month + '-' + parts.day + '-' + parts.year + ' ' + parts.hour + ':' + parts.minute + ' ' +
    String(parts.dayPeriod || '').toUpperCase();
}
// One Release's body as a note, as ReleaseNews.cs NoteOf reads it: the first
// line is the title, each "- " line after it one line of what changed, any
// other line the note's text.
function noteOf(body, published) {
  let text = String(body || '');
  if (!text.trim() || NEWS_WAS_NOTHING.test(text)) text = NEWS_QUIET;
  let title = '';
  const details = [], lines = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.startsWith('- ');
    const said = bullet ? line.slice(2).trim() : line;
    if (!said) continue;
    if (!title) title = said;
    else if (bullet) details.push(said);
    else lines.push(said);
  }
  return { date: newsDate(published), title, body: lines.join('\n'), details };
}
// The notes of the build Releases at or before on, newest first, at most
// NEWS_KEEP, as ReleaseNews.cs NewsOf picks them: published, a build tag, and
// the title merge-release.yml gives a Release with notes, "Release " and its
// tag.
function newsOf(releases, on) {
  const top = newsKey(on);
  if (!Array.isArray(releases) || top < 0n) return [];
  const picked = [], seen = new Set();
  for (const r of releases) {
    if (!r || r.draft) continue;
    const k = newsKey(r.tag);
    if (k < 0n || k > top || seen.has(k)) continue;
    if (r.name !== 'Release ' + r.tag) continue;
    seen.add(k);
    picked.push({ k, note: noteOf(r.body, r.published_at) });
  }
  picked.sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : 0));
  return picked.slice(0, NEWS_KEEP).map((p) => p.note);
}
// The collection the Downloads page links, from the main feed's collectionUrl
// at its collectionRevision (#4115). downloads.js puts main's Release's
// revision on it (#5767).
function feedCollection(doc) {
  let collection = String((doc && doc.collectionUrl) || '');
  let collectionRevision = parseInt(doc && doc.collectionRevision, 10) || 0;
  const cm = /^(.*?\/collections\/[A-Za-z0-9]+)([/?#].*)?$/.exec(collection);
  if (collectionRevision > 0 && cm) collection = cm[1] + '/revisions/' + collectionRevision;
  else collectionRevision = 0;
  return { collection, collectionRevision };
}
// The page: main's launcher number, the collection, and the notes.
function publicNews(releases, mainTag, doc, now) {
  const on = String(mainTag || '').replace(/^main-/, '');
  const c = feedCollection(doc);
  return { launcher: newsVersion(on), collection: c.collection, collectionRevision: c.collectionRevision,
           at: now.toISOString(), news: newsOf(releases, on) };
}
let newsWritten = '';    // the page last written, less its time
let newsBusy = false;
async function refreshNews() {
  if (newsBusy) return;
  newsBusy = true;
  try {
    const main = newestSetup('main');
    if (!main || typeof main.tag !== 'string') return;    // GitHub not answered yet: asked again next time
    const releases = await releaseNotes();
    if (!releases) return;
    const file = feedFile('feed');
    const page = publicNews(releases, main.tag, file ? readJsonQuiet(file) : null, new Date());
    const same = JSON.stringify(Object.assign({}, page, { at: '' }));
    if (same === newsWritten) return;
    if (!putJson(NEWS, page)) { console.error('[thornswood-docs] news: could not write ' + NEWS); return; }
    newsWritten = same;
    console.log('[thornswood-docs] news: ' + page.news.length + ' entries, main on ' + main.tag);
  } catch (e) {
    console.error('[thornswood-docs] news: ' + (e && e.message));
  } finally {
    newsBusy = false;
  }
}
/* ---- end news from the Release ---- */
setInterval(refreshNews, NEWS_LOOK_MS).unref?.();
setImmediate(refreshNews);

Object.assign(module.exports, { NEWS });
