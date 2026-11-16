/*
  The downloads folder: the files listed for download, and the installer
  from its GitHub Release. And the Downloads page itself, which the site
  sends whole (#4330): the age gate, or the steps and the download buttons
  when the browser has already given its age statement.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { ageGateBody, ageStated, downloadServed, downloadsBody,
  downloadsFacts, listFiles };

const fs     = require('fs');
const path   = require('path');
const { FILES } = require('./base');
const { cfg } = require('./config');
const { escAttr } = require('./pages');
const { jsonFile } = require('./store');
const { newestSetup, serverRevision } = require('./feed');
const { NEWS } = require('./news');
const { publicJson } = require('./limits');

// ------------------------------------------------------------- downloads --
// The old installer's names: the setup program and its payload zip, stamped or
// not, as Publish-Installer put them in the downloads folder until #4824. The
// setup program comes from a GitHub Release now (newestSetup), so a copy left
// in the folder is never served or listed, whatever files.json still says.
function oldInstaller(name) {
  return /^Thornswood(?:-Dev)?-Setup(?:-\d{8}-\d{4})?\.(?:exe|zip)$/i.test(name);
}

// What /file/ serves from the downloads folder, which is also all the
// Downloads list may show from it (#3798). files.json is the list of what is
// published, so a name is served only when it is listed there and not hidden.
// files.json itself is served too. Anything else in the folder is not
// published, and answers 404. Until this the route served whatever sat in the
// folder, and a read only diagnostic put there by hand on the box (a script
// naming a staff member and the game server's address) went to anyone who
// asked for it by name, while the Downloads page only hid it.
function downloadServed(name, meta) {
  if (name === 'files.json') return true;
  if (oldInstaller(name)) return false;
  const m = Object.prototype.hasOwnProperty.call(meta, name) ? meta[name] : null;
  if (!m || typeof m !== 'object') return false;
  return !m.hidden;
}

function listFiles() {
  const meta = jsonFile(path.join(FILES, 'files.json'), {});
  const out = [];
  let names = [];
  // No downloads folder is no downloads. One that is there and cannot be
  // listed is said (#2736), since the page then offers nothing and the log
  // is the only place that says it is the folder and not the build.
  if (fs.existsSync(FILES)) {
    try { names = fs.readdirSync(FILES); }
    catch (e) { console.error('[thornswood-docs] could not list the downloads in ' + FILES + ' (' + (e.code || e.message) + ')'); }
  }
  for (const name of names) {
    // Only what /file/ serves, so the page never offers a name that answers
    // 404, and nothing files.json does not publish is listed at all.
    if (name === 'files.json' || !downloadServed(name, meta)) continue;
    let st;
    try { st = fs.statSync(path.join(FILES, name)); } catch (e) { continue; }
    if (!st.isFile()) continue;
    const m = meta[name];
    // A file's SHA-256, when files.json gives one, so the Downloads page can
    // print it beside the size and date (To Do entry 176). Only a well formed
    // hash goes out, in lower case because Get-FileHash writes upper and the
    // page builds an address from it.
    const sha256 = String(m.sha256 || '').toLowerCase();
    const hash = /^[0-9a-f]{64}$/.test(sha256) ? sha256 : '';
    out.push({ name, size: st.size, at: st.mtimeMs, hidden: !!m.hidden,
      label: m.label || name, version: m.version || '', note: m.note || '',
      sha256: hash, publisher: typeof m.publisher === 'string' ? m.publisher.trim() : '' });
  }
  // The installer: main's setup program, from its GitHub Release (#4824),
  // with the sha256 GitHub measured on it. Who signed it is not on the
  // Release, so the page names nobody rather than a name nothing checked
  // (#5275). Dev's is not listed: it is for staff, at /file/ by its name.
  // The button goes to /file/<name>, which sends the browser on to the file
  // where GitHub keeps it (Patrick, 8 Nov 2026: "linking the downloads page
  // to the files on GitHub"). Until 9 Nov it went to the Release's github.com
  // download address, which GitHub stopped answering that day for anybody
  // not signed in, while its API kept answering (#5608).
  const setup = newestSetup('main');
  if (setup) {
    out.push({ name: setup.name, size: setup.size, at: setup.at, hidden: false,
      label: setup.name, version: setup.tag, note: '', sha256: setup.sha256, publisher: '' });
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

/*
  THE DOWNLOADS PAGE IS SENT WHOLE (#4330). Until this the site sent a short
  stand-in body, and the page's script swapped all of it a moment later: for
  the age gate, or for the steps it built once /api/public answered. Every
  visit to /downloads jumped. Now the site writes the right body into the
  page as it sends it, and the script has nothing to swap.

  Which body is the age statement's cookie, read by the same rule home.js's
  ageCookie() reads it: tw-age-18 holding the gate's policy number. The
  cookie's day is the browser's to keep, so a cookie it still sends is in
  date. The gate's rules and its words are home.js's (#2192); AGE_POLICY here
  is the same number, and site\tests\test-age-gate.js holds the two equal,
  and the gate's words below to the ones home.js shows on /join.

  A browser that keeps the statement only in localStorage (one that refuses
  the cookie) gets the gate here, because the site cannot see localStorage;
  its script asks /api/downloads for the page instead.
*/
const AGE_COOKIE = 'tw-age-18';
const AGE_POLICY = 1;
function ageStated(req) {
  return new RegExp('(?:^|;\\s*)' + AGE_COOKIE + '=' + AGE_POLICY + '(?:;|$)')
    .test(String((req && req.headers && req.headers.cookie) || ''));
}

