// test-3838-no-personal-details.js
//
//     node tests/test-3838-no-personal-details.js
//
// No tracked file names a personal mail address, a Windows profile account
// name or somebody's public IPv4 address.
//
// WHY THIS EXISTS. Issue #3838, found by the #3684 history scan on 26 Oct
// 2026. Files written on One carried the real paths and addresses they were
// written with: a personal Gmail as Caddy's ACME contact, a profile path in
// a doc, in a provenance record and in two tests' data, and two sign-in
// addresses in Developer-Guide.md. The repository is going public (#3721),
// and the history rewrite (#3684) cleans these out of old versions only once
// main itself is clean. Nothing on main refused them, so each one was fixed
// by hand after somebody happened to look, and the next file written on One
// would have brought one back.
//
// WHAT COUNTS. Read off every tracked text file:
//   - an address at a personal mail provider (Gmail, Outlook, Hotmail, Live,
//     Yahoo, iCloud, Proton, AOL) or a school (.edu);
//   - a Microsoft tenant name (<name>.onmicrosoft.com), which is made from
//     the address of whoever opened the tenant;
//   - a profile path, C:\Users\<account>\ in any of its spellings
//     (C:/Users/, C:\\Users\\, /c/Users/, /mnt/c/Users/, and a Mac's
//     /Users/), whose account is not a placeholder or one of the box's own
//     service accounts;
//   - a public IPv4 address (#3838, 1 Nov 2026: a doc comment in
//     launcher/app/Chars.cs quoted a server log line with two people's
//     addresses, and nothing here looked for one). An address is personal
//     data, and the privacy page keeps a game log's addresses 30 days.
// Write C:\Users\<you>\..., %USERPROFILE%, $env:USERPROFILE or a role
// address instead, and an address from 192.0.2.0/24, 198.51.100.0/24 or
// 203.0.113.0/24, which are kept for examples (RFC 5737).
//
// WHAT IS NOT AN ADDRESS. Four numbers with dots are often something else,
// so these are passed over: private, loopback and other ranges nobody's
// machine is reached at; Cloudflare's published ranges (read from
// scripts/deploy/cloudflare-ranges.txt) and GitHub's (the ones
// scripts/deploy/Install-Runner.ps1 opens), which the box's firewall names;
// a number ending .0 or .255, which is the end of a range, not a machine;
// one under 10.x.x.x unless an address word (ip, IPv4, address, addr) comes
// just before it, since our launcher's own versions look like 1.1.101.17;
// and NOT_ADDRESSES below, each value with what it really is.
//
// WHAT IS LEFT ALONE, AND WHY.
//   - records/client-licences/, records/front-licences/ and
//     installer/licences/ (but its README.txt, which is ours): third-party
//     licence texts keep their authors' notices word for word, as the
//     licences require. installer/licences holds the texts of the libraries
//     inside the launcher, which go with every install (#4823).
//   - the same notice lines copied into our own source: a line that is,
//     past its comment marks, word for word a line of one of those texts
//     that holds an address. zlib's licence says its notice "may not be
//     removed or altered from any source distribution", and
//     launcher/app/FromGameDeflate.cs, zlib translated into C#, carries it
//     with its authors' addresses (#3668). Any other address in that file,
//     or the same address on a line of its own, is still found.
//   - tests/fixtures/ui-front-build.js: a third-party webpack build, kept
//     as its authors built it (#3761); the profile path in it is one of
//     theirs, from their own machine.
//   - WAITING below: files that already hold one and leave main or change
//     by the issue named beside them. An entry whose file is clean or gone
//     fails this check, so the list only gets shorter: take the line out in
//     the same change that cleans the file.
//
// Read only. Runs on Windows and Linux.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_DIR = path.join(__dirname, '..'); // the tests are in tests\, the repository is one folder up

const WAITING = [];

