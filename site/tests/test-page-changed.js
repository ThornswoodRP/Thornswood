// test-page-changed.js
//
// The terms, privacy and rules pages say when they last changed, and a
// SHA-256 of the text /api/page serves can be read back to that day.
// The day is the last change to the wording on main, not the day the line
// was added. No server and no VPS: this reads the files.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const PAGES = ['terms', 'privacy', 'rules'];
const EXPECT = {
  terms: '2026-10-26',
  privacy: '2026-11-01',
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

const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'public', 'page-versions.json'), 'utf8'));
const server = siteFiles.source();

yes('the site looks a hash up at /api/page-version',
    server.indexOf('page-version') >= 0 && server.indexOf('function findPageVersion') >= 0);
yes('and /api/page sends the hash and the day',
    server.indexOf('sha256: sha') >= 0 && server.indexOf('changed: ver ? ver.changed : null') >= 0);

for (const name of PAGES) {
  const raw = fs.readFileSync(path.join(ROOT, 'site', 'data', 'site', name + '.md'), 'utf8');
  const day = EXPECT[name];
  const line = 'Last changed: ' + longDate(day) + '.';
  yes(name + ' shows its own day: ' + line, raw.indexOf(line) >= 0);
  yes(name + ' says that once', raw.split(line).length === 2);
  const rows = list.pages[name] || [];
  const bySha = {};
  rows.forEach(function (row) { bySha[row.sha256] = row.changed; });
  [false, true].forEach(function (open) {
    [raw, raw.replace(/\r\n/g, '\n')].forEach(function (text) {
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

const sample = (list.pages.terms || [])[0];
yes('a listed hash is 64 hex characters', sample && /^[0-9a-f]{64}$/.test(sample.sha256));
yes('an unknown hash is absent', JSON.stringify(list).indexOf('0000000000000000000000000000000000000000000000000000000000000000') < 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
