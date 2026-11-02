// test-third-party.js
//
// THIRD-PARTY.md names what Thornswood hands out that somebody else wrote, and
// the public credits page carries the directions to the source. This holds
// both to the build, so neither can drift away from what actually ships.
//
// From the To Do List, entry 171: "There is no licence on this project and no
// third-party notices file anywhere." Its done-when asks that every /resource:
// in Build-Launcher.ps1 and every file under launcher\lib be "either the project's
// own or listed by name and licence", and it asks for that cross-check to be
// made "mechanically rather than by memory". This is that check. Since #4823
// the launcher keeps no library files under launcher\lib: every library is a
// package reference in Thornswood.csproj, compiled into the native exe, and
// three native libraries go beside it. So the check is now every resource the
// project embeds, every package it references and every package those bring,
// by version and licence, and each native library by its sha256.
//
// It also keeps the source offer honest. The GPL (section 6) and the AGPL
// (section 13) want the directions to lead to the source of what actually
// ships. When New-ClientBuildRecord.ps1 or New-ServerBuildRecord.ps1 records a
// new fork commit, this fails until THIRD-PARTY.md and credits.md name it.
// tests\test-one-engine.js holds the engine\skymp pin to those two records, so
// the pin, the records and both pages name one commit. It runs in the build
// check on every pull request since #1720. Run only at night, it let one pull
// request after another move the pin and the records on 3 and 4 October
// (#1568 to #1573) while THIRD-PARTY.md kept naming d6c99400, and nothing on
// those pull requests said so; #1689 put both pages right.
//
// Measured when it was written, on 24 September: the three WebView2 files were
// byte for byte Microsoft.Web.WebView2 1.0.2903.40 from nuget.org (gone with
// #4823), the six
// client files in the game folder match client-build.json, and
// MpClientPlugin.dll is built from skymp5-server, which is AGPL, not GPL.
//
// Where a clone of the fork that holds the recorded commit is on this machine
// (engine\skymp, C:\Thornswood-Dev\skymp, or THORNSWOOD_SKYMP), it also reads each
// subproject's LICENSE and package.json at that commit, and the build files
// that say which subproject each client file comes from. On a runner without
// the fork those lines say SKIP and the rest still runs.
//
// The same goes for the Thornswood Client Runtime, Thornswood's own mod on
// Nexus Mods: where Vortex's copy of it is here (%APPDATA%\Vortex\skyrimse\mods,
// or THORNSWOOD_VORTEX_MODS), every file in it is held to its section, and
// where the launcher's Profile\OwnGame\files.txt is here (C:\Thornswood\Profile,
// or THORNSWOOD_PROFILE), so is every file the collection puts under
// Data\Platform\Distribution.
//
// Read only.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = REPO_DIR;
const REPO = REPO_DIR;
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function skip(what) { console.log('SKIP  ' + what); }
function read(p) {
  try { return fs.readFileSync(p, 'utf8').split(CR).join(''); } catch (e) { return null; }
}
function flat(s) { return String(s).replace(/\s+/g, ' ').trim(); }

const noticesRaw = read(path.join(ROOT, 'THIRD-PARTY.md'));
yes('THIRD-PARTY.md exists at the repo root', noticesRaw !== null);
const N = noticesRaw || '';
const creditsRaw = read(path.join(REPO, 'site', 'data', 'site', 'credits.md'));
yes('the public credits page is there to read', creditsRaw !== null);
const C = creditsRaw || '';

// ---------------------------------------------------------------- the launcher
//
// Everything Build-Launcher.ps1 compiles into an exe, by the name it is given
// inside the exe. These are made here, each one for Thornswood:
const OURS = {
  'logo.png': 'the emblem, launcher\\logo.png',
  'logo-dev.png': 'the emblem the dev build shows instead, launcher\\logo-dev.png',
  'launcher-header.jpg': 'a strip of the Thornswood backdrop, launcher\\art',
  'launcher-header.webp': 'the same strip moving, made from launcher\\launcher-header.mp4',
  'app.ico': 'the icon',
  'app-dev.ico': 'the icon the dev build\'s shortcuts carry, launcher\\app-dev.ico',
  'Thornswood.ini': 'the key template, launcher',
  'client-build.json': 'the record of the client runtime',
  'skyrim-files.json': 'the list of the pinned Skyrim build\'s own files, read from Steam\'s depot manifests',
  'ui-gone.json': 'the Daedric menu set and unused fork assets a refresh must not copy back',
  'generated.json': 'the build list of the animation and body files the launcher makes on each computer (#3715)'
};

// What goes into the launcher is written in its project file since #498's
// switch (Build-Launcher.ps1 only publishes it): every EmbeddedResource by the
// LogicalName the code reads it under.
const proj = read(path.join(REPO, 'launcher', 'app', 'Thornswood.csproj')) || '';
yes('launcher\\app\\Thornswood.csproj is there to read', proj.length > 0);

const resources = [];
const unreadable = [];
(proj.match(/<EmbeddedResource\b[\s\S]*?<\/EmbeddedResource>/g) || []).forEach(function (el) {
  const m = /<LogicalName>([^<]+)<\/LogicalName>/.exec(el);
  if (m) { resources.push(m[1].trim()); } else { unreadable.push(el.replace(/\s+/g, ' ')); }
});
unreadable.forEach(function (l) { console.log('      no LogicalName in: ' + l); });
yes('every EmbeddedResource in Thornswood.csproj names the resource it becomes', unreadable.length === 0);
// Since #4823 the window is compiled, voice has no page and no WebView2, and
// NLayer is a package: none of them is a resource any more.
const gone = resources.filter(function (n) { return /WebView2|^ui\.xaml$|^voice-host\.html$|^NLayer\.dll$/i.test(n); });
yes('Thornswood.csproj embeds no WebView2 file, ui.xaml, voice page or NLayer.dll (' + gone.join(', ') + ')', gone.length === 0);
yes('Thornswood.csproj embeds resources to check (' + resources.length + ')', resources.length >= 10);

const seen = {};
resources.forEach(function (name) {
  if (seen[name]) { return; }
  seen[name] = true;
  if (Object.prototype.hasOwnProperty.call(OURS, name)) {
    yes(name + ' is Thornswood\'s own (' + OURS[name] + ') and THIRD-PARTY.md says so',
        N.indexOf('`' + name + '`') >= 0);
  } else {
    yes(name + ', compiled into the launcher, is named in THIRD-PARTY.md', N.indexOf(name) >= 0);
  }
});

// ---------------------------------------------------------------- launcher source
//
// The launcher's code is compiled into it too, and one file of it,
// FromGameDeflate.cs, is zlib 1.3 translated into C#. It went out from #2827
// with no zlib notice and THIRD-PARTY.md calling everything compiled in
// Thornswood's own (#3668). So the header of every .cs file under
// launcher\app (its comments down to the first type it
// declares) is read for outside projects: the libraries in
// records\client-licences, the numeric and compression ones the launcher's
// work touches, and any line saying code was translated, ported, adapted or
// copied, or carrying a copyright line. Each file that names one needs a row
// in THIRD-PARTY.md's "Launcher source that names outside work" naming what it
// names, and a row that says a file carries a library's code needs that
// library's notice in the file's header word for word, the file marked as
// altered, and THIRD-PARTY.md pointing at the licence text.
const SRC_DIRS = [path.join('launcher', 'app')];
const LIC_DIR = path.join(REPO, 'records', 'client-licences');
const licNames = (fs.existsSync(LIC_DIR) ? fs.readdirSync(LIC_DIR) : [])
  .filter(function (n) { return /\.txt$/i.test(n); })
  .map(function (n) { return n.replace(/\.txt$/i, ''); });
yes('records\\client-licences has licence texts to name (' + licNames.length + ')', licNames.length > 0);
const OUTSIDE = licNames.concat(['deflate.c', 'trees.c', 'inflate.c', 'miniz', 'LZ4', 'LZMA', '7-Zip',
  'OpenBLAS', 'LAPACK', 'BLAS', 'numpy', 'Eigen', 'Newtonsoft', 'Json.NET', 'SharpZipLib', 'DotNetZip',
  'BouncyCastle', 'Mono', 'corefx', 'referencesource']);