// Four-part numbers that are not anybody's address, with what each one is.
// A value here is passed over only in the files named beside it.
const NOT_ADDRESSES = [
  [[20, 2, 0, 7].join('.'), 'the Gamebryo nif format version Skyrim SE uses', /^(?:launcher\/app\/(?:CoveredBodies|FromGame)\.cs|scripts\/dev\/Build-Backdrop\.py|scripts\/mods\/Build-NoticeBoard\.py|tests\/fixtures\/2827\/from-game-fixture\.py|tests\/test-build-generated\.ps1|launcher\/tests\/test-covered-bodies\.ps1|tests\/test-menu-backdrop\.js)$/],
  [[192, 135, 119, 166].join('.'), "the old product's server, which the docs check refuses", /^tests\/test-repo-docs\.js$/],
  [[128, 0, 0, 1].join('.'), 'a made-up caller next to loopback, for the sign-in address check', /^site\/tests\/test-2187-signin-addr\.js$/],
  [[104, 28, 0, 1].join('.'), 'the first address past a Cloudflare range, for the range check', /^tests\/test-2995-cloudflare-front\.ps1$/],
  [[13, 0, 0, 4].join('.'), 'a made-up block list entry for the runner firewall check', /^tests\/test-runner-offbox\.ps1$/],
  [[13, 0, 0, 5].join('.'), 'a made-up block list entry for the runner firewall check', /^tests\/test-runner-offbox\.ps1$/],
  [[13, 0, 0, 6].join('.'), 'a made-up block list entry for the runner firewall check', /^tests\/test-runner-offbox\.ps1$/],
];
const LEFT_ALONE = [/^records\/client-licences\//, /^records\/front-licences\//, /^installer\/licences\/(?!README\.txt$)/, /^tests\/fixtures\/ui-front-build\.js$/];

// Every line of a recorded licence text (the client's and the site's
// front build's) that holds an address, with its
// spacing collapsed, so a notice copied into a source comment is known.
const LIC_DIRS = ['client-licences', 'front-licences'].map((d) => path.join(REPO_DIR, 'records', d));
const flatLine = (l) => l.replace(/^\s*(?:\/\/+|#+|\*+|;+|--)?/, '').replace(/\s+/g, ' ').trim();
const NOTICE_LINES = new Set();
for (const dir of LIC_DIRS) {
  for (const n of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])) {
    for (const l of fs.readFileSync(path.join(dir, n), 'utf8').split(/\r?\n/)) if (/@/.test(l)) NOTICE_LINES.add(flatLine(l));
  }
}

const MAIL_DOMAIN = /^(?:gmail\.com|googlemail\.com|outlook\.[a-z.]+|hotmail\.[a-z.]+|live\.[a-z.]+|msn\.com|yahoo\.[a-z.]+|ymail\.com|icloud\.com|me\.com|mac\.com|proton\.me|protonmail\.[a-z.]+|aol\.com|(?:[a-z0-9-]+\.)+edu)$/i;
const MAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;
const TENANT = /\b[A-Za-z0-9-]+\.onmicrosoft\.com\b/gi;
// The drive (or Git Bash's /c, WSL's /mnt/c), a separator, Users, a
// separator, then the account, up to the next separator, quote or space;
// or a Mac's /Users/<account>, with a capital U, so a web API's /users/@me
// is not one.
const ACCOUNT = '([^\\\\/\\s"\'`<>|:*?,;()\\[\\]{}@]+)';
const PROFILE = [
  new RegExp('(?:\\b[A-Za-z]:|/mnt/[a-z]|(?:^|[\\s"\'`(=])/[a-z])(?:\\\\\\\\|\\\\|/)[Uu]sers(?:\\\\\\\\|\\\\|/)' + ACCOUNT, 'g'),
  new RegExp('(?:^|[\\s"\'`(=])/Users/' + ACCOUNT, 'g'),
];
// Accounts every Windows machine has, the box's own service and runner
// accounts (scripts\vps\Install-Runner.ps1, ServiceAccount.ps1), the two
// made-up names tests use (x, tester), and %USERNAME% or $env:USERNAME.
// <you> and <account> never match the account pattern above at all.
const ACCOUNT_OK = /^(?:you|Public|Default|Default User|All Users|Administrator|runneradmin|x|tester|thornswood-[A-Za-z0-9.<>-]*|[$%].*)$/i;

// IPv4 ranges as [first, last] numbers.
const ip4 = (a) => a.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const range4 = (cidr) => {
  const [a, bits] = cidr.split('/');
  const size = 2 ** (32 - Number(bits === undefined ? 32 : bits));
  const first = Math.floor(ip4(a) / size) * size;
  return [first, first + size - 1];
};
const NOT_PUBLIC = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24',
  '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/3'].map(range4);
