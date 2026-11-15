// tests/test-6184-verb-files.js
//
//     node tests/test-6184-verb-files.js
//
// Issue #6184: a change to a file a verb of the box runs is held for Patrick
// the way a change to the verb's own script is. Auto-merge and the Bots'
// merge hold what the two verb lists name, and on 13 Nov 2026 the lists
// named New-NexusRevision.ps1 but not nexus-collection.js or
// collection-permissions.js, which it runs, so changes to both merged with no
// card (#6007, #5992). scripts/ops/Verb-Files.js finds what each verb runs.
// What is held here:
//
//   1. what counts as run, on stand-ins: a dot-source, a call, the parts of
//      a Join-Path, a path from the repository's top, a require, a Python
//      import, and C# named anywhere; and what does not: a name in a comment
//      or the help, a name inside a message, a file of a service the verb
//      deploys (game, site, bot, voice);
//   2. every verb of scripts/vps/gate/verbs.json and
//      scripts/release/nexus-verbs.json names under reads every file of code
//      its script runs, no file of code it no longer runs, and nothing that
//      is not in the repository;
//   3. the measured cases: New-NexusRevision names nexus-collection.js and
//      collection-permissions.js, and auto-merge holds a pull request that
//      changes only one of them unless it is Patrick's;
//   4. --write puts a verb's reads in and replaces it, and leaves the rest
//      of the list as it is written.
'use strict';
const fs = require('fs');
const path = require('path');
const V = require('../scripts/ops/Verb-Files.js');
const A = require('../scripts/ops/Auto-Merge.js');

const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

// ---- 1. what counts as run
const have = new Set([
  'scripts/release/Entry.ps1', 'scripts/release/Lib.ps1', 'scripts/release/Called.ps1', 'scripts/release/InHelp.ps1',
  'scripts/release/InComment.ps1', 'scripts/release/InMessage.ps1', 'scripts/vps/Vps.ps1', 'scripts/mods/Joined.ps1',
  'scripts/release/tool.js', 'scripts/release/helper.js', 'scripts/release/notes.js', 'scripts/dev/build.py',
  'scripts/dev/own_rows.py', 'scripts/dev/in_doc.py', 'game/gamemode.js', 'site/server.js', 'bot/bot.py',
  'voice/voice-server.js', 'launcher/app/Signature.cs', 'records/collection.json'
]);
const ps = [
  '<#',
  '  Entry.ps1. InHelp.ps1 is named here, in the help, and is not run.',
  "  It reads 'InHelp.ps1' in quotes too.",
  '#>',
  '$Here = $PSScriptRoot',
  '. (Join-Path $Here \'Lib.ps1\')',
  '& (Join-Path $Here "Called.ps1") -NoPause   # and InComment.ps1 in a comment',
  '# \'InComment.ps1\' quoted in a comment',
  '. (Join-Path $Repo \'scripts/vps/Vps.ps1\')',
  '& (Join-Path $Here \'..\' \'mods\' \'Joined.ps1\')',
  'Die \'InMessage.ps1 is not there, so nothing was sent.\'',
  'Write-Host "Run InMessage.ps1 again"',
  '$node = Join-Path $Here \'tool.js\'',
  '$py = \'scripts/dev/build.py\'',
  '$gm = Join-Path $Repo \'game\\gamemode.js\'',
  '$site = \'site/server.js\'; $bot = \'bot/bot.py\'; $voice = \'..\\..\\voice\\voice-server.js\'',
  'Add-Type -Path (Join-Path $Repo \'launcher\\app\\Signature.cs\')',
  '$rec = \'records/collection.json\''
].join('\r\n');
const got = V.named('scripts/release/Entry.ps1', ps, have);
const keys = [...got.keys()].sort();
yes('1 a dot-source, a call and a path from the repository\'s top count',
  got.has('scripts/release/Lib.ps1') && got.has('scripts/release/Called.ps1') && got.has('scripts/vps/Vps.ps1'));
yes('1 the parts of one Join-Path count: ..\\mods\\Joined.ps1', got.has('scripts/mods/Joined.ps1'));
yes('1 a script handed to node or python counts', got.has('scripts/release/tool.js') && got.has('scripts/dev/build.py'));
yes('1 C# a script compiles in counts, wherever it is', got.has('launcher/app/Signature.cs'));
yes('1 a name in the help or a comment does not count', !got.has('scripts/release/InHelp.ps1') && !got.has('scripts/release/InComment.ps1'));
yes('1 a name inside a message does not count', !got.has('scripts/release/InMessage.ps1'));
yes('1 a service\'s files, which the verb puts on the box, do not count',
  !got.has('game/gamemode.js') && !got.has('site/server.js') && !got.has('bot/bot.py') && !got.has('voice/voice-server.js'));
yes('1 a file that is not code does not count', !got.has('records/collection.json'));
yes('  and that is all it found: ' + keys.join(' '), keys.length === 7);

const js = [
  '// helper.js is named in a comment: require(\'./notes\')',
  '/* and require(\'./notes\') here too */',
  'const h = require(\'./helper\');',
  'const g = require(\'../../game/gamemode.js\');',
  'console.log(\'notes.js is said in a message\');'
].join('\n');
const gotJs = V.named('scripts/release/tool.js', js, have);
yes('1 a require counts, a require in a comment does not', gotJs.has('scripts/release/helper.js') && !gotJs.has('scripts/release/notes.js'));
yes('1 a require of a service file does not count', !gotJs.has('game/gamemode.js') && gotJs.size === 1);

const py = [
  '"""build.py. in_doc.py is named in the docstring."""',
  'import json, own_rows',
  '# import in_doc',
  'print("in_doc.py is said in a message")'
].join('\n');
const gotPy = V.named('scripts/dev/build.py', py, have);
yes('1 an import of a file beside it counts, a docstring or comment does not', gotPy.has('scripts/dev/own_rows.py') && gotPy.size === 1);

