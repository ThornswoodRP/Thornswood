// test-4426-install-everything.js
//
// Issue #4426: scripts/dev/Install-Everything.cmd and the script it runs,
// scripts/dev/Install-Thornswood.ps1, said they install what the client needs
// and rebuild the launcher. By default the run then publishes a dev release
// (Ship.ps1 -Channel dev), which needs the VPS and signing; -NoShip is the
// only way to install without it. The script's header still listed the body
// step #1179 retired, and the Developer Guide named neither file.
//
// This holds:
//   1. the header's step names for -Only and -Skip are the step table's keys;
//   2. the header names no retired body step;
//   3. the header and the .cmd both say the default run publishes to dev and
//      that -NoShip only installs, and the .cmd hands -NoShip on;
//   4. the Developer Guide's set-up page names Install-Everything.cmd, says
//      it publishes to dev and which machine it is for.
//
// Read only.
//
//     node tests/test-4426-install-everything.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'); }
  catch (e) { return ''; }
}

const ps = read('scripts/dev/Install-Thornswood.ps1');
const cmd = read('scripts/dev/Install-Everything.cmd');
const guide = read('docs/guide/set-up-a-machine.md');
yes('Install-Thornswood.ps1 is there', ps.length > 0);
yes('Install-Everything.cmd is there', cmd.length > 0);

const head = (/^<#([\s\S]*?)#>/.exec(ps) || ['', ''])[1];
yes('Install-Thornswood.ps1 opens with a header', head.length > 0);

// ------------------------------------------------- 1. step names vs table
const table = (/\$steps\s*=\s*@\(([\s\S]*?)\n\)/.exec(ps) || ['', ''])[1];
const keys = [];
for (const m of table.matchAll(/Key\s*=\s*'([a-z]+)'/g)) if (keys.indexOf(m[1]) < 0) keys.push(m[1]);
yes('the step table has keys', keys.length > 0, 'read: ' + keys.join(' '));
const named = /Step names for -Only and -Skip:\s*\n\s*([a-z ]+)/.exec(head);
const names = named ? named[1].trim().split(/\s+/) : [];
yes('the header lists the step names for -Only and -Skip', names.length > 0);
yes('and they are the step table\'s keys, in its order',
    names.join(' ') === keys.join(' '),
    'header: ' + names.join(' ') + '; table: ' + keys.join(' '));

// ------------------------------------------------- 2. no retired body step
yes('the header does not name the body fix as a step', !/body fix/i.test(head));
yes('nor offer -SkipBody as leaving the body meshes alone', !/-SkipBody\s+leave the body/i.test(head));

// ------------------------------------------------- 3. publishing, both files
yes('the header says the default run publishes to the dev channel',
    /publish[\s\S]{0,120}\bdev\b/i.test(head));
yes('the header says -NoShip only installs', /-NoShip[^\n]*\binstall/i.test(head));
const rem = cmd.split('\n').filter((l) => /^rem /i.test(l)).join('\n');
yes('Install-Everything.cmd says it publishes to the dev channel', /publish[\s\S]{0,120}\bdev\b/i.test(rem));
yes('and that -NoShip only installs', /-NoShip[\s\S]{0,80}\binstall/i.test(rem));
yes('and hands what it is given (-NoShip) on to the script',
    /Install-Thornswood\.ps1"\s+%\*/.test(cmd));

// ------------------------------------------------- 4. the Developer Guide
yes('set-up-a-machine.md names Install-Everything.cmd', guide.indexOf('Install-Everything.cmd') >= 0);
const at = guide.indexOf('Install-Everything.cmd');
const near = at < 0 ? '' : guide.slice(Math.max(0, at - 600), at + 1200);
yes('and says beside it that it publishes to dev', /publish[\s\S]{0,120}\bdev\b/i.test(near));
yes('and names -NoShip there', near.indexOf('-NoShip') >= 0);
yes('in the section for a machine that ships, not On every PC',
    at > guide.indexOf('## Setting up a machine') && guide.indexOf('## Setting up a machine') > 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
