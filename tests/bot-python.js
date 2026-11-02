'use strict';
// The Python a harness runs the bot with (issue #2437).
//
// The bot runs on Python 3.12 (Install-Bot.ps1) and bot\_pyguard.py refuses
// anything below 3.10. Plain python is whichever is first on PATH, and on One
// that is 3.9.13, so a harness that ran plain python imported a bot that
// refused to load, read no output, and failed checks that said nothing about
// the bot (test-help-report.js, 4 of 45, measured 12 Oct).
//
// This makes the same choice Setup-Discord.ps1 and Set-DiscordOnboarding.ps1
// make (#2421): the py launcher's 3.12 first, then plain python, then python3.
// Off Windows there is no py launcher, and 3.12 goes by python3.12, so that
// is asked second (#3005): python3 on a Linux machine can be 3.13, where the
// hash-pinned bot\requirements.txt does not install (discord.py wants
// audioop-lts there, which it does not pin).
// Each candidate is asked to import _pyguard and discord from bot\, so the
// version floor is the bot's own and not a copy of it, and a Python without
// the bot's libraries is passed over the same way.
//
// find() returns { cmd, args } for the first candidate that loads both, with
// args the launcher's own arguments to put before the script (['-3.12'] for
// py). When none does it returns { cmd: null, why }, why naming what each
// one said, for the harness to print.

const path = require('path');
const { spawnSync } = require('child_process');

const BOT = path.join(__dirname, '..', 'bot');
const CANDIDATES = [
  { cmd: 'py', args: ['-3.12'] },
  { cmd: 'python3.12', args: [] },
  { cmd: 'python', args: [] },
  { cmd: 'python3', args: [] }
];

function lastLine(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter((l) => l.trim());
  return lines.length ? lines[lines.length - 1].trim() : '';
}

function find() {
  const probe = 'import sys; sys.path.insert(0, sys.argv[1]); import _pyguard, discord';
  const said = [];
  for (const c of CANDIDATES) {
    const r = spawnSync(c.cmd, c.args.concat(['-c', probe, BOT]), { encoding: 'utf8',
      env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' }) });
    const name = [c.cmd].concat(c.args).join(' ');
    if (r.error) { said.push(name + ': not on this machine'); continue; }
    if (r.status === 0) { return { cmd: c.cmd, args: c.args.slice() }; }
    said.push(name + ': ' + (lastLine(r.stderr) || lastLine(r.stdout) || ('exit ' + r.status)));
  }
  return { cmd: null, args: [], why: said.join('; ') };
}

// The line that puts the bot's libraries where find() looks, for a harness
// to print when none loads the bot. On Windows it is docs/guide/set-up-a-machine.md
// "Setting up a machine"'s. Off Windows the system's python3.12 refuses a
// plain pip install (PEP 668), so it goes into the user's own packages.
const INSTALL = process.platform === 'win32'
  ? 'py -3.12 -m pip install -r bot\\requirements.txt'
  : 'python3.12 -m pip install --user --break-system-packages --require-hashes -r bot/requirements.txt';

module.exports = { find, BOT, INSTALL };