// Names that are also ordinary words are matched as the project's name only,
// capitalised: voice's WASAPI code says "mono" for one audio channel, which is
// not the Mono runtime.
const AS_WRITTEN = { 'Mono': true };
const SAYS_OUTSIDE = /\btranslat(ed|ion)\s+(of|from|into)\b|\bport(ed)?\s+(of|from)\b|\badapted\s+from\b|\bcopied\s+from\b|\bcopyright\s*(\(C\)|©)|\(C\)\s*\d{4}/i;
function namesIn(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^A-Za-z0-9_-])' + esc + '($|[^A-Za-z0-9_-])', AS_WRITTEN[name] ? '' : 'i').test(text);
}
function header(src) {
  const out = [];
  const lines = src.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^(\[[^\]]*\]\s*)*((public|internal|static|sealed|partial|abstract)\s+)*(class|struct|enum|interface)\s/.test(t)) { break; }
    if (t.indexOf('//') === 0) { out.push(t.replace(/^\/+ ?/, '').replace(/<\/?summary>/g, '')); }
  }
  return out.join('\n');
}
const srcSection = (/\n### Launcher source that names outside work\n([\s\S]*?)(\n## |\n### |$)/.exec(N) || [])[1] || '';
yes('THIRD-PARTY.md has the section "Launcher source that names outside work"', srcSection.length > 0);
const srcRows = {};
srcSection.split('\n').forEach(function (l) {
  const m = /^\| `([^`]+\.cs)` \| ([^|]*) \| ([^|]*) \|/.exec(l);
  if (m) { srcRows[m[1]] = { names: m[2], carries: m[3].trim() }; }
});
const srcFiles = {};
SRC_DIRS.forEach(function (d) {
  const full = path.join(REPO, d);
  (fs.existsSync(full) ? fs.readdirSync(full) : []).filter(function (n) { return /\.cs$/i.test(n); })
    .forEach(function (n) { srcFiles[n] = path.join(full, n); });
});
yes('there is launcher source to read (' + Object.keys(srcFiles).length + ' files)', Object.keys(srcFiles).length >= 50);
const flagged = {};
Object.keys(srcFiles).sort().forEach(function (n) {
  const h = header(read(srcFiles[n]) || '');
  const names = OUTSIDE.filter(function (o) { return namesIn(h, o); });
  if (names.length === 0 && !SAYS_OUTSIDE.test(h)) { return; }
  flagged[n] = true;
  const row = srcRows[n];
  yes(n + '\'s header names outside work (' + (names.join(', ') || 'says it was taken from somewhere') +
      ') and THIRD-PARTY.md has its row', !!row);
  if (!row) { return; }
  names.forEach(function (o) {
    yes('  its row names ' + o, namesIn(row.names, o));
  });
  const carried = /^yes:\s*(.+)$/i.exec(row.carries);
  yes('  its row says whether it carries outside code ("yes: <library>" or "no")', !!carried || /^no$/i.test(row.carries));
  if (!carried) { return; }
  carried[1].split(',').map(function (s) { return s.trim(); }).forEach(function (lib) {
    const text = read(path.join(LIC_DIR, lib + '.txt'));
    yes('  ' + lib + '\'s licence text is in records\\client-licences', text !== null);
    if (text === null) { return; }
    const body = text.replace(/\r/g, '').split('\n')
      .filter(function (l) { return !/copyright|\(C\)/i.test(l); }).join('\n');
    yes('  its header carries ' + lib + '\'s notice word for word', flat(h).indexOf(flat(body)) >= 0);
    yes('  its header says it is altered and not the original software',
        /\baltered from\b/i.test(h) && /not the original software/i.test(h));
    yes('  THIRD-PARTY.md points at records\\client-licences\\' + lib + '.txt',
        N.indexOf('`records\\client-licences\\' + lib + '.txt`') >= 0);
  });
});
Object.keys(srcRows).forEach(function (n) {
  yes(n + ', in "Launcher source that names outside work", is launcher source whose header names outside work',
      !!srcFiles[n] && !!flagged[n]);
});

// ---------------------------------------------------------------- the packages
//
// Since #4823 the launcher keeps no library under launcher\lib. Every library
// is a package from nuget.org that Thornswood.csproj references, and Native
// AOT compiles its code into Thornswood.exe with the .NET runtime; three
// native libraries go beside the exe. So a package added to the project, or
// one moved to a new version, without a word in the notices fails here, and so
// does a native library that is not the bytes the notices give.
function walk(dir, out) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  list.forEach(function (d) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { walk(p, out); } else { out.push(p); }
  });
  return out;
}
function sha256(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
// A line of THIRD-PARTY.md naming the package and its version: a table row or
// a sentence, so a package named without its version, or at an old one, fails.
function namedAt(text, name, version) {
  const n = new RegExp('(^|[^A-Za-z0-9_.-])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9_.-])', 'i');
  return text.split('\n').some(function (l) { return n.test(l) && l.indexOf(version) >= 0; });
}
yes('launcher\\lib is gone: every library is a package the project references', !fs.existsSync(path.join(REPO, 'launcher', 'lib')));

const pkgRefs = [];
(proj.match(/<PackageReference\b[^>]*>/g) || []).forEach(function (el) {
  const i = /\bInclude="([^"]+)"/.exec(el), v = /\bVersion="([^"]+)"/.exec(el);
  if (i && v) { pkgRefs.push({ name: i[1], version: v[1] }); }
});
yes('Thornswood.csproj references packages to check (' + pkgRefs.map(function (r) { return r.name + ' ' + r.version; }).join(', ') + ')',
    pkgRefs.length >= 5);
pkgRefs.forEach(function (r) {
  yes(r.name + ' ' + r.version + ', which the launcher compiles in, is named in THIRD-PARTY.md at that version', namedAt(N, r.name, r.version));
  // The credits page names each library the way people know it: Avalonia for
  // the Avalonia packages, .NET for the framework's own, BouncyCastle for
  // BouncyCastle.Cryptography.
  const family = /^System\./.test(r.name) ? '.NET' : r.name.split('.')[0];
  yes('  and the credits page names ' + family, flat(C).indexOf(family) >= 0);
});

// What the restore says the project takes code from, with the packages the
// references bring, where a restore has run here (dotnet build or publish
// writes it under out\, which git ignores). On a fresh clone it is not there,
// and these lines say SKIP.
const ASSETS = path.join(REPO, 'out', 'obj', 'launcher', 'project.assets.json');
let assets = null;
try { assets = JSON.parse(fs.readFileSync(ASSETS, 'utf8')); } catch (e) { assets = null; }
if (!assets) {
  skip('no restore of launcher\\app\\Thornswood.csproj here (out\\obj\\launcher\\project.assets.json), so the packages it brings were not read');
} else {
  const target = assets.targets && assets.targets['net10.0-windows/win-x64'];
  yes('the restore has the win-x64 target the launcher is published for', !!target);
  const folders = Object.keys(assets.packageFolders || {});
  if (process.env.NUGET_PACKAGES) { folders.unshift(process.env.NUGET_PACKAGES); }
  function inCache(name, version, rel) {
    for (let i = 0; i < folders.length; i++) {
      const p = path.join(folders[i], name.toLowerCase(), version.toLowerCase(), rel);
      if (fs.existsSync(p)) { return p; }
    }
    return null;
  }
  const shipped = [];
  Object.keys(target || {}).forEach(function (key) {
    const lib = target[key];
    if (lib.type !== 'package') { return; }
    const parts = key.split('/');
    const code = Object.keys(lib.runtime || {}).filter(function (f) { return !/_\._$/.test(f); });
    const natives = Object.keys(lib.native || {}).filter(function (f) { return /\.dll$/i.test(f); });
    if (code.length === 0 && natives.length === 0) { return; }
    shipped.push({ name: parts[0], version: parts[1], natives: natives });
  });
  yes('the restore names packages whose code goes into the launcher (' + shipped.length + ')', shipped.length >= 10);
  shipped.forEach(function (s) {
    yes(s.name + ' ' + s.version + ' is named in THIRD-PARTY.md at that version', namedAt(N, s.name, s.version));
    const nupkg = inCache(s.name, s.version, s.name.toLowerCase() + '.' + s.version.toLowerCase() + '.nupkg');
    if (nupkg) {
      const h = sha256(nupkg);
      yes('  by the sha256 of its .nupkg, ' + h.slice(0, 16), N.indexOf(h) >= 0);
    } else {
      skip('  ' + s.name + ' ' + s.version + ' is not in this machine\'s package folder, so its .nupkg was not hashed');
    }
    s.natives.forEach(function (rel) {
      const file = path.basename(rel);
      yes('  ' + file + ', which goes beside the exe, is named in THIRD-PARTY.md', N.indexOf('`' + file + '`') >= 0);
      const p = inCache(s.name, s.version, rel);
      if (p) {
        const h = sha256(p);
        yes('  ' + file + ' is in THIRD-PARTY.md by its sha256, ' + h.slice(0, 16), N.indexOf(h) >= 0);
      } else {
        skip('  ' + file + ' is not in this machine\'s package folder, so it was not hashed');
      }
    });
  });
  yes('three native libraries go beside the exe, as THIRD-PARTY.md says', shipped.reduce(function (n, s) { return n + s.natives.length; }, 0) === 3);

  // The .NET runtime Native AOT compiles in: the class libraries, a runtime
  // pack the restore downloads rather than a package in the target, and the
  // compiler's own runtime, which is in the target with no assembly of its own.
  const fw = (assets.project && assets.project.frameworks) || {};
  let aot = '';
  Object.keys(fw).forEach(function (k) {
    (fw[k].downloadDependencies || []).forEach(function (d) {
      if (d.name === 'Microsoft.NETCore.App.Runtime.NativeAOT.win-x64') { aot = String(d.version).replace(/[\[\]\s]/g, '').split(',')[0]; }
    });
  });
  yes('the restore downloads the Native AOT runtime pack (' + aot + ')', aot.length > 0);
  if (aot) {
    yes('Microsoft.NETCore.App.Runtime.NativeAOT.win-x64 ' + aot + ' is named in THIRD-PARTY.md at that version',
        namedAt(N, 'Microsoft.NETCore.App.Runtime.NativeAOT.win-x64', aot));
  }
  const ilc = Object.keys(target || {}).filter(function (k) { return /^runtime\.win-x64\.Microsoft\.DotNet\.ILCompiler\//.test(k); })[0];
  yes('the restore names the win-x64 Native AOT compiler (' + (ilc || 'none') + ')', !!ilc);
  if (ilc) {
    yes(ilc.replace('/', ' ') + ' is named in THIRD-PARTY.md at that version', namedAt(N, ilc.split('/')[0], ilc.split('/')[1]));
  }

  // The licences the packages carry, word for word on both pages. The MIT and
  // BSD licences ask for their notice with every copy.
  [['Microsoft.NETCore.App.Runtime.NativeAOT.win-x64', aot, 'LICENSE.TXT', '.NET'],
   ['SkiaSharp', (shipped.filter(function (s) { return s.name === 'SkiaSharp'; })[0] || {}).version, 'LICENSE.txt', 'SkiaSharp'],
   ['Avalonia.Angle.Windows.Natives', (shipped.filter(function (s) { return s.name === 'Avalonia.Angle.Windows.Natives'; })[0] || {}).version, 'LICENSE', 'ANGLE']
  ].forEach(function (l) {
    const p = l[1] ? inCache(l[0], l[1], l[2]) : null;
    if (!p) { skip(l[3] + '\'s licence: ' + l[0] + ' ' + (l[1] || '') + ' is not in this machine\'s package folder'); return; }
    const text = read(p);
    yes('THIRD-PARTY.md carries ' + l[3] + '\'s licence word for word, from ' + l[0] + '\'s ' + l[2], flat(N).indexOf(flat(text)) >= 0);
    yes('the credits page carries it word for word', flat(C).indexOf(flat(text)) >= 0);
  });
  // Skia's and HarfBuzz's own notices, as the native packages' notices file
  // gives them.
  const sk = shipped.filter(function (s) { return s.name === 'SkiaSharp.NativeAssets.Win32'; })[0];
  const notices = sk ? inCache(sk.name, sk.version, 'THIRD-PARTY-NOTICES.txt') : null;
  if (!notices) {
    skip('SkiaSharp.NativeAssets.Win32\'s THIRD-PARTY-NOTICES.txt is not here, so Skia\'s and HarfBuzz\'s notices were not compared');
  } else {
    const all = read(notices);
    ['skia', 'HarfBuzz'].forEach(function (lib) {
      const m = new RegExp('\\n# ' + lib + '\\n# [^\\n]*\\n#{80}\\n([\\s\\S]*?)\\n#{80}\\n# END: ' + lib).exec(all);
      const body = m ? m[1].replace(/\n-{80}\s*$/, '') : '';
      yes('THIRD-PARTY.md carries ' + lib + '\'s notice from SkiaSharp\'s notices file word for word', body.length > 0 && flat(N).indexOf(flat(body)) >= 0);
      yes('the credits page carries it word for word', body.length > 0 && flat(C).indexOf(flat(body)) >= 0);
    });
  }
}

// The licences that no package carries a file of, read from each project's
// repository at the commit its nuspec names on 1 November 2026: Avalonia's
// licence.md, Velopack's LICENSE and MicroCom's LICENSE.
const PKG_MIT_BODY = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software and associated documentation files (the "Software"), to deal',
  'in the Software without restriction, including without limitation the rights',
  'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
  'copies of the Software, and to permit persons to whom the Software is',
  'furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all',
  'copies or substantial portions of the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
  'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
  'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
  'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
  'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
  'SOFTWARE.'
].join('\n');
[['Avalonia', 'The MIT License (MIT)\nCopyright (c) AvaloniaUI OÜ\nAll Rights Reserved\n' + PKG_MIT_BODY],
 ['MicroCom', 'MIT License\nCopyright (c) 2021 Nikita Tsukanov\n' + PKG_MIT_BODY],
 ['Velopack', 'Copyright © 2021 Caelan Sayler\nCopyright © 2024 Velopack Ltd.\n' +
   'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and ' +
   'associated documentation files (the "Software"), to deal in the Software without restriction, including ' +
   'without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell ' +
   'copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the ' +
   'following conditions:\nThe above copyright notice and this permission notice shall be included in all ' +
   'copies or substantial portions of the Software.\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY ' +
   'KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A ' +
   'PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY ' +
   'CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF ' +
   'OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.']
].forEach(function (l) {
  yes('THIRD-PARTY.md carries ' + l[0] + '\'s licence word for word', flat(N).indexOf(flat(l[1])) >= 0);
  yes('the credits page carries ' + l[0] + '\'s licence word for word', flat(C).indexOf(flat(l[1])) >= 0);
});

// NLayer, the menu theme's MP3 decoder (#3207): NLayer 3.0.0 from nuget.org.
// Its netstandard2.0 file was compared byte for byte on 26 October, when the
// launcher embedded it; since #4823 the package is a reference and its
// net8.0 file is compiled in. The package names MIT as its licence and commit
// 046c7ce4 of naudio/NLayer as its source; the MIT licence wants its notice
// with every copy, so it is on the public page too, as the repository's
// LICENSE at that commit has it.
yes('THIRD-PARTY.md gives the NLayer version and its source commit', N.indexOf('Version 3.0.0') >= 0 && N.indexOf('046c7ce422970f8f0f0bc205d6c6341bcb7debf1') >= 0);
yes('the credits page gives the NLayer version and links its source', C.indexOf('NLayer 3.0.0') >= 0 && C.indexOf('https://github.com/naudio/NLayer') >= 0);
const NLAYER_LICENCE = [
  'Copyright (c) 2018 Mark Heath, Andrew Ward & Contributors',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software and associated documentation files (the "Software"), to deal',
  'in the Software without restriction, including without limitation the rights',
  'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
  'copies of the Software, and to permit persons to whom the Software is',
  'furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all',
  'copies or substantial portions of the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
  'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
  'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
  'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
  'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
  'SOFTWARE.'
].join('\n');
yes('THIRD-PARTY.md carries the NLayer licence word for word', flat(N).indexOf(flat(NLAYER_LICENCE)) >= 0);
yes('the credits page carries the NLayer licence word for word', flat(C).indexOf(flat(NLAYER_LICENCE)) >= 0);

// ---------------------------------------------------------------- the site
//
// Entry 247 (#271) moved the site's fonts and marked off Google Fonts and
// cdnjs into site\public, so since then the site hands them to every
// visitor itself. Anything there that is somebody else's by its kind, a font
// file or a minified script, has to be in THIRD-PARTY.md by name and sha256,
// so a newer marked or another font dropped in without a word fails here.
// Text is hashed with its CRs taken out: git stores it with LF, a Windows
// checkout adds them, and the hash in the notices is of what git stores.
const PUB = path.join(REPO, 'site', 'public');
function vendoredKind(n) { return /\.(woff2?|ttf|otf)$/i.test(n) || /\.min\.js$/i.test(n); }
let pubNames = [];
try { pubNames = fs.readdirSync(PUB); } catch (e) { pubNames = []; }
const siteFiles = pubNames.filter(vendoredKind);
console.log('      the site serves ' + siteFiles.length + ' font or minified script files');
siteFiles.forEach(function (n) {
  let buf = fs.readFileSync(path.join(PUB, n));
  if (/\.js$/i.test(n)) { buf = Buffer.from(buf.toString('latin1').split(CR).join(''), 'latin1'); }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  yes(n + ' (the site) is named in THIRD-PARTY.md', N.indexOf('`' + n + '`') >= 0);
  yes(n + ' is in THIRD-PARTY.md by its sha256, ' + sha.slice(0, 16), N.toLowerCase().indexOf(sha) >= 0);
});
// And the other way: a row for a file the site no longer serves is a notice
// for something nobody is handed any more.
const siteSection = (/\n## On the site\n([\s\S]*?)\n## /.exec(N) || [])[1] || '';
yes('THIRD-PARTY.md has a section for the site', siteSection.length > 0);
siteSection.split('\n').forEach(function (l) {
  const m = /^\| `([^`]+)`/.exec(l);
  if (!m || !vendoredKind(m[1])) { return; }
  yes(m[1] + ', listed under the site, is still in site\\public', pubNames.indexOf(m[1]) >= 0);
});
const markedFile = siteFiles.filter(function (n) { return /^marked-.*\.min\.js$/i.test(n); })[0];
if (markedFile) {
  const head = (read(path.join(PUB, markedFile)) || '').slice(0, 300);
  yes(markedFile + ' still carries its own MIT notice at the top', /\(MIT Licensed\)/.test(head));
  const row = siteSection.split('\n').filter(function (l) { return l.indexOf('`' + markedFile + '`') >= 0; })[0] || '';
  yes('THIRD-PARTY.md gives ' + markedFile + ' as MIT', /\bMIT\b/.test(row));
}
siteFiles.filter(function (n) { return /\.woff2?$/i.test(n); }).forEach(function (n) {
  const row = siteSection.split('\n').filter(function (l) { return l.indexOf('`' + n + '`') >= 0; })[0] || '';
  yes('THIRD-PARTY.md gives ' + n + ' as OFL-1.1', row.indexOf('OFL-1.1') >= 0);
});
['Cinzel', 'Spectral', 'marked'].forEach(function (what) {
  yes('the credits page names ' + what + ', which the site serves', C.indexOf(what) >= 0);
});
// The MIT and OFL ask for their text to go with the files, not only a name in
// a header (#421): marked's and each font family's licence are served beside
// them, by the sha256 THIRD-PARTY.md gives, and the credits page links each.
const LICENCE_TEXTS = { 'marked-LICENSE.txt': /Permission is hereby granted, free of charge/,
  'cinzel-OFL.txt': /Copyright 2020 The Cinzel Project Authors[\s\S]*SIL OPEN FONT LICENSE Version 1\.1/,
  'spectral-OFL.txt': /Copyright 2017 The Spectral Project Authors[\s\S]*SIL OPEN FONT LICENSE Version 1\.1/ };
Object.keys(LICENCE_TEXTS).forEach(function (n) {
  const t = read(path.join(PUB, n));
  yes(n + ' is in site\\public and is the licence it says it is', t !== null && LICENCE_TEXTS[n].test(t));
  const sha = t === null ? '' : crypto.createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');
  yes(n + ' is in THIRD-PARTY.md under the site by its sha256, ' + sha.slice(0, 16), !!sha && siteSection.indexOf(sha) >= 0);
  yes('the credits page links /' + n, C.indexOf('](/' + n + ')') >= 0);
});

// ---------------------------------------------------------------- the client
//
// Which subproject of the fork each recorded file is built from, and the build
// file line that proves it. MpClientPlugin.dll is the surprise: it goes to
// every client and is built out of skymp5-server.
const LICENCE_OF = {
  'skymp5-client': 'GPL-3.0',
  'skyrim-platform': 'GPL-3.0',
  'skymp5-front': 'GPL-3.0',
  'skymp5-server': 'AGPL-3.0'
};
const PLATFORM_CMAKE = 'skyrim-platform/src/platform_se/CMakeLists.txt';
const BUILT_FROM = {
  'MpClientPlugin.dll': { sub: 'skymp5-server', proof: 'skymp5-server/cpp/CMakeLists.txt', needle: 'add_library(MpClientPlugin' },
  'SkyrimPlatform.dll': { sub: 'skyrim-platform', proof: PLATFORM_CMAKE, needle: 'OUTPUT_NAME "SkyrimPlatform")' },
  'SkyrimPlatformImpl.dll': { sub: 'skyrim-platform', proof: PLATFORM_CMAKE, needle: 'OUTPUT_NAME "SkyrimPlatformImpl"' },
  'SkyrimPlatformCEF.exe.hidden': { sub: 'skyrim-platform', proof: PLATFORM_CMAKE, needle: 'add_executable(SkyrimPlatformCEF' },
  'skymp5-client.js': { sub: 'skymp5-client', proof: 'skymp5-client/CMakeLists.txt', needle: 'Plugins/skymp5-client.js' },
  'TESModPlatform.pex': { sub: 'skyrim-platform', proof: 'skyrim-platform/src/platform_se/psc/TESModPlatform.psc', needle: 'TESModPlatform' }
};
function namesLicence(text, want) {
  if (want === 'AGPL-3.0') { return text.indexOf('AGPL-3.0') >= 0; }
  return /(^|[^A])GPL-3\.0/.test(text) && text.indexOf('AGPL') < 0;
}

let cb = null;
try { cb = JSON.parse(read(path.join(REPO, 'records', 'client-build.json'))); } catch (e) { cb = null; }
yes('records\\client-build.json reads', !!(cb && cb.files && cb.forkCommit));
const cbFiles = cb && cb.files ? Object.keys(cb.files) : [];
const commit = cb ? String(cb.forkCommit || '') : '';
const forkUrl = cb ? String(cb.fork || '').replace(/\.git$/, '') : '';
if (cb) {
  yes('THIRD-PARTY.md names the fork, ' + forkUrl, forkUrl.length > 0 && N.indexOf(forkUrl) >= 0);
  yes('THIRD-PARTY.md names the fork branch, ' + cb.forkBranch, N.indexOf(String(cb.forkBranch)) >= 0);
  yes('THIRD-PARTY.md names the recorded client commit, ' + commit, commit.length >= 7 && N.indexOf(commit) >= 0);
  yes('THIRD-PARTY.md names the upstream base, ' + cb.upstreamBase, N.indexOf(String(cb.upstreamBase)) >= 0);
  yes('the credits page links the fork', C.indexOf(forkUrl) >= 0);
  yes('the credits page names the fork branch', C.indexOf(String(cb.forkBranch)) >= 0);
  yes('the credits page names the recorded client commit, ' + commit, commit.length >= 7 && C.indexOf(commit) >= 0);
  yes('the credits page names the upstream base, ' + cb.upstreamBase, !!cb.upstreamBase && C.indexOf(String(cb.upstreamBase)) >= 0);
}
yes('client-build.json records six client files', cbFiles.length === 6);

const rows = N.split('\n').filter(function (l) { return l.charAt(0) === '|'; });
cbFiles.forEach(function (rel) {
  const leaf = rel.split('\\').pop();
  const from = BUILT_FROM[leaf];
  yes(leaf + ' has a known subproject in this harness', !!from);
  const row = rows.filter(function (l) { return l.indexOf('`' + rel + '`') >= 0; })[0] || '';
  yes(rel + ' has its own row in THIRD-PARTY.md', row.length > 0);
  if (!from) { return; }
  const want = LICENCE_OF[from.sub];
  yes(leaf + ': the row says it is built from ' + from.sub, row.indexOf(from.sub) >= 0);
  yes(leaf + ': the row gives ' + want, namesLicence(row, want));
});
// On the page it is a row of the source table, which entry 170 wrote in words
// ("GNU AGPL version 3") rather than as the SPDX name, so either counts, as
// long as it is on the same line as the file.
yes('the credits page says MpClientPlugin.dll is AGPL-3.0',
    /MpClientPlugin\.dll[^\n]*(AGPL-3\.0|GNU AGPL version 3)/.test(C));
// The sentence in THIRD-PARTY.md that gives each subproject its licence, the
// same four the fork's package.json files declare (checked below where the
// fork is here).
const CLAIM = {
  'skymp5-client': '`GPL-3.0` for skymp5-client, skyrim-platform and skymp5-front',
  'skyrim-platform': '`GPL-3.0` for skymp5-client, skyrim-platform and skymp5-front',
  'skymp5-front': '`GPL-3.0` for skymp5-client, skyrim-platform and skymp5-front',
  'skymp5-server': '`AGPL-3.0` for skymp5-server'
};
// The public page may use the name people know a part by instead of its folder.
const SPOKEN = { 'skyrim-platform': 'Skyrim Platform' };
Object.keys(LICENCE_OF).forEach(function (sub) {
  yes('THIRD-PARTY.md gives ' + sub + ' as ' + LICENCE_OF[sub], flat(N).indexOf(CLAIM[sub]) >= 0);
  yes('the credits page names ' + sub,
      C.indexOf(sub) >= 0 || (!!SPOKEN[sub] && C.indexOf(SPOKEN[sub]) >= 0));
});

// ---------------------------------------------------------------- the server
//
// The record is written by New-ServerBuildRecord.ps1. Windows PowerShell's
// -Encoding UTF8 puts a byte order mark in front of the file, which PowerShell
// reads back happily and JSON.parse will not read at all. The record of
// 26 September went to GitHub that way, so this file read nothing out of it and
// the four lines below, which are what hold THIRD-PARTY.md and the credits page
// to the server commit that is live, quietly stopped running. The mark is
// checked on its own line so the next one says what it is rather than only that
// the file did not read. The writer uses UTF8Encoding($false) now, the same as
// New-ClientBuildRecord.ps1.
const sbText = read(path.join(REPO, 'records', 'server-build.json'));
yes('records\\server-build.json has no byte order mark in front of it', !!sbText && sbText.charCodeAt(0) !== 0xFEFF);
let sb = null;
try { sb = JSON.parse(sbText); } catch (e) { sb = null; }
yes('records\\server-build.json reads', !!(sb && sb.source && sb.source.commit));
if (sb && sb.source) {
  const sc = String(sb.source.commit);
  yes('THIRD-PARTY.md names the server binary, ' + sb.binary, N.indexOf(String(sb.binary)) >= 0);
  yes('THIRD-PARTY.md names the server commit, ' + sc.slice(0, 12), N.indexOf(sc) >= 0);
  yes('the credits page names the server commit, ' + sc.slice(0, 12), C.indexOf(sc) >= 0);
  yes('the server is built from the fork THIRD-PARTY.md names',
      String(sb.source.repo).replace(/\.git$/, '') === forkUrl);
}

// #1782. The commit above was found anywhere in the file, so when #1689 moved
// the pin to a247ef27 and wrote it into the fork section, "On our servers" and
// the source offer in "Where the source is" kept naming #1617's e6534129 and
// this stayed green. Each of the three is held to the record on its own now.
// The offer is what section 13 of the AGPL asks for: the source of the server
// people connect to.
if (sb && sb.source) {
  const sc = String(sb.source.commit);
  const forkSec = section('The SkyMP client runtime, built from the fork');
  yes('the fork section names the server record\'s commit, ' + sc.slice(0, 12), forkSec.indexOf(sc) >= 0);
  const ours = section('On our servers');
  yes('"On our servers" names the server record\'s commit, ' + sc.slice(0, 12), ours.indexOf(sc) >= 0);
  yes('"On our servers" gives the server record\'s SHA256, ' + String(sb.sha256).slice(0, 12),
      !!sb.sha256 && ours.indexOf(String(sb.sha256)) >= 0);
  const otherSums = (ours.match(/\b[0-9a-f]{64}\b/g) || []).filter(function (h) { return h !== sb.sha256; });
  yes('"On our servers" gives no other SHA256 (' + (otherSums.join(', ') || 'none') + ')', otherSums.length === 0);
  yes('"On our servers" gives when it was built, ' + sb.builtUtc,
      !!sb.builtUtc && ours.indexOf(String(sb.builtUtc)) >= 0);
  const mainAt = /Main remains on `([0-9a-f]{40})`/.exec(ours);
  const offer = section('Where the source is');
  const trees = [];
  const treeRe = new RegExp(reEscape(forkUrl) + '/tree/([0-9a-f]{7,40})(?=\\s)', 'g');
  let tm;
  while ((tm = treeRe.exec(offer)) !== null) { trees.push(tm[1]); }
  yes('"Where the source is" links the fork at the server record\'s commit first (' + (trees[0] || 'none') + ')',
      trees[0] === sc);
  const stray = trees.filter(function (c) { return c !== sc && !(mainAt && c === mainAt[1]); });
  yes('and at no commit but that one and the one "On our servers" says main is on (' +
      (stray.join(', ') || 'none other') + ')', stray.length === 0);
}

// ---------------------------------------------------------------- the fork
//
// Only where the fork is cloned here and holds the recorded commit. This is
// what makes the licence column a measurement rather than a memory.
// The engine/skymp submodule once it has files in it, and the old clone until
// then: the same rule as scripts\release\Where.ps1.
const REPO_FORK = path.join(REPO_DIR, 'engine', 'skymp');
const FORK = process.env.THORNSWOOD_SKYMP ||
  (fs.existsSync(path.join(REPO_FORK, 'CMakeLists.txt')) ? REPO_FORK : 'C:\\Thornswood-Dev\\skymp');
function git(args) {
  return execFileSync('git', ['-C', FORK].concat(args),
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).split(CR).join('');
}
let haveFork = false;
if (commit && fs.existsSync(FORK)) {
  try { git(['cat-file', '-e', commit + '^{commit}']); haveFork = true; } catch (e) { haveFork = false; }
}
if (!haveFork) {
  skip('no clone of the fork holding ' + (commit || 'the recorded commit') + ' at ' + FORK + ', so the licence files were not read');
} else {
  Object.keys(LICENCE_OF).forEach(function (sub) {
    const want = LICENCE_OF[sub];
    let lic = '', pkg = null;
    try { lic = git(['show', commit + ':' + sub + '/LICENSE']); } catch (e) { lic = ''; }
    try { pkg = JSON.parse(git(['show', commit + ':' + sub + '/package.json'])); } catch (e) { pkg = null; }
    const head = want === 'AGPL-3.0' ? 'GNU AFFERO GENERAL PUBLIC LICENSE' : 'GNU GENERAL PUBLIC LICENSE';
    const first = lic.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    yes(sub + '/LICENSE at ' + commit + ' is the ' + head + ' version 3',
        first[0] === head && /^Version 3,/.test(first[1] || ''));
    yes(sub + '/package.json at ' + commit + ' declares ' + want, !!pkg && pkg.license === want);
  });
  Object.keys(BUILT_FROM).forEach(function (leaf) {
    const from = BUILT_FROM[leaf];
    let text = '';
    try { text = git(['show', commit + ':' + from.proof]); } catch (e) { text = ''; }
    yes(leaf + ' is built from ' + from.sub + ': ' + from.proof + ' has ' + from.needle,
        text.indexOf(from.needle) >= 0);
  });
  let tpl = '';
  try { tpl = git(['show', commit + ':THIRD_PARTY_LICENSES']); } catch (e) { tpl = ''; }
  ['TiltedUI', 'TiltedCore', 'TiltedHooks', 'TiltedReverse'].forEach(function (lib) {
    yes(lib + ' is in upstream\'s THIRD_PARTY_LICENSES and in THIRD-PARTY.md',
        tpl.indexOf(lib) >= 0 && N.indexOf(lib) >= 0);
  });
}

// ---------------------------------------------------------------- the LGPL
//
// #1332. Two of the libraries the fork's build links are not permissive:
// antigo (LGPL-3.0) and frida-gum (the wxWindows Library Licence 3.1). The
// issue said antigo goes to every client inside MpClientPlugin.dll and asked
// for the LGPL text and a notice to go with it. Measured on 5 October: the
// build links antigo into MpClientPlugin.dll, but nothing in the client calls
// it, so its code is only in scam_native.node, which nobody receives, and the
// LGPL asks nothing of what ships. frida-gum is in SkyrimPlatformImpl.dll;
// gum's own licence has an exception for binaries, and the libraries its
// devkit carries are held below (#3099, #3287). THIRD-PARTY.md says
// so, and this holds it there: the day a client file calls antigo, the fork
// files that use it stop being the three server ones and this fails, because
// then its notice and the LGPL text have to go with that file.
function cl0() {
  try { return JSON.parse(read(path.join(REPO, 'records', 'client-licences.json')).replace(/^\uFEFF/, '')); } catch (e) { return null; }
}
const libRows = N.split('\n').filter(function (l) { return l.charAt(0) === '|'; });
const antigoRow = libRows.filter(function (l) { return /^\| antigo, https:\/\/github\.com\/nic11\/antigo /.test(l); })[0] || '';
const fridaRow = libRows.filter(function (l) { return /^\| frida-gum \d/.test(l); })[0] || '';
const antigoAt = (/`([0-9a-f]{40})`/.exec(antigoRow) || [])[1] || '';
// The fork's build measures it since #3099: the record names no antigo in any client file.
if (cl0()) {
  const withAntigo = Object.keys(cl0().files || {}).filter(function (f) { return (cl0().files[f] || []).indexOf('antigo') >= 0; });
  yes('records\\client-licences.json names antigo in no client file' + (withAntigo.length ? ', but: ' + withAntigo.join(', ') : ''), withAntigo.length === 0);
}
const fridaAt = (/`([0-9a-f]{40})`/.exec(fridaRow) || [])[1] || '';
const fridaVer = (/^\| frida-gum (\d+\.\d+\.\d+)/.exec(fridaRow) || [])[1] || '';
yes('THIRD-PARTY.md has a row for antigo naming its commit (' + (antigoAt.slice(0, 8) || 'none') + ')', antigoAt.length === 40);
yes('the antigo row gives LGPL-3.0', /\| LGPL-3\.0\b/.test(antigoRow));
yes('the antigo row says its code is only in scam_native.node', /\| Only in `scam_native\.node`/.test(antigoRow));
yes('THIRD-PARTY.md has a row for frida-gum naming its version and commit (' + (fridaVer || 'none') + ')',
    fridaVer.length > 0 && fridaAt.length === 40);
yes('the frida-gum row gives gum\'s wxWindows Library Licence 3.1 and SkyrimPlatformImpl.dll',
    fridaRow.indexOf('wxWindows Library Licence 3.1') >= 0 && fridaRow.indexOf('`SkyrimPlatformImpl.dll`') >= 0);
yes('THIRD-PARTY.md no longer says this repository has an LGPL-3.0.txt to ship',
    !fs.existsSync(path.join(ROOT, 'LGPL-3.0.txt')) && /It has none, and none is owed/.test(flat(N)));
// The fork files that use antigo, other than its port and the build files
// that link it. MpClientPlugin.dll takes server_guest_lib for Inventory.cpp
// only, so these three put nothing of antigo into it.
const ANTIGO_USERS = [
  'skymp5-server/cpp/addon/ScampServer.cpp',
  'skymp5-server/cpp/server_guest_lib/MpObjectReference.cpp',
  'skymp5-server/cpp/server_guest_lib/WorldState.cpp'
];
const ANTIGO_LINKS = ['vcpkg.json', 'skymp5-server/cpp/CMakeLists.txt'];
// The fork's own tests (misc/tests) go into no file anybody receives. Since
// fork #77, test_save_completion_addon.cpp there writes stand-ins for antigo's
// names so the addon compiles without it; THIRD-PARTY.md says so.
const ANTIGO_TESTS = 'misc/tests/';
// The fork's Thornswood build scripts go into no file anybody receives either.
// Write-ClientLicences.ps1 (#3099) names antigo as the library its measurement
// finds linked into MpClientPlugin.dll with no code kept.
const ANTIGO_TOOLS = 'misc/thornswood/';
if (!haveFork) {
  skip('no fork here, so the antigo and frida-gum ports and antigo\'s users were not read');
} else {
  let port = '', portJson = null, frida = '';
  try { port = git(['show', commit + ':overlay_ports/antigo/portfile.cmake']); } catch (e) { port = ''; }
  try { portJson = JSON.parse(git(['show', commit + ':overlay_ports/antigo/vcpkg.json'])); } catch (e) { portJson = null; }
  try { frida = git(['show', commit + ':overlay_ports/frida-gum/portfile.cmake']); } catch (e) { frida = ''; }
  yes('overlay_ports/antigo at ' + commit.slice(0, 8) + ' fetches antigo at the commit THIRD-PARTY.md names',
      !!antigoAt && new RegExp('REF ' + antigoAt + '\\b').test(port));
  yes('overlay_ports/antigo/vcpkg.json at ' + commit.slice(0, 8) + ' declares LGPL-3.0', !!portJson && portJson.license === 'LGPL-3.0');
  yes('overlay_ports/frida-gum at ' + commit.slice(0, 8) + ' fetches the ' + fridaVer + ' devkit and the licence at the commit THIRD-PARTY.md names',
      !!fridaVer && frida.indexOf('/' + fridaVer + '/frida-gum-devkit-' + fridaVer + '-') >= 0 &&
      !!fridaAt && frida.indexOf('frida/frida-gum/' + fridaAt + '/COPYING') >= 0);
  let users = [];
  try {
    users = git(['grep', '-l', '-i', '-e', 'antigo', commit, '--']).split('\n')
      .map(function (l) { return l.slice(commit.length + 1).trim(); })
      .filter(function (p) { return p && p.indexOf('overlay_ports/') !== 0 && ANTIGO_LINKS.indexOf(p) < 0; });
  } catch (e) { users = []; }
  const testUsers = users.filter(function (p) { return p.indexOf(ANTIGO_TESTS) === 0; });
  testUsers.forEach(function (p) {
    yes('THIRD-PARTY.md names ' + p.split('/').pop() + ', a fork test that names antigo, as going into no shipped file',
        N.indexOf(p.split('/').pop()) >= 0 && /Nothing under `misc\\tests` goes into a file anybody receives/.test(flat(N)));
  });
  users = users.filter(function (p) { return p.indexOf(ANTIGO_TESTS) !== 0 && p.indexOf(ANTIGO_TOOLS) !== 0; });
  const newUsers = users.filter(function (p) { return ANTIGO_USERS.indexOf(p) < 0; });
  newUsers.forEach(function (p) { console.log('      uses antigo, and may put it into a client file: ' + p); });
  yes('the only fork files that use antigo are the three server ones THIRD-PARTY.md names (' + users.length + ')',
      users.length > 0 && newUsers.length === 0);
  ANTIGO_USERS.forEach(function (p) {
    yes('THIRD-PARTY.md names ' + p.split('/').slice(-2).join('\\') + ' as a user of antigo',
        N.indexOf(p.split('/').pop()) >= 0);
  });
}
// The recorded client files themselves, where the game folder holds them. A
// string of antigo's own (from its ResolvedContext.cpp at that commit) is in
// its library and in the recorded scam_native.node, and must not be in the
// recorded MpClientPlugin.dll. GumInterceptor is frida-gum's.
const GAME = process.env.THORNSWOOD_GAME || 'C:\\Thornswood\\Game';
function recordedCopy(rel) {
  const p = path.join(GAME, rel);
  let buf = null;
  try { buf = fs.readFileSync(p); } catch (e) { return null; }
  const want = cb && cb.files && cb.files[rel] ? String(cb.files[rel].sha256) : '';
  return crypto.createHash('sha256').update(buf).digest('hex') === want ? buf : null;
}
const ANTIGO_SAYS = ['resolved context with ', 'stringstream error!'];
const mpc = recordedCopy('Data\\SKSE\\Plugins\\MpClientPlugin.dll');
if (!mpc) {
  skip('no recorded MpClientPlugin.dll in ' + GAME + ', so it was not read for antigo');
} else {
  ANTIGO_SAYS.forEach(function (s) {
    yes('the recorded MpClientPlugin.dll carries none of antigo\'s code ("' + s.trim() + '" is not in it)',
        mpc.indexOf(Buffer.from(s, 'latin1')) < 0);
  });
}
const lib = path.join(FORK, 'build', 'vcpkg_installed', 'x64-windows-sp', 'lib', 'antigo.lib');
if (fs.existsSync(lib)) {
  const lb = fs.readFileSync(lib);
  yes('those strings are antigo\'s: its built library has them',
      ANTIGO_SAYS.every(function (s) { return lb.indexOf(Buffer.from(s, 'latin1')) >= 0; }));
} else {
  skip('no built antigo.lib under ' + FORK + ', so the strings were not checked against it');
}
const spi = recordedCopy('Data\\Platform\\Distribution\\RuntimeDependencies\\SkyrimPlatformImpl.dll');
if (!spi) {
  skip('no recorded SkyrimPlatformImpl.dll in ' + GAME + ', so it was not read for frida-gum');
} else {
  yes('the recorded SkyrimPlatformImpl.dll carries frida-gum (GumInterceptor), as the row says',
      spi.indexOf(Buffer.from('GumInterceptor', 'latin1')) >= 0);
}

// ------------------------------------------- the libraries inside them (#3099)
//
// The client files link the fork's vcpkg libraries statically, and their
// licence texts went nowhere until #3099: THIRD-PARTY.md said "None of those
// texts travels with the client runtime today". records\client-licences.json
// is what the fork's build measured in each native file. Its table here is the
// record, row for row, every text it names is beside it, and the frida row
// says what is inside frida-gum.lib (#3287).
let cl = null;
try { cl = JSON.parse(read(path.join(REPO, 'records', 'client-licences.json')).replace(/^﻿/, '')); } catch (e) { cl = null; }
yes('records\\client-licences.json reads', !!(cl && cl.forkCommit && cl.files && cl.ports));
if (cl) {
  yes('records\\client-licences.json is of the client record\'s commit (' + cl.forkCommit + ')', !!cb && String(cl.forkCommit) === String(cb.forkCommit));
  const HEAD = '| Library | Version | Licence, as its port declares it | In |';
  const lines = N.split('\n');
  const at = lines.indexOf(HEAD);
  const have = [];
  for (let i = at + 2; at >= 0 && i < lines.length && lines[i].charAt(0) === '|'; i++) have.push(lines[i]);
  const want = Object.keys(cl.ports).sort().map(function (n) {
    const p = cl.ports[n];
    const lic = p.licence ? p.licence : 'not declared; its text is in `' + n + '.txt`';
    const files = (p.in || []).map(function (f) { return String(f).split('\\').pop(); }).sort().map(function (f) { return '`' + f + '`'; }).join(', ');
    return '| ' + n + ' | ' + p.version + ' | ' + lic + ' | ' + files + ' |';
  });
  const wrong = want.filter(function (r) { return have.indexOf(r) < 0; });
  const extra = have.filter(function (r) { return want.indexOf(r) < 0; });
  wrong.forEach(function (r) { console.log('      not in THIRD-PARTY.md: ' + r); });
  extra.forEach(function (r) { console.log('      not in the record: ' + r); });
  yes('THIRD-PARTY.md\'s table of the libraries inside the client files is the record, row for row (' + want.length + ')',
      at >= 0 && want.length > 0 && wrong.length === 0 && extra.length === 0);
  const noText = Object.keys(cl.ports).filter(function (n) {
    let b = null;
    try { b = fs.readFileSync(path.join(REPO, 'records', 'client-licences', n + '.txt')); } catch (e) { return true; }
    return crypto.createHash('sha256').update(b).digest('hex') !== String(cl.ports[n].sha256) || b.length !== Number(cl.ports[n].bytes);
  });
  yes('every port in it has its text in records\\client-licences, byte for byte' + (noText.length ? ', not: ' + noText.join(', ') : ''), noText.length === 0);
}
// ------------------------------------- the other code inside them (#3751)
//
// Code that does not come through vcpkg had no record, so its notices went
// nowhere: Tilted Phoques' libraries, the fork's MIT folders, and the npm
// packages webpack bundles into skymp5-client.js and build.js. Every library
// THIRD-PARTY.md names as built into a client file with a notice of its own
// has a row in "The other code inside the client files"; each row is the
// record's library, text and all, or, while the record has none (a client
// measured before #3751), is named under "What is still missing". The front's
// table is front-build.json's packages, row for row, each with its text.
function tableRows(head) {
  const lines = N.split('\n');
  const at = lines.indexOf(head);
  const rows = [];
  for (let i = at + 2; at >= 0 && i < lines.length && lines[i].charAt(0) === '|'; i++) rows.push(lines[i]);
  return { at: at, rows: rows };
}
const OTHER_HEAD = '| Library | Version | Licence, as its folder or package gives it | In |';
const other = tableRows(OTHER_HEAD);
const otherNames = other.rows.map(function (r) { return r.split('|')[1].trim(); });
yes('THIRD-PARTY.md has the table of the other code inside the client files (' + other.rows.length + ' rows)', other.at >= 0 && other.rows.length > 0);
// What the client section says is compiled into the client files, and which
// of it carries a notice of its own: a folder named just before a licence
// that is not the GPL's or AGPL's, and the Tilted folder.
const compiled = (function () {
  const a = N.indexOf('What is compiled into them:');
  const b = N.indexOf('### The libraries inside the client files');
  return a >= 0 && b > a ? N.slice(a, b) : '';
})();
const noticed = [];
(compiled.match(/(?:`[^`]+`(?:,\s*|\s+and\s+))*`[^`]+`\s*\((?:MIT|BSD|Apache|ISC|Zlib|BSL)/g) || []).forEach(function (m) {
  (m.match(/`([^`]+)`/g) || []).forEach(function (t) { const n = t.replace(/`/g, ''); if (noticed.indexOf(n) < 0) noticed.push(n); });
});
if (/skyrim-platform\\src\\tilted/.test(compiled)) noticed.push('tilted');
const unrowed = noticed.filter(function (n) { return otherNames.indexOf(n) < 0; });
yes('each library the client section names with a notice of its own has a row (' + noticed.join(', ') + ')' + (unrowed.length ? ', not: ' + unrowed.join(', ') : ''),
    noticed.length >= 3 && unrowed.length === 0);
