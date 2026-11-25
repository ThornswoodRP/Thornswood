// test-page-changed.js
//
// The terms, privacy and rules pages say when they last changed, and a
// SHA-256 of the text /api/page serves can be read back to that day.
// The day is the last change to the wording on main, not the day the line
// was added. No server and no VPS: this reads the files.

const path = require('path');
const os = require('node:os');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('node:child_process');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const PAGES = ['terms', 'privacy', 'rules'];
const EXPECT = {
  terms: '2026-10-26',
  rules: '2026-10-26'
};
const MONTHS = [null, 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function longDate(iso) {
  const parts = iso.split('-');
  return Number(parts[2]) + ' ' + MONTHS[Number(parts[1])] + ' ' + parts[0];
}

function forMode(md, open) {
  const drop = open === true ? 'alpha' : 'open';
  return String(md)
    .replace(new RegExp('^<!-- ' + drop + ' -->[ \\t]*\\r?\\n[\\s\\S]*?^<!-- /' + drop +
                        ' -->[ \\t]*(?:\\r?\\n|$)', 'gm'), '')
    .replace(/^<!-- \/?(?:alpha|open) -->[ \t]*(?:\r?\n|$)/gm, '');
}

function sha(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

const PRIVACY = 'site/data/site/privacy.md';
const DATE_LINE = /^Last changed: [^\n]*\n?/gm;
const lfText = text => text.replace(/\r\n/g, '\n');
const wording = text => lfText(text).replace(DATE_LINE, '');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

// Ignore commits that only fix the date line. On a main checkout this walks
// the history that actually landed, not the pull request or queue history.
function lastWordingDay(readGit = git, revision = 'HEAD') {
  const commits = readGit('log', '--first-parent', '--format=%H %ct', revision, '--', PRIVACY).trim().split('\n');
  for (let i = 0; i + 1 < commits.length; i++) {
    const [head, seconds] = commits[i].split(' ');
    const [before] = commits[i + 1].split(' ');
    if (wording(readGit('show', head + ':' + PRIVACY)) !== wording(readGit('show', before + ':' + PRIVACY))) {
      return new Date(Number(seconds) * 1000).toISOString().slice(0, 10);
    }
  }
  throw new Error('Cannot establish the privacy wording date from this checkout history');
}

function privacyErrors(raw, rows, day) {
  const errors = [];
  const line = 'Last changed: ' + longDate(day) + '.';
  const lf = lfText(raw);
  if ((lf.match(DATE_LINE) || []).map(x => x.trimEnd()).join('\n') !== line) {
    errors.push('the page must say ' + line + ' exactly once');
  }
  const known = new Map(rows.map(row => [row.sha256.toLowerCase(), row.changed]));
  if (known.size !== rows.length) errors.push('duplicate privacy hashes');
  const hashes = new Set();
  for (const text of [lf, lf.replace(/\n/g, '\r\n')]) {
    for (const open of [false, true]) hashes.add(sha(forMode(text, open)));
  }
  for (const digest of hashes) {
    if (known.get(digest) !== day) errors.push(JSON.stringify({ sha256: digest, changed: day }));
  }
  return errors;
}

const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'public', 'page-versions.json'), 'utf8'));
const server = siteFiles.source();

yes('the site looks a hash up at /api/page-version',
    server.indexOf('page-version') >= 0 && server.indexOf('function findPageVersion') >= 0);
yes('and /api/page sends the hash and the day',
    server.indexOf('sha256: sha') >= 0 && server.indexOf('changed: ver ? ver.changed : null') >= 0);

