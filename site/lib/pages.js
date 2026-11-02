/*
  The written pages: the documents and boards, the public pages and their
  blurbs, the markdown renderer, the Known Issues and Roadmap lists the bot
  builds, the lore lines and the credits.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { fillCreditsCommits, fillLoreLine, fillPage, pageHtml,
  pageMarkdown, readLines, roadmapBoard };

const fs     = require('fs');
const path   = require('path');
const { DATA, PUBLIC } = require('./base');
const { cfg, forMode } = require('./config');

// --------------------------------------------------------------- content --
/* Prose pages. Markdown, because they are read start to finish and a table
   would be the wrong shape for either. */
const DOCS = {
  tests: 'Test These',
  help:  'Help'
};

/* Boards. A board is sections, each section a table with its own columns, so
   a column can be added to one without touching the rest.

   KNOWN ISSUES AND THE ROADMAP ARE NOT BOARDS ANY MORE (#3140). Both were
   typed here, and both went stale: the known board kept NPC behaviour #504
   had fixed, and the roadmap called the emote wheel unstarted while it
   shipped. Patrick: build them from the board's labels. The bot, which reads
   the issue board for #known-issues, writes both into data/from-bot/lists.json
   and the site draws them from there (THE KNOWN ISSUES PAGE AND THE ROADMAP,
   below). */
const BOARDS = {
  active:      'Active Issues',
  suggestions: 'Suggestions',
  archive:     'Archive',
  todo:        'Patrick'
};

/* Who may see what. 'member' is the password, 'admin' is Discord (the
   access.admin pair), 'staff' is every access.dev role. The server decides
   this, not the page: a section left out here is not sent at all, rather than
   sent and hidden. */
/* Everything behind /hub is admin now. The tester tier used to live in here,
   which meant anybody allowed into the game could open the same panel he does
   and read half of it. Downloads and Report a problem went to the public site
   instead, so a playtester never needs this page at all and the gate can be
   one role check rather than two tiers. */
/* Hub trimmed (#433): Gallery (uploads), Sessions, Linked Accounts, Inbox.
   Issue boards, tests, help, roadmap, news, link, archive, todo left the hub.
   Public /known /help /roadmap /news stay as PUBLIC_PAGES. */
/* The Gallery page is 'staff' rather than 'admin' (#742). Every gallery door
   it calls asks for w.dev, so a Gamemaster, Moderator or Loremaster could
   approve and delete by API while the page that does it sent them back to the
   hub home, and the launcher's Manage on the site button opens this address.
   The page now matches the doors behind it. The linked accounts are 'staff'
   since #1010, because that page is where staff ban, PK and write notes, and
   every staff role may. The other two stay 'admin': the play sessions and
   the report inbox. The hold economy is 'staff' (#3164, Patrick, 22 Oct:
   staff's hold economy view is a staff page on the hub). */
const LEVEL = {
  uploads: 'staff', linked: 'staff', sessions: 'admin', inbox: 'admin', economy: 'staff'
};

/* The public front lives at / and needs no password. The working area moved
   to /hub, because a server nobody can read about is a server nobody joins,
   and a login box was the first thing anybody saw. */
/* How long Cloudflare keeps a public page at its edge (#5190), by the
   Cloudflare-CDN-Cache-Control header only those pages carry. Five minutes:
   the box answers a page's first visitor in each of Cloudflare's places and
   the rest from there, and a merge's change shows within five minutes of
   going in. */
const PUBLIC_EDGE_SECONDS = 300;
const PUBLIC_PAGES = ['/', '/world', '/rules', '/credits', '/join',
                      '/classes', '/roadmap', '/news', '/gallery',
                      '/downloads', '/report',
                      // Known Issues and Help are for the person whose install
                      // will not start or who cannot sign in, so they cannot
                      // sit behind the sign in. Help is help.md in the data
                      // folder and Known Issues is written from the issue
                      // board (#3140), both read through /api/page like the
                      // site pages.
                      '/known', '/help',
                      // What is kept about somebody and what they are
                      // agreeing to cannot sit behind a sign in, because
                      // the person deciding whether to sign up is the one
                      // who needs to read them.
                      '/privacy', '/terms', '/cookies'];