// What a verb runs is followed through what each file runs.
const texts = { 'scripts/release/Entry.ps1': '. (Join-Path $PSScriptRoot \'Lib.ps1\')', 'scripts/release/Lib.ps1': '& (Join-Path $PSScriptRoot \'tool.js\')', 'scripts/release/tool.js': 'require(\'./helper\')', 'scripts/release/helper.js': '' };
const r = V.runs('scripts/release/Entry.ps1', (f) => { if (!(f in texts)) throw new Error('none'); return texts[f]; }, have);
yes('1 it follows each file it finds to what that one runs, and leaves the script out', r.files.join(' ') === 'scripts/release/Lib.ps1 scripts/release/helper.js scripts/release/tool.js');

// ---- 2. every verb's reads names what it runs
const rows = V.compare(REPO);
let files = 0;
const inRepo = new Set(require('child_process').execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean));
for (const row of rows) {
  files += row.runs.length;
  yes('2 ' + row.name + ' (' + path.posix.basename(row.list) + ') names under reads every file it runs (' + row.runs.length + ')' +
    (row.missing.length ? ': missing ' + row.missing.map((m) => m + ' (' + row.why.get(m) + ')').join('; ') : ''), row.missing.length === 0);
  if (row.stale.length) yes('2 ' + row.name + ' names under reads only what it still runs: ' + row.stale.join(', '), false);
  const gone = row.reads.filter((x) => x.slice(-1) === '/' ? ![...inRepo].some((f) => f.indexOf(x) === 0) : !inRepo.has(x));
  if (gone.length) yes('2 ' + row.name + ' names under reads only what is in the repository: ' + gone.join(', '), false);
}
yes('2 both lists were read: ' + rows.length + ' verbs, ' + files + ' files run besides their scripts',
  rows.some((x) => x.list === 'scripts/vps/gate/verbs.json') && rows.some((x) => x.list === 'scripts/release/nexus-verbs.json'));
yes('  when a list is behind, the way to put it right is said: node scripts/ops/Verb-Files.js --write', /--write/.test(fs.readFileSync(path.join(REPO, 'scripts/ops/Verb-Files.js'), 'utf8')));

// ---- 3. the measured cases (#6007, #5992)
const nr = rows.find((x) => x.name === 'New-NexusRevision');
yes('3 New-NexusRevision names nexus-collection.js and collection-permissions.js under reads',
  nr && nr.reads.indexOf('scripts/release/nexus-collection.js') >= 0 && nr.reads.indexOf('scripts/release/collection-permissions.js') >= 0);
const held = A.verbScripts(REPO);
const worker = { id: 'PR_1', number: 1, isDraft: false, isCrossRepository: false, baseRefName: 'main', headRefOid: 'h1', mergeable: 'MERGEABLE',
  isInMergeQueue: false, author: { login: 'thornswood-workers' }, autoMergeRequest: null, timelineItems: { nodes: [] }, headRefName: 'claude/x', reviews: { nodes: [] } };
for (const f of ['scripts/release/nexus-collection.js', 'scripts/release/collection-permissions.js']) {
  const j = A.judge(Object.assign({}, worker, { paths: [f] }), 'main', held);
  yes('3 auto-merge holds one that changes only ' + f + ', not Patrick\'s', j[0] === false && j[1].indexOf(f) >= 0);
  yes('  Patrick\'s that changes it goes on', A.judge(Object.assign({}, worker, { author: { login: 'EvilPatrick06' }, headRefName: 'patrick-nexus', paths: [f] }), 'main', held)[0] === true);
}
yes('3 one that changes only the gamemode\'s source is not held', A.judge(Object.assign({}, worker, { paths: ['game/gamemode/a.ts'] }), 'main', held)[0] === true);

// ---- 4. --write keeps the rest of the list
const list = [
  '{',
  '  "verbs": {',
  '    "One": {',
  '      "script": "scripts/a.ps1",',
  '      "timeoutMinutes": 5,',
  '      "fixed": [',
  '        "-NoPause"',
  '      ],',
  '      "params": {}',
  '    },',
  '    "Two": {',
  '      "script": "scripts/b.ps1",',
  '      "reads": ["scripts/keys/"],',
  '      "params": {}',
  '    }',
  '  }',
  '}'
].join('\r\n');
const one = V.putReads(list, 'One', ['scripts/x.ps1', 'scripts/y.ps1']);
yes('4 a verb with no reads gets them after its script line, one a line', JSON.parse(one).verbs.One.reads.join(' ') === 'scripts/x.ps1 scripts/y.ps1' &&
  one.split('\r\n')[4] === '      "reads": [');
yes('  and its fixed words, the other verb and the line ends are as they were', JSON.parse(one).verbs.One.fixed[0] === '-NoPause' &&
  JSON.parse(one).verbs.Two.reads.join() === 'scripts/keys/' && one.split('\r\n').length === list.split('\r\n').length + 4 && one.indexOf('\n') === one.indexOf('\r\n') + 1);
const two = V.putReads(one, 'Two', ['scripts/keys/', 'scripts/z.ps1']);
yes('4 a verb\'s reads on one line is replaced whole', JSON.parse(two).verbs.Two.reads.join(' ') === 'scripts/keys/ scripts/z.ps1' && !/"reads": \["scripts\/keys\/"\]/.test(two));
const three = V.putReads(two, 'One', ['scripts/x.ps1']);
yes('4 a reads of several lines is replaced whole', JSON.parse(three).verbs.One.reads.join(' ') === 'scripts/x.ps1' && three.split('"reads"').length === 3);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
