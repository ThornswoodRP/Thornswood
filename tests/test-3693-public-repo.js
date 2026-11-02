// test-3693-public-repo.js
//
// The team-only files stay out of the public repository, nothing public links
// to them, and the files a stranger reads first carry no agent names, session
// links or dated asides.
//
// WHY THIS EXISTS. Issue #3693, part of making the repository public (#3721).
// CLAUDE.md was 329 lines of rules for a Claude, ops/ held what is true now
// about the servers and the runs waiting for the Desk, docs/archive held the
// team's dated notes, and six pages under docs/ said who holds each account
// and key, how the box is reached and what its runners can reach. Patrick
// chose on 26 Oct 2026 (answer A) that they move to a private ops repository
// the Desk and the threads read, and that the public repository keeps a short
// CLAUDE.md with build and test tips only. The #3684 rewrite then takes them
// out of the public history, which only holds if nothing puts them back.
// His answer C on the same issue moved the box runbooks (SERVER, RESTORING,
// IT-IS-DOWN, MOVING-THE-SERVER, SERVICE-OBJECTIVES) and the merchant work's
// planning notes (docs/systems/merchant-plans) there too.
//
// What it checks:
//   1. none of the moved paths is tracked here;
//   2. no tracked text file links to one, by a relative link or a link to
//      the file on GitHub (a file may name a page "in the ops repo", since a
//      name sends nobody to a page they cannot open);
//   3. CLAUDE.md is short and is build and test tips: no rules for an agent,
//      nobody named, no dated asides;
//   4. README.md, CONTRIBUTING.md, SECURITY.md, SUPPORT.md, CODE_OF_CONDUCT.md,
//      CLAUDE.md, the pull request template and the issue forms name no agent,
//      carry no session link or Claude-Session line, and have no "(Patrick,
//      22 Oct)" asides: the history of a rule is in git.
//
// Read only.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..'); // the tests are in tests\, the repository is one folder up

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, ''); }
  catch (e) { return null; }
}
function where(text, rx) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (rx.test(lines[i])) hits.push(':' + (i + 1));
  return hits.length ? ' (found at' + hits.join(',') + ')' : '';
}

// What left for the private ops repository, as paths from the root.
const MOVED_DIRS = ['ops/', 'docs/archive/', 'docs/systems/merchant-plans/'];
const MOVED_NAMES = ['OWNERSHIP', 'DEPLOY-IDENTITIES', 'BOX-ACCESS', 'RUNNER-ISOLATION', 'WEBSITE-OPERATIONS', 'WEBSITE-AUDIT',
  'SERVER', 'RESTORING', 'IT-IS-DOWN', 'MOVING-THE-SERVER', 'SERVICE-OBJECTIVES'];
const MOVED_PAGES = MOVED_NAMES.map(function (n) { return 'docs/' + n + '.md'; });

let tracked = [];
try {
  tracked = execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean);
} catch (e) {
  console.log('FAIL  git ls-files did not answer: ' + e.message);
  process.exit(1);
}
yes('git lists the tracked files, ' + tracked.length + ' of them', tracked.length > 1000);

// ------------------------------------------------------------ 1. the paths
MOVED_DIRS.forEach(function (d) {
  const back = tracked.filter(function (f) { return f.startsWith(d); });
  back.slice(0, 5).forEach(function (f) { console.log('      tracked again: ' + f); });
  yes(d + ' is not tracked here (it is in the private ops repo)', back.length === 0);
});
MOVED_PAGES.forEach(function (p) {
  yes(p + ' is not tracked here (it is in the private ops repo)', tracked.indexOf(p) < 0);
});

// ------------------------------------------------------------ 2. the links
const NAMES = MOVED_NAMES.join('|');
// The same file on GitHub, wherever the link is written.
const BLOB_LINK = new RegExp('github\\.com/ThornswoodRP/Thornswood/(?:blob|tree)/[^/\\s]+/(?:ops/|docs/archive|docs/systems/merchant-plans|docs/(?:' + NAMES + ')\\.md)', 'i');
// A markdown link, resolved from the folder of the page it is in.
const MD_LINK = /\]\(([^)\s]+)\)/g;
function moved(target) {
  return MOVED_DIRS.some(function (d) { return target === d.slice(0, -1) || target.startsWith(d); }) ||
    MOVED_PAGES.indexOf(target) >= 0;
}
const linking = [];
tracked.filter(function (f) { return /\.md$/i.test(f); }).forEach(function (f) {
  const t = read(f);
  if (t === null) return;
  let m;
  MD_LINK.lastIndex = 0;
  while ((m = MD_LINK.exec(t)) !== null) {
    const raw = m[1].replace(/[#?].*$/, '');
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), raw));
    if (moved(target)) { linking.push(f + ' -> ' + raw); break; }
  }
});
tracked.filter(function (f) { return /\.(md|txt|html?|ya?ml|json|js|ps1|py|cs|xaml)$/i.test(f) && f !== 'tests/test-3693-public-repo.js'; }).forEach(function (f) {
  const t = read(f);
  if (t !== null && BLOB_LINK.test(t)) linking.push(f + ' -> a GitHub link');
});
linking.forEach(function (f) { console.log('      links to a page in the private ops repo: ' + f); });
yes('no tracked file links to a page in the private ops repo', linking.length === 0);

// ------------------------------------------------------------ 3. CLAUDE.md
const AGENT = /\b(Claude|Grok|Codex|ChatGPT|Smeagle|Anvil|Herald|Waystone|Wyrd|Cursor)\b/;
const SESSION = /claude\.ai\/code\/session|Claude-Session:/i;
// "(Patrick, 22 Oct)", "Decided by Patrick on 11 Oct", "(Djinn, 4 Oct 2026)".
const ASIDE = /\b(Patrick|Djinn|Gavin)\b[^.\n]{0,40}\b\d{1,2} (Sep|Oct|Nov|Dec)\b|\b(Decided|Asked|Changed|Extended|Added) by (Patrick|Djinn)\b/;
const PERSON = /\b(Patrick|Djinn|Gavin|Jhinswife|WiccanDjinn)\b/;

const claude = read('CLAUDE.md');
yes('CLAUDE.md is there', claude !== null);
if (claude !== null) {
  const n = claude.split(/\r?\n/).length;
  yes('CLAUDE.md is short, ' + n + ' lines', n <= 60);
  yes('CLAUDE.md is build and test tips: a Build and a Test section', /^## Build\s*$/m.test(claude) && /^## Test\s*$/m.test(claude));
  yes('CLAUDE.md names nobody' + where(claude, PERSON), !PERSON.test(claude));
}

// ------------------------------------------------ 4. what a stranger reads
const FIRST = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md', 'CLAUDE.md',
  '.github/pull_request_template.md'].concat(tracked.filter(function (f) { return /^\.github\/ISSUE_TEMPLATE\//.test(f); }));
FIRST.forEach(function (f) {
  const t = read(f);
  yes(f + ' is there', t !== null);
  if (t === null) return;
  yes(f + ' names no agent' + where(t, AGENT), !AGENT.test(t));
  yes(f + ' carries no session link or Claude-Session line' + where(t, SESSION), !SESSION.test(t));
  yes(f + ' has no dated aside about who decided' + where(t, ASIDE), !ASIDE.test(t));
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