if (cl && cl.libraries) {
  const want = Object.keys(cl.libraries).sort().map(function (n) {
    const p = cl.libraries[n];
    const ver = p.kind === 'fork' ? 'the fork\'s' : String(p.version);
    const lic = p.licence ? p.licence : 'not declared; its text is in `' + n + '.txt`';
    const files = (p.in || []).map(function (f) { return String(f).split('\\').pop(); }).sort().map(function (f) { return '`' + f + '`'; }).join(', ');
    return '| ' + n + ' | ' + ver + ' | ' + lic + ' | ' + files + ' |';
  });
  const wrong = want.filter(function (r) { return other.rows.indexOf(r) < 0; });
  const extra = other.rows.filter(function (r) { return want.indexOf(r) < 0; });
  wrong.forEach(function (r) { console.log('      not in THIRD-PARTY.md: ' + r); });
  extra.forEach(function (r) { console.log('      not in the record: ' + r); });
  yes('the table of the other code is the record\'s libraries, row for row (' + want.length + ')', want.length > 0 && wrong.length === 0 && extra.length === 0);
  const noText = Object.keys(cl.libraries).filter(function (n) {
    let b = null;
    try { b = fs.readFileSync(path.join(REPO, 'records', 'client-licences', n + '.txt')); } catch (e) { return true; }
    return crypto.createHash('sha256').update(b).digest('hex') !== String(cl.libraries[n].sha256) || b.length !== Number(cl.libraries[n].bytes);
  });
  yes('every library in the record has its text in records\\client-licences, byte for byte' + (noText.length ? ', not: ' + noText.join(', ') : ''), noText.length === 0);
} else {
  const missing = flat(section('What is still missing'));
  const unsaid = otherNames.filter(function (n) { return missing.indexOf(n) < 0; });
  yes('the client record lists no libraries (measured before #3751), so "What is still missing" names every row' + (unsaid.length ? ', not: ' + unsaid.join(', ') : ''),
      otherNames.length > 0 && unsaid.length === 0);
}
let fb = null;
try { fb = JSON.parse(read(path.join(REPO, 'records', 'front-build.json')).replace(/^﻿/, '')); } catch (e) { fb = null; }
yes('records\\front-build.json lists the npm packages in build.js', !!(fb && fb.packages && Object.keys(fb.packages).length > 0));
if (fb && fb.packages) {
  const front = tableRows('| Package | Version | Licence, as its package.json declares it | Text |');
  const want = Object.keys(fb.packages).sort().map(function (n) {
    const p = fb.packages[n];
    return '| ' + p.package + ' | ' + p.version + ' | ' + (p.licence || 'not declared') + ' | `' + n + '.txt` |';
  });
  const wrong = want.filter(function (r) { return front.rows.indexOf(r) < 0; });
  const extra = front.rows.filter(function (r) { return want.indexOf(r) < 0; });
  wrong.forEach(function (r) { console.log('      not in THIRD-PARTY.md: ' + r); });
  extra.forEach(function (r) { console.log('      not in the record: ' + r); });
  yes('THIRD-PARTY.md\'s table of the npm packages in build.js is front-build.json, row for row (' + want.length + ')',
      front.at >= 0 && wrong.length === 0 && extra.length === 0);
  const noText = Object.keys(fb.packages).filter(function (n) {
    let b = null;
    try { b = fs.readFileSync(path.join(REPO, 'records', 'front-licences', n + '.txt')); } catch (e) { return true; }
    return crypto.createHash('sha256').update(b).digest('hex') !== String(fb.packages[n].sha256) || b.length !== Number(fb.packages[n].bytes);
  });
  yes('every package in it has its text in records\\front-licences, byte for byte' + (noText.length ? ', not: ' + noText.join(', ') : ''), noText.length === 0);
}
yes('THIRD-PARTY.md no longer says the vcpkg texts travel nowhere',
    !/None of those texts travels/.test(N) && !/vcpkg licence texts do not travel/.test(flat(section('What is still missing'))));
