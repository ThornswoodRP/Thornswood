'use strict';
// test-4682-server-dir.js
//
// Where the launcher looks for a server to start when the address is this
// machine (SkyMp.ServerDir, #4682). Until #4682 the search ended with
// C:\Thornswood\skymp\build\dist\server, one developer machine's build
// folder of the fork, compiled into every copy of the launcher, and the
// comment above it said that folder was checked first when it was checked
// last. Somebody running a server from a build of their own points Server
// folder in Settings at it, which is what the launcher says when it finds
// none.
//
// This holds:
//   - ServerDir tries Settings' Server folder, then Server in the install
//     folder, and nothing else
//   - no path with a drive letter is in ServerDir, and no copy of the fork's
//     build folder (skymp\build\dist) is anywhere in launcher\app's code
//   - the comment above ServerDir names the two in the order they are tried
//   - the line said when there is none still sends the person to Settings
//
// Read only.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'launcher', 'app');

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

const src = fs.readFileSync(path.join(APP, 'SkyMp.cs'), 'utf8').replace(/\r\n/g, '\n');

// ServerDir's body, from its signature to the brace that closes it.
function body(text, sig) {
  const at = text.indexOf(sig);
  if (at < 0) return null;
  const open = text.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(open, i + 1); }
  }
  return null;
}

const sig = 'public static string ServerDir(Config cfg)';
const dir = body(src, sig);
yes('SkyMp.cs has ServerDir', dir !== null);
if (dir === null) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exitCode = 1; return; }

// The tries array, one entry per line, comments left out.
const arr = /string\[\]\s+tries\s*=\s*new\s+string\[\]\s*\{([\s\S]*?)\};/.exec(dir);
yes('ServerDir lists what it tries in one array', arr !== null);
const tries = arr ? arr[1].split('\n').map((l) => l.replace(/\/\/.*$/, '').trim().replace(/,$/, '').trim()).filter((l) => l.length > 0) : [];
yes('it tries Settings\' Server folder first (' + (tries[0] || 'nothing') + ')', tries[0] === 'cfg == null ? null : cfg.ServerFolder');
yes('then Server in the install folder (' + (tries[1] || 'nothing') + ')', tries[1] === 'Path.Combine(Paths.Root, "Server")');
yes('and nothing else (' + tries.length + ' tried)', tries.length === 2);

yes('no path with a drive letter is in ServerDir', !/"[A-Za-z]:\\\\/.test(dir) && !/@"[A-Za-z]:\\/.test(dir));

// No copy of the fork's build folder anywhere in the launcher's code.
const hits = [];
for (const f of fs.readdirSync(APP)) {
  if (!f.endsWith('.cs')) continue;
  const lines = fs.readFileSync(path.join(APP, f), 'utf8').split(/\r?\n/);
  lines.forEach((l, i) => {
    const code = l.replace(/\/\/.*$/, '');
    if (/skymp\\{1,2}build\\{1,2}dist/i.test(code) || /skymp\/build\/dist/i.test(code)) hits.push(f + ':' + (i + 1));
  });
}
yes('no code in launcher\\app names the fork\'s build folder (' + (hits.join(', ') || 'none') + ')', hits.length === 0);

// The comment right above ServerDir.
const at = src.indexOf(sig);
const before = src.slice(0, at);
const docStart = before.lastIndexOf('/// <summary>');
const doc = docStart >= 0 ? before.slice(docStart) : '';
yes('ServerDir has a comment', doc.length > 0);
const iFolder = doc.indexOf('Server folder');
const iBeside = doc.search(/Server in the install folder|install folder's Server|Server folder in the install folder/);
yes('the comment names Settings\' Server folder before the install folder\'s Server', iFolder >= 0 && iBeside > iFolder);
yes('the comment says nothing of a build folder being checked', !/build folder/i.test(doc));

yes('with no server folder found, the launcher says to point Server folder in Settings at one',
  /there is no server folder here to start\. Point Server folder in Settings at the one with dist_back\\\\skymp5-server\.js in it\./.test(src));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
