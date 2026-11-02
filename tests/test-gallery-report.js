/*
  test-gallery-report.js

      node .\tests\test-gallery-report.js

  The launcher's Gallery page: upload, Report, Accept and Delete, with Play
  keeping the rotating approved spotlight only (#731).

  WHY THIS EXISTS. Issue #731 asked for Report and staff Approve/Delete wired
  to the site's gallery doors. Gavin's ask on 2026-09-27 moved those tools off
  the Play card onto a real Gallery tab/page, and stripped Report / Manage from
  Play.

  THE SITE GREW THAT TICKET DOOR, #743. The six staff doors now share one gate,
  galleryStaff in site\server.js, and it takes the hub cookie or a signed
  launcher ticket whose account is staff (st.dev, a bar higher than the st.play
  the report door asks). So a staff button in the launcher is possible now. It
  is not built: Manage on the site still opens the site page, and this harness
  holds the launcher to that until the launcher lane changes it on purpose.

  The launcher cannot be started from here (the ops repo's CLAUDE.md), so this reads the
  source, the window (launcher\app\MainWindow.axaml since the move to
  Avalonia, #4823, where Shell reaches each named control as win.<Name>) and
  site\server.js and checks the shape:

    - Gallery.Report / Submit / Approve / Reject / TakeDown / Queue talk to
      the right doors over the ticket;
    - Discord.Send and Discord.PostBytes exist so GET/DELETE and raw upload
      work;
    - Play's GalleryCard has no Report or Manage chrome;
    - the Gallery page and NavGallery exist and Shell wires them;
    - a 403 with no why on a staff door is named as an old site;
    - the words follow the house rules.

  Read only. It reads launcher\app\*.cs, launcher\app\MainWindow.axaml and
  site\server.js.
*/
const fs = require('fs');
const path = require('path');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'launcher', 'app');
const GALLERY = fs.readFileSync(path.join(APP, 'Gallery.cs'), 'utf8');
const DISCORD = fs.readFileSync(path.join(APP, 'Discord.cs'), 'utf8');
const SHELL = fs.readFileSync(path.join(APP, 'Shell.cs'), 'utf8');
const XAML = fs.readFileSync(path.join(APP, 'MainWindow.axaml'), 'utf8');
const SERVER = siteFiles.source();

let pass = 0, fail = 0;
const yes = (w, c) => {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); }
};

function body(src, signature) {
  const at = src.indexOf(signature);
  if (at < 0) return '';
  const lineStart = src.lastIndexOf('\n', at) + 1;
  const indent = src.slice(lineStart, at);
  const end = src.indexOf('\n' + indent + '}', at);
  return end < 0 ? '' : src.slice(at, end + indent.length + 2);
}

function literals(src) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
  return out.join('\n');
}

// ---- site doors -------------------------------------------------------------
yes('the site serves POST /api/gallery/report',
    /p === '\/api\/gallery\/report' && req\.method === 'POST'/.test(SERVER));
yes('the site serves POST /api/gallery/submit',
    /p === '\/api\/gallery\/submit' && req\.method === 'POST'/.test(SERVER));
yes('gallery submit allowlist is images plus mp4 and webm',
    /GALLERY_ALLOW = \['\.png', '\.jpg', '\.jpeg', '\.webp', '\.gif', '\.mp4', '\.webm'\]/.test(SERVER));
yes('the site serves GET /api/gallery/who',
    /p === '\/api\/gallery\/who' && req\.method === 'GET'/.test(SERVER));