function ageGateBody() {
  return '<div class="age-gate" id="ageGate">' +
    '<h1>Eighteen and over</h1>' +
    '<p>Thornswood is an adult roleplay server. It contains sexual content between adult characters, violence, and language that is not written for children.</p>' +
    '<p>Confirming here is you stating that you are eighteen or older. That ' +
    'statement is kept as a record of what you said, not as verification of your age.</p>' +
    '<p class="quiet">The <a href="/rules">rules</a> and <a href="/terms">terms</a> say the same.</p>' +
    '<div class="acts">' +
    '<button class="btn first" type="button" id="ageYes">I am eighteen or older</button>' +
    '<a class="btn ghost" href="/">Leave</a>' +
    '</div></div>';
}

// What the page is drawn from: the same values /api/public hands out, so the
// page and the API cannot say two different things.
function downloadsFacts() {
  const feed = publicJson(NEWS, { news: [] });
  // The revision the link opens, the one the server was built against
  // (#4115): from the signed record of the Release main runs (#5767), not the
  // feed, which only a Ship writes. The feed still names the collection.
  const revision = serverRevision('main');
  const base = String(feed.collection || '').replace(/\/revisions\/\d+$/, '');
  return {
    // The one switch (#428).
    open: cfg.open === true,
    invite: cfg.discord.invite || '',
    launcher: feed.launcher || '',
    collection: base && revision > 0 ? base + '/revisions/' + revision : base,
    collectionRevision: revision,
    files: listFiles()
  };
}

/* The page's body out of downloadsFacts(). This is the How to join section
   off the front page. It lived there and on this page in two different
   shapes, which meant two places to keep right and a front page that would
   not end. It is one place now, and this is the page the front page points
   at. */
