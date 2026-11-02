'use strict';
// test-component-readmes.js
//
// Six folders under tools each say, in a README, what they hold, how to run or
// change it on a machine, and where it runs. And the setup block in
// the guide's setup block (docs/guide/set-up-a-machine.md) says the dev
// channel needs the dev build installed and run once.
//
// WHY THIS EXISTS. From the To Do List: "Four deployable components have no
// README, and the dev release path has never been proven end to end". On 19
// September the dev build on the second machine had never been run, so it had
// no game folder of its own and Ship built the dev release out of the Steam
// copy. The setup block listed git, gh, node and Python and never mentioned the
// dev build, although every change goes to the dev build first. And none of
// these six folders had a word written about it outside the code:
// launcher reads like the launcher's source and its compiled window, and
// installer holds what the install hands over, while the install itself is
// in the launcher's first start (#4824).
//
// A README is worth having only while it is true, so this checks what each one
// states against the code that decides it, not only that the file is there:
// the ports are read out of server.js, voice-server.js and DevBuild.cs, the
// folders and tasks out of the scripts that install them, every script and
// repo path a README names has to exist, and every THORNSWOOD_ setting it names
// has to be one that folder's code reads. When one of these fails after a code
// change, the README is what has gone wrong; change the README.
//
// TWO THINGS IT USED TO GET WRONG, both fixed here rather than in what they
// read, because in both the document and the window were right and this file
// was behind.
//
// The three sections were read as the whole of a README. site\README.md has a
// fourth, `## The gallery`, a table of the ten gallery routes and who may ask
// them, which is worth having and does not belong under any of the three. So
// the three are what a README OPENS with, in that order, and a folder may say
// more after them; every section, the extra ones included, still has to say
// something.
//
// And the two buttons were read as a Content attribute on the Button, which is
// how a button with a plain label is written. BtnServerDev stopped being one:
// the dev build moved onto the Play page's server dropdown (#703), and that
// entry is a dot, a label and a line of grey meta, so its label is a nested
// TextBlock and Content is not there at all. The regex found nothing and the
// failure read `as the launcher labels it, "undefined"`, which is this harness
// describing itself. Label() below takes either shape.
//
// It also checks that nothing which carries these folders to people would
// carry a README with them. Go.ps1 copies the overlays and the plugins by
// filter, Deploy-Docs and Install-Voice send named files, and Build-Launcher
// embeds and compiles by name. A README.md in Data\Platform would be a stray
// file in every pack.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const siteFiles = require('./site-files');

const ROOT = REPO_DIR;
const CR = String.fromCharCode(13);
// A backslash, built rather than typed, so no tool on the way can eat it.
const BS = String.fromCharCode(92);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join(''); }
  catch (e) { return null; }
}
function exists(rel) {
  try { fs.statSync(path.join(ROOT, rel)); return true; } catch (e) { return false; }
}
function uniq(a) {
  return a.filter(function (x, i) { return a.indexOf(x) === i; });
}
function files(rel) {
  try {
    return fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })
      .filter(function (e) { return e.isFile(); })
      .map(function (e) { return e.name; });
  } catch (e) { return []; }
}
// Whether git is told to leave this path alone: build output, or one
// machine's own file. A README may name those without them being here.
function ignored(rel) {
  try {
    execSync('git check-ignore -q -- "' + rel + '"', { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch (e) { return false; }
}
function tracked(rel) {
  try {
    return execSync('git ls-files -- "' + rel + '"', { cwd: ROOT }).toString().trim().length > 0;
  } catch (e) { return null; }
}
// What a button in the launcher's window (launcher\app\MainWindow.axaml) says on it, whichever way it is written: the
// Content attribute for a plain label, or the first nested TextBlock's Text for
// one built out of a dot, a label and a line of meta, which is how every entry
// in the Play page's server dropdown is written. '' when there is no such
// button, so a renamed control reads as missing rather than as a label.
function label(ui, buttonName) {
  const at = ui.indexOf('x:Name="' + buttonName + '"');
  if (at < 0) { return ''; }
  const open = ui.lastIndexOf('<Button', at);
  if (open < 0) { return ''; }
  const openEnd = ui.indexOf('>', at);
  if (openEnd < 0) { return ''; }
  const openTag = ui.slice(open, openEnd + 1);
  const content = /\bContent="([^"]+)"/.exec(openTag);
  if (content) { return content[1]; }
  // Self closing and no Content: nothing is written on it.
  if (ui[openEnd - 1] === '/') { return ''; }
  const shut = ui.indexOf('</Button>', openEnd);
  if (shut < 0) { return ''; }
  const inner = ui.slice(openEnd + 1, shut);
  const text = /<TextBlock[^>]*\bText="([^"]+)"/.exec(inner);
  return text ? text[1] : '';
}
// That label as its own word, so a paragraph naming Thornswood-DevBuild is not
// mistaken for one naming the Dev entry.
function namesLabel(text, lbl) {
  if (!lbl) { return false; }
  const esc = lbl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^A-Za-z])' + esc + '(?![A-Za-z])').test(text);
}