// Every staff door, through the one gate they share since #743. A door that
// wandered off it, or a gate that stopped asking for staff, is what this
// catches, because either would change what the launcher may do.
const staffDoors = [
  ["p === '/api/gallery/pending' && req.method === 'GET'", '/api/gallery/pending'],
  ["p === '/api/gallery/approve' && req.method === 'POST'", '/api/gallery/approve'],
  ["p === '/api/gallery/approved' && req.method === 'DELETE'", '/api/gallery/approved'],
  ["p === '/api/gallery/reports' && req.method === 'GET'", '/api/gallery/reports'],
  ["p === '/api/gallery/report/dismiss' && req.method === 'POST'", '/api/gallery/report/dismiss']
];
for (const [needle, name] of staffDoors) {
  const at = SERVER.indexOf(needle);
  const door = at < 0 ? '' : SERVER.slice(at, at + 400);
  yes(name + ' is there and goes through galleryStaff, the one staff gate',
      at > 0 &&
      /const gs = await galleryStaff\(url, w\);\s*\n\s*if \(!gs\.ok\) return sendJson\(res, gs\.code, gs\.body\);/.test(door));
}
const gate = body(SERVER, 'async function galleryStaff(url, w)');
yes('the gate is there', gate.length > 0);
yes('it takes the hub cookie who(req) reads', /if \(w\.dev\) return \{ ok: true/.test(gate));
yes('and a launcher ticket out of the query, the way the report door reads one',
    /readTicket\(url\.searchParams\.get\('ticket'\)\)/.test(gate));
yes('a ticket has to be staff: st.dev, not the st.play the report door asks',
    /if \(!st\.dev\) return \{ ok: false, code: 403/.test(gate) && !/st\.play/.test(gate));
yes('it re-asks Discord rather than trusting the ticket on its own, inside Play\'s deadline',
    /within\(standing\(t\.d\), PLAY_ANSWER_MS, \(\) => standingLate\(t\.d\)\)/.test(gate) &&
    /standCache\.delete\(String\(t\.d\)\)/.test(gate));
yes('an account that left, is banned, or could not be looked up is refused',
    /!st\.inGuild/.test(gate) && /st\.banned/.test(gate) && /st\.lookupFailed/.test(gate));
yes('neither cookie nor ticket is the 403 staff only these doors always sent',
    /if \(!t\) return \{ ok: false, code: 403, body: \{ error: 'staff only' \} \};/.test(gate));
yes('who(req) is still the twa cookie and nothing else, so a cookie is not the ticket',
    /const ADMIN\s+= 'twa';/.test(SERVER) &&
    /function identity\(req\) \{\s*\n\s*const raw = cookies\(req\)\[ADMIN\] \|\| '';/.test(SERVER));

// The page the card sends staff to has to be open to the roles the doors let
// in, or Manage on the site lands a Gamemaster back on the hub home (#742).
yes('the hub Gallery page is a staff page, matching the doors',
    /const LEVEL = \{\s*\n\s*uploads: 'staff',/.test(SERVER));
yes('and the page gate knows what a staff page is',
    /LEVEL\[key\] === 'staff' \? !!w\.dev/.test(SERVER));

// ---- Gallery.cs API ---------------------------------------------------------
const report = body(GALLERY, 'public static string Report(string name, string why)');
yes('Gallery.Report is there', report.length > 0);
yes('Report posts to /api/gallery/report with ticket',
    /"\/api\/gallery\/report\?ticket="/.test(report) &&
    /Uri\.EscapeDataString\(Discord\.Ticket\)/.test(report));

const submit = body(GALLERY, 'public static string Submit(string path, string by, string note, out string copies)');
yes('Gallery.Submit is there', submit.length > 0);
yes('Submit posts to /api/gallery/submit with ticket',
    /"\/api\/gallery\/submit\?ticket="/.test(submit));
yes('Submit uses Discord.PostBytes (body is the file)',
    /Discord\.PostBytes\(url, data, ContentTypeFor\(ext\), 60000, out reply\)/.test(submit));
yes('Submit allowlist matches the site images and recordings',
    /AllowExt = new string\[\] \{ \"\.png\", \"\.jpg\", \"\.jpeg\", \"\.webp\", \"\.gif\", \"\.mp4\", \"\.webm\" \}/.test(GALLERY));

yes('Gallery.Approve hits /api/gallery/approve',
    /Staff\("POST", "\/api\/gallery\/approve"/.test(GALLERY));
yes('Gallery.Reject DELETEs /api/gallery/approved for pending',
    /Staff\("DELETE", "\/api\/gallery\/approved"/.test(GALLERY));
yes('Gallery.TakeDown DELETEs /api/gallery/approved',
    /Staff\("DELETE", "\/api\/gallery\/approved"/.test(GALLERY));
yes('Gallery.Queue GETs /api/gallery/pending',
    /Ask\("GET", "\/api\/gallery\/pending"/.test(GALLERY));

const trouble = body(GALLERY, 'static string Trouble(int code, string reply, string what)');
yes('old-site 403 without why is named as an old site',
    /code == 403 && Str\(reply, "why"\)\.Length == 0/.test(trouble) &&
    /does not take staff work from the launcher yet/.test(trouble));

yes('rotation still reads /api/public',
    /Discord\.Site \+ "\/api\/public"/.test(GALLERY));

// ---- Discord helpers --------------------------------------------------------
yes('Discord.Send takes a method',
    /public static int Send\(string method, string url, string json, out string reply\)/.test(DISCORD));
yes('Discord.PostJson is Send with POST',
    /return Send\("POST", url, json, out reply\);/.test(DISCORD));
yes('Discord.PostBytes is there for upload',
    /public static int PostBytes\(string url, byte\[\] data, string contentType, int timeoutMs, out string reply\)/.test(DISCORD));

// ---- Play has no staff chrome; Gallery page does ----------------------------
yes('Play GalleryCard has no BtnGalleryReport',
    !/x:Name="BtnGalleryReport"/.test(XAML));
yes('Play GalleryCard has no BtnGalleryManage',
    !/x:Name="BtnGalleryManage"/.test(XAML));
yes('Play GalleryCard has no GalleryReportRow',
    !/x:Name="GalleryReportRow"/.test(XAML));
yes('Play still has GalleryCard spotlight',
    /x:Name="GalleryCard"/.test(XAML) && /x:Name="GalleryImage"/.test(XAML) && /x:Name="GalleryBy"/.test(XAML));

yes('NavGallery exists', /x:Name="NavGallery"/.test(XAML));
yes('PageGallery exists', /x:Name="PageGallery"/.test(XAML));
for (const name of ['BtnGalleryChoose', 'BtnGallerySend', 'BtnGalleryRefresh',
                    'BoxGalleryBy', 'BoxGalleryNote', 'BoxGalleryWhy',
                    'BtnGalleryReportSend', 'BtnGalleryReportCancel',
                    'GalleryApprovedList',
                    'GalleryPageReportRow', 'TxtGalleryPageSaid',
                    'GalleryDrop', 'GalleryChosenList', 'TxtGalleryDropLead']) {
  yes('MainWindow.axaml has ' + name, XAML.indexOf('x:Name="' + name + '"') > 0);
  yes('Shell.cs takes ' + name + ' from the window', SHELL.indexOf('win.' + name + ';') > 0);
}
yes('no separate waiting section in XAML',
    XAML.indexOf('GalleryStaffBlock') < 0 &&
    XAML.indexOf('GalleryPendingList') < 0 &&
    XAML.indexOf('Waiting for Accept') < 0);
yes('Play keeps From the world header',
    /Text="From the world"/.test(XAML));
yes('Play byline has no from the world suffix',
    SHELL.indexOf(', from the world') < 0 &&
    /galleryBy\.Text = \(shot\.By != null && shot\.By\.Length > 0\)/.test(SHELL));

yes('Gallery.FetchPending loads waiting thumbs with ticket',
    /public static Bitmap FetchPending\(Pending item\)/.test(GALLERY));
yes('Shell wires the drop zone', /WireGalleryDrop\(\)/.test(SHELL));
yes('approved list is a WrapPanel of image cards',
    /WrapPanel x:Name="GalleryApprovedList"/.test(XAML));
yes('pending cards share GalleryApprovedList with Accept in Shell',
    /WrapPanel x:Name="GalleryApprovedList"/.test(XAML) &&
    /FillGalleryGrid\(/.test(SHELL) &&
    /accept\.Content = "Accept"/.test(SHELL) &&
    /GalleryDeletePending\(/.test(SHELL));
yes('Reject button is gone from Shell UI',
    SHELL.indexOf('Content = "Reject"') < 0 &&
    SHELL.indexOf('GalleryReject(') < 0);
yes('staff Accept is not gated on who.Answered',
    /bool staff = GalleryStaff\(\);/.test(SHELL) &&
    !/bool staff = doors && GalleryStaff\(\);/.test(SHELL));

{
  // Last in all three arrays, whatever its number: the Controls page left
  // them in #3126 and the pages after it moved down one.
  const at = Number((/PageGallery = (\d+);/.exec(SHELL) || [])[1]);
  const nav = (/navButtons = new Button\[\] \{([\s\S]*?)\};/.exec(SHELL) || ['', ''])[1].match(/win\.(\w+)/g) || [];
  const grids = (/pages = new Control\[\] \{([\s\S]*?)\};/.exec(SHELL) || ['', ''])[1].match(/win\.(\w+)/g) || [];
  const titles = ((/PageTitles = \{([\s\S]*?)\};/.exec(SHELL) || ['', ''])[1].match(/"[^"]*"/g) || []);
  yes('PageGallery (' + at + ') is the last index of the three arrays (' + nav.length + ', ' + grids.length + ', ' + titles.length + ')',
      at === nav.length - 1 && at === grids.length - 1 && at === titles.length - 1 &&
      nav[at] === 'win.NavGallery' && grids[at] === 'win.PageGallery' && titles[at] === '"Gallery"');
}
yes('ShowPage rebuilds the Gallery page',
    /else if \(i == PageGallery\) BuildGalleryPage\(\);/.test(SHELL));
yes('Choose wires to GalleryChooseFile',
    /btnGalleryChoose\.Click \+= delegate \{ GalleryChooseFile\(\); \}/.test(SHELL));
yes('Send wires to GallerySendChosen',
    /btnGallerySend\.Click \+= delegate \{ GallerySendChosen\(\); \}/.test(SHELL));
yes('Accept calls Gallery.Approve with the copies the card showed',
    /Gallery\.Approve\(name, shown\)/.test(SHELL) &&
    /accept\.Click \+= delegate \{ GalleryAccept\(name, copies\); \}/.test(SHELL));
yes('Delete calls Gallery.TakeDown',
    /Gallery\.TakeDown\(name\)/.test(SHELL));
yes('Delete pending still uses Gallery.Reject API under Delete',
    /GalleryDeletePending\(/.test(SHELL) &&
    /Gallery\.Reject\(name\)/.test(SHELL));
yes('Auto load / StartOnSaveInstalled row is gone from Checks',
    (function () {
      const checks = fs.readFileSync(path.join(APP, 'Checks.cs'), 'utf8');
      return checks.indexOf('StartOnSaveInstalled') < 0 &&
             checks.indexOf('Auto load') < 0;
    })());
yes('WriteStartIni is gone from Chars (#394; tests\\test-start-on-save-gone.js holds the rest)',
    !/WriteStartIni/.test(fs.readFileSync(path.join(APP, 'Chars.cs'), 'utf8')));

// reports inbox stays at the site
const csFiles = fs.readdirSync(APP).filter(f => f.endsWith('.cs'));
for (const door of ['/api/gallery/reports', '/api/gallery/report/dismiss']) {
  let hits = 0;
  for (const f of csFiles) {
    const src = fs.readFileSync(path.join(APP, f), 'utf8');
    hits += (src.split('"' + door).length - 1);
  }
  yes('nothing in the launcher calls ' + door, hits === 0);
}

// ---- words ------------------------------------------------------------------
const words = literals(report) + '\n' + literals(submit) + '\n' +
              literals(body(SHELL, 'static void GallerySendChosen()')) + '\n' +
              literals(body(SHELL, 'static void OpenGalleryReport(Gallery.Shot shot)'));
yes('no "player" in gallery copy', !/\bplayers?\b/i.test(words));
yes('no em or en dash in gallery copy', !/[\u2013\u2014]/.test(words));
yes('Thornswood is spelt Thornswood', !/ThornsWood/.test(words + GALLERY + XAML + SHELL));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
