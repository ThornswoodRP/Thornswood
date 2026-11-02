// test-must-be-light.js
//
// The launcher reads light flags and never writes one (#3022).
//
// SkyMP resolves a form by the plugin's position in the server's list, and the
// client counts positions with Game.GetModCount, which skips light plugins. So
// a copy whose ESL flag is not the server's pushes every plugin after it one
// place along, and the game says LOAD ORDER ERROR.
//
// Until #3022 the launcher wrote the flag into plugin files itself
// (Checks.FlagLight), on a set it worked out by guessing: any plugin the
// collection reference enables that the server's manifest leaves out was
// called light (Verify.MustBeLight). That covered nine plugins whose archives
// never carried the flag One's copies had, which #2979 traced to a hand edit
// on Vortex's Plugins page on One and fixed in the collection itself with
// Vortex patches (revision 4 of 7essxf). The guess was also wrong on its own
// terms: on One, at 12:07 AM on 27 Sep and again on 1 Oct, the launcher said
// "ElysiumEstate.esp is not flagged light ... Fix flags it", about a full
// plugin of 956,423 bytes. Flagging it light would move every form in it.
//
// So the collection installs the flag, and the launcher only compares it with
// the server's own two lists (the full plugins and, since #1715, the light
// ones) and sends the person to Vortex. This harness fails on the old code.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const appDir = path.join(REPO_DIR, 'launcher', 'app');
const all = fs.readdirSync(appDir).filter(function (f) { return /\.cs$/.test(f); })
  .map(function (f) { return { name: f, text: fs.readFileSync(path.join(appDir, f), 'utf8') }; });
const checks = fs.readFileSync(path.join(appDir, 'Checks.cs'), 'utf8');
const verify = fs.readFileSync(path.join(appDir, 'Verify.cs'), 'utf8');

// Nothing writes a flag and nothing guesses a light set any more.
['FlagLight', 'NotLight', 'MustBeLight'].forEach(function (n) {
  const where = all.filter(function (f) { return new RegExp('\\b' + n + '\\b').test(f.text); })
    .map(function (f) { return f.name; });
  yes(n + ' is gone from the launcher' + (where.length ? ' (still in ' + where.join(', ') + ')' : ''), where.length === 0);
});

// The header is opened for reading only: the one place that reads the flag
// never asks for write access.
const hl = /static bool\? HeaderLight\(string path\)\s*\{([\s\S]*?)\n        \}/.exec(checks);
yes('Checks.HeaderLight reads the flag', !!hl && hl[1].indexOf('LightFlag') >= 0);
yes('and opens the plugin for reading only',
    !!hl && hl[1].indexOf('FileAccess.Read,') >= 0 && hl[1].indexOf('ReadWrite,') < 0 && hl[1].indexOf('Write(') < 0);
yes('a file that cannot be read answers null, so it is never reported either way',
    !!hl && /return null;/.test(hl[1]) && /public static bool\? FlaggedLight\(string name\)/.test(checks));

// The comparison: the server's own lists, never worked out.
const fns = /static List<KeyValuePair<string, bool>> FlagNotServers\(Config cfg\)\s*\{([\s\S]*?)\n        \}/.exec(verify);
yes('Verify.FlagNotServers compares the flag with the server', !!fns);
const body = fns ? fns[1] : '';
yes('it asks the server for its manifest', body.indexOf('Manifest(cfg)') >= 0);
yes('it walks the full list and the light list (#1715)',
    body.indexOf('manifestLight') >= 0 && /:\s*mods\)/.test(body));
yes('it does not start from the collection reference, which is what the guess did',
    body.indexOf('Paths.Golden') < 0);
yes('it leaves ours to Bytes, whose Fix fetches the server’s copy', body.indexOf('m.Served') >= 0);
yes('it skips an .esl, which is light by its name', /EndsWith\("\.esl"/.test(body));
yes('it reads the flag through Checks.FlaggedLight and skips an unreadable file',
    body.indexOf('Checks.FlaggedLight(m.filename)') >= 0 && body.indexOf('here != null') >= 0);

// What Run says: Vortex puts it right, Fix does not claim to.
const run = /public static List<Issue> Run\(Config cfg, bool checkBytes\)[\s\S]*?\n        \}\n/.exec(verify);
const runText = run ? run[0] : '';
const at = runText.indexOf('FlagNotServers(cfg)');
yes('Verify.Run reports it', at >= 0);
const issue = at >= 0 ? runText.slice(at, runText.indexOf('true));', at)) : '';
yes('with no Fix line, because Fix does not write the flag', /null,\s*FromVortex\(cfg, f\.Key\)/.test(issue));
yes('and sends the person to Vortex for that mod', issue.indexOf('FromVortex(cfg, f.Key)') >= 0);
yes('both directions are said: light on the server, and full on the server',
    issue.indexOf('is light on the server and not flagged light in your copy') >= 0 &&
    issue.indexOf('is flagged light in your copy and is a full plugin on the server') >= 0);
yes('before the order walk, so one problem reads as one problem',
    at >= 0 && at < runText.indexOf('LoadOrder.FirstMismatch(game, manifest)'));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
