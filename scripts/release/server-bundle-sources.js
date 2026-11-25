// server-bundle-sources.js
//
//     node scripts\release\server-bundle-sources.js <skymp5-server.js.map> <fork>
//
// Whether the server's JavaScript half, dist_back\skymp5-server.js, was built
// from the fork as it stands (issues #1200 and #1214). New-ServerBuildRecord.ps1
// runs it before it records the bundle as built from the fork's commit.
//
// HOW. skymp5-server's build-ts bundles with esbuild and --sourcemap, and
// esbuild writes every file it bundled into the map word for word
// (sourcesContent): the server's own TypeScript under skymp5-server\ts and
// every package out of skymp5-server\node_modules. So the map says what the
// bundle was built from. Each source is read from the fork and compared. A
// bundle built from another commit's TypeScript, or against packages the fork
// does not have installed, differs somewhere, and that source is named.
//
// Source paths in the map are relative to the bundle's own folder, which
// build-ts puts at <fork>\build\dist\server\dist_back (skymp5-server's
// package.json, --outfile). They are resolved against that folder in the
// fork whichever folder the map is read from, so a copy of the build can be
// checked against the fork it came from.
//
// What is held, measured on the build of 1a2e5995 (1,290 sources):
//   skymp5-server\ts             every one there and word for word (11 of
//                                the 12 files; system.ts is types only)
//   skymp5-server\node_modules   every one that is on disk, word for word
//                                (1,029). The other 249 are a package's own
//                                TypeScript, named by the source map the
//                                package ships beside its JavaScript, which
//                                esbuild follows; the package is not
//                                installed with it. Those packages are held
//                                to yarn.lock by New-ServerBuildRecord.ps1
//                                (yarn check --integrity), not here.
//   a name with a colon before any slash ("node-modules-polyfills:util")
//                                is a namespace a package's map uses, not a
//                                file, and is counted, not read
// Anything else outside skymp5-server is a bundle built from somewhere else.
//
// Prints one line per source that differs and "SOURCES OK <sources> <ts>"
// when every one is the fork's. Exit 0 when they all are, 1 when any is not,
// 2 when the map or the fork cannot be read. Read only.
'use strict';
const fs = require('fs');
const path = require('path');

// { problems: [sentences], sources, ts } for a parsed map against a fork.
// read(absolutePath) gives the file's text, or null when there is none.
function bundleSourceProblems(map, fork, read) {
  const out = [];
  const sources = map && Array.isArray(map.sources) ? map.sources : null;
  const contents = map && Array.isArray(map.sourcesContent) ? map.sourcesContent : null;
  if (!sources || !sources.length) { return { problems: ['the source map names no sources'], sources: 0, ts: 0 }; }
  if (!contents || contents.length !== sources.length) {
    return { problems: ['the source map does not carry what each source said (sourcesContent), so nothing shows what it was built from'], sources: sources.length, ts: 0 };
  }
  const base = path.join(fork, 'build', 'dist', 'server', 'dist_back');
  const server = path.join(fork, 'skymp5-server');
  const inServer = server.toLowerCase() + path.sep;
  let ts = 0;
  for (let i = 0; i < sources.length; i++) {
    const src = String(sources[i]);
    if (/^[A-Za-z][A-Za-z0-9+.-]+:[^/\\]/.test(src)) { continue; }
    const abs = path.resolve(base, src);
    const rel = path.relative(fork, abs).split(path.sep).join('/');
    if (abs.toLowerCase().indexOf(inServer) !== 0) {
      out.push('the bundle was built from ' + src + ', which is not in the fork\'s skymp5-server');
      continue;
    }
    const own = /^skymp5-server\/ts\//.test(rel);
    if (own) { ts++; }
    const have = read(abs);
    if (have === null) {
      if (own) { out.push('the bundle was built from ' + rel + ', which the fork does not have'); }
      continue;
    }
    if (have !== contents[i]) { out.push(rel + ' in the bundle is not the fork\'s ' + rel); }
  }
  if (!ts) { out.push('the source map names none of the server\'s own TypeScript (skymp5-server/ts)'); }
  return { problems: out, sources: sources.length, ts: ts };
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

module.exports = { bundleSourceProblems: bundleSourceProblems };

if (require.main === module) {
  process.exitCode = cli();
}
// Run as a program. A function, so a stop is a return and not node's exit
// function, which can hang on Node 24 (#6036).
function cli() {
  const mapPath = process.argv[2];
  const fork = process.argv[3];
  if (!mapPath || !fork) {
    console.log('usage: node server-bundle-sources.js <skymp5-server.js.map> <fork>');
    return 2;
  }
  let map = null;
  try { map = JSON.parse(fs.readFileSync(mapPath, 'utf8')); } catch (e) {
    console.log('the source map ' + mapPath + ' does not read: ' + e.message);
    return 2;
  }
  if (!fs.existsSync(path.join(fork, 'skymp5-server'))) {
    console.log('there is no skymp5-server in ' + fork);
    return 2;
  }
  const r = bundleSourceProblems(map, path.resolve(fork), readText);
  // A handful is enough to say what happened; a bundle from another commit
  // can differ in hundreds of places.
  r.problems.slice(0, 20).forEach(function (p) { console.log(p); });
  if (r.problems.length > 20) { console.log('... and ' + (r.problems.length - 20) + ' more'); }
  if (r.problems.length) { return 1; }
  console.log('SOURCES OK ' + r.sources + ' ' + r.ts);
  return 0;
}