yes('the frida-gum row says what else frida-gum.lib holds, under the LGPL',
    /glib, gobject, gnulib and libcharset \(LGPL-2\.1-or-later\)/.test(fridaRow));
// The source of what is inside frida-gum.lib (#3287): records\frida-sources.json
// names the six parts, each archive on Thornswood's own Release of them
// (Patrick, C on #3287) and, while forksUp, Thornswood's fork of each of
// Frida's repositories. "Where the source is" names the Release, each archive
// and Frida's repository at the same commit, and the forks while they are up;
// Source-Notice.ps1 reads the record rather than a list of its own; and with
// the fork here, each commit is the one its portfile fetches from.
let fs3287 = null;
try { fs3287 = JSON.parse(fs.readFileSync(path.join(REPO, 'records', 'frida-sources.json'), 'utf8').replace(/^﻿/, '')); } catch (e) { fs3287 = null; }
const bundled = fs3287 && Array.isArray(fs3287.parts) ? fs3287.parts : [];
yes('records\\frida-sources.json names six parts of frida-gum.lib (' + bundled.length + ')', bundled.length === 6);
yes('  of the Frida the client files carry (' + (fs3287 && fs3287.frida) + ', the row says ' + (fridaVer || 'none') + ')', !!fs3287 && fs3287.frida === fridaVer);
const sn = read(path.join(REPO, 'scripts', 'release', 'Source-Notice.ps1')) || '';
yes('Source-Notice.ps1 reads where they are from records\\frida-sources.json and names no commit of its own',
    /records\\frida-sources\.json/.test(sn) && !/'frida-[a-z0-9-]+',\s*'[0-9a-f]{40}'/.test(sn));
