'use strict';
/*
  test-4432-log-age-by-stat.js

      node tests\test-4432-log-age-by-stat.js

  #4432. Every hour, and at the end of every play session, the site worked
  out how old each saved launcher log set was by reading the whole set (up
  to a megabyte) and parsing it for its "at", one after another on the
  site's only thread, so the site answered nothing else meanwhile, and the
  launcher's /api/play/end waited for all of it.

  This lifts the site's own functions by text (tests\site-files.js) and runs
  them on a scratch session-logs folder, with every read of a file in that
  folder counted:

    A  the prune deletes only sets past their 365 days, holds a kept one,
       and opens no set at all to learn its age: the file's time is the
       set's saved time;
    B  that stays true when a set is written again after it was saved: a
       replay marked on it, or a kept session's chat dropped from it, leaves
       the file's time at the set's own "at";
    C  the end of a play session no longer runs the prune; the hourly sweep
       does.

  Writes only to its own temp folder.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const siteFiles = require('./site-files');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const src = siteFiles.source();
function grab(name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('the site has no function ' + name);
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}
const has = (name) => src.indexOf('function ' + name + '(') >= 0;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4432-'));
const SLOGS = path.join(TMP, 'session-logs');
const SLOG_ONE = 256 * 1024;
const SLOG_ALL = 1024 * 1024;
const SLOG_DAYS = 365;
const SLOG_NAMES = ['launcher.log', 'crash.log'];
const DAY = 86400000;
let ROWS = [];
function sessionRows() { return ROWS; }
function isObjectLike(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/* Every read of a file in the session-logs folder, by its name. */
const opened = [];
const inSlogs = (p) => typeof p === 'string' && path.resolve(p).indexOf(SLOGS + path.sep) === 0;
const fsCounted = new Proxy(fs, {
  get(t, k) {
    const v = t[k];
    if (['readFileSync', 'openSync', 'createReadStream', 'readFile', 'open'].indexOf(k) >= 0) {
      return function (p) {
        if (inSlogs(p)) opened.push(path.basename(p));
        return v.apply(t, arguments);
      };
    }
    return typeof v === 'function' ? v.bind(t) : v;
  }
});

// The site's own functions, run with the counted fs.
const lifted = ['slogFile', 'slogTrim', 'putSessionLogs', 'retentionSay', 'pruneSessionLogs', 'sessionKey',
                'readSlogSet', 'dropKeptChat'];
for (const n of ['writeSlogSet']) if (has(n)) lifted.push(n);
// eslint-disable-next-line no-new-func
const make = new Function('fs', 'path', 'crypto', 'SLOGS', 'SLOG_ONE', 'SLOG_ALL', 'SLOG_DAYS', 'SLOG_NAMES',
  'sessionRows', 'isObjectLike',
  lifted.map(grab).join('\n') + '\nreturn { ' + lifted.join(', ') + ' };');
const S = make(fsCounted, path, crypto, SLOGS, SLOG_ONE, SLOG_ALL, SLOG_DAYS, SLOG_NAMES, sessionRows, isObjectLike);

const file = (k) => path.join(SLOGS, k + '.json');
const readSet = (k) => JSON.parse(fs.readFileSync(file(k), 'utf8'));
/* A set as one saved `days` ago is on disk: its own "at" and its file time
   both that long back, the way a set saved then and never touched since is. */
function savedDaysAgo(k, days) {
  S.putSessionLogs(k, '333', { 'launcher.log': 'line\n'.repeat(50) });
  const o = readSet(k);
  o.at = Date.now() - days * DAY;
  fs.writeFileSync(file(k), JSON.stringify(o));
  fs.utimesSync(file(k), new Date(o.at), new Date(o.at));
}
const mtime = (k) => fs.statSync(file(k)).mtimeMs;
const quiet = (fn) => { const e = console.error; console.error = () => { }; try { return fn(); } finally { console.error = e; } };