const PUBLIC_DOCS = ['help'];
/* The public pages are markdown on disk like everything else here, so the
   wording can be fixed from the site rather than by a deploy. */
const SITE = path.join(DATA, 'site');

/* What a link to each page says when it is pasted into Discord. Every address
   used to unfurl with the same generic home text, so a link to the rules and a
   link to the roadmap read identically in a channel. This is the only copy:
   the page is sent with its title, description and og tags already written
   from it (publicDiscovery and the route below), so the browser tab and a
   crawler read the same words. home.js kept a second list for the tab until
   #3138, and the two had drifted apart on two pages. */
const BLURB = {
  '/':          ['Thornswood', 'A Skyrim roleplay server set fifty years after the civil war. The world still has people in it.'],
  '/world':     ['The world', 'Fifty years after the Stormcloaks won. A free Skyrim, an Empire with an embassy and no soldiers, and the White Harbour Accord.'],
  '/rules':     ['Rules', 'Nine rules, short on purpose. Nobody dies without agreeing to, play a person rather than a legend, and staff decide.'],
  '/join':      ['How to join', 'What you need, how to apply, and what happens between pressing Play and arriving in your town.'],
  '/credits':   ['Credits', 'Everyone whose work Thornswood is built on.'],
  '/classes':   ['Professions and classes', 'One profession, one half of it, one class. An Edgewright cannot make steel armour, so you find somebody who can.'],
  '/known':     ['Known issues', 'What is broken right now that the team already knows about, each one on the board to be fixed. Read this before reporting anything.'],
  '/help':      ['Help', 'Installing, the collection, LOAD ORDER ERROR, and where the logs are.'],
  '/downloads': ['Download', 'What you need, the installer, and the collection in Vortex.'],
  '/roadmap':   ['Roadmap', 'What is being worked on and roughly in what order.'],
  '/news':      ['Every release', 'What changed, newest first. The same list the launcher shows.'],
  '/report':    ['Report a problem', 'Something broken, or an idea, with no account needed. Or somebody behaving badly, signed in.'],
  '/gallery':   ['From the world', 'Pictures taken by people playing.'],
  '/privacy':   ['Privacy', 'What Thornswood keeps about you, why, and how to have it deleted. No advertising tag and no tracking cookie.'],
  '/terms':     ['Terms', 'Eighteen and over, play by the rules, your account is yours, and nothing here is charged for or promised.'],
  '/cookies':   ['Cookies', 'Every cookie and piece of browser storage this site uses: sign-in and the eighteen-and-over gate. No advertising cookie.']
};
const escAttr = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ==== thornswood page render ====
//
// THE WRITTEN PAGES GO OUT AS HTML. Until entry 247 the rules, the world, how
// to join and the rest were an empty page that the browser filled in: it
// fetched the markdown and turned it into HTML with marked, loaded from
// cdnjs.cloudflare.com with no integrity check, in fonts from Google. So the
// rules page was blank to anything that does not run the page's script (a
// search engine, a link preview), it was blank whenever cdnjs could not be
// reached, and every visitor's address went to two other companies for
// opening it. The same marked, 12.0.2, now sits in public/ and runs here, and
// the page leaves this server with its words already in it.
//
// NO HTML THROUGH, BY CONSTRUCTION. Help is edited in the hub and the rest are
// files anybody with the box can change. Rendered in the browser, a line of
// HTML in one of them ran on the page; rendered here it would be written into
// the public front as served. So the renderer never recognises HTML at all: a
// tag in the markdown is text and comes out escaped, a link or a picture only
// goes somewhere if its address is http, https, mailto or on this site, and
// every attribute it writes is one it built and escaped itself. That is an
// allowlist in the renderer rather than a regex over its output afterwards,
// and it needs no package: the site has no package.json and Deploy-Docs sends
// files, not node_modules.
//
// The one piece of HTML any page used is the empty anchor world.md puts above
// the Accord, which the footer's /world#accord points at. An empty anchor with
// an id and nothing else is the one shape let through.
function makePageRenderer(lib) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // marked escapes a title and a picture's words while it reads them, so this
  // leaves a finished entity alone rather than showing "&amp;quot;".
  const escOnce = (s) => String(s == null ? '' : s)
    .replace(/&(?!#\d{1,7};|#[Xx][0-9A-Fa-f]{1,6};|\w+;)/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // An address as it goes into href or src, or null when it is not one this
  // site hands out. encodeURI is what marked itself does to it. After that
  // anything before a colon, with no slash, ? or # ahead of it, is a scheme,
  // and only three are allowed. The & is escaped on the way out, so
  // javascript&#58; reaches the browser as those characters and not as a
  // colon.
  function address(href) {
    let h;
    try { h = encodeURI(String(href == null ? '' : href)).replace(/%25/g, '%'); }
    catch (e) { return null; }
    const scheme = /^([^:/?#]*):/.exec(h);
    if (scheme && !/^(https?|mailto)$/i.test(scheme[1])) return null;
    return esc(h);
  }
  const m = new lib.Marked({ gfm: true, breaks: false });
  m.use({
    // Undefined is "not this", so marked goes on to read it as text, which it
    // escapes. A tag never becomes an html token and never switches marked
    // into the raw mode that stops it escaping what follows.
    tokenizer: {
      html() { return undefined; },
      tag() { return undefined; }
    },
    extensions: [{
      name: 'emptyAnchor',
      level: 'inline',
      start(src) { const i = src.indexOf('<a id='); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const a = /^<a id=(["'])([A-Za-z][A-Za-z0-9_-]{0,63})\1\s*><\/a>/.exec(src);
        return a ? { type: 'emptyAnchor', raw: a[0], id: a[2] } : undefined;
      },
      renderer(t) { return '<a id="' + t.id + '"></a>'; }
    }],
    renderer: {
      // Nothing above produces one. Escaped anyway, so a later marked that
      // does is still safe.
      html(text, block) { return block ? '<p>' + esc(text) + '</p>\n' : esc(text); },
      link(href, title, text) {
        const to = address(href);
        if (to === null) return text;
        return '<a href="' + to + '"' + (title ? ' title="' + escOnce(title) + '"' : '') +
               '>' + text + '</a>';
      },
      image(href, title, text) {
        const to = address(href);
        if (to === null) return escOnce(text);
        return '<img src="' + to + '" alt="' + escOnce(text) + '"' +
               (title ? ' title="' + escOnce(title) + '"' : '') + '>';
      }
    }
  });
  return (md) => m.parse(String(md == null ? '' : md));
}

// home.html with a written page put into it: the page shown, the front hidden,
// and the tab named after the page's first heading. Each marker is replaced
// once with a function, so a $ in somebody's text is a dollar and not a
// replacement pattern. A home.html without the markers comes back unchanged,
// and its own script fetches the page instead.
function fillPage(html, body) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(body);
  const name = h1 ? h1[1].replace(/<[^>]*>/g, '').trim() : '';
  return html
    .replace(/<div id="landing">[\s\S]*?<\/div><!-- \/landing -->/,
             () => '<div id="landing" hidden></div><!-- /landing -->')
    .replace('<div class="page" id="page" hidden><div class="wrap" id="pagebody"></div></div>',
             () => '<div class="page" id="page"><div class="wrap" id="pagebody">' + body + '</div></div>')
    .replace('<title>Thornswood</title>',
             () => '<title>' + (name ? name + ' · Thornswood' : 'Thornswood') + '</title>');
}
// ==== end thornswood page render ====

/* The addresses that are a markdown page. The same list as PAGES in
   home.html, and tools/test-site-render.js checks that the two agree. */
const MD_PAGES = ['/world', '/rules', '/join', '/credits', '/classes',
                  '/known', '/help', '/privacy', '/terms', '/cookies'];
const MARKED = 'marked-12.0.2.min.js';
let renderMd = null;
try { renderMd = makePageRenderer(require(path.join(PUBLIC, MARKED))); }
catch (e) {
  console.error('[thornswood-docs] ' + MARKED + ' did not load, so the written ' +
                'pages go out as plain text until it does: ' + e.message);
}
// Plain text rather than no page, if the library is missing or a page will
// not render, so one bad edit to Help cannot turn /help into an error.
function pageHtml(md) {
  if (renderMd) {
    try { return renderMd(md); }
    catch (e) {
      console.error('[thornswood-docs] a page would not render, sent as plain text: ' + e.message);
    }
  }
  return '<pre class="pre-wrap">' + escAttr(md) + '</pre>';
}
/*
  THE KNOWN ISSUES PAGE AND THE ROADMAP, FROM THE ISSUE BOARD (#3140).

  Both used to be boards typed into board.json, and both went stale. Now the
  bot builds them from the board each time it reads it for #known-issues
  (bot.py, "the site's known issues and roadmap") and writes them into
  data/from-bot/lists.json:

    { at: when the bot read the board,
      known: [{ title, text, where: ['Main', 'Dev'] }],
      roadmap: { lanes: [{ name, rows: [{ title, text }] }] } }

  known is the #known-issues forum's list, word for word: an open issue
  labelled Main Findings or Dev Findings whose fix has not landed, in the
  words of its last "Known issue:" comment. roadmap is every open issue
  labelled roadmap: now, next or later, in that lane, in the words of its
  last "Roadmap:" comment; there is no Done lane (Patrick, 26 Oct).

  These two turn the file into what /known (and /api/page/known) and /roadmap
  (and /api/roadmap) serve. A part the file does not hold, or a file that is
  not there or will not read, is said on the page as not read, never drawn as
  an empty list: an empty list says nothing is broken. The time of the read is
  on both pages, so a bot that stopped writing shows as an old date.
*/
// ==== thornswood lists ====
const KNOWN_INTRO = 'What is broken right now that the team already knows about. Each one is\n' +
  'on the issue board to be fixed, and comes off this page as soon as work on\n' +
  'it is merged.';
const ROADMAP_INTRO = 'What is being built and roughly in what order. Nothing here has a date on it, because a date would be a guess.\n\n' +
  'Things move up this list when somebody starts on them, not when they are announced.';
const LIST_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "26 Oct 2026, 8:05 AM UTC", or null for a time that will not read.
function listTime(at) {
  const d = new Date(String(at || ''));
  if (!at || isNaN(d.getTime())) return null;
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return d.getUTCDate() + ' ' + LIST_MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' +
    (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM') + ' UTC';
}
function listText(v) { return String(v == null ? '' : v).replace(/\r\n/g, '\n').trim(); }
// Where a known issue was found, in words.
function knownWhere(where) {
  const w = (Array.isArray(where) ? where : []).map(String);
  const words = [];
  if (w.indexOf('Main') >= 0) words.push('main');
  if (w.indexOf('Dev') >= 0) words.push('the dev server');
  return words.length ? 'Found on ' + words.join(' and ') + '.' : '';
}
// The Known Issues page's markdown out of lists.json's contents (or null).
function knownMarkdown(lists) {
  const out = ['# Known Issues', '', KNOWN_INTRO, ''];
  const at = listTime(lists && lists.at);
  const known = lists && Array.isArray(lists.known) ? lists.known : null;
  if (!known || !at) {
    out.push('The list could not be read from the issue board just now. Try again in a few', 'minutes, and report a problem as usual in the meantime.');
    return out.join('\n') + '\n';
  }
  const rows = known.filter((k) => k && listText(k.title));
  out.push('## Broken right now', '');
  if (!rows.length) out.push('Nothing is listed right now.', '');
  else out.push('Report one of these only if it does something this page does not describe.', '');
  for (const k of rows) {
    out.push('### ' + listText(k.title).replace(/\s*\n\s*/g, ' '), '');
    if (listText(k.text)) out.push(listText(k.text), '');
    const where = knownWhere(k.where);
    if (where) out.push('*' + where + '*', '');
  }
  out.push('*Read from the issue board ' + at + '.*');
  return out.join('\n') + '\n';
}
// The roadmap as /api/roadmap hands it to the front page and /roadmap draws
// it: its intro, a section per lane (columns What and Where it stands, so a
// lane reads like the board it replaced), when it was read, and unread when
// the file held no roadmap.
function roadmapBoard(lists) {
  const at = listTime(lists && lists.at);
  const rm = lists && lists.roadmap && Array.isArray(lists.roadmap.lanes) ? lists.roadmap : null;
  const board = { intro: ROADMAP_INTRO, sections: [], at: at || '', unread: !rm || !at };
  if (board.unread) return board;
  rm.lanes.forEach((lane, i) => {
    if (!lane || !listText(lane.name)) return;
    board.sections.push({
      id: 'lane' + i, name: listText(lane.name), note: '',
      columns: [{ id: 'what', name: 'What' }, { id: 'where', name: 'Where it stands' }],
      rows: (Array.isArray(lane.rows) ? lane.rows : []).filter((r) => r && listText(r.title)).map((r, j) => ({
        id: 'lane' + i + 'r' + j, done: false,
        cells: { what: listText(r.title), where: listText(r.text) } }))
    });
  });
  return board;
}
// ==== end thornswood lists ====

// A written page's markdown, or null. Help lives in the data folder with the
// other documents, not under site; Known Issues is written from the issue
// board, by way of the bot's lists.json (#3140).
function pageMarkdown(name) {
  if (name === 'known') {
    try { return forMode(knownMarkdown(readLists()), cfg.open); } catch (e) { return null; }
  }
  const dir = PUBLIC_DOCS.indexOf(name) >= 0 ? DATA : SITE;
  const file = path.join(dir, name + '.md');
  if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) return null;
  try { return forMode(fs.readFileSync(file, 'utf8'), cfg.open); } catch (e) { return null; }
}

// The hints and lore lines (#3147): data\site\lines.md is the one copy of
// them. The front page's lore line comes out of it as the page is served,
// and /api/public hands the lot out, which is where the Discord bot reads its
// status lines. The file's own comment says its rules, and
// site\tests\test-3147-lines.js holds them, so nothing here checks a line again.
// ==== thornswood lines ====
function parseLines(md) {
  const out = { hints: [], lore: [] };
  let list = null, last = null;
  String(md == null ? '' : md).replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).forEach(function (l) {
    const head = /^##\s+(.*?)\s*$/.exec(l);
    if (head) {
      list = /^hints$/i.test(head[1]) ? 'hints' : /^lore lines$/i.test(head[1]) ? 'lore' : null;
      last = null;
      return;
    }
    if (!list) return;
    const item = /^- (.*?)\s*$/.exec(l);
    if (item) {
      if (list === 'hints') { out.hints.push(item[1]); last = null; }
      else { last = { text: item[1], from: '' }; out.lore.push(last); }
      return;
    }
    // The source of a lore line, on the line under it.
    const from = /^ {2}(\S.*?)\s*$/.exec(l);
    if (from && last && !last.from) last.from = from[1];
  });
  return out;
}

// home.html's lore line, the empty quote under The World, filled with one
// line picked at pick (0 to 1, Math.random() when served). With no lore line
// to show it stays empty and hidden.
function fillLoreLine(html, lore, pick) {
  const esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  const list = Array.isArray(lore) ? lore : [];
  if (!list.length) return html;
  const one = list[Math.min(list.length - 1, Math.floor(pick * list.length))];
  return html.replace('<blockquote class="chron" id="loreLine" hidden></blockquote>', () =>
    '<blockquote class="chron" id="loreLine">' + esc(one.text) +
    (one.from ? '<cite>' + esc(one.from) + '</cite>' : '') + '</blockquote>');
}
// ==== end thornswood lines ====

function readLines() {
  try {
    return parseLines(forMode(fs.readFileSync(path.join(SITE, 'lines.md'), 'utf8'), cfg.open));
  } catch (e) {
    console.error('[thornswood-docs] could not read data/site/lines.md, so the front page shows ' +
                  'no lore line and /api/public no lines: ' + e.message);
    return { hints: [], lore: [] };
  }
}

// The credits page says which engine each server runs. That is a fact of the
// box, not of the repo, so a hand edit went stale with every deploy (the
// source-offer test caught 720a5f7c that way). Deploy-Server.ps1 and
// Publish-Server.ps1 write data/deployed-build.json after a server deploy on
// either channel (scripts/deploy/DeployedBuild.ps1), and the feeds this site
// serves carry the client commit. fillCreditsCommits puts both into the page
// at serve time. The markdown keeps its hand text, which names no commit for
// either server or either feed, and is what goes out when the record or a
// feed cannot be read.
// ==== thornswood credits fill ====
function fillCreditsCommits(md, deployed, feeds) {
  const FULL = /^[0-9a-f]{40}$/;
  const SOME = /^[0-9a-f]{7,40}$/;
  const tree = 'https://github.com/ThornswoodRP/skymp/tree/';
  const link = function (c) { return '[`' + c.slice(0, 8) + '`](' + tree + c + ')'; };
  const pick = function (ch) {
    const e = deployed && typeof deployed === 'object' ? deployed[ch] : null;
    const c = e && typeof e === 'object' ? String(e.commit || '') : '';
    return FULL.test(c) ? c : null;
  };
  let out = String(md);
  const live = pick('live');
  const dev = pick('dev');
  // Either server alone is enough to say something true (#2303). Until then
  // a record with only live in it, which is what the box held on 11 Oct after
  // the dev engine went up through Publish-Server, kept the hand text, and the
  // hand text named the engine the main server had left behind.
  if (live || dev) {
    const rec = /built from one commit,\s+\[`[0-9a-f]{7,40}`\]\(https:\/\/github\.com\/ThornswoodRP\/skymp\/tree\/([0-9a-f]{40})\)/.exec(out);
    const recorded = rec ? rec[1] : '';
    let said;
    if (live && dev && live === dev) {
      said = live === recorded ? 'Both servers run it, ' + link(live) + '.'
                               : 'The recorded build has not been deployed yet. Both servers run ' + link(live) + '.';
    } else if (live && dev) {
      said = (live !== recorded && dev !== recorded ? 'The recorded build has not been deployed yet. ' : '') +
             'The test server runs ' + link(dev) + ' and the main server runs ' + link(live) + '.';
    } else {
      // Only the server the record names is spoken for; the other is left
      // unsaid rather than guessed.
      const one = live || dev;
      const who = live ? 'The main server' : 'The test server';
      said = one === recorded ? who + ' runs it, ' + link(one) + '.' : who + ' runs ' + link(one) + '.';
    }
    // The hand text is the rest of the paragraph after "then to the main
    // server.", whatever it says (#2098, #2303).
    out = out.replace(/(then to the main server\.\s+)(?:(?!\n\s*\n)[\s\S])+?(?=\n\s*\n|$)/,
                      function (m, lead) { return lead + said; });
  }
  // A channel row's last cell is hand text that names no commit (#421: a
  // hash typed there went stale with every Ship), and the feed's commit takes
  // its place, whatever it says.
  for (const row of [['Public', 'feed/version.json', 'public'], ['Dev', 'feed-dev/version.json', 'dev']]) {
    const c = feeds && typeof feeds === 'object' ? String(feeds[row[2]] || '') : '';
    if (!SOME.test(c)) continue;
    const re = new RegExp('(^|\\n)(\\|\\s*' + row[0] + '\\s*\\|\\s*`' + row[1].replace(/[./]/g, '\\$&') +
                          '`\\s*\\|[ \\t]*)[^|\\n]*?([ \\t]*\\|[ \\t\\r]*(?=\\n|$))');
    out = out.replace(re, function (m, a, b, end) { return a + b + link(c) + end; });
  }
  return out;
}
// ==== end thornswood credits fill ====

Object.assign(module.exports, { BLURB, BOARDS, DOCS, escAttr, LEVEL,
  MD_PAGES, PUBLIC_EDGE_SECONDS, PUBLIC_PAGES });

// From modules loaded after this one, taken once this one is whole, so a
// module that needs this one back finds all of it.
const { readLists } = require('./store');