const whereSec = section('Where the source is');
const relUrl = fs3287 ? 'https://github.com/' + fs3287.release.repo + '/releases/tag/' + fs3287.release.tag : '';
yes('"Where the source is" names the Release of their archives (' + relUrl + ')', !!relUrl && whereSec.indexOf(relUrl) >= 0);
const unnamed = bundled.filter(function (b) {
  return whereSec.indexOf('`' + b.archive + '`') < 0 || whereSec.indexOf(b.upstream + ' `' + b.commit + '`') < 0;
});
yes('  and each archive, with Frida\'s repository at the same commit' + (unnamed.length ? ', not: ' + unnamed.map(function (b) { return b.name; }).join(', ') : ''), bundled.length > 0 && unnamed.length === 0);
const forkNamed = bundled.filter(function (b) { return whereSec.indexOf('https://github.com/EvilPatrick06/' + b.name + '/tree/' + b.commit) >= 0; });
yes('  and the forks exactly while the record says they are up (' + forkNamed.length + ' named, forksUp ' + (fs3287 && fs3287.forksUp) + ')',
    !!fs3287 && (fs3287.forksUp ? forkNamed.length === bundled.length : forkNamed.length === 0));
if (haveFork) {
  let fp = '';
  try { fp = git(['show', commit + ':overlay_ports/frida-gum/portfile.cmake']); } catch (e) { fp = ''; }
  const off = bundled.filter(function (b) { return fp.indexOf('/' + b.commit + '/') < 0; });
  yes('each is a commit overlay_ports/frida-gum at ' + commit.slice(0, 8) + ' fetches its licence from' + (off.length ? ', not: ' + off.map(function (b) { return b.name; }).join(', ') : ''), !!fp && off.length === 0);
} else {
  skip('no fork here, so the frida commits were not held to its portfile');
}

