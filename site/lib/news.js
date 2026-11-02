/*
  The News page, which the site writes itself from the main feed's news
  file (#5187).
*/

'use strict';

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { DATA, ROOT } = require('./base');
const { askReleaseCopies, feedFile, feedReleaseTag, readJsonQuiet,
  releaseCopies } = require('./feed');
const { putJson } = require('./store');

/* The site's News page and /api/releases read this file, and the site writes
   it itself (#5187) from the main feed it serves and that feed's news file,
   which is also on the release's GitHub Release. Before, Publish-News.ps1
   sent it over ssh at the end of a main Ship, and a Ship stopped before that
   step left the page a release behind. */
const NEWS    = path.join(DATA, 'news.json');

/* ---- news from the Release (#5187) ----
   NEWS COMES FROM THE FEED'S NEWS FILE. The main feed (feedFile('feed'))
   names its notes as "newsFile", one file named by its sha256, which every
   feed edit sends into this site's feed/assets with the feed, and which
   release-files.yml puts on the release's GitHub Release with the rest
   (release copies, above). Each NEWS_LOOK_MS the site looks at the newest
   main feed: when it or its news file is not the one news.json was last
   written from, the news file is read (this site's copy while it holds those
   bytes, the Release's copy when it does not), checked against its sha256,
   cleaned for strangers (publicNews) and written to news.json. A news file
   the site does not hold and the Release does not hold yet keeps the last
   page, and is asked about again next time; GitHub is asked only through
   askReleaseCopies, inside its sixty unsigned calls an hour. A feed whose
   notes are all in "news" (no news file) needs neither.
   tests/test-5187-site-news.js drives this block.

   CLEANED FOR STRANGERS. The launcher's notes are written for somebody who
   already plays: paths, launcher versions, near repeats of one release. The
   public copy drops those lines and keeps the newest NEWS_KEEP; nothing is
   reworded (the title Ship asks for is what the world reads). This was
   Publish-News.ps1's job, which this replaces. */
const NEWS_KEEP = 12;
// Everything dated before this is development history and stays off the page.
const NEWS_FROM = Date.UTC(2026, 8, 15);
const NEWS_LOOK_MS = 60 * 1000;
// Lines that mean something to the team and nothing to anybody else: which
// launcher files changed, the version (already shown), the download size,
// anything that is a path, and the two lines Publish-Server used to write
// into every server entry.
const NEWS_NOISE = [/^\s*Launcher rebuilt\s*:/i, /^\s*Launcher \d+\.\d+/i, /files? to download/i,
                    /[\\/](SKSE|Data|tools)[\\/]/i, /^\s*Load order\s*:/i, /^\s*The gamemode was rebuilt\b/i];
