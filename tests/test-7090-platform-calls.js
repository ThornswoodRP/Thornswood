// test-7090-platform-calls.js
//
//     node tests/test-7090-platform-calls.js
//
// The game plugins call only what the pinned Skyrim Platform has (#7090).
//
// WHY THIS EXISTS. The plugins are run in harnesses against stand-ins of
// Skyrim Platform written by hand, and a stand-in can offer a method the
// real one does not have. That is how a getActorBase call passed two
// harnesses and threw in the game. The same check found two more on main
// on 27 Nov 2026: the front set the field of view with Game.setCameraFOV and
// the mark plugin read a cell's editor id with Utility.getFormEditorID, and
// the pinned fork has neither (setCameraFOV is a console command there, not
// a call), so both only ever took their "this build has none" branch.
// tests/test-3126-settings.js held the field of view against a stand-in
// Game that had setCameraFOV.
//
// WHAT IT CHECKS. records/front-build.json's platformCalls, which
// Build-Front.ps1 -Record writes from the pinned fork commit with
// scripts/dev/Build-PlatformCalls.js (the typings, the .psc natives, the
// names the platform's C++ sets as functions, and the client's WorldView),
// and which Build-Front.ps1 holds the record to on every build. Every
// method call in game/plugins/*.js (x.name(...)) must be one of those
// names, a name the JavaScript runtime itself gives values, or a name a
// plugin declares itself. Red on any other, with the file and line.
//
// The record and not engine/skymp: the gate's checkouts do not fetch the
// fork, and this reads no git, so it runs only when a plugin or the record
// changes. tests/test-one-engine.js holds front-build.json to the pin.
//
// First it proves the check finds a call the platform does not have, and
// leaves alone the ones written in a comment, a string, a template or a
// regular expression; then it runs on this tree.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const { tokens, declared, calls, builtins } = require('./plugin-calls.js');

const REPO = path.join(__dirname, '..');
const PLUGINS = path.join(REPO, 'game', 'plugins');

let pass = 0;
let fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

const front = JSON.parse(fs.readFileSync(path.join(REPO, 'records', 'front-build.json'), 'utf8'));
const server = JSON.parse(fs.readFileSync(path.join(REPO, 'records', 'server-build.json'), 'utf8'));
const pc = front.platformCalls || {};
const platform = new Set(Array.isArray(pc.names) ? pc.names : []);
const runtime = builtins();

yes('records/front-build.json has platformCalls, written by Build-Front.ps1 -Record', platform.size > 0);
yes('  read from the typings, the .psc natives, the platform\'s C++ and the WorldView',
    !!(pc.sources && Object.keys(pc.sources).some((f) => /skyrimPlatform\.ts$/.test(f)) &&
       Object.keys(pc.sources).some((f) => /\.psc$/i.test(f)) &&
       Object.keys(pc.sources).some((f) => /skyrim_platform\/[^/]+\.cpp$/.test(f)) &&
       Object.keys(pc.sources).some((f) => /^skymp5-client\/src\/view\//.test(f))));
yes('  of the commit the server is built from', front.forkCommit === (server.source && server.source.commit));

// What a set of sources calls that is in none of the three.
function misses(files) {
  const own = new Set();
  const read = {};
  for (const [name, src] of Object.entries(files)) {
    read[name] = tokens(src);
    for (const n of declared(read[name])) { own.add(n); }
  }
  const out = [];
  for (const [name, T] of Object.entries(read)) {
    for (const c of calls(T)) {
      if (platform.has(c.name) || runtime.has(c.name) || own.has(c.name)) { continue; }
      out.push(name + ':' + c.line + ' ' + c.name);
    }
  }
  return out;
}

// The check, on made up plugins.
{
  const planted = misses({
    'a.js': [
      "const sp = require('skyrimPlatform');",
      'const pc = sp.Game.getPlayer();',
      'const base = pc.getThornswoodNoSuchCall();',
      "sp.on('update', () => { pc.getActorValue('Health'); });",
      '// pc.getThornswoodInAComment();',
      "const s = 'pc.getThornswoodInAString()';",
      'const t = `a ${pc.getThornswoodInATemplate()} b`;',
      'const u = `pc.getThornswoodInTemplateText()`;',
      'const r = /x.getThornswoodInARegex()/;',
      'const o = { getThornswoodOwn() { return 1; } };',
      'o.getThornswoodOwn();',
      'pc?.getThornswoodOptional?.();',
      "[1, 2].map((x) => x).join(',');",
    ].join('\n'),
  });
  yes('a call the platform does not have is found, with its line', planted.includes('a.js:3 getThornswoodNoSuchCall'));
  yes('  and one inside ${ } in a template', planted.includes('a.js:7 getThornswoodInATemplate'));
  yes('  and one made with ?.', planted.includes('a.js:12 getThornswoodOptional'));
  yes('  and nothing else: not a comment, a string, template text, a regex, the plugin\'s own, the platform\'s or the runtime\'s',
      planted.length === 3);
  yes('getActorBase, the one that threw in the game, is not a platform call', !platform.has('getActorBase'));
  yes('closeMenu (a .psc native), getBackend (set by the C++) and getNthFormView (the WorldView) are',
      platform.has('closeMenu') && platform.has('getBackend') && platform.has('getNthFormView'));
}

// This tree.
{
  const names = fs.readdirSync(PLUGINS).filter((f) => f.endsWith('.js')).sort();
  const files = {};
  for (const f of names) { files[f] = fs.readFileSync(path.join(PLUGINS, f), 'utf8'); }
  yes('game/plugins has plugins to read', names.length > 0);
  const found = misses(files);
  for (const m of found) { console.log('      game/plugins/' + m + ' is not in the pinned Skyrim Platform'); }
  yes('every call in game/plugins is the pinned Skyrim Platform\'s, the runtime\'s or a plugin\'s own', found.length === 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
