// test-7045-server-ahead.js
//
//     node tests/test-7045-server-ahead.js
//
// #7045. On 26 Nov 2026 at 4:37 PM build-1.3.134 was published with a new
// Thornswood-Content.esp (346,021 bytes, 337.9 KB), and at 4:40 PM the box
// deploy agent put that Release's plugin on the Dev server, as it does for
// every Release (#6176). Patrick's open launcher was still 1.3.132, whose
// copy is 346,258 bytes (338.1 KB): Play refused, Fix said the release "does
// not have the copy the server runs yet", and the update that had it was
// already on GitHub. The launcher had only its half hourly check to learn of
// it, and it took it by itself a few minutes later.
//
// So this reads the launcher for:
//   1. Verify.ServerAheadOfRelease names a plugin of ours the server runs and
//      this install's release does not carry: a line answered NotInRelease,
//      held to the release's own copy by size and crc32;
//   2. AskForServersRelease asks the channel at once, off the window's
//      thread, and hands the answer to LauncherAnswer like every check;
//   3. Play asks before it refuses, and takes the waiting update (or says
//      Install now when automatic updates are off) instead of sending
//      anybody to Fix;
//   4. Fix asks after its own rescan and before it judges the update it
//      takes last;
//   5. NotInRelease says what that ask found, not "the latest release",
//      which it never read.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8').split(CR).join(''); }
const app = 'launcher/app/';
const verify = read(app + 'Verify.cs');
const upd = read(app + 'ShellUpdate.cs');
const play = read(app + 'ShellPlay.cs');
const scanfix = read(app + 'ShellScanFix.cs');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function body(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
}

// 1. Which plugin of ours the release does not carry.
const ahead = body(verify, 'public static string ServerAheadOfRelease(Config cfg, List<Issue> issues)');
yes('1. Verify.ServerAheadOfRelease is there', ahead !== '');
yes('1. it reads only lines answered NotInRelease', /i\.WhatWill != NotInRelease\) continue;/.test(ahead));
yes('1. it takes the bytes from the installed release, nowhere else', /Updater\.ReleaseCopy\(cfg\)/.test(ahead) && !/Http\./.test(ahead));
yes('1. a release with no copy of it is ahead', /if \(bytes == null\) return i\.Plugin;/.test(ahead));
yes('1. a release copy that is not the server\'s by size or crc32 is ahead',
  /bytes\.LongLength != i\.WantSize \|\| crc != i\.WantCrc\) return i\.Plugin;/.test(ahead));
yes('1. a launcher setup did not install has no channel to ask', /if \(release == null\) return null;/.test(ahead));

// 2. The ask.
const ask = body(upd, 'static async Task AskForServersRelease(string plugin)');
yes('2. AskForServersRelease is there', ask !== '');
yes('2. it asks the channel off the window\'s thread', /await OffThread\(delegate[\s\S]*Updater\.CheckLauncher\(cfg\)/.test(ask));
yes('2. it hands the answer to LauncherAnswer', /LauncherAnswer\(asked, launcher, note, why, false\);/.test(ask));
yes('2. it counts as the last ask, so the clock does not ask again at once', /launcherAskedAt = DateTime\.UtcNow;/.test(ask));
yes('2. it says in the log why it asks', /Log\("The server runs a " \+ plugin/.test(ask));

// 3. Play asks before it refuses.
const blockAt = play.indexOf('if (blockers > 0)');
const notLaunching = play.indexOf('Log("Not launching. " + blockers', blockAt);
const block = play.slice(blockAt, notLaunching);
yes('3. Play asks before its refusal', blockAt >= 0 && notLaunching > blockAt &&
  /Verify\.ServerAheadOfRelease\(cfg, found\)/.test(block) && /await AskForServersRelease\(ahead\);/.test(block));
yes('3. and takes the waiting update when updates go in by themselves', /if \(cfg\.AutoUpdate\) UpdateBySelf\(\);/.test(block));
yes('3. or says Install now when they do not', /Press Install now on the card above Play, then Play\./.test(block));
yes('3. and does not then send anybody to Fix', /return;\s*\}\s*\}\s*$/.test(block.trimEnd()) && !/Press Fix/.test(block));

// 4. Fix asks before it judges the update.
const rest = body(scanfix, 'static async Task FixRest(bool afterUpdate, bool afterVortex)');
const rescanAt = rest.indexOf('List<Issue> plugins = await Rescan();');
const askAt = rest.indexOf('await AskForServersRelease(ahead)');
const updAt = rest.indexOf('if (Has(Upkeep.LastIssues, IssueKind.Update))');
yes('4. Fix asks after its rescan and before the update it takes last', rescanAt >= 0 && askAt > rescanAt && updAt > askAt);
yes('4. on the rescan\'s own lines', /Verify\.ServerAheadOfRelease\(cfg, plugins\)/.test(rest));

// 5. What Fix says.
const m = /const string NotInRelease = "([^"]*)";/.exec(verify);
const said = m ? m[1] : '';
yes('5. NotInRelease no longer claims to have read the latest release', said !== '' && !/latest release/.test(said));
yes('5. it says Fix asked GitHub, and where the update is', /asked GitHub/.test(said) && /card above Play/.test(said));
yes('5. it keeps the words the Scan and Fix harness reads', /does not have the copy the server runs/.test(said));
yes('5. no em dash, and not the word the rules keep out', !/—/.test(said) && !/\bplayers?\b/i.test(said));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