try {
  // ---------------------------------------------------------------- A --
  console.log('A. the prune, by age:');
  const RECENT = ['recent0000000001', 'recent0000000002', 'recent0000000003'];
  for (const k of RECENT) savedDaysAgo(k, 3);
  savedDaysAgo('edge000000000001', SLOG_DAYS - 1);
  savedDaysAgo('old0000000000001', SLOG_DAYS + 5);
  savedDaysAgo('old0000000000002', SLOG_DAYS + 40);
  savedDaysAgo('kept000000000001', SLOG_DAYS + 40);
  ROWS = [{ session: 'kept000000000001', who: '333', keep: true }];
  opened.length = 0;
  const out = quiet(() => S.pruneSessionLogs());
  yes('the two sets past 365 days are deleted (' + out.deleted + ')',
      out.deleted === 2 && !fs.existsSync(file('old0000000000001')) && !fs.existsSync(file('old0000000000002')));
  yes('a set one day short of 365 stays', fs.existsSync(file('edge000000000001')));
  yes('recent sets stay', RECENT.every((k) => fs.existsSync(file(k))));
  yes('an old set on a row marked kept stays', fs.existsSync(file('kept000000000001')));
  yes('no recent set was opened to learn its age (opened: ' + (opened.filter((n) => /^recent|^edge/.test(n)).join(', ') || 'none') + ')',
      !opened.some((n) => /^recent|^edge/.test(n)));
  yes('and no set at all was opened: its file time is its age (opened: ' + (opened.join(', ') || 'none') + ')',
      opened.length === 0);

  // ---------------------------------------------------------------- B --
  console.log('\nB. a set written again keeps its saved time:');
  savedDaysAgo('replay0000000001', SLOG_DAYS + 2);
  const at1 = readSet('replay0000000001').at;
  S.putSessionLogs('replay0000000001', '333', { 'launcher.log': 'a clean set sent over the top\n' });
  yes('a replay is marked on the set', readSet('replay0000000001').resent === 1);
  yes('and the file time is still the set\'s own "at" (' + Math.round((mtime('replay0000000001') - at1) / DAY) + ' days apart)',
      Math.abs(mtime('replay0000000001') - at1) < 2000);

  savedDaysAgo('dropped000000001', SLOG_DAYS + 2);
  const o = readSet('dropped000000001');
  o.chat = { copiedAt: Date.now(), lines: [] };
  fs.writeFileSync(file('dropped000000001'), JSON.stringify(o));
  fs.utimesSync(file('dropped000000001'), new Date(o.at), new Date(o.at));
  yes('a kept session\'s chat is dropped when it is let go', S.dropKeptChat('dropped000000001') === 'dropped' &&
      !readSet('dropped000000001').chat);
  yes('and the file time is still the set\'s own "at" (' + Math.round((mtime('dropped000000001') - o.at) / DAY) + ' days apart)',
      Math.abs(mtime('dropped000000001') - o.at) < 2000);

  const fresh = 'fresh00000000001';
  S.putSessionLogs(fresh, '333', { 'launcher.log': 'new\n' });
  yes('a new set\'s file time is its "at"', Math.abs(mtime(fresh) - readSet(fresh).at) < 2000);

  ROWS = [];
  quiet(() => S.pruneSessionLogs());
  yes('so both go at their 365 days, by their saved time', !fs.existsSync(file('replay0000000001')) &&
      !fs.existsSync(file('dropped000000001')) && fs.existsSync(file(fresh)));

  // ---------------------------------------------------------------- C --
  console.log('\nC. the end of a session:');
  const from = src.indexOf("(p === '/api/play/start' || p === '/api/play/end')");
  const to = src.indexOf("p === '/api/play/logs'", from);
  const block = from >= 0 && to > from ? src.slice(from, to) : '';
  yes('the site has the start and end handler', block.length > 0);
  yes('and the end of a session does not run the prune', block.length > 0 && !/pruneSessionLogs\s*\(/.test(block));
  yes('the hourly sweep still does', /function retentionSweep\(\)[\s\S]*?sessionLogs: pruneSessionLogs\(\)/.test(src) &&
      /setInterval\(retentionSweep, RETENTION_EVERY_MS\)/.test(src));
} catch (e) {
  yes('the harness ran to the end: ' + (e && e.stack || e), false);
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
