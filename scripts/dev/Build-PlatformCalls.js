#!/usr/bin/env node
// scripts/dev/Build-PlatformCalls.js
//
//     node scripts/dev/Build-PlatformCalls.js <fork clone> <commit>
//
// Issue #7090. Prints, as JSON, every name Skyrim Platform offers the game
// plugins at one fork commit, read from that commit's own sources with git
// show, so the fork's checkout can be at any commit:
//
//   - skyrimPlatform.ts, the typings: every function, class, method and
//     function-typed property it declares;
//   - the .psc files Skyrim Platform ships, every native Function, with its
//     first letter made small the way the platform exposes it
//     (TESModPlatform.CloseMenu is sp.TESModPlatform.closeMenu);
//   - skyrim_platform/*.cpp, every name the platform's C++ sets as a
//     function on an object it hands to JavaScript (.Set("getBackend",
//     Napi::Function::New(...))), which the typings leave out;
//   - skymp5-client/src/view/*.ts, the methods of the client's WorldView,
//     which reaches the plugins as sp.storage.view.
//
// The typings alone miss names the platform really has (closeMenu,
// getBackend, the WorldView), so all four are read.
//
// Build-Front.ps1 -Record writes this into records/front-build.json as
// platformCalls, with the rest of what it builds from the pinned commit,
// and without -Record holds the record to it. tests/test-7090-platform-calls.js
// checks every call in game/plugins against it.
//
// Read only.
'use strict';
const cp = require('child_process');

const TYPINGS = 'skyrim-platform/src/platform_se/codegen/convert-files/skyrimPlatform.ts';
const PLATFORM = 'skyrim-platform/src/platform_se';
const VIEW = 'skymp5-client/src/view';
const ID = '[A-Za-z_$][\\w$]*';

function platformCalls(fork, commit) {
  const git = (...a) => cp.execFileSync('git', ['-C', fork, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const full = git('rev-parse', '--verify', '--quiet', commit + '^{commit}').trim();
  const sources = {};
  const names = new Set();
  const read = (f) => {
    sources[f] = git('rev-parse', full + ':' + f).trim();
    return git('show', full + ':' + f);
  };
  const list = (dir) => git('ls-tree', '-r', '--name-only', full, dir).split('\n').filter(Boolean);

  const declared = [
    new RegExp('\\bfunction\\s+(' + ID + ')'),
    new RegExp('\\bclass\\s+(' + ID + ')'),
    new RegExp('^\\s+(?:static\\s+|readonly\\s+|abstract\\s+)*(' + ID + ')\\??\\s*[(<]'),
    new RegExp('^\\s*(?:export\\s+declare\\s+(?:let|const|var)\\s+|\\s+(?:readonly\\s+)?)(' + ID + ')\\??\\s*:\\s*\\('),
  ];
  for (const line of read(TYPINGS).split('\n')) {
    for (const re of declared) { const m = re.exec(line); if (m) { names.add(m[1]); } }
  }

  const files = list(PLATFORM);
  for (const f of files.filter((f) => /\.psc$/i.test(f))) {
    for (const line of read(f).split('\n')) {
      const m = /^\s*(?:[\w[\]]+\s+)?Function\s+([A-Za-z_]\w*)\s*\([^)]*\)[^;]*\bnative\b/i.exec(line);
      if (m) { names.add(m[1][0].toLowerCase() + m[1].slice(1)); }
    }
  }
  for (const f of files.filter((f) => /\/skyrim_platform\/[^/]+\.cpp$/.test(f))) {
    const src = read(f);
    const re = new RegExp('\\.Set\\(\\s*"(' + ID + ')"\\s*,([\\s\\S]{0,200})', 'g');
    let m;
    while ((m = re.exec(src))) {
      const value = m[2].split(/\)\s*;/)[0];
      if (/Function::New|NapiHelper::|Napi::Function/.test(value)) { names.add(m[1]); }
    }
  }

  for (const f of list(VIEW).filter((f) => /\.ts$/.test(f))) {
    for (const line of read(f).split('\n')) {
      const m = new RegExp('^\\s+(?:public\\s+|private\\s+|protected\\s+|static\\s+|async\\s+)*(' + ID + ')\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\{?\\s*$').exec(line);
      if (m && !/^(if|for|while|switch|catch|function|return)$/.test(m[1])) { names.add(m[1]); }
    }
  }

  const sorted = {};
  for (const k of Object.keys(sources).sort()) { sorted[k] = sources[k]; }
  return { sources: sorted, names: [...names].sort() };
}

module.exports = { platformCalls };

if (require.main === module) {
  const [fork, commit] = process.argv.slice(2);
  if (!fork || !commit) {
    console.error('usage: node scripts/dev/Build-PlatformCalls.js <fork clone> <commit>');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(platformCalls(fork, commit)) + '\n');
}
