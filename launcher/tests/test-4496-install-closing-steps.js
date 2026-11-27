'use strict';
// #4496: the setup window's last lines give the launcher's steps in its order.
// #6339: and they say the animation and body files take a few minutes, once.
// The launcher keeps the collection card down while the build is wrong
// (Shell.cs DrawStatus), so a wrong build is its own first step, then the
// collection, Connect Discord and Play. tests/test-4824-install.py runs these
// lines for real, but no workflow runs it (#5840), so the gate reads them here.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../app/InstallSteps.cs'), 'utf8');
let failed = 0;
function yes(name, ok) { console.log((ok ? 'PASS  ' : 'FAIL  ') + name); if (!ok) failed++; }
const start = src.indexOf('void Checks(long targetExe)');
const end = src.indexOf('Say("Opening Thornswood now.");', start);
yes('Checks() and its last line are found', start >= 0 && end > start);
const tail = src.slice(src.indexOf('if (Bad > 0)', start), end);
const at = s => tail.indexOf(s);
const steps = ['Next, in the launcher:', '. Press Downgrade on the front page.', '. Install the collection in Vortex',
  '. Press Connect Discord at the bottom of the left sidebar.', '. Press Play.'];
yes('the closing lines name every launcher step', steps.every(s => at(s) >= 0));
yes('in the launcher\'s order: Downgrade, the collection, Connect Discord, Play',
  steps.every((s, i) => i === 0 || at(steps[i - 1]) < at(s)));
yes('Downgrade is a step only when the build check failed',
  /bool downgrade = !checks\[0\]\.Value;[\s\S]*if \(downgrade\)\s*\n\s*Say\("  " \+ step\+\+ \+ "\. Press Downgrade/.test(tail));
yes('checks[0] is the build check', /new KeyValuePair<string, bool>\("Game 1\.6\.1170"/.test(src.slice(src.indexOf('var checks = new List', start))));
yes('the collection is never called the next step', !/which is the next step/.test(tail));
yes('no character named after yourself, and no save', !/named after yourself|save once/.test(tail));
// #6339: the window says the animation and body files take a few minutes,
// the first time only, whether the launcher makes its own folder by itself or
// the first Play asks to.
const own = tail.indexOf('if (choice.MakeOwnGame)'), other = tail.indexOf('else', own);
const said = (a, b) => tail.slice(a, b).replace(/"\);\s*Say\("/g, ' ');
yes('#6339 with its own folder ticked, the building of the animation and body files takes a few minutes, once',
  own >= 0 && /animation and body files, which Pandora and BodySlide build in their own windows\. That takes a few minutes, the first time only\./.test(said(own, other)));
yes('#6339 with it unticked, the first Play builds them, and that takes a few minutes, once',
  other > own && /The first Play asks to make Thornswood's own Skyrim folder, then builds the animation and body files[^"]*That takes a few minutes, the first time only\./.test(said(other, tail.length)));
console.log(failed + ' failed');
process.exitCode = failed ? 1 : 0;