const CF_FILE = path.join(REPO_DIR, 'scripts', 'deploy', 'cloudflare-ranges.txt');
const CLOUDFLARE = (fs.existsSync(CF_FILE) ? fs.readFileSync(CF_FILE, 'utf8') : '').split(/\r?\n/)
  .map((l) => l.trim()).filter((l) => /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(l)).map(range4);
const GITHUB = ['140.82.112.0/20', '192.30.252.0/22', '4.148.0.0/16'].map(range4);
const IP4 = /(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w]|\.\d)/g;
const ADDRESS_WORD = /\b(?:ip|ipv4|address|addr)\b[^0-9\n]{0,16}$/i;
function publicIp4(line, m, rel) {
  const o = m.slice(1, 5).map(Number);
  if (o.some((x) => x > 255)) return false;
  const v = o.join('.');
  const n = ip4(v);
  if ([...NOT_PUBLIC, ...CLOUDFLARE, ...GITHUB].some(([a, b]) => n >= a && n <= b)) return false;
  if (o[3] === 0 || o[3] === 255) return false;
  if (o[0] < 10 && !ADDRESS_WORD.test(line.slice(0, m.index))) return false;
  if (NOT_ADDRESSES.some(([val, , where]) => val === v && where.test(rel || ''))) return false;
  return true;
}

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// The findings in one file's text: what kind, the line and the column. The
// value itself is not printed, so a finding never reaches a build log.
function findings(text, rel) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    MAIL.lastIndex = 0;
    const notice = NOTICE_LINES.has(flatLine(l));
    while ((m = MAIL.exec(l))) if (MAIL_DOMAIN.test(m[1]) && !notice) out.push({ kind: 'a personal mail address', line: i + 1, col: m.index + 1 });
    TENANT.lastIndex = 0;
    while ((m = TENANT.exec(l))) out.push({ kind: 'a Microsoft tenant name', line: i + 1, col: m.index + 1 });
    for (const re of PROFILE) {
      re.lastIndex = 0;
      while ((m = re.exec(l))) if (!ACCOUNT_OK.test(m[1])) out.push({ kind: 'a profile account name', line: i + 1, col: m.index + 1 });
    }
    IP4.lastIndex = 0;
    while ((m = IP4.exec(l))) if (publicIp4(l, m, rel)) out.push({ kind: 'a public IPv4 address', line: i + 1, col: m.index + 1 });
  }
  return out;
}