const NEWS_DULL = [/^server updated\.?$/i, /^no corner box\.?$/i, /^fixes?\.?$/i, /^wip\.?$/i];
// A note's date as the feed writes it ("11-1-2026 10:11 AM", month first),
// as ISO or as "23 Sep 2026", in milliseconds; NaN when it is none of them,
// and such a note is kept, since dropping one because its date was odd is
// worse than showing it.
function newsDay(s) {
  const t = String(s || '').trim();
  let m = /^(\d{1,2})-(\d{1,2})-(\d{4})\b/.exec(t);
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
  m = /^(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  // "23 Sep 2026", as hand-written notes had it.
  m = /^(\d{1,2}) ([A-Za-z]{3})[A-Za-z]* (\d{4})\b/.exec(t);
  const mon = m ? 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[2].toLowerCase()) : -1;
  if (mon >= 0 && mon % 3 === 0) return Date.UTC(+m[3], mon / 3, +m[1]);
  return NaN;
}
// Two titles are one release when seven in ten of their words are shared:
// six near identical titles in one afternoon is one entry to a reader, and
// the newest, which comes first, is the one that shipped.
function newsWords(t) {
  return Array.from(new Set(String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)));
}
function newsSame(a, b) {
  const wa = newsWords(a), wb = newsWords(b);
  if (!wa.length || !wb.length) return false;
  const set = new Set(wb);
  const hit = wa.filter((w) => set.has(w)).length;
  const union = wa.length + wb.length - hit;
  return union > 0 && hit / union >= 0.7;
}
function newsList(v) {
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined);
  return v === null || v === undefined || v === '' ? [] : [v];
}
// The page from the feed's own document and the notes of its news file:
// "news" first, then the file's that "news" does not have, each once by date
// and title, as the launcher reads them.
function publicNews(doc, fileNotes, now) {
  const all = [], seen = new Set();
  for (const n of newsList(doc && doc.news).concat(newsList(fileNotes))) {
    if (!n || typeof n !== 'object') continue;
    const key = String(n.date || '') + '\n' + String(n.title || '');
    if (seen.has(key)) continue;
    seen.add(key); all.push(n);
  }
  const news = [];
  for (const n of all) {
    const title = String(n.title || '').trim();
    if (!title) continue;
    const day = newsDay(n.date);
    if (day < NEWS_FROM) continue;
    if (NEWS_DULL.some((re) => re.test(title))) continue;
    if (news.some((x) => newsSame(x.title, title))) continue;
    const details = newsList(n.details).map(String)
      .filter((line) => line.trim() && !NEWS_NOISE.some((re) => re.test(line)));
    // "The server at <address> was reinstalled and is answering" was a note to
    // whoever ran Publish-Server, with the box's address in it.
    let body = String(n.body || '');
    if (/^\s*The server at \S+ was reinstalled and is answering\.?\s*$/i.test(body)) body = '';
    // The file list never goes: a hundred lines of paths.
    news.push({ date: String(n.date || ''), title, body, details });
    if (news.length >= NEWS_KEEP) break;
  }
  // The collection rides along because the Downloads page links it and the
  // feed is the only place it is set, with the revision the server was built
  // against so Nexus does not show a newer one (#4115).
  let collection = String((doc && doc.collectionUrl) || '');
  let collectionRevision = parseInt(doc && doc.collectionRevision, 10) || 0;
  const cm = /^(.*?\/collections\/[A-Za-z0-9]+)([/?#].*)?$/.exec(collection);
  if (collectionRevision > 0 && cm) collection = cm[1] + '/revisions/' + collectionRevision;
  else collectionRevision = 0;
  return { launcher: String((doc && doc.launcherVersion) || ''), collection, collectionRevision,
           at: now.toISOString(), news };
}
// The bytes at a Release copy's address, or why not. GitHub answers it with a
// redirect to its download host; only GitHub's own hosts are followed, at
// most three times, and what comes back must be the size and sha256 the
// Release gave.
const NEWS_HOSTS = /^(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)$/;
function newsFetch(url, sha, size, hops) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ why: 'not an address: ' + url }); }
    if (u.protocol !== 'https:' || !NEWS_HOSTS.test(u.hostname)) return resolve({ why: 'not one of GitHub\'s download hosts: ' + u.hostname });
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const req = https.get(u, { headers: { 'user-agent': 'thornswood-site' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if ((hops || 0) >= 3) return settle({ why: 'more than three redirects' });
        return newsFetch(new URL(res.headers.location, u).toString(), sha, size, (hops || 0) + 1).then(settle);
      }
      if (res.statusCode !== 200) { res.resume(); return settle({ why: 'GitHub answered ' + res.statusCode }); }
      const parts = []; let got = 0;
      res.on('data', (d) => { got += d.length; if (got > size) { req.destroy(); settle({ why: 'more bytes than the Release says' }); } else parts.push(d); });
      res.on('error', (e) => settle({ why: e.message }));
      res.on('end', () => {
        const body = Buffer.concat(parts);
        if (body.length !== size) return settle({ why: 'the file is ' + body.length + ' bytes, not ' + size });
        if (crypto.createHash('sha256').update(body).digest('hex') !== sha) return settle({ why: 'the file is not its sha256' });
        settle({ body });
      });
    });
    const timer = setTimeout(() => { settle({ why: 'GitHub did not send it inside twenty seconds' }); req.destroy(); }, 20000);
    req.on('error', (e) => settle({ why: 'could not reach GitHub: ' + e.message }));
  });
}
let newsMadeFrom = '';    // the feed file and news file news.json was last written from
let newsBusy = false;
let newsLastWhy = '';
async function refreshNews() {
  if (newsBusy) return;
  newsBusy = true;
  try {
    const file = feedFile('feed');
    const doc = file ? readJsonQuiet(file) : null;
    if (!doc) return;
    const ptr = doc.newsFile;
    const sha = ptr && /^[0-9a-f]{64}$/.test(String(ptr.sha256 || '')) ? String(ptr.sha256) : '';
    const from = file + '|' + sha;
    if (from === newsMadeFrom) return;
    let notes = [];
    if (sha) {
      let body = null;
      // The site's own copy, which every feed edit sends with the feed, when
      // it holds it and it is still those bytes; else the Release's.
      const own = path.join(ROOT, 'feed', 'assets', sha);
      if (fs.existsSync(own)) {
        const b = fs.readFileSync(own);
        if (crypto.createHash('sha256').update(b).digest('hex') === sha) body = b;
      }
      if (!body) {
        const tag = feedReleaseTag('feed');
        const c = tag ? (askReleaseCopies(tag), releaseCopies[tag]) : null;
        const f = c && c.files && c.files[sha];
        if (!f) return;    // not on the Release yet: asked again next time
        const got = await newsFetch(f.url, sha, f.size, 0);
        if (!got.body) {
          if (got.why !== newsLastWhy) console.error('[thornswood-docs] news: ' + tag + ': ' + got.why);
          newsLastWhy = got.why;
          return;
        }
        body = got.body;
      }
      const text = body.toString('utf8').replace(/^﻿/, '');
      notes = text.trim() ? JSON.parse(text) : [];
    }
    const page = publicNews(doc, notes, new Date());
    if (!putJson(NEWS, page)) { console.error('[thornswood-docs] news: could not write ' + NEWS); return; }
    newsMadeFrom = from; newsLastWhy = '';
    console.log('[thornswood-docs] news: ' + page.news.length + ' entries from ' + path.basename(file) + (sha ? ' and its Release' : ''));
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