// A PowerShell -Filter glob as a regular expression.
function glob(f) {
  const g = f.replace(/^['"]|['"]$/g, '');
  const src = g.split('').map(function (c) {
    if (c === '*') { return '.*'; }
    if (c === '?') { return '.'; }
    return c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp('^' + src + '$', 'i');
}

const SIX = ['docs-app', 'voice', 'ts-plugins', 'ts-ui', 'setup', 'launcher'];
// Where each lives: voice left tools for the repository root on 25 September.
const AT = { 'voice': 'voice', 'docs-app': 'site', 'ts-plugins': 'game/plugins', 'ts-ui': 'game/ui',
  'launcher': 'launcher', 'setup': 'installer' };
function at(d) { return AT[d] || ('tools/' + d); }
const HEADS = ['## What it is', '## On your machine', '## Where it runs'];
const readme = {};
SIX.forEach(function (d) { readme[d] = read(at(d) + '/README.md'); });

// ------------------------------------------------------ every README, alike --
SIX.forEach(function (d) {
  const t = readme[d];
  const name = at(d).split('/').join(BS);
  yes(name + ' has a README.md', t !== null);
  if (t === null) { return; }
  const lines = t.split('\n');
  yes(name + ': it starts with a title', /^# \S/.test(lines[0]));
  const heads = lines.filter(function (l) { return /^## /.test(l); });
  // The three come first, in order. Anything after them is that folder's own
  // detail, and site\README.md has one: `## The gallery`.
  yes(name + ': it opens with the three sections, in order: what it is, on your machine, where it runs' +
      (heads.length > 3 ? ', then ' + heads.slice(3).join(', ') : ''),
      JSON.stringify(heads.slice(0, 3)) === JSON.stringify(HEADS));
  const parts = t.split(/^## .*$/m).slice(1);
  yes(name + ': every section says something, the extra ones included (' + parts.length + ')',
      parts.length === heads.length && parts.length >= 3 && parts.every(function (p) {
        return p.replace(/\s+/g, ' ').trim().split(' ').length >= 25;
      }));

  // The words rules, and no names: operational documents are losing names.
  yes(name + ': it never says player', !/\bplayers?\b/i.test(t));
  yes(name + ': no em dash and no en dash', t.indexOf('\u2014') < 0 && t.indexOf('\u2013') < 0);
  yes(name + ': it names nobody', !/\b(Patrick|Djinn|Gavin|WiccanDjinn|EvilPatrick06)\b/.test(t));
  yes(name + ': no placeholder left in it', !/\b(TODO|TBD|FIXME|XXX)\b/.test(t) && !/lorem ipsum/i.test(t));

  const scripts = uniq(t.match(/\b[A-Z][A-Za-z]*(?:-[A-Z][A-Za-z]*)*\.ps1\b/g) || []);
  // In scripts\<area> since phase 8 of issue #440.
  const noScript = scripts.filter(function (s) {
    return !['release', 'deploy', 'vps', 'ops', 'mods', 'dev'].some(function (a) { return exists('scripts/' + a + '/' + s); });
  });
  yes(name + ': every script it names is in scripts (' + scripts.length + ' named)' +
      (noScript.length ? ', missing ' + noScript.join(', ') : ''), noScript.length === 0);

  const re = new RegExp('tools' + BS + BS + '[A-Za-z0-9_.*' + BS + BS + '-]+', 'g');
  const paths = uniq((t.match(re) || []).map(function (p) {
    return p.replace(/[.\\,]+$/, '');
  })).filter(function (p) { return p.indexOf('*') < 0; });
  const noPath = paths.filter(function (p) {
    const rel = p.split(BS).join('/');
    return !exists(rel) && !ignored(rel);
  });
  yes(name + ': every repo path it names is here, or is one git is told to ignore (' +
      paths.length + ' named)' + (noPath.length ? ', missing ' + noPath.join(', ') : ''),
      noPath.length === 0);

  // The code beside it, and in its lib folder when it has one (the site's
  // modules since #5357).
  const code = files(at(d)).map(function (f) { return at(d) + '/' + f; })
    .concat(files(at(d) + '/lib').map(function (f) { return at(d) + '/lib/' + f; }))
    .filter(function (f) { return /\.(js|cs|html)$/.test(f); })
    .map(function (f) { return read(f) || ''; }).join('\n');
  const settings = uniq(t.match(/THORNSWOOD_[A-Z_]+/g) || []);
  const unread = settings.filter(function (s) { return code.indexOf(s) < 0; });
  yes(name + ': every THORNSWOOD_ setting it names is read by the code beside it (' +
      settings.length + ' named)' + (unread.length ? ', not read: ' + unread.join(', ') : ''),
      unread.length === 0);

  const ours = uniq((t.match(/`thornswood-[\w-]+\.(?:js|mp3)`/g) || []).map(function (s) {
    return s.replace(/`/g, '');
  }));
  const nowhere = ours.filter(function (n) {
    return !exists('game/plugins/' + n) && !exists('game/ui/' + n);
  });
  yes(name + ': every plugin or overlay file it names exists (' + ours.length + ' named)' +
      (nowhere.length ? ', missing ' + nowhere.join(', ') : ''), nowhere.length === 0);
});

// ------------------------------------------------------------------ the site --
{
  const t = readme['docs-app'] || '';
  const server = siteFiles.source() || '';
  const deploy = read('scripts/deploy/Deploy-Docs.ps1') || '';
  const port = (/THORNSWOOD_DOCS_PORT \|\| (\d+)/.exec(server) || [])[1];
  yes('site: server.js has a default port to hold the README to', !!port);
  yes('site: the README gives it, 127.0.0.1:' + port, !!port && t.indexOf('127.0.0.1:' + port) >= 0);
  const dPort = (/\[int\]\$Port\s*=\s*(\d+)/.exec(deploy) || [])[1];
  yes('site: Deploy-Docs.ps1 starts it on that same port', !!dPort && dPort === port);
  const dRoot = (/\[string\]\$Root\s*=\s*'([^']+)'/.exec(deploy) || [])[1];
  yes('site: the README names the folder Deploy-Docs.ps1 puts it in, ' + dRoot,
      !!dRoot && t.indexOf(dRoot.split('/').join(BS)) >= 0);
  const dTask = (/\[string\]\$Task\s*=\s*'([^']+)'/.exec(deploy) || [])[1];
  yes('site: and the scheduled task it runs under, ' + dTask, !!dTask && t.indexOf('`' + dTask + '`') >= 0);
  yes('site: the door routes the README names are ones server.js answers',
      server.indexOf("'/api/allowed'") >= 0 && server.indexOf("'/dev/api/allowed'") >= 0 &&
      t.indexOf('/api/allowed') >= 0 && t.indexOf('/dev/api/allowed') >= 0);
}

// ------------------------------------------------------------------- voice --
{
  const t = readme.voice || '';
  const vs = read('voice/voice-server.js') || '';
  const dev = read('launcher/app/DevBuild.cs') || '';
  const iv = read('scripts/deploy/Install-Voice.ps1') || '';
  const watch = read('scripts/vps/Watch-Services.ps1') || '';
  const live = (/THORNSWOOD_VOICE_PORT \|\| (\d+)/.exec(vs) || [])[1];
  const devPort = (/DevVoicePort = "(\d+)"/.exec(dev) || [])[1];
  yes('voice: the live port read out of voice-server.js and the dev one out of DevBuild.cs',
      !!live && !!devPort);
  yes('voice: the README gives both, ' + live + ' and ' + devPort,
      !!live && !!devPort && t.indexOf(live) >= 0 && t.indexOf(devPort) >= 0);
  const ivRoot = (/\[string\]\$Root\s*=\s*'([^']+)'/.exec(iv) || [])[1];
  const ivTask = (/\[string\]\$TaskName\s*=\s*'([^']+)'/.exec(iv) || [])[1];
  yes('voice: the README names the folder and task Install-Voice.ps1 puts the live service in, ' +
      ivRoot + ' and ' + ivTask,
      !!ivRoot && !!ivTask && t.indexOf('`' + ivRoot + '`') >= 0 && t.indexOf('`' + ivTask + '`') >= 0);
  const devSvc = /Name = 'dev voice'; Task = '([^']+)';\s*Port = (\d+)/.exec(watch) || [];
  yes('voice: the dev task and port the README gives are the ones Watch-Services.ps1 watches',
      devSvc.length === 3 && devSvc[2] === devPort &&
      t.indexOf("-TaskName '" + devSvc[1] + "'") >= 0 && t.indexOf('-Port ' + devSvc[2]) >= 0);
  yes('voice: the three switches the README gives for the dev service are ones Install-Voice.ps1 takes',
      /\[string\]\$Root\b/.test(iv) && /\[int\]\$Port\b/.test(iv) && /\[string\]\$TaskName\b/.test(iv));
  yes('voice: /health reports the BUILD string, as the README says',
      /const BUILD = '/.test(vs) && /build: BUILD/.test(vs) && t.indexOf('`BUILD`') >= 0);
  // The README says the feed lives only in the gamemode, between its markers,
  // and reads its port. The older copy beside the service went in #2736.
  const gm = read('game/gamemode.js') || '';
  const a = gm.indexOf('// ==== thornswood voice feed, added by Add-VoiceFeed.ps1 ====');
  const b = gm.indexOf('// ==== end thornswood voice feed ====');
  const block = (a >= 0 && b > a) ? gm.slice(a, b) : '';
  yes('voice: the gamemode carries the voice feed block between its markers', block.length > 0);
  yes('voice: as the README says, that block reads its port from server-settings.json',
      /VOICE_PORT = voicePort\(\)/.test(block) && t.indexOf('server-settings.json') >= 0);
  yes('voice: and it is the only copy, as the README says',
      read('voice/gamemode-voice.js') === null && read('scripts/deploy/Add-VoiceFeed.ps1') === null &&
      t.indexOf('went in #2736') >= 0);
}

// ----------------------------------------------------------------- plugins --
{
  const t = readme['ts-plugins'] || '';
  const go = read('scripts/release/Go.ps1') || '';
  const keep = read('launcher/app/Keep.cs') || '';
  const rules = read('scripts/release/Ship-Rules.ps1') || '';
  // Go.ps1's default -Game is the Game folder of the install Where.ps1 finds
  // (#3003), and the README says so rather than naming one machine's path.
  const asksInstall = go.indexOf("[string] $Game   = ((& (Join-Path $PSScriptRoot 'Where.ps1') Install) + '" + BS + "Game')") >= 0;
  yes('plugins: Go.ps1 installs into the Game folder of the install Where.ps1 finds, as the README says',
      asksInstall && t.indexOf('`Where.ps1 Install`') >= 0 &&
      t.indexOf('`Game' + BS + 'Data' + BS + 'Platform' + BS + 'Plugins`') >= 0);
  const serverPart = go.indexOf('if (-not $SkipServer)');
  yes('plugins: Go.ps1 still copies the voice service to the VPS unless it is given -SkipServer, ' +
      'which is why the README says to pass it',
      serverPart >= 0 && go.indexOf("'.." + BS + ".." + BS + "voice" + BS + "voice-server.js'", serverPart) > serverPart &&
      t.indexOf('Go.ps1 -SkipServer') >= 0 && (readme['ts-ui'] || '').indexOf('Go.ps1 -SkipServer') >= 0);
  yes('plugins: Keep and Ship-Rules still tell ours by the thornswood- name the README gives',
      keep.indexOf('StartsWith("thornswood-"') >= 0 && rules.indexOf("'thornswood-*.js'") >= 0 &&
      t.indexOf('`thornswood-*.js`') >= 0);
  yes('plugins: the retired thornswood-chargen.js is gone, and the README no longer names it',
      read('game/plugins/thornswood-chargen.js') === null && t.indexOf('thornswood-chargen') < 0);
}

// ---------------------------------------------------------------- overlays --
{
  const t = readme['ts-ui'] || '';
  const front = read('game/plugins/thornswood-front.js') || '';
  const go = read('scripts/release/Go.ps1') || '';
  yes('overlays: thornswood-front.js still has the OVERLAYS list a new overlay has to join',
      /const OVERLAYS = \[/.test(front) && t.indexOf('`OVERLAYS`') >= 0);
  yes('overlays: Go.ps1 still takes the front from thornswood-front.zip, as the README says',
      go.indexOf("local" + BS + "thornswood-front.zip'") >= 0 && t.indexOf('thornswood-front.zip') >= 0);
  const zip = tracked('local/thornswood-front.zip');
  yes('overlays: and that zip is not in git, as the README says', zip === false);
}

// --------------------------------------------------------- launcher --
{
  const t = readme.launcher || '';
  const bl = read('scripts/release/Build-Launcher.ps1') || '';
  const art = read('launcher/app/Art.cs') || '';
  const held = files('launcher');
  // Since phase 7 (issue #440) this is the whole launcher: the source, the
  // window, the icon and the art. Since #4823 the window is compiled markup
  // in launcher\app (MainWindow.axaml, with App.axaml), not a ui.xaml read at
  // run time, and voice is the launcher's own code, so there is no voice page
  // and no WebView2 or NLayer file under launcher\lib.
  yes('launcher: holds the art and the key template, and no ui.xaml or voice page (' + held.join(', ') + ')',
      held.indexOf('launcher-header.webp') >= 0 && held.indexOf('Thornswood.ini') >= 0 &&
      held.indexOf('ui.xaml') < 0 && held.indexOf('voice-host.html') < 0 && !exists('launcher/lib'));
  yes('launcher: the source folder holds the compiled window and the application',
      exists('launcher/app/Shell.cs') && exists('launcher/app/MainWindow.axaml') &&
      exists('launcher/app/MainWindow.axaml.cs') && exists('launcher/app/App.axaml'));
  // Since #498's switch the project file says what goes in, and Build-Launcher.ps1 builds it.
  const appProj = read('launcher/app/Thornswood.csproj') || '';
  yes('launcher: Thornswood.csproj embeds the moving header strip by name, and Build-Launcher.ps1 builds that project',
      /<EmbeddedResource Include="\.\.\\launcher-header\.webp"><LogicalName>launcher-header\.webp<\/LogicalName>/.test(appProj) &&
      bl.indexOf("Join-Path $Src 'Thornswood.csproj'") >= 0);
  yes('launcher: Art.cs loads it by that name', art.indexOf('"launcher-header.webp"') >= 0);
  yes('launcher: the README says where the source and the window are',
      t.indexOf('`launcher' + BS + 'app`') >= 0 && t.indexOf('MainWindow.axaml') >= 0 &&
      t.indexOf('App.axaml') >= 0 && t.indexOf('launcher-header.webp') >= 0);
  yes('launcher: the README says how it is built, with dotnet publish and Native AOT, not MSBuild',
      /dotnet publish/.test(t) && /Native AOT/.test(t) && !/\bMSBuild\b/.test(t));
}

// ------------------------------------------------------------ installer --
// Since #4824 the install is compiled code in the launcher's first start and
// Velopack's Setup.exe: no setup program, script or batch file of its own.
{
  const t = readme.setup || '';
  const bl = read('scripts/release/Build-Launcher.ps1') || '';
  const place = read('launcher/app/InstallPlace.cs') || '';
  const held = files('installer').filter(function (f) { return f !== 'README.md'; });
  // READ ME FIRST.txt went with #4824: Velopack's Setup.exe carries no loose
  // page, and the join guide on the site is what a person reads.
  yes('installer: holds licences and nothing else, nothing to compile or run (' + held.join(', ') + ')',
      held.length === 0 && exists('installer/licences/README.txt') && !exists('installer/READ ME FIRST.txt') &&
      !exists('installer/setup') && t.indexOf('`licences' + BS + '`') >= 0 && /\bhttps:\/\/thornswood\.net\/join\b/.test(t));
  yes('installer: the README names where the install is, and those files are there',
      ['InstallWindow.cs', 'InstallSteps.cs', 'InstallPlace.cs'].every(function (f) {
        return exists('launcher/app/' + f) && t.indexOf('launcher' + BS + 'app' + BS + f) >= 0;
      }));
  yes('installer: Build-Launcher.ps1 builds no setup program of its own',
      bl.indexOf('Setup.csproj') < 0 && bl.indexOf('setup-stub.exe') < 0);
  const inst = (/return @"([^"]+)";/.exec(place) || [])[1];
  yes('installer: the README gives the install folder InstallPlace.cs falls back to, ' + inst,
      !!inst && t.indexOf('`' + inst + '`') >= 0);
  yes('installer: the README says the script and the batch files are gone and nothing falls back to them',
      /Setup-Thornswood/.test(t) && /nothing falls back to them/.test(t));
}

// ------------------------------------------- nothing carries a README out --
{
  const go = read('scripts/release/Go.ps1') || '';
  const filters = { ui: [], pl: [] };
  let bare = 0;
  go.split('\n').forEach(function (l) {
    const m = /Get-ChildItem\s+-LiteralPath\s+\$(uiSrc|plSrc)\b/.exec(l);
    if (!m) { return; }
    const f = /-Filter\s+([^\s)]+)/.exec(l);
    if (!f) { bare++; return; }
    filters[m[1] === 'uiSrc' ? 'ui' : 'pl'].push(f[1]);
  });
  yes('Go.ps1 lists the overlays and the plugins only through filters (' +
      filters.ui.join(' ') + ' and ' + filters.pl.join(' ') + ')',
      filters.ui.length > 0 && filters.pl.length > 0 && bare === 0);
  // The filters are read right only if they still take what they are for.
  yes('those filters, read as globs, take the overlays and the plugins they are for',
      filters.ui.some(function (f) { return glob(f).test('thornswood-chat.js'); }) &&
      filters.pl.some(function (f) { return glob(f).test('thornswood-front.js'); }));
  yes('and none of them would copy README.md into the game folder',
      filters.ui.concat(filters.pl).every(function (f) { return !glob(f).test('README.md'); }));

  const dd = read('scripts/deploy/Deploy-Docs.ps1') || '';
  const lists = dd.split('\n').filter(function (l) {
    return /Get-ChildItem\s+(\(Join-Path \$App\b|(-LiteralPath\s+)?\$App\b)/.test(l);
  });
  // Since #446 and #459 the site goes up as one artifact, and server.js is in
  // it by name beside its modules in lib (#5357), public and data, not by a
  // copy of the folder it sits in.
  const art = /New-ThornswoodArtifact -Component site [^\n]*-Paths ([^\n]+)/.exec(dd);
  const artPaths = art ? (art[1].match(/'[^']+'/g) || []).map(function (q) { return q.slice(1, -1); }) : [];
  yes('Deploy-Docs.ps1 lists lib, public, data and data/site, never the folder the README sits in',
      lists.length > 0 && lists.every(function (l) {
        return /Get-ChildItem \(Join-Path \$App '(lib|public|data|data\/site)'\)/.test(l);
      }) &&
      artPaths.length > 0 && artPaths.indexOf('site/server.js') >= 0 &&
      artPaths.every(function (q) { return /^site\/(server\.js|lib|public|data)$/.test(q); }));

  const iv = read('scripts/deploy/Install-Voice.ps1') || '';
  const sent = (/foreach \(\$f in ('[^)]*')\)/.exec(iv) || [])[1];
  // What goes up is the $send table since #1093 (staged, checked, swapped).
  // The one Get-ChildItem it has lists the old .stage-* folders on the box to
  // clear them, with -Directory; any listing of files would be a wildcard
  // send, so only folder listings are let through.
  const sendKeys = [];
  iv.replace(/\$send\['([^']+)'\]\s*=/g, function (m, k) { sendKeys.push(k); return m; });
  const fileLists = iv.split('\n').filter(function (l) { return /Get-ChildItem/.test(l) && !/-Directory\b/.test(l); });
  yes('Install-Voice.ps1 sends named files, with no wildcard (' + sent + '; sends ' + sendKeys.join(', ') + ')',
      !!sent && sent.indexOf('*') < 0 && !/README/i.test(sent) &&
      sendKeys.length > 0 && sendKeys.every(function (k) { return k.indexOf('*') < 0 && !/README/i.test(k); }) &&
      fileLists.length === 0);

  const bl = read('scripts/release/Build-Launcher.ps1') || '';
  yes('Build-Launcher.ps1 never lists launcher or installer, so only the named file goes in',
      !bl.split('\n').some(function (l) {
        return /Get-ChildItem/.test(l) && /'(\.\.\\launcher|\.\.\\installer\\setup|launcher|setup)(['\\])/.test(l);
      }));
}

// ------------------------------------------------------------- the guide --
// The guide is Developer-Guide.md, an index, and its pages in docs/guide
// (tests/guide-text.js). The pieces table is on the-system.md and the setup
// block on set-up-a-machine.md.
{
  const guide = require('./guide-text.js');
  const sd = guide.whole();
  const pieces = guide.page('the-system').split('\n');
  yes('docs/guide/the-system.md\'s pieces table has a Dev build row naming Thornswood-DevBuild',
      pieces.some(function (l) { return /^\| Dev build \|/.test(l) && l.indexOf('Thornswood-DevBuild') >= 0; }));
  const lines = guide.page('set-up-a-machine').split('\n');
  const hits = [];
  lines.forEach(function (l, i) { if (l.indexOf('Thornswood-DevBuild') >= 0) { hits.push(i); } });

  const setupAt = lines.findIndex(function (l) { return /^#{2,3} Setting up a machine$/.test(l); });
  let nextHead = lines.length;
  const setupLevel = setupAt >= 0 ? lines[setupAt].match(/^#+/)[0].length : 2;
  for (let i = setupAt + 1; setupAt >= 0 && i < lines.length; i++) {
    const marks = lines[i].match(/^(#+)\s/);
    if (marks && marks[1].length <= setupLevel) { nextHead = i; break; }
  }
  let ghAt = -1, baseAt = -1;
  for (let i = setupAt + 1; setupAt >= 0 && i < nextHead; i++) {
    if (ghAt < 0 && lines[i] === 'gh auth status') { ghAt = i; }
    if (baseAt < 0 && lines[i].indexOf('Publish-Update.ps1 -Baseline') >= 0) { baseAt = i; }
  }
  const inSetup = hits.filter(function (i) { return ghAt > 0 && baseAt > ghAt && i > ghAt && i < baseAt; });
  yes('the other is in the setup block, after gh auth status and before the first release instruction',
      inSetup.length >= 1);

  // The paragraph around it: from the blank line before to the blank line after.
  let para = '';
  if (inSetup.length) {
    let s = inSetup[0], e = inSetup[0];
    while (s > 0 && lines[s - 1].trim() !== '') { s--; }
    while (e < lines.length - 1 && lines[e + 1].trim() !== '') { e++; }
    para = lines.slice(s, e + 1).join('\n');
  }
  const ui = read('launcher/app/MainWindow.axaml') || '';
  const shell = read('launcher/app/Shell.cs') || '';
  const install = label(ui, 'BtnServerDev');
  const make = label(ui, 'BtnOwnGameMake');
  yes('the setup paragraph names the entry that installs the dev build as the launcher labels it, "' +
      install + '"', namesLabel(para, install));
  yes('and the one that makes its game folder, "' + make + '"', !!make && para.indexOf('"' + make + '"') >= 0);
  // Which entry that is, measured rather than taken from the paragraph. The
  // label above is only worth checking while this is the control that does it.
  yes('that entry is in the dropdown the paragraph sends a reader to, under the server button',
      /<Popup x:Name="ServerPickPopup"[^>]*[\s\S]*?#BtnServerPick\b/.test(ui) &&
      ui.indexOf('x:Name="BtnServerPick"') < ui.indexOf('x:Name="BtnServerDev"') &&
      /Play page/.test(para) && /dropdown/.test(para));
  yes('and pressing it is what installs the dev build (Shell.cs, SwitchToDev)',
      /btnServerDev\s*=\s*win\.BtnServerDev\b/.test(shell) &&
      /btnServerDev\.Click\s*\+=[\s\S]{0,160}?SwitchToDev\(\)/.test(shell) &&
      /static void SwitchToDev\(\)[\s\S]*?DevBuild\.Install\(/.test(shell));

  const ship = read('scripts/release/Ship.ps1') || '';
  yes('Ship.ps1 refuses the dev channel without the dev build, as the paragraph says',
      /No dev build at \$Root\./.test(ship) && /refuses `-Channel dev`/.test(para));
  // #2662: only the folder Ship finds for itself is refused. A folder named
  // with -Root or recorded with Setup-ShipMachine is not, and the paragraph
  // says so.
  yes('and only the folder it finds for itself: one named with -Root or recorded with Setup-ShipMachine is not refused, ' +
      'as the paragraph says (#2662)',
      /function Get-DevRootRefusal\(\[string\]\$Root, \[bool\]\$RootGiven, \[string\]\$Recorded\)\s*\{\s*if \(\$RootGiven -or \$Recorded\) \{ return '' \}/.test(ship) &&
      /'ShipRootNamedDev'/.test(ship) &&
      /refusal is for `<drive>:\\Thornswood-DevBuild` only/.test(para) && /`-Root`/.test(para) &&
      /Setup-ShipMachine\.ps1 -Channel dev -Root <folder>/.test(para) && /#2662/.test(para));
  // If Ship stops falling back to the Steam copy, this fails, and the
  // sentence in docs/guide/set-up-a-machine.md that warns about it is what to change.
  yes('Ship.ps1 still builds the dev release out of the Steam copy when the dev build has no game folder, ' +
      'which the paragraph warns about',
      ship.indexOf("$goArgs['Vortex'] = $true") >= 0 && /Steam\s+copy/.test(para));
  const ready = read('scripts/release/Check-ShipReady.ps1') || '';
  yes('it names the pre-flight, Check-ShipReady.ps1 -Channel dev, which takes that channel',
      para.indexOf('Check-ShipReady.ps1 -Channel dev') >= 0 && ready.indexOf("[ValidateSet('main','dev')]") >= 0);
  yes('the paragraph keeps the words rules',
      para.length > 0 && !/\bplayers?\b/i.test(para) && para.indexOf('\u2014') < 0);

  const own = read('launcher/app/ShellOwnGame.cs') || '';
  yes('the dev channel section no longer says the dev build starts on the Steam copy, which Play refuses',
      sd.indexOf('so it starts on the Steam copy') < 0 && /static bool OwnGameRequired\(\)/.test(own) &&
      /Play will\s+not start the game out of the Steam copy/.test(sd));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