for (const name of PAGES) {
  const raw = fs.readFileSync(path.join(ROOT, 'site', 'data', 'site', name + '.md'), 'utf8');
  if (name === 'privacy') {
    const day = lastWordingDay();
    yes('privacy wording matches the commit whose history is checked',
      wording(raw) === wording(git('show', 'HEAD:' + PRIVACY)));
    const errors = privacyErrors(raw, list.pages.privacy, day);
    yes('privacy date and all served hashes agree with the wording day ' + day, !errors.length);
    for (const error of errors) console.log('      ' + error);
    yes('privacy keeps earlier wordings too', list.pages.privacy.some(row => row.changed < day));
    continue;
  }
  const day = EXPECT[name];
  const line = 'Last changed: ' + longDate(day) + '.';
  yes(name + ' shows its own day: ' + line, raw.indexOf(line) >= 0);
  yes(name + ' says that once', raw.split(line).length === 2);
  const rows = list.pages[name] || [];
  const bySha = {};
  rows.forEach(function (row) { bySha[row.sha256] = row.changed; });
  [false, true].forEach(function (open) {
    const lf = raw.replace(/\r\n/g, '\n');
    [raw, lf].forEach(function (text) {
      const digest = sha(forMode(text, open));
      const which = open ? 'open' : 'alpha';
      yes(name + ' as served (' + which + ') is listed as ' + day, bySha[digest] === day);
      // The row a new wording needs, so whoever changed the page can add it.
      if (bySha[digest] !== day) console.log('      add to page-versions.json under ' + name + ': { "sha256": "' + digest + '", "changed": "' + day + '" }');
    });
  });
  const days = {};
  rows.forEach(function (row) { days[row.changed] = true; });
  yes(name + ' keeps earlier wordings too', Object.keys(days).length >= 2);
  yes(name + ' does not stamp today on the current text', bySha[sha(forMode(raw, false))] !== '2026-10-02');
}

const rowsFor = (text, day) => [text, text.replace(/\n/g, '\r\n')].map(x => ({ sha256: sha(x), changed: day }));

// A test merge and a landed squash can have the same tree and different days.
// Exercise the Git history lookup against both, not a date supplied by a fixture.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-merge-day-'));
try {
  const fixtureGit = (day, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd: scratch, encoding: 'utf8', env: { ...process.env,
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_AUTHOR_DATE: day, GIT_COMMITTER_DATE: day }
  });
  const before = '2026-11-16T23:59:30Z';
  const after = '2026-11-17T00:00:30Z';
  const run = (...args) => fixtureGit(before, ...args);
  const page = path.join(scratch, PRIVACY);
  const stale = '# Privacy\n\nLast changed: 16 November 2026.\n\nNew wording.\n';
  run('init', '-q', '-b', 'main');
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, stale.replace('New wording', 'Old wording'));
  run('add', PRIVACY);
  fixtureGit('2026-11-15T12:00:00Z', 'commit', '-qm', 'Old wording');
  run('checkout', '-qb', 'proposed');
  fs.writeFileSync(page, stale);
  run('add', PRIVACY);
  run('commit', '-qm', 'New wording');
  run('checkout', '-qb', 'candidate', 'main');
  run('merge', '-q', '--no-ff', '-m', 'Test merge', 'proposed');
  run('checkout', '-q', 'main');
  run('merge', '-q', '--squash', 'proposed');
  fixtureGit(after, 'commit', '-qm', 'Landed squash');
  yes('the candidate and landed main have identical trees',
    run('rev-parse', 'candidate^{tree}') === run('rev-parse', 'main^{tree}'));
  const candidateDay = lastWordingDay(run, 'candidate');
  const landedDay = lastWordingDay(run, 'main');
  yes('Git history puts the candidate and landed wording on different UTC days',
    candidateDay === '2026-11-16' && landedDay === '2026-11-17');
  const proposedRows = rowsFor(stale, candidateDay);
  yes('the candidate date and hashes pass on the test merge only',
    privacyErrors(run('show', 'candidate:' + PRIVACY), proposedRows, candidateDay).length === 0);
  yes('the landed commit rejects yesterday’s date and both rows even though the tree matches',
    privacyErrors(run('show', 'main:' + PRIVACY), proposedRows, landedDay).length === 3);
  const fresh = stale.replace('16 November', '17 November');
  fs.writeFileSync(page, fresh);
  run('add', PRIVACY);
  fixtureGit('2026-11-18T12:00:00Z', 'commit', '-qm', 'Date correction only');
  const correctedDay = lastWordingDay(run, 'main');
  yes('a later date-only commit still checks against the landed wording day',
    correctedDay === landedDay &&
    privacyErrors(run('show', 'main:' + PRIVACY), rowsFor(fresh, correctedDay), correctedDay).length === 0);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

const sample = (list.pages.terms || [])[0];
yes('a listed hash is 64 hex characters', sample && /^[0-9a-f]{64}$/.test(sample.sha256));
yes('an unknown hash is absent', JSON.stringify(list).indexOf('0000000000000000000000000000000000000000000000000000000000000000') < 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
