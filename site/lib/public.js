/*
  What strangers see: each public page's body and the tags search engines
  read, every file named with its version, the page wordings the installer
  records, and the routes of the hub's pages.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { creditsFacts, findPageVersion, pageSha256,
  publicAssetBody, publicAssetVersion, publicDiscovery, publicPageBody,
  singlePageHeading, versionAssets };

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { PUBLIC } = require('./base');
const { BLURB, escAttr, pageHtml, roadmapBoard } = require('./pages');
const { DEPLOYED_BUILD, feedFile, readJsonQuiet } = require('./feed');
function creditsFacts() {
  const feeds = {};
  for (const pair of [['public', 'feed'], ['dev', 'feed-dev']]) {
    const f = feedFile(pair[1]);
    const v = f ? readJsonQuiet(f) : null;
    const c = v && v.clientRuntime && v.clientRuntime.forkCommit;
    if (typeof c === 'string') feeds[pair[0]] = c;
  }
  return { deployed: readJsonQuiet(DEPLOYED_BUILD), feeds: feeds };
}

// Public discovery uses the configured project domain, never a request's Host.
const PUBLIC_ORIGIN = 'https://thornswood.net';
function singlePageHeading(body, title) {
  let seen = false;
  body = body.replace(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/gi, (whole, attrs, text) => {
    if (!seen) { seen = true; return whole; }
    return '<h2' + attrs + '>' + text + '</h2>';
  });
  return seen ? body : '<h1>' + escAttr(title) + '</h1>' + body;
}
function publicPageBody(route) {
  const b = BLURB[route];
  let body = '<h1>' + escAttr(b[0]) + '</h1><p>' + escAttr(b[1]) + '</p>';
  if (route === '/news') {
    const feed = publicJson(NEWS, {news:[]});
    const news = (Array.isArray(feed.news) ? feed.news : []).slice(0, 60);
    if (feed.launcher) body += '<p>Launcher <b>' + escAttr(feed.launcher) + '</b> is current.</p>';
    for (const n of news) {
      const details = Array.isArray(n.details) ? n.details : (n.details ? [n.details] : []);
      body += '<article class="rel"><div class="when">' + escAttr(n.date || '') + '</div><h2>' +
        escAttr(n.title || '') + '</h2>' + (n.body ? '<p>' + escAttr(n.body) + '</p>' : '') +
        (details.length ? '<ul>' + details.map(d => '<li>' + escAttr(d) + '</li>').join('') + '</ul>' : '') + '</article>';
    }
    if (!news.length) body += '<p>No release notes are available yet.</p>';
  } else if (route === '/roadmap') {
    // Same roadmap as /api/roadmap, built from the issue board (#3140).
    const rm = roadmapBoard(readLists());
    if (rm.intro) body += pageHtml(rm.intro).replace(/<h1\b/g, '<h2').replace(/<\/h1>/g, '</h2>');
    let count = 0;
    for (const section of (rm.sections || [])) {
      // Every lane the bot wrote is drawn, in its order, none filtered by
      // name (#2560); the bot writes no Done lane since 26 Oct.
      if (!(section.rows || []).length) continue;
      body += '<section class="lane"><h2>' + escAttr(section.name || '') + '</h2><ul>';
      for (const row of section.rows) {
        const text = (section.columns || []).map(col => (row.cells || {})[col.id]).filter(Boolean).join(' · ');
        body += '<li>' + escAttr(text) + '</li>'; count++;
      }
      body += '</ul></section>';
    }
    if (rm.unread) body += '<p>The roadmap could not be read from the issue board just now. Try again in a few minutes.</p>';
    else if (!count) body += '<p>No upcoming work is listed here yet. See <a href="/known">known issues</a> for current limits.</p>';
    if (rm.at) body += '<p><em>Read from the issue board ' + escAttr(rm.at) + '.</em></p>';
  } else if (route === '/gallery') {
    const shots = publicJson(GALLERY, []);
    const approved = (Array.isArray(shots) ? shots : []).slice(0, 24);
    body += '<p>Only pictures approved by staff appear here. <a href="/privacy">How submissions are used</a>.</p><div class="gallery">';
    for (const g of approved) {
      if (!/^\/shot\/[^?#]+$/.test(g.url || '')) continue;
      const alt = g.alt || 'Skyrim scene shared by ' + (g.by || 'the Thornswood community');
      const media = /\.(mp4|webm)$/i.test(g.name || '')
        ? '<video controls preload="metadata" aria-label="' + escAttr(alt) + '"><source src="' + escAttr(g.url) + '"></video>'
        : '<img src="' + escAttr(g.url) + '"' +
          (g.srcset ? ' srcset="' + escAttr(g.srcset) + '" sizes="(max-width: 620px) calc(100vw - 48px), 34vw"' : '') +
          ' alt="' + escAttr(alt) + '" loading="lazy">';
      body += '<figure class="shot-card"><div class="shot">' + media + '</div><figcaption>' + escAttr(g.by || 'Thornswood community') + '</figcaption></figure>';
    }
    body += '</div>';
    if (!approved.length) body += '<p>No approved pictures are available yet.</p>';
  } else if (route === '/downloads') {
    body += '<p>You need to own Skyrim Special Edition on Steam and be eighteen or older.</p>' +
      '<p><a href="/join">Read the installation and application steps</a>. ' +
      '<a href="/help">Get installation help</a>.</p>' +
      '<p>The download controls appear after the age statement. JavaScript is needed for those controls.</p>';
  } else if (route === '/report') {
    body += '<p>Reports are private. Your Discord name is optional for game faults and ideas. ' +
      'A report about a person requires Discord sign-in.</p>' +
      '<p>Do not include passwords, access tokens, payment details, or unrelated personal information. ' +
      '<a href="/privacy">Read how reports are stored and used</a>.</p>' +
      '<p>The report form needs JavaScript. You can also ask for help in the Discord linked above.</p>';
  }
  return body;
}
/*
  EVERY FILE A PAGE NAMES CARRIES ITS OWN HASH, SO IT CAN BE KEPT FOR A YEAR
  (#3218).

  Only home.js and home.css had a ?v= written on, and the static branch below
  never read it, so those two were kept for an hour like everything else, and
  the fonts, the logo, the banner and the video were fetched again after every
  hour (Cloudflare stretched it to four). A Lighthouse run on 21 Oct 2026 put
  826 KiB of a repeat visit on it.

  Now every "/name" a page names in src, href, poster or srcset, and every
  url(/name) a stylesheet names, is written out as /name?v=<hash of what is
  served>, and the static branch sends a name asked for with the hash it has
  now as immutable for a year. A deploy that changes a file changes its hash,
  so the page names a new address and nothing old is shown. A stylesheet's
  hash is of the stylesheet as served, its fonts' hashes included, so a new
  font file moves fonts.css's address with it. Asked for with no hash, or an
  old one, a file is the hour and its ETag, as before.

  The hash of a stylesheet is kept against its own file and the hashes of what
  it names; any other file's against its size and times, which every deploy
  changes.
*/
const publicAssetVersions = new Map();
const ASSET_NAME = /^[A-Za-z0-9._-]+\.(?:js|css|png|jpe?g|webp|avif|gif|svg|ico|woff2?|mp4|webm)$/i;
function publicAssetVersion(asset) {
  if (!ASSET_NAME.test(asset)) return null;
  const file = path.join(PUBLIC, asset);
  try {
    const st = fs.statSync(file), key = st.size + ':' + st.mtimeMs + ':' + st.ctimeMs;
    const cached = publicAssetVersions.get(asset);
    const named = (refs) => refs.map(publicAssetVersion).join(',');
    if (cached && cached.key === key && named(cached.refs) === cached.named) return cached.version;
    const body = publicAssetBody(asset);
    const refs = /\.css$/i.test(asset) ? assetRefs(fs.readFileSync(file, 'utf8')) : [];
    const version = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
    publicAssetVersions.set(asset, {key, version, refs, named: named(refs)}); return version;
  } catch (e) { return null; }
}
// The bytes the static branch sends for a file of public/: a stylesheet with
// its url()s versioned, anything else as it is on disk.
function publicAssetBody(asset) {
  const raw = fs.readFileSync(path.join(PUBLIC, asset));
  return /\.css$/i.test(asset) ? Buffer.from(versionAssets(raw.toString('utf8')), 'utf8') : raw;
}
const ASSET_ATTR = /(\s(?:src|href|poster)=")\/([A-Za-z0-9._-]+)"/g;
const ASSET_SRCSET = /(\ssrcset=")([^"]*)"/g;
const ASSET_URL = /url\((["']?)\/([A-Za-z0-9._-]+)\1\)/g;
function assetRefs(text) {
  const out = [];
  String(text).replace(ASSET_URL, (all, q, name) => { out.push(name); return all; });
  return out;
}
function versionAssets(text) {
  const tag = (name) => { const v = publicAssetVersion(name); return v ? '/' + name + '?v=' + v : '/' + name; };
  return String(text)
    .replace(ASSET_ATTR, (all, attr, name) => attr + tag(name) + '"')
    .replace(ASSET_SRCSET, (all, attr, list) => attr +
      list.replace(/(^|,\s*)\/([A-Za-z0-9._-]+)/g, (m, lead, name) => lead + tag(name)) + '"')
    .replace(ASSET_URL, (all, q, name) => 'url(' + q + tag(name) + q + ')');
}
function publicDiscovery(html, route) {
  const blurb = BLURB[route], canonical = PUBLIC_ORIGIN + route;
  const title = route === '/' ? blurb[0] : blurb[0] + ' · Thornswood';
  const graph = [
    {'@type':'Organization', '@id':PUBLIC_ORIGIN+'/#community', name:'Thornswood', url:PUBLIC_ORIGIN+'/',
      logo:PUBLIC_ORIGIN+'/logo.png', description:'A free Skyrim roleplay fan project and online community.'},
    {'@type':'WebSite', '@id':PUBLIC_ORIGIN+'/#website', url:PUBLIC_ORIGIN+'/', name:'Thornswood',
      publisher:{'@id':PUBLIC_ORIGIN+'/#community'}},
    {'@type':'WebPage', '@id':canonical+'#page', url:canonical, name:title, description:blurb[1],
      isPartOf:{'@id':PUBLIC_ORIGIN+'/#website'}, inLanguage:'en'}
  ];
  if (route !== '/') {
    graph[2].breadcrumb = {'@id':canonical+'#breadcrumb'};
    graph.push({'@type':'BreadcrumbList', '@id':canonical+'#breadcrumb', itemListElement:[
      {'@type':'ListItem', position:1, name:'Thornswood', item:PUBLIC_ORIGIN+'/'},
      {'@type':'ListItem', position:2, name:blurb[0], item:canonical}
    ]});
    html = html.replace('<main id="main" tabindex="-1">', () => '<main id="main" tabindex="-1"><nav class="wrap breadcrumbs" aria-label="Breadcrumb">' +
      '<ol><li><a href="/">Thornswood</a></li><li aria-current="page">' + escAttr(blurb[0]) + '</li></ol></nav>');
  }
  // Escape the HTML script terminator even if metadata becomes editable later.
  const ld = JSON.stringify({'@context':'https://schema.org', '@graph':graph}).replace(/</g, '\\u003c');
  const head = '<link rel="canonical" href="' + canonical + '">\n' +
    '<meta property="og:url" content="' + canonical + '">\n' +
    '<meta property="og:image:alt" content="Thornswood emblem over a painted Skyrim landscape">\n' +
    '<meta name="twitter:image:alt" content="Thornswood emblem over a painted Skyrim landscape">\n' +
    '<meta name="twitter:title" content="' + escAttr(title) + '">\n' +
    '<meta name="twitter:description" content="' + escAttr(blurb[1]) + '">\n' +
    '<script type="application/ld+json">' + ld + '</script>\n';
  // The ?v= on every file the page names is send()'s (versionAssets).
  return html.replace(/<title>[\s\S]*?<\/title>/, () => '<title>' + escAttr(title) + '</title>')
    .replace('</head>', () => head + '</head>');
}


// ==== thornswood page versions ====
/* SHA-256 of a page's text as /api/page serves it, the same bytes the
   installer writes into Profile\accepted.json. public/page-versions.json
   lists every wording that has been on main, so a hash already accepted
   can be read back to the day that wording last changed. */
const PAGE_VERSIONS = path.join(PUBLIC, 'page-versions.json');
function pageSha256(md) {
  return crypto.createHash('sha256').update(String(md), 'utf8').digest('hex');
}
function pageVersionRows() {
  try {
    const doc = JSON.parse(fs.readFileSync(PAGE_VERSIONS, 'utf8'));
    return doc && doc.pages && typeof doc.pages === 'object' ? doc.pages : {};
  } catch (e) { return {}; }
}
function findPageVersion(sha) {
  const want = String(sha || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) return null;
  const pages = pageVersionRows();
  for (const name of Object.keys(pages)) {
    const rows = Array.isArray(pages[name]) ? pages[name] : [];
    for (const row of rows) {
      if (row && String(row.sha256 || '').toLowerCase() === want) {
        return { page: name, sha256: want, changed: String(row.changed || '') };
      }
    }
  }
  return null;
}
// ==== end thornswood page versions ====


const PAGES = {
  '/hub':         'home',
  '/uploads':     'uploads',
  '/linked':      'linked',
  '/sessions':    'sessions',
  '/inbox':       'inbox',
  '/economy':     'economy'
};

Object.assign(module.exports, { PAGES, PUBLIC_ORIGIN });

// From modules loaded after this one, taken once this one is whole, so a
// module that needs this one back finds all of it.
const { readLists } = require('./store');
const { NEWS } = require('./news');
const { publicJson } = require('./limits');
const { GALLERY } = require('./uploads');