function downloadsBody(d) {
  const esc = escAttr;
  const files = d.files || [];

  // The stamp under the download button, read the way a clock is read.
  //
  // A file in the downloads folder may carry a 24 hour time, which is shown
  // to people, not to a machine. Anything that is not a plain date and time
  // is left exactly as it is: the installer's is the tag of the Release it
  // is on (build-20261101.7 and the like), which says which build it is.
  function clock(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v || ''));
    if (!m) return v;
    let h = parseInt(m[4], 10);
    const half = h < 12 ? 'AM' : 'PM';
    h = h % 12; if (h === 0) { h = 12; }
    return parseInt(m[2], 10) + '-' + parseInt(m[3], 10) + '-' + m[1] +
           ' ' + h + ':' + m[5] + ' ' + half;
  }
  function human(b) {
    if (!b) return '';
    if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
    if (b >= 1048576)    return Math.round(b / 1048576) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  }
  // The installer's SHA-256, under the size and date, as GitHub measured it
  // on the Release. A file with none shows nothing rather than a link to
  // nothing.
  function hash(f) {
    return f && /^[0-9a-f]{64}$/.test(f.sha256 || '') ? f.sha256 : '';
  }
  function sum(f) {
    const h = hash(f);
    if (!h) return '';
    // The label is held together with white-space:nowrap so the browser cannot
    // soft-break it at the ASCII hyphen (SHA- / 256). The non-breaking space
    // keeps the whole label on the same line as the hash's start, and the hash
    // wraps within itself if the column is narrow.
    return '<br><span class="nowrap">SHA-256</span>&nbsp;' +
           '<span class="wrap-anywhere">' + h + '</span>';
  }
  // hidden is a file on the site for something other than people, never on
  // this page.
  function pick(ext) {
    for (let i = 0; i < files.length; i++) {
      if (files[i].hidden) continue;
      if ((files[i].name || '').toLowerCase().slice(-ext.length) === ext) return files[i];
    }
    return null;
  }
  // The installer is Velopack's setup program from a GitHub Release, the
  // launcher's package inside it (#4824): one file, nothing beside it.
  const exe = pick('.exe');

  let out = '<h1>Download</h1>';
  if (d.launcher) out += '<p>Launcher <strong>' + esc(d.launcher) + '</strong> is current.</p>';

  out += '<p class="lede">You need a legitimate copy of <strong>Skyrim Special ' +
         'Edition</strong> on Steam, on build <strong>1.6.1170</strong> (if yours is ' +
         'newer, the launcher has a button that puts it back; Steam does the download ' +
         'under your own account), and ' +
         '<strong>Vortex</strong> with a free Nexus Mods account, which is how the ' +
         'mods get to you.</p>' +
         '<p class="lede"><strong>Eighteen and over.</strong> Downloading or playing ' +
         'Thornswood is you stating that you are eighteen or older.</p>' +
         // The one switch (#428): open when the site's config says so, and
         // this says what is true either way.
         (d.open === true
           ? '<p class="lede"><strong>Thornswood is open.</strong> Anyone can download ' +
             'it, and anyone in the Discord can play. Being there means accepting the ' +
             '<a href="/rules">rules</a>.</p>'
           : '<p class="lede"><strong>Thornswood is in alpha, and the world is open by ' +
             'application.</strong> The installer is open to anybody, so you can download ' +
             'and install it now. Play unlocks once you have applied in the Discord and been ' +
             'given the Playtester role. The application asks whether you are eighteen or ' +
             'over and whether you accept the <a href="/rules">rules</a>, and your answers ' +
             'are kept against your Discord account.</p>');

  // The button belongs under the step that tells you to take it, not above
  // the list where it is the first thing you meet and the instructions are
  // something you scroll past afterwards.
  // "Published by" names who Windows names (#5275, Patrick's answer A on
  // q-installer-publisher), when the entry says so. It said "Thornswood",
  // which is not what the Windows prompt says next. An entry with no
  // publisher names nobody, which the Release's installer is until the site
  // can say who signed it.
  // Where the button goes: /file/<name>, which sends the installer on from
  // where GitHub keeps it (#5608), and any other file from the site itself.
  function fileHref(f) {
    return '/file/' + encodeURIComponent(f.name);
  }
  const by = exe && exe.publisher ? 'Published by ' + esc(exe.publisher) + '<br>' : '';
  let grab = '';
  if (!exe) {
    grab = '<p class="faint">The installer is not published yet.</p>';
  } else {
    grab = '<div class="grab"><a class="btn first" href="' + esc(fileHref(exe)) + '">' +
           'Download the installer</a>' +
           '<p class="also faintly">' + by + esc(human(exe.size)) +
           (exe.version ? ' \u00b7 ' + esc(clock(exe.version)) : '') + sum(exe) + '</p></div>';
  }

  out += (d.open === true
           ? '<h2>Join the Discord, then four steps</h2>' +
             '<div class="steps">' +
             '<div class="step"><div><h3>Come into the Discord</h3>' +
               '<p>Anyone in the Discord can play. Read the <a href="/rules">rules</a>, ' +
               'because being there means accepting them. Your Discord account is what ' +
               'lets you through, so there is nothing else to sign up for.</p>'
           : '<h2>Apply in Discord, then four steps</h2>' +
             '<div class="steps">' +
             '<div class="step"><div><h3>Come into the Discord and apply</h3>' +
               '<p>The installer is open to anybody, and this is the step that unlocks ' +
               'Play. Read the <a href="/rules">rules</a>, then open a ticket and pick ' +
               'Apply to be an alpha playtester. It asks whether you are eighteen or over, ' +
               'whether you accept the rules, and a few lines about who you want to play. ' +
               'It is not an essay, and somebody answers. Once you are accepted your ' +
               'Discord account is what lets you through, so there is nothing else to sign ' +
               'up for.</p>') +
           // The first step is the only one that had no way to do it from
           // here. The installer has its two buttons and the collection has
           // one, and this said come into the Discord without a door. The
           // invite is the site's config, the same one every page names.
           (d.invite
             ? '<div class="grab"><a class="btn first" href="' + esc(d.invite) +
               '" target="_blank" rel="noopener">Open the Discord</a>' +
               '<p class="also faintly">The invite never expires.' +
               (d.open === true ? '' : ' Open a ticket once you are in.') + '</p></div>'
             : '') +
           '</div></div>' +
         '<div class="step"><div><h3>Take the installer</h3>' +
           '<p>One file. Download it and run it. The mods are not in it. It puts in ' +
           'the launcher with Thornswood&rsquo;s own content and opens it, and the ' +
           'launcher asks where to install and puts in the script extender. One box ' +
           'there, Give Thornswood a Skyrim folder of its own, starts ticked. Left ticked, ' +
           'Thornswood writes nothing of its own into your Steam copy, and once Vortex has deployed the ' +
           'launcher builds a game folder of its own from it, mostly as hard links. ' +
           'Unticked, Thornswood&rsquo;s own files go into your Steam copy and the ' +
           'launcher asks before it builds the folder. The SkyMP files in it are free software, and the credits page ' +
           // Beside the download button because that is where the files are
           // handed over. Entry 170 on the To Do List: the source had to be
           // reachable "from the download page". It says where the source is
           // rather than that it is all public, because one SkyMP build in
           // the installer has no recorded version and the page says so.
           'says <a href="/credits#source">where their source code is</a>.</p>' +
           grab + '</div></div>' +
         '<div class="step"><div><h3>Install the collection in Vortex</h3>' +
           '<p>Not optional. Without it you have a launcher and no mods, and the ' +
           'server turns you away when you press Play. The mods come from a ' +
           'collection on Nexus, so every one of them arrives from its own author ' +
           'rather than from a copy of ours, and a mod update stops meaning a ' +
           'reinstall. Vortex keeps them in a profile of their own, so switching ' +
           'back to your usual profile and running Purge Mods leaves you where you ' +
           'started.</p>' +
           // The two stops a new free Nexus account meets before Vortex can
           // start (#4764). The counts are records\collection.json's, held
           // there by tests\test-4764-adult-collection-steps.js.
           '<p>Some of the collection&rsquo;s mods are marked adult, so first turn on ' +
           'adult content in your Nexus Mods settings, or Nexus shows the collection ' +
           'as hidden. On a free account Vortex opens each file&rsquo;s page on Nexus ' +
           'and you press Slow download there, once for each file: 120 files, from ' +
           '111 mods. A Premium account downloads them without pressing anything.</p>' +
           // The step said install the collection and never said where. The
           // address comes from version.json by way of the news feed, so there
           // is one copy of it and it cannot go stale here.
           // The link opens the revision the server was built against, not
           // the collection's page, which Nexus always shows at its newest
           // (#4115): a newer revision than the server's keeps Play shut.
           // The number is the main feed's, which a main Ship sets from the
           // record, so it moves to a new revision by itself the moment the
           // server is released on it, and not before.
           // The link is for a first install only: a collection that comes
           // in by a Nexus link is installed beside the one already there,
           // and only Vortex's own Update replaces it (#5546).
           (d.collection
             ? '<div class="grab"><a class="btn first" href="' + esc(d.collection) +
               '" target="_blank" rel="noopener">' +
               (d.collectionRevision > 0 ? 'Open revision ' + esc(String(d.collectionRevision)) : 'Open the collection') +
               '</a>' +
               '<p class="also faintly">' +
               (d.collectionRevision > 0
                 ? 'Opens revision ' + esc(String(d.collectionRevision)) + ' on Nexus, the one the ' +
                   'server was built against. Install that one in Vortex, not a newer one ' +
                   'Nexus may show first.'
                 : 'Opens on Nexus. Vortex takes it from there.') +
               ' Already have the collection? Do not use this link: open Collections in ' +
               'Vortex and press Update on the Thornswood collection. Installing it again ' +
               'from Nexus adds a second copy beside the first.' +
               '</p></div>'
             : '') +
           '</div></div>' +
         '<div class="step"><div><h3>Connect your Discord in the launcher</h3>' +
           '<p>One click. Your browser opens, you say yes, and it closes itself. ' +
           'You never do it again.</p></div></div>' +
         '<div class="step"><div><h3>Press Play</h3>' +
           '<p>No address to type, no password to remember. Once your Discord has the ' +
           'role, the launcher patches anything that changed and puts you in the ' +
           'world.</p></div></div>' +
         '</div>';

  out += (d.open === true
           ? '<p class="lede lede-mt-34">The installer is open to anybody, ' +
             'and so is the world: the launcher asks Discord who you are every time it ' +
             'starts, and being in the Discord is enough.</p>'
           : '<p class="lede lede-mt-34">The installer is open to anybody, ' +
             'and the world is open by application: the launcher asks Discord who you are ' +
             'every time it starts, so downloading it before you have been accepted just ' +
             'means you are ready when you are.</p>') +
         '<div class="acts acts-start">' +
         '<a class="btn first" href="' + esc(d.invite || '/join') + '" target="_blank" ' +
         'rel="noopener">' + (d.open === true ? 'Join the Discord' : 'Apply in the Discord') + '</a>' +
         '<a class="btn ghost" href="/join">The long version</a></div>';
  return out;
}

Object.assign(module.exports, { AGE_COOKIE, AGE_POLICY });