// ---------------------------------------------------------------- the front
//
// Since #2931 every Ship builds build.js and the files beside it from the
// fork's skymp5-front at the pin and holds them to records\front-build.json.
// THIRD-PARTY.md said for a month that nobody recorded its commit. Its section
// on that build names the record's commit and count, and every font the
// record holds is named with what its own file says.
let front = null;
try { front = JSON.parse(read(path.join(REPO, 'records', 'front-build.json'))); } catch (e) { front = null; }
yes('records\\front-build.json reads', !!(front && front.forkCommit && front.files));
const frontSec = (function () {
  const at = N.indexOf('\n## SkyMP\'s interface, built from the fork');
  if (at < 0) { return ''; }
  const next = N.indexOf('\n## ', at + 4);
  return next < 0 ? N.slice(at) : N.slice(at, next);
})();
yes('THIRD-PARTY.md has a section on the interface built from the fork', frontSec.length > 0);
if (front && front.files) {
  const fNames = Object.keys(front.files);
  let fBytes = 0;
  fNames.forEach(function (n) { fBytes += front.files[n].bytes; });
  const fFlat = flat(frontSec);
  yes('that section names the record\'s commit, ' + String(front.forkCommit).slice(0, 8), frontSec.indexOf('`' + String(front.forkCommit).slice(0, 8) + '`') >= 0);
  yes('that section names the client record\'s commit as the same one', String(front.forkCommit).indexOf(commit) === 0);
  yes('that section gives the record\'s ' + fNames.length + ' files and ' + fBytes + ' bytes',
      fFlat.indexOf(fNames.length + ' files, ' + fBytes.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' bytes') >= 0);
  fNames.filter(function (n) { return /\.(ttf|otf|woff2?)$/i.test(n); }).forEach(function (n) {
    yes('that section names the font ' + n + ' the record holds', frontSec.indexOf('`' + n + '`') >= 0);
  });
  if (front.files['build.js']) {
    yes('that section gives build.js by the record\'s sha256', frontSec.indexOf(front.files['build.js'].sha256) >= 0);
  }
}
yes('"What is still missing" no longer says build.js has no recorded commit as if every release did',
    !/^- build\.js has no recorded source commit\.$/m.test(section('What is still missing')));