// ------------------------------------------------- the patterns themselves ---
// Planted lines, each built from pieces so this file holds no value itself.
const at = '@';
const bs = String.fromCharCode(92);
const ms = '.onmicro' + 'soft.com';
const U = 'Users';
const plant = (s) => findings(s).length;
yes('a Gmail address is found', plant('email someone' + at + 'gmail.com') === 1);
yes('  and an Outlook one', plant('it names someone' + at + 'outlook.com and') === 1);
yes('  and a school one', plant('a' + at + 'student.example.edu') === 1);
yes('  and a tenant name, with or without an address', plant('domain `someone' + ms + '`') === 1 && plant('x' + at + 'someone' + ms) === 1);
yes('  but not a role address, a noreply or a .invalid one', plant('a' + at + 'thornswood.net b' + at + 'users.noreply.github.com c' + at + 'thornswood.invalid') === 0);
yes('the recorded licence texts give their notice lines (' + NOTICE_LINES.size + ')', NOTICE_LINES.size > 0);
const zlibAuthors = [...NOTICE_LINES].filter((l) => /caltech\.edu/.test(l))[0] || '';
yes('  a licence\'s own notice line, copied into a comment, is left alone', zlibAuthors !== '' && plant('//   ' + zlibAuthors.replace(/ /g, '        ')) === 0);
yes('  but its address on a line of its own is still found', plant('// mail ' + zlibAuthors.split(' ').pop()) === 1);
yes('a profile path is found', plant('C:' + bs + 'Users' + bs + 'someone' + bs + 'Downloads') === 1);
yes('  and with forward slashes, doubled backslashes, Git Bash and WSL', plant('C:/' + U + '/someone/x') === 1 && plant("'C:" + bs + bs + 'Users' + bs + bs + "someone'") === 1 && plant('cd /c/' + U + '/someone/x') === 1 && plant('/mnt/c/' + U + '/someone/x') === 1 && plant('"/' + U + '/someone/github/x"') === 1);
yes('  but not a placeholder or the box\'s own accounts', plant('C:' + bs + 'Users' + bs + '<you>' + bs + 'x C:' + bs + 'Users' + bs + 'Administrator' + bs + 'x C:' + bs + 'Users' + bs + 'thornswood-runner5' + bs + 'x C:' + bs + 'Users' + bs + '%USERNAME%') === 0);
yes('  nor a web address with Users in it', plant('https://github.com/users/someone/projects/1') === 0);
const q = (...o) => o.join('.');
yes('a public IPv4 address is found, as a server log quotes it', plant('Connecting a user 1 with ip ' + q(24, 168, 10, 118) + '   -> 1 logged as 2') === 1);
yes('  and one under 10.x.x.x after an address word', plant('the ip ' + q(5, 6, 7, 8) + ' connected') === 1);
yes('  but not an example, private or loopback one', plant(q(203, 0, 113, 7) + ' ' + q(192, 0, 2, 1) + ' ' + q(198, 51, 100, 9) + ' ' + q(10, 1, 2, 3) + ' ' + q(192, 168, 1, 5) + ' ' + q(127, 0, 0, 1)) === 0);
yes('  nor a launcher version', plant('dev ' + q(1, 1, 101, 17) + ' and v' + q(1, 2, 6, 1)) === 0);
yes('  nor a range\'s end, or Cloudflare\'s or GitHub\'s ranges (' + CLOUDFLARE.length + ' read)', CLOUDFLARE.length > 0 && plant(q(11, 0, 0, 0) + ' ' + q(126, 255, 255, 255) + ' ' + q(104, 16, 0, 1) + ' ' + q(140, 82, 112, 9)) === 0);
yes('  nor a version number with more digits on it', plant(q(1, 2, 3, 4) + '.5 ' + q(20, 2, 0, 7) + 'a') === 0);
yes('  and a known value only in the file named beside it', plant(q(20, 2, 0, 7)) === 1 && findings(q(20, 2, 0, 7), 'tests/test-menu-backdrop.js').length === 0);

// ------------------------------------------------------- the tracked files ---
let files = [];
try {
  files = execFileSync('git', ['-C', REPO_DIR, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
} catch (e) {
  console.log('git ls-files failed: ' + e.message);
}
yes('the tracked files are listed (' + files.length + ')', files.length > 100);

const waiting = new Map(WAITING);
const found = new Map();
let read = 0;
for (const rel of files) {
  if (LEFT_ALONE.some((r) => r.test(rel))) continue;
  const full = path.join(REPO_DIR, rel);
  let buf;
  try {
    if (!fs.statSync(full).isFile()) continue; // a submodule
    buf = fs.readFileSync(full);
  } catch (e) { continue; }
  if (buf.subarray(0, 8000).includes(0)) continue; // binary
  read++;
  const f = findings(buf.toString('utf8').split('\r').join(''), rel);
  if (f.length) found.set(rel, f);
}
yes('the text files are read (' + read + ')', read > 100);

const unexpected = [...found.keys()].filter((rel) => !waiting.has(rel));
yes('no tracked file names a personal address, profile account or public IPv4 address' + (unexpected.length ? ':' : ''), unexpected.length === 0);
for (const rel of unexpected) {
  for (const f of found.get(rel)) console.log('        ' + rel + ':' + f.line + ':' + f.col + '  ' + f.kind);
}
if (unexpected.length) console.log('      Write C:' + bs + 'Users' + bs + '<you>' + bs + '..., %USERPROFILE%, $env:USERPROFILE, a role address or a 203.0.113.x address instead.');
for (const [val, what, where] of NOT_ADDRESSES) {
  const at = files.filter((rel) => where.test(rel) && fs.existsSync(path.join(REPO_DIR, rel)) && fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').includes(val));
  yes(val + ' (' + what + ') is still where NOT_ADDRESSES says' + (at.length ? '' : ': it is gone, so take its line out'), at.length > 0);
}

for (const [rel, why] of WAITING) {
  const still = found.has(rel);
  yes(rel + ' still waits on ' + why + (still ? '' : ': it is clean or gone now, so take its line out of WAITING in this file'), still);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