// ---------------------------------------------------------------- Nexus Mods
//
// Two of the collection's mods are Thornswood's own uploads. One of them, the
// Thornswood Client Runtime (Nexus 192762), is the largest thing somebody else
// wrote that Thornswood hands out: since 1.0.1, 67 files of CEF, Chromium,
// ANGLE, ICU, Node and Microsoft's shader compiler, about 349 MB. 1.0.0 also
// had one Skyrim Platform script, and Nexus still serves it to revisions 1
// and 2 of the collection, so its source stays offered.
// THIRD-PARTY.md once filed all of it under "Not shipped by Thornswood", and
// nothing here noticed, because this harness looked no further than the
// launcher, launcher\lib, the site and the six client files. So the section on
// that mod is held to the mod itself where Vortex's copy is on this machine,
// and to the launcher's record of where each game file came from.
function section(title) {
  const at = N.indexOf('\n## ' + title);
  if (at < 0) { return ''; }
  const next = N.indexOf('\n## ', at + 4);
  return next < 0 ? N.slice(at) : N.slice(at, next);
}
function commas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function reEscape(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const RUNTIME_ID = '192762';
const CONTENT_ID = '192001';
const runtimeSec = section('Thornswood Client Runtime');
const runtimeFlat = flat(runtimeSec);
const reachSec = section('How it reaches people');
const notShipped = section('Not shipped by Thornswood');
const sourceSec = section('Where the source is');
const missingSec = section('What is still missing');
yes('THIRD-PARTY.md has a section for the Thornswood Client Runtime', runtimeSec.length > 0);
yes('that section links its Nexus page, mod ' + RUNTIME_ID, runtimeSec.indexOf('/mods/' + RUNTIME_ID) >= 0);
yes('THIRD-PARTY.md has a section for Thornswood Content, mod ' + CONTENT_ID,
    section('Thornswood Content').indexOf('/mods/' + CONTENT_ID) >= 0);
yes('"How it reaches people" names Nexus Mods and both of Thornswood\'s mods there',
    reachSec.indexOf('Nexus Mods') >= 0 && reachSec.indexOf(RUNTIME_ID) >= 0 && reachSec.indexOf(CONTENT_ID) >= 0);
yes('THIRD-PARTY.md has a "Not shipped by Thornswood" section', notShipped.length > 0);
['libcef', 'libnode', 'Distribution'].forEach(function (w) {
  yes('"Not shipped by Thornswood" does not claim ' + w, notShipped.indexOf(w) < 0);
});
yes('"What is still missing" does not say nothing hands a person the GPL text',
    missingSec.length > 0 && !/nothing hands a person the GPL/i.test(flat(missingSec)));
yes('"Where the source is" says the installer hands AGPL-3.0.txt',
    /installer hands[\s\S]{0,200}AGPL-3\.0\.txt/.test(sourceSec));
yes('installer/licences/AGPL-3.0.txt exists', (function () {
  try { return fs.statSync(path.join(ROOT, 'installer', 'licences', 'AGPL-3.0.txt')).isFile(); } catch (e) { return false; }
})());
yes('installer/licences/GPL-3.0.txt exists', (function () {
  try { return fs.statSync(path.join(ROOT, 'installer', 'licences', 'GPL-3.0.txt')).isFile(); } catch (e) { return false; }
})());
// The voice libraries' notices since #4823, in place of WebView2's, which
// went with the web view.
['Concentus-LICENSE.txt', 'SharpSRTP-LICENSE.txt', 'BouncyCastle-LICENSE.txt'].forEach(function (f) {
  yes('installer/licences/' + f + ' exists', (function () {
    try { return fs.statSync(path.join(ROOT, 'installer', 'licences', f)).isFile(); } catch (e) { return false; }
  })());
});
yes('installer/licences/WebView2-LICENSE.txt is gone with the web view', !fs.existsSync(path.join(ROOT, 'installer', 'licences', 'WebView2-LICENSE.txt')));
// The launcher's libraries' texts go with the install as files (#4823): one
// list in InstallSteps.LicenceFiles, the same names in Build-SetupFiles.ps1,
// every file of installer/licences on it, and Uninstall.cs removing the list.
(function () {
  const licDir = path.join(ROOT, 'installer', 'licences');
  const onDisk = fs.readdirSync(licDir).filter(function (f) { return f !== 'README.txt'; }).sort();
  const steps = fs.readFileSync(path.join(ROOT, 'launcher', 'app', 'InstallSteps.cs'), 'utf8');
  const m = /static readonly string\[\] LicenceFiles =\s*\{([\s\S]*?)\};/.exec(steps);
  const listed = m ? (m[1].match(/"[^"]+"/g) || []).map(function (s) { return s.slice(1, -1); }).sort() : [];
  yes('InstallSteps.LicenceFiles names every file in installer/licences but README.txt, and nothing else',
      listed.length > 0 && JSON.stringify(listed) === JSON.stringify(onDisk));
  const setup = fs.readFileSync(path.join(ROOT, 'scripts', 'release', 'Build-SetupFiles.ps1'), 'utf8');
  // Build-SetupFiles.ps1 reads its names off that list in InstallSteps.cs, so
  // there is no second list: its pattern is run here on the same file, and the
  // GPL and AGPL (which come with SOURCE CODE.txt) are the ones it leaves out.
  const s = /\$listAt = \[regex\]::Match\(\[IO\.File\]::ReadAllText\(\$stepsCs\), '([^']+)'\)/.exec(setup);
  const readsSteps = setup.indexOf("$stepsCs = Join-Path $RepoDir 'launcher\\app\\InstallSteps.cs'") >= 0;
  let packed = [];
  if (s) {
    const pat = s[1].replace(/^\(\?s\)/, '');
    const got = new RegExp(pat, 's').exec(steps);
    packed = got ? (got[1].match(/"[^"]+"/g) || []).map(function (x) { return x.slice(1, -1); })
      .filter(function (f) { return f !== 'GPL-3.0.txt' && f !== 'AGPL-3.0.txt'; }) : [];
  }
  const wantPacked = listed.filter(function (f) { return f !== 'GPL-3.0.txt' && f !== 'AGPL-3.0.txt'; });
  yes('Build-SetupFiles.ps1 packs the launcher licence texts InstallSteps.LicenceFiles names, read off that list (GPL and AGPL come with SOURCE CODE.txt)',
      readsSteps && /\$launcherLicences = @\(\[regex\]::Matches\(\$listAt\.Groups\[1\]\.Value/.test(setup) &&
      setup.indexOf("Where-Object { $_ -notin 'GPL-3.0.txt', 'AGPL-3.0.txt' }") >= 0 &&
      packed.length > 0 && JSON.stringify(packed.slice().sort()) === JSON.stringify(wantPacked));
  const uninstall = fs.readFileSync(path.join(ROOT, 'launcher', 'app', 'Uninstall.cs'), 'utf8');
  yes('Uninstall.cs removes every file of InstallSteps.LicenceFiles',
      /foreach \(string lic in InstallSteps\.LicenceFiles\) leave\.Add\(Path\.Combine\(Paths\.Root, lic\)\);/.test(uninstall));
  const readme = fs.readFileSync(path.join(licDir, 'README.txt'), 'utf8');
  const unread = onDisk.filter(function (f) { return readme.indexOf('\n  ' + f) < 0 && readme.indexOf('\r\n  ' + f) < 0; });
  yes('installer/licences/README.txt says where each text is from' + (unread.length ? ', not: ' + unread.join(', ') : ''), unread.length === 0);
})();
// 1.0.1 has no GPL file in it; 1.0.0, which revisions 1 and 2 still install,
// has ___systemPolyfill.js and skyrim-platform's licence beside it.
const polyRows = runtimeSec.split('\n').filter(function (l) {
  return l.charAt(0) === '|' && l.indexOf('___systemPolyfill.js') >= 0;
});
yes('no table in the Client Runtime section lists ___systemPolyfill.js, which 1.0.1 does not carry', polyRows.length === 0);
const oldRuntime = (function () {
  const at = runtimeSec.indexOf('\n### Version 1.0.0');
  return at < 0 ? '' : flat(runtimeSec.slice(at));
})();
yes('the Client Runtime section says what 1.0.0, still installed by revisions 1 and 2, carries',
    oldRuntime.indexOf('`___systemPolyfill.js`') >= 0 && oldRuntime.indexOf('SkyrimPlatform-LICENSE.txt') >= 0 &&
    oldRuntime.indexOf('GNU General Public License version 3') >= 0);
const polySrc = new RegExp(reEscape(forkUrl) + '/tree/([0-9a-f]{40})/skyrim-platform/tools/system_polyfill').exec(sourceSec);
yes('"Where the source is" gives a commit of the fork that still has ___systemPolyfill.js', !!(forkUrl && polySrc));
yes('the credits page names the Thornswood Client Runtime and links its Nexus page',
    C.indexOf('Thornswood Client Runtime') >= 0 && C.indexOf('/mods/' + RUNTIME_ID) >= 0);
yes('the credits page names ___systemPolyfill.js and its licence',
    /___systemPolyfill\.js[\s\S]{0,200}GNU GPL version 3/.test(C));

// The polyfill's source, where the fork is here: the commit named for it has
// the same script, the recorded commit no longer has it, and the licence text
// the mod carries is skyrim-platform's own.
const POLY = 'skyrim-platform/tools/system_polyfill';
let polyUpstream = null;
let spLicence = null;
// A clone fetched at the pin alone (--depth 1, as Build-Front.ps1 and
// engine-pin.yml fetch it, #5148) does not hold the polyfill's older commit,
// so there is nothing here to read it in.
let polyHere = false;
if (haveFork && polySrc) {
  try { git(['cat-file', '-e', polySrc[1] + '^{commit}']); polyHere = true; } catch (e) { polyHere = false; }
}
if (polyHere) {
  try { polyUpstream = git(['show', polySrc[1] + ':' + POLY + '/dist/___systemPolyfill.js']); } catch (e) { polyUpstream = null; }
  try { spLicence = git(['show', polySrc[1] + ':skyrim-platform/LICENSE']); } catch (e) { spLicence = null; }
  yes('the fork at ' + polySrc[1].slice(0, 8) + ' has ' + POLY + '/src/___systemPolyfill.ts', (function () {
    try { git(['cat-file', '-e', polySrc[1] + ':' + POLY + '/src/___systemPolyfill.ts']); return true; } catch (e) { return false; }
  })());
  yes('the fork at the recorded commit no longer has ' + POLY, (function () {
    try { git(['cat-file', '-e', commit + ':' + POLY]); return false; } catch (e) { return true; }
  })());
} else {
  skip(haveFork && polySrc ? 'the fork clone at ' + FORK + ' does not hold ' + polySrc[1].slice(0, 8) + ', so ___systemPolyfill.js\'s source was not read there'
    : 'no fork here to read ___systemPolyfill.js\'s source commit in');
}

// Vortex's copy of the mod. The newest one Vortex holds is the one read; an
// older upload than the notices describe is a machine that has not caught up,
// and says SKIP, while a newer one fails until the notices describe it.
const VORTEX_MODS = process.env.THORNSWOOD_VORTEX_MODS ||
  path.join(process.env.APPDATA || '', 'Vortex', 'skyrimse', 'mods');
function versionOf(s) { return String(s).split('.').map(function (x) { return parseInt(x, 10) || 0; }); }
function compareVersions(a, b) {
  const x = versionOf(a), y = versionOf(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) { return (x[i] || 0) < (y[i] || 0) ? -1 : 1; }
  }
  return 0;
}
let runtimeDir = null, runtimeVer = null;
try {
  fs.readdirSync(VORTEX_MODS).forEach(function (n) {
    const m = new RegExp('^Thornswood Client Runtime ' + RUNTIME_ID + ' (\\d+(?:\\.\\d+)*) ').exec(n);
    if (m && (runtimeVer === null || compareVersions(m[1], runtimeVer) > 0)) {
      runtimeVer = m[1]; runtimeDir = path.join(VORTEX_MODS, n);
    }
  });
} catch (e) { runtimeDir = null; }
const notedVer = (/version (\d+(?:\.\d+)*), file \d+/.exec(runtimeFlat) || [])[1] || null;
yes('the Client Runtime section gives the version and file it describes', !!notedVer);
if (!runtimeDir) {
  skip('no copy of the Thornswood Client Runtime in ' + VORTEX_MODS + ', so its files were not read');
} else if (notedVer && compareVersions(runtimeVer, notedVer) < 0) {
  skip('Vortex here holds the Client Runtime ' + runtimeVer + ', older than the ' + notedVer + ' THIRD-PARTY.md describes');
} else {
  yes('THIRD-PARTY.md describes the Client Runtime Vortex holds here, ' + runtimeVer,
      !!notedVer && compareVersions(runtimeVer, notedVer) === 0);
  const dist = path.join(runtimeDir, 'Platform', 'Distribution');
  const modFiles = walk(dist, []);
  const rel = function (p) { return path.relative(dist, p).split(path.sep).join('\\'); };
  let bytes = 0;
  modFiles.forEach(function (p) { bytes += fs.statSync(p).size; });
  yes('the section gives the file count, ' + modFiles.length + ' files', runtimeFlat.indexOf(modFiles.length + ' files') >= 0);
  yes('the section gives the size, ' + commas(bytes) + ' bytes', runtimeFlat.indexOf(commas(bytes) + ' bytes') >= 0);
  const locales = modFiles.filter(function (p) { return /^CEF\\locales\\[^\\]+\.pak$/i.test(rel(p)); });
  yes('the section counts the language packs, ' + locales.length + ' `CEF\\locales\\*.pak`',
      runtimeFlat.indexOf(locales.length + ' `CEF\\locales\\*.pak`') >= 0);
  const unnamed = modFiles.filter(function (p) {
    return locales.indexOf(p) < 0 && runtimeSec.indexOf(path.basename(p)) < 0;
  }).map(rel);
  unnamed.forEach(function (r) { console.log('      not named in the section: ' + r); });
  yes('every other file in the mod is named in the section (' + (modFiles.length - locales.length) + ')', unnamed.length === 0);
  const leaves = cbFiles.map(function (r) { return r.split('\\').pop().toLowerCase(); });
  yes('none of the six recorded client files is in the mod, as the section says',
      modFiles.every(function (p) { return leaves.indexOf(path.basename(p).toLowerCase()) < 0; }));

  // By sha256: every program, data file and script, and nothing listed that
  // the mod does not have.
  const hashRows = {};
  runtimeSec.split('\n').forEach(function (l) {
    const m = /^\| `([^`]+)` \| [\d,]+ \| `([0-9a-f]{64})` \|/.exec(l);
    if (m) { hashRows[m[1]] = m[2]; }
  });
  modFiles.filter(function (p) { return /\.(dll|exe|dat|js)$/i.test(p); }).forEach(function (p) {
    const r = rel(p);
    const sha = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    yes(r + ' is in the section by its sha256, ' + sha.slice(0, 16), hashRows[r] === sha);
  });
  Object.keys(hashRows).forEach(function (r) {
    yes(r + ', hashed in the section, is in the mod', fs.existsSync(path.join.apply(path, [dist].concat(r.split('\\')))));
  });

  // The licence texts it installs, each named, and the versions its README
  // gives, each in the section.
  const docs = path.join(runtimeDir, 'Docs', 'Thornswood Client Runtime');
  let licences = [];
  try { licences = fs.readdirSync(path.join(docs, 'licences')); } catch (e) { licences = []; }
  yes('the mod carries licence texts (' + licences.length + ')', licences.length > 0);
  licences.forEach(function (n) { yes(n + ', in the mod, is named in the section', runtimeSec.indexOf('`' + n + '`') >= 0); });
  const icuText = (function () {
    try { return fs.readFileSync(path.join(docs, 'licences', 'ICU-LICENSE.txt')); } catch (e) { return null; }
  })();
  if (icuText !== null) {
    const icuSha = crypto.createHash('sha256').update(icuText).digest('hex');
    yes('the section gives the sha256 of the mod\'s ICU-LICENSE.txt, ' + icuSha.slice(0, 16), runtimeFlat.indexOf(icuSha) >= 0);
  }
  const readme = read(path.join(docs, 'README.txt')) || '';
  const what = readme.split(/\nNot included/)[0];
  const vers = (what.match(/\b\d+\.\d+\.\d+(?:\.\d+)?(?:\+g[0-9a-f]+)?/g) || []).filter(function (v, i, a) { return a.indexOf(v) === i; });
  yes('the mod\'s README gives versions to check (' + vers.join(', ') + ')', vers.length > 0);
  vers.forEach(function (v) { yes('the section gives ' + v + ', from the mod\'s README', runtimeSec.indexOf(v) >= 0); });

  const polyMod = read(path.join(dist, '___systemPolyfill.js'));
  if (polyMod !== null && polyUpstream !== null) {
    yes('the mod\'s ___systemPolyfill.js is the fork\'s at ' + polySrc[1].slice(0, 8) + ', line endings aside',
        polyMod === polyUpstream);
  }
  const spMod = read(path.join(docs, 'licences', 'SkyrimPlatform-LICENSE.txt'));
  if (spMod !== null && spLicence !== null) {
    yes('the mod\'s SkyrimPlatform-LICENSE.txt is skyrim-platform/LICENSE', spMod === spLicence);
  }
}

// The launcher's record of where each game file came from, where the profile
// is here. Every file under Data\Platform\Distribution that the collection
// provides is covered by the Client Runtime section, and there are as many as
// it says.
const PROFILE = process.env.THORNSWOOD_PROFILE || 'C:\\Thornswood\\Profile';
const filesTxt = read(path.join(PROFILE, 'OwnGame', 'files.txt'));
if (filesTxt === null) {
  skip('no ' + path.join(PROFILE, 'OwnGame', 'files.txt') + ' here, so where the game files came from was not read');
} else {
  const fromCollection = filesTxt.split('\n').map(function (l) { return l.split('|'); })
    .filter(function (f) { return f.length >= 5 && f[1] === 'V'; })
    .map(function (f) { return f.slice(4).join('|'); })
    .filter(function (r) { return /^Data\\Platform\\Distribution\\/i.test(r); });
  if (fromCollection.length === 0) {
    skip('files.txt here gives the collection no file under Data\\Platform\\Distribution');
  } else {
    const loose = fromCollection.filter(function (r) {
      if (/\\CEF\\locales\\[^\\]+\.pak$/i.test(r)) { return runtimeSec.indexOf('`CEF\\locales\\*.pak`') < 0; }
      return runtimeSec.indexOf(r.split('\\').pop()) < 0;
    });
    loose.forEach(function (r) { console.log('      from the collection and not in the section: ' + r); });
    yes('every file the collection puts under Data\\Platform\\Distribution is in the Client Runtime section (' +
        fromCollection.length + ')', loose.length === 0);
    yes('the section says ' + fromCollection.length + ' files, as files.txt does',
        runtimeFlat.indexOf(fromCollection.length + ' files') >= 0);
  }
}

// ------------------------------------- built here from other people's work
//
// Issue #3715. The launcher builds behavior files with Pandora and bodies
// with BodySlide on each computer (launcher\app\GeneratedBuild.cs, which
// Build-Generated.ps1 runs too), and Ship-Rules.ps1 names what it builds
// ($ShipGeneratedBodyFiles, $ShipGeneratedOutfitFiles and the patterns
// $ShipGeneratedPatterns adds) so that no pack and no installer carries them.
// Until 27 October every release carried them, 45 files with nothing saying
// whose they were. They are still other people's work on every computer, and
// the credits name it: every path and pattern Ship-Rules.ps1 names as built is
// named by an entry of records\asset-provenance.json, and every file of a
// generated record matches one: tests\fixtures\3715-generated.txt, the 45 the
// installer carried on 27 October, and the launcher's own
// Profile\OwnGame\generated.txt where it is on this machine.
const shipRulesText = read(path.join(REPO, 'scripts', 'release', 'Ship-Rules.ps1')) || '';
function shipPaths(text, name) {
  // @() on one line is an empty list, not the start of one that ends further down.
  const m = new RegExp('^\\$' + name + ' = (?:[$\\w]+ \\+ )*@\\((?:\\)|([\\s\\S]*?)^\\))', 'm').exec(text);
  // A comment line inside the list is not a path, though it may hold a quote.
  const body = (m && m[1] || '').replace(/^\s*#.*$/mg, '');
  return m ? (body.match(/'[^']+'/g) || []).map(function (q) { return q.slice(1, -1); }) : [];
}
// PowerShell's -like, as Test-ShipGenerated uses it: * and ?, any case.
function like(rel, pattern) {
  const rx = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + rx + '$', 'i').test(rel);
}
function generatedRows(text) {
  return String(text || '').split('\n').map(function (l) { return /^file [0-9a-f]{64} (.+)$/.exec(l.trim()); })
    .filter(Boolean).map(function (m) { return m[1].replace(/\//g, '\\'); });
}
// Each finding is one line saying what has no entry.
function generatedAudit(reg, rules, rows) {
  const bad = [];
  const entries = ((reg && reg.notInRepo) || []).filter(function (e) { return Array.isArray(e.paths); });
  const named = function (p) {
    return entries.filter(function (e) { return e.paths.some(function (q) { return q.toLowerCase() === p.toLowerCase(); }); });
  };
  const lets = shipPaths(rules, 'ShipGeneratedBodyFiles').concat(shipPaths(rules, 'ShipGeneratedOutfitFiles'), shipPaths(rules, 'ShipGeneratedPatterns'));
  lets.forEach(function (p) {
    const by = named(p);
    if (by.length === 0) bad.push(p + ': Ship-Rules.ps1 names it as built on each computer, and no records\\asset-provenance.json entry names it');
    by.forEach(function (e) {
      if (!e.licence || !e.status) bad.push(p + ': its entry has no licence or status');
      if (e.status === 'no-licence-found' && !(Number.isInteger(e.issue) && e.issue > 0)) bad.push(p + ': no licence found, and no issue carries the decision');
    });
  });
  rows.forEach(function (rel) {
    const by = entries.filter(function (e) { return e.paths.some(function (q) { return like(rel, q); }); });
    if (by.length === 0) bad.push(rel + ': in a generated record, and no records\\asset-provenance.json entry covers it');
  });
  return { bad: bad, lets: lets };
}
let provenance = null;
try { provenance = JSON.parse(read(path.join(REPO, 'records', 'asset-provenance.json'))); } catch (e) { }
yes('records\\asset-provenance.json reads, for the generated files', provenance !== null);
const standIn = generatedRows(read(path.join(REPO, 'tests', 'fixtures', '3715-generated.txt')));
yes('the stand-in generated record lists the 45 files the installer carried (' + standIn.length + ')', standIn.length === 45);
const gen = generatedAudit(provenance, shipRulesText, standIn);
gen.bad.forEach(function (b) { console.log('      ' + b); });
yes('Ship-Rules.ps1 names what the launcher builds (' + gen.lets.length + ' paths and patterns, each once)', gen.lets.length === new Set(gen.lets.map(function (p) { return p.toLowerCase(); })).size && gen.lets.length >= 12);
yes('every generated path and pattern, and every file in the stand-in record, has a provenance entry (' + gen.bad.length + ' finding(s))', gen.bad.length === 0);
const ownGenerated = read(path.join(PROFILE, 'OwnGame', 'generated.txt'));
if (ownGenerated === null) {
  skip('no ' + path.join(PROFILE, 'OwnGame', 'generated.txt') + ' here, so this machine\'s generated files were not held to the register');
} else {
  const own = generatedAudit(provenance, shipRulesText, generatedRows(ownGenerated));
  own.bad.forEach(function (b) { console.log('      ' + b); });
  yes('every file this machine\'s generated.txt lists has a provenance entry (' + own.bad.length + ' finding(s))', own.bad.length === 0);
}
const builtSec = (/\n## Built here from other people's work: behaviors and bodies\n([\s\S]*?)\n## /.exec(N) || [])[1] || '';
yes('THIRD-PARTY.md has the section on what the launcher builds', builtSec.length > 0);
['Pandora Behaviour Engine+', 'Precision', 'True Directional Movement', 'CBBE 3BA', 'HIMBO', 'Nexus SE 198'].forEach(function (w) {
  yes('  it names ' + w, builtSec.indexOf(w) >= 0);
});
yes('  and "What is still missing" says the installer already published carries them until a release after #3715 replaces it', /behavior files[\s\S]*#3715[\s\S]*replaces it/.test((/\n## What is still missing\n([\s\S]*?)\n## /.exec(N) || [])[1] || ''));
// HIMBO's body goes out under CC BY-SA 4.0, which asks for the credit and the
// licence wherever it is handed on.
yes('the public credits page credits HIMBO and gives its licence', /HIMBO/.test(C) && /Kreiste and Novelyst/.test(C) && /creativecommons\.org\/licenses\/by-sa\/4\.0/.test(C));
if (provenance) {
  const without = function (test) {
    const c = JSON.parse(JSON.stringify(provenance));
    c.notInRepo = c.notInRepo.filter(function (e) { return !test(e); });
    return generatedAudit(c, shipRulesText, standIn).bad;
  };
  let r = without(function (e) { return (e.paths || []).indexOf('Data\\meshes\\actors\\character\\character assets\\femalebody_0.nif') >= 0; });
  yes('a body whose provenance entry is taken out is caught', r.some(function (b) { return /^Data\\meshes\\actors\\character\\character assets\\femalebody_0\.nif: Ship-Rules\.ps1 names it as built/.test(b); }));
  r = without(function (e) { return (e.paths || []).indexOf('Data\\meshes\\actors\\*\\behaviors\\*.hkx') >= 0; });
  yes('a behavior file whose provenance entry is taken out is caught', r.some(function (b) { return /^Data\\meshes\\actors\\character\\behaviors\\0_master\.hkx: in a generated record/.test(b); }));
}

// ------------------------------------------------- the collection's menus
// QuickLoot IE's Nexus page says "Released under the GPL-3.0-or-later
// license", and its 4.1.0 changelog "Changed the project license to
// GPL-3.0-or-later"; all four records said "version 3" or "GPL 3" until
// #3800. SkyUI's, SkyHUD's and moreHUD's pages each say something different
// about their files, and the record had them as one ("nothing on those mods'
// pages"), so each is held to its own page's words.
{
  const ql = read(path.join(REPO, 'game', 'ours', 'Data', 'SKSE', 'Plugins', 'QuickLootIE.json')) || '';
  const prov = JSON.parse(read(path.join(REPO, 'records', 'asset-provenance.json')) || '{"assets":[]}');
  const all = JSON.stringify(prov);
  const qlEntry = (prov.assets || []).find(function (a) { return a.path === 'game/ours/Data/SKSE/Plugins/QuickLootIE.json'; });
  const menuEntry = (prov.notInRepo || []).find(function (a) { return /skyui\\itemcard\.swf/.test(a.path); });
  const qlSection = flat(N.slice(N.indexOf('`Data\\SKSE\\Plugins\\QuickLootIE.json` does ship'), N.indexOf('## Made for Thornswood by somebody else')));
  const qlCredits = flat(C.slice(C.indexOf('**QuickLoot IE\'s settings**'), C.indexOf('**SkyUI\'s item lists')));
  [['THIRD-PARTY.md', qlSection], ['the credits page', qlCredits], ['QuickLootIE.json', flat(ql.split('"logLevel"')[0])],
   ['its provenance licence', qlEntry ? qlEntry.licence : ''], ['its provenance attribution', qlEntry ? qlEntry.attribution : '']]
    .forEach(function (pair) {
      yes(pair[0] + ' names QuickLoot IE\'s licence GPL-3.0-or-later', pair[1].indexOf('GPL-3.0-or-later') >= 0);
      yes('  and never the GPL 3 or version 3 alone', !/GPL 3\b|General Public License version 3(?! unchanged)/.test(pair[1]));
    });
  const menus = flat(N.slice(N.indexOf('## The collection\'s menus, with no gold values'), N.indexOf('`Data\\SKSE\\Plugins\\QuickLootIE.json` does ship')));
  yes('THIRD-PARTY.md no longer says nothing on the menu mods\' pages lets them be handed on',
      menus.indexOf('nothing on those mods\' pages') < 0 && all.indexOf('none of them lets Thornswood hand these files on') < 0);
  yes('  it quotes SkyUI\'s page on uploads and patches',
      menus.indexOf('"Upload: not allowed to upload to other sites"') >= 0 && menus.indexOf('"You may release any patches that require the original file"') >= 0);
  yes('  SkyHUD\'s on the rest of the mod', menus.indexOf('"The rest of the mod must not be included"') >= 0);
  yes('  and says moreHUD\'s page has no permission list', /moreHUD: the page shows no permission list/.test(menus));
  yes('  with the date the pages were read', /read on 26 October/.test(menus));
  yes('the provenance menu entry quotes each page too', !!menuEntry &&
      menuEntry.licence.indexOf('read 26 Oct 2026') >= 0 && menuEntry.licence.indexOf('Upload: not allowed to upload to other sites') >= 0 &&
      menuEntry.licence.indexOf('The rest of the mod must not be included') >= 0 && /moreHUD \(12688\): the page shows no permission list/.test(menuEntry.licence));
  yes('no record says only revision 4 installs the menu mods\' files', all.indexOf('revision 4 installs') < 0 && N.indexOf('revision 4 installs') < 0);
}

// ---------------------------------------------------------------- the words
[['THIRD-PARTY.md', N], ['credits.md', C]].forEach(function (pair) {
  yes(pair[0] + ' has no em dash', pair[1].indexOf('\u2014') < 0);
  yes(pair[0] + ' never says player', !/\bplayers?\b/i.test(pair[1]));
});
// Thornswood's own code is under MIT (Patrick, 26 Oct, #3688). LICENSE holds
// the MIT text and nothing else: one added sentence and GitHub's licence
// reader (licensee) stops naming it MIT, measured 26 Oct. What MIT does not
// cover, and the terms every contributor agrees to once (#1331), are in
// LICENSING.md. This file points there and licenses nothing of ours itself.
const licence = read(path.join(ROOT, 'LICENSE'));
yes('LICENSE is at the repo root', licence !== null);
const MIT_BODY = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software and associated documentation files (the "Software"), to deal',
  'in the Software without restriction, including without limitation the rights',
  'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
  'copies of the Software, and to permit persons to whom the Software is',
  'furnished to do so, subject to the following conditions:',
  '',
  'The above copyright notice and this permission notice shall be included in all',
  'copies or substantial portions of the Software.',
  '',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
  'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
  'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
  'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
  'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
  'SOFTWARE.',
].join('\n');
const MIT_FILE = 'MIT License\n\nCopyright (c) 2026 Patrick (EvilPatrick06) and Thornswood contributors\n\n' +
  MIT_BODY + '\n';
yes('  it is the MIT text and nothing else, so GitHub reads it as MIT', licence === MIT_FILE);
const licensing = read(path.join(ROOT, 'LICENSING.md'));
const LG = licensing || '';
yes('LICENSING.md is at the repo root', licensing !== null);
yes('  it says what MIT does not cover', /## What MIT does not cover/.test(LG));
yes('  the SkyMP fork keeps its own licences', /engine\/skymp/.test(LG) && /Affero/.test(LG));
yes('  every file THIRD-PARTY.md lists keeps its own', /Every file `THIRD-PARTY\.md` lists/.test(LG));
yes('  lore, art and music Thornswood owns are under CC BY-NC-SA 4.0 (Patrick, 26 Oct, #3688)',
    /## Lore, art and music: CC BY-NC-SA 4\.0/.test(LG) && /creativecommons\.org\/licenses\/by-nc-sa\/4\.0/.test(LG));
yes('  the content plugin\'s own records are under it, Last.esp and WoodworkerTrail once #2791 rebuilds them (q-3688-esp-licence, 4)',
    /`game\/content\/Thornswood-Content\.esp` now/.test(flat(LG)) && /once #2791 has rebuilt them/.test(flat(LG)));
yes('  the name and logo stay all rights reserved', /\*\*The Thornswood name and logo\.\*\* They stay all rights reserved/.test(LG));
// Every logo file LICENSING.md keeps out of CC BY-NC-SA 4.0 is a real file.
const logoAt = LG.indexOf('**The Thornswood name and logo.**');
const logoPara = logoAt >= 0 ? LG.slice(logoAt, LG.indexOf('\n7. ', logoAt)) : '';
const logoFiles = [];
let dirNow = '';
(logoPara.match(/`[^`]+`/g) || []).forEach(function (q) {
  const f = q.slice(1, -1);
  if (f.indexOf('/') >= 0) { dirNow = f.slice(0, f.lastIndexOf('/') + 1); logoFiles.push(f); }
  else if (dirNow) { logoFiles.push(dirNow + f); }
});
const logoMissing = logoFiles.filter(function (f) { return !fs.existsSync(path.join(ROOT, f)); });
logoMissing.forEach(function (f) { console.log('      named as a logo file, not in the repository: ' + f); });
yes('  every logo file it names is in the repository (' + logoFiles.length + ')', logoFiles.length >= 10 && logoMissing.length === 0);
yes('  and it carries the contributor terms', /## Contributor terms/.test(LG) && /agrees to these\s+terms once/.test(LG));
yes('THIRD-PARTY.md sends the project\'s own licence to LICENSE and LICENSING.md',
    /does not license Thornswood's own work\./.test(N) && /`LICENSE` at the root/.test(N) && /`LICENSING\.md` says what that licence does not cover/.test(N));
yes('THIRD-PARTY.md says it covers files kept in the repository too, as LICENSING.md does',
    /the files kept in this repository that somebody else wrote/.test(N));
// Contributor term 3 asks the pull request to say whose the work is, so the
// template has a line for it (#3651).
const template = read(path.join(ROOT, '.github', 'pull_request_template.md')) || '';
if (/the pull request says whose it is/.test(flat(LG))) {
  yes('the pull request template has a "Whose work" line for contributor term 3', /^Whose work:/m.test(template));
} else {
  yes('LICENSING.md no longer asks the pull request to say whose the work is', true);
}
[['LICENSING.md', LG]].forEach(function (pair) {
  yes(pair[0] + ' has no em dash', pair[1].indexOf('—') < 0);
  yes(pair[0] + ' never says player', !/\bplayers?\b/i.test(pair[1]));
});

// --------------------------------------------- kept in the repository, #3761
//
// LICENSING.md says MIT does not cover anything THIRD-PARTY.md lists, and
// THIRD-PARTY.md lists what sits in the repository as well as what ships.
// A fixture that is large or carries somebody else's notice has a row in
// "Kept in the repository, not shipped". The 2.4 MB skymp5-front build and
// certifi's roots sat in tests\fixtures with none until #3761.
const keptAt = N.indexOf('## Kept in the repository, not shipped');
yes('THIRD-PARTY.md has a section for files kept in the repository, not shipped', keptAt >= 0);
const keptSec = keptAt >= 0 ? N.slice(keptAt, N.indexOf('\n## ', keptAt + 5) > 0 ? N.indexOf('\n## ', keptAt + 5) : N.length) : '';
const NOTICE_RE = /@license|\bCopyright\b|\bcertifi\b|-----BEGIN CERTIFICATE-----/;
function walkFixtures(dir, rel, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const r = rel ? rel + '\\' + e.name : e.name;
    if (e.isDirectory()) { walkFixtures(path.join(dir, e.name), r, out); }
    else if (e.isFile()) { out.push({ rel: r, full: path.join(dir, e.name) }); }
  });
  return out;
}
const fixtures = walkFixtures(path.join(ROOT, 'tests', 'fixtures'), '', []);
const fixturesFlagged = fixtures.filter(function (f) {
  const size = fs.statSync(f.full).size;
  if (size > 100 * 1024) { return true; }
  return NOTICE_RE.test(fs.readFileSync(f.full, 'latin1'));
});
yes('  the check found the fixtures it was written for (' + fixturesFlagged.length + ')',
    fixturesFlagged.some(function (f) { return f.rel === '3111-roots.pem'; }));
fixturesFlagged.forEach(function (f) {
  yes('  tests\\fixtures\\' + f.rel + ' has a row there', keptSec.indexOf('`tests\\fixtures\\' + f.rel + '`') >= 0);
});
const uiFront = fixtures.filter(function (f) { return f.rel === 'ui-front-build.js'; })[0];
if (uiFront) {
  const ui = fs.readFileSync(uiFront.full, 'utf8');
  yes('  tests\\fixtures\\ui-front-build.js is only the build\'s asset modules: no bundled npm notice in it',
      !/@license|\bCopyright\b|react-dom|\bLicensed under\b/i.test(ui));
  yes('  and it has a row there all the same, since it was cut from skymp5-front\'s GPL build',
      keptSec.indexOf('`tests\\fixtures\\ui-front-build.js`') >= 0 && /General Public License version 3/.test(keptSec));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
