'use strict';
/*
  test-3620-set-aside-copies.js

      node tests\test-3620-set-aside-copies.js

  Issue #3620: a wipe (Wipe-Saves.ps1), a restore (Restore-Server.ps1), a
  character reset (Reset-Character.ps1) and an appearance reset
  (Reset-Appearance.ps1) each set the characters they replace aside inside
  the game server's folder, and nothing ever deleted them. server-log.js,
  which every game server's task runs it under, now deletes each one
  ASIDE_DAYS after the time in its name, at the start and once an hour.

  What it proves, in a scratch folder, with stamps made from today:
    - a copy of each kind set aside 31 days ago goes, and one set aside 29
      days ago stays: world-before-*, world-before-restore-*, the
      private\*-before-*.json registers and the .initialized mark beside them,
      changeForms\_discarded-* and changeForms\<id>.json.bak-*
    - the live world, private and their files are never touched, and neither
      is a name the rule does not fit (a stamp that is not one, a file
      where a folder belongs)
    - a link is left as it is and said, and what it points at stays
    - each line names the copy and the day it was set aside, never what is
      in it
    - a folder with no server-settings.json (voice runs under it too) is
      never looked at
    - a real start under server-log.js deletes them before the program runs
      and says so in server.log
    - the site's retention sweep, lifted out of site\server.js, deletes the
      data, uploads and config.json a restore (vps-restore-services.ps1) set
      aside beside them 30 days on, and nothing else in the site's folder
      (the bot's joins.json copies: tests\test-2353-join-keeping.py)
    - the privacy page and the scripts that set copies aside say how long
  Nothing leaves this machine.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const siteFiles = require('./site-files');

const REPO = path.resolve(__dirname, '..');
const WRITER = path.join(REPO, 'scripts', 'vps', 'Server-Log.js');
const SL = require(WRITER);
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function put(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
}
const there = (p) => fs.existsSync(p);
const DAY = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');
function stamp(t) {
  const d = new Date(t);
  return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-3620-'));
try {
  yes('the copies are kept 30 days', SL.ASIDE_DAYS === 30);
  const NOW = Date.now();
  const OLD = stamp(NOW - 31 * DAY), NEW = stamp(NOW - 29 * DAY);
  const R = path.join(scratch, 'server');
  const PV = path.join(R, 'private'), CF = path.join(R, 'world', 'changeForms');
  const mine = JSON.stringify({ formDesc: 'ff000a01', profileId: 5001 });
  function build() {
    fs.rmSync(R, { recursive: true, force: true });
    put(path.join(R, 'server-settings.json'), { privDir: 'private' });
    put(path.join(CF, 'ff000a01.json'), mine);
    put(path.join(PV, 'characters.json'), { who: { 5001: { name: 'Mine' } } });
    put(path.join(PV, 'books.json'), { books: [] });
    for (const s of [OLD, NEW]) {
      put(path.join(R, 'world-before-' + s, 'changeForms', 'ff000a01.json'), mine);
      put(path.join(R, 'world-before-restore-' + s, 'world', 'changeForms', 'ff000a01.json'), mine);
      put(path.join(R, 'world-before-restore-' + s, 'private', 'characters.json'), { who: { 5001: {} } });
      put(path.join(PV, 'characters-before-' + s + '.json'), { who: { 5001: {} } });
      put(path.join(PV, 'books-before-' + s + '.json'), { books: [{ chat: [{ text: 'hello' }] }] });
      put(path.join(PV, 'dungeon-rewards-ledger.initialized-before-' + s), '');
      put(path.join(CF, '_discarded-' + s, 'ff000a01.json'), mine);
      put(path.join(CF, 'ff000a01.json.bak-' + s), mine);
    }
    // Names the rule does not fit.
    put(path.join(R, 'world-before-notastamp', 'x.json'), '{}');
    put(path.join(R, 'world-before-' + stamp(NOW - 35 * DAY)), 'a file where a folder belongs');
    put(path.join(PV, 'notes.json'), '{}');
  }
  build();
  const said = SL.ageAside(R, NOW);
  const gone = (p) => !there(p);
  yes('a wipe\'s world set aside 31 days ago goes, one 29 days ago stays',
      gone(path.join(R, 'world-before-' + OLD)) && there(path.join(R, 'world-before-' + NEW, 'changeForms', 'ff000a01.json')));
  yes('a restore\'s world and private the same', gone(path.join(R, 'world-before-restore-' + OLD)) && there(path.join(R, 'world-before-restore-' + NEW, 'private', 'characters.json')));
  yes('a wipe\'s registers and cards in private the same, book chat with them',
      gone(path.join(PV, 'characters-before-' + OLD + '.json')) && gone(path.join(PV, 'books-before-' + OLD + '.json')) &&
      there(path.join(PV, 'characters-before-' + NEW + '.json')) && there(path.join(PV, 'books-before-' + NEW + '.json')));
  yes('  and the mark the wipe set aside beside them',
      gone(path.join(PV, 'dungeon-rewards-ledger.initialized-before-' + OLD)) && there(path.join(PV, 'dungeon-rewards-ledger.initialized-before-' + NEW)));
  yes('a character reset\'s _discarded folder the same', gone(path.join(CF, '_discarded-' + OLD)) && there(path.join(CF, '_discarded-' + NEW, 'ff000a01.json')));
  yes('an appearance reset\'s copy the same', gone(path.join(CF, 'ff000a01.json.bak-' + OLD)) && there(path.join(CF, 'ff000a01.json.bak-' + NEW)));
  yes('the live world and private are never touched',
      there(path.join(CF, 'ff000a01.json')) && there(path.join(PV, 'characters.json')) && there(path.join(PV, 'books.json')) && there(path.join(PV, 'notes.json')));
  yes('a name the rule does not fit stays, and a file where a folder belongs stays',
      there(path.join(R, 'world-before-notastamp', 'x.json')) && there(path.join(R, 'world-before-' + stamp(NOW - 35 * DAY))));
  const day = new Date(NOW - 31 * DAY);
  const dayText = day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate());
  yes('each one is a line naming the copy and the day it was set aside',
      said.length === 7 && said.every((l) => /^set-aside copies: deleted .+, set aside \d{4}-\d{2}-\d{2}, more than 30 days ago$/.test(l)) &&
      said.some((l) => l.indexOf('world-before-restore-' + OLD) >= 0 && l.indexOf(dayText) >= 0));
  // The copy's name carries its stamp, and a stamp's time can hold 5001
  // (3:00:10 PM is 150010), so the stamp comes out before the content is looked for.
  yes('  and never what is in it', !said.some((l) => /5001|Mine|hello/.test(l.split(OLD).join(''))));
  yes('a second pass finds nothing and says nothing', SL.ageAside(R, NOW).length === 0);
  yes('a pass with a longer keep deletes nothing more', (build(), SL.ageAside(R, NOW, 60)).length === 0 && there(path.join(R, 'world-before-' + OLD)));

  // A link: left, said, and what it points at stays.
  build();
  const far = path.join(scratch, 'elsewhere');
  put(path.join(far, 'keep.json'), '{}');
  let linked = true;
  try { fs.symlinkSync(far, path.join(CF, '_discarded-' + stamp(NOW - 40 * DAY)), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { linked = false; console.log('SKIP  could not make a link here: ' + (e.code || e.message)); }
  if (linked) {
    const s2 = SL.ageAside(R, NOW);
    yes('a link is left as it is and said, and what it points at stays',
        there(path.join(far, 'keep.json')) && s2.some((l) => /set-aside copies: left .*_discarded-.*: it is a link/.test(l)));
  }

  // Voice runs under server-log.js too, with no server-settings.json.
  const V = path.join(scratch, 'voice');
  put(path.join(V, 'world-before-' + OLD, 'x.json'), '{}');
  yes('a folder with no server-settings.json is never looked at', SL.ageAside(V, NOW).length === 0 && there(path.join(V, 'world-before-' + OLD, 'x.json')));
  put(path.join(V, 'server-settings.json'), '{"privDir":');
  yes('  nor one whose server-settings.json will not parse', SL.ageAside(V, NOW).length === 0 && there(path.join(V, 'world-before-' + OLD, 'x.json')));

  // A real start: before the program, said in server.log.
  build();
  put(path.join(R, 'exit.js'), 'process.exit(0);');
  const r = cp.spawnSync(process.execPath, [WRITER, '--log', path.join(R, 'server.log'), 'exit.js'], { cwd: R, encoding: 'utf8' });
  const log = fs.readFileSync(path.join(R, 'server.log'), 'utf8');
  yes('a real start under server-log.js deletes them and says so in server.log',
      r.status === 0 && gone(path.join(R, 'world-before-' + OLD)) && there(path.join(R, 'world-before-' + NEW)) &&
      /\[server-log\] set-aside copies: deleted world-before-/.test(log));
  const src = fs.readFileSync(WRITER, 'utf8');
  yes('  and the hourly pass runs it too', /setInterval\([\s\S]*?ageAside\(process\.cwd\(\), t\)[\s\S]*?SWEEP_MS\)/.test(src));

  // The site's half of a restore (vps-restore-services.ps1): data, uploads and
  // config.json set aside beside them in the site's folder, aged by the
  // site's retention sweep, lifted out of site\server.js.
  const SITE = siteFiles.source().split(String.fromCharCode(13)).join('');
  const from = SITE.indexOf('const RESTORE_ASIDE_DAYS'), to = SITE.indexOf('function retentionSweep()');
  yes('site\\server.js has the restore-copy sweep', from > 0 && to > from);
  const siteSaid = [];
  const sweep = new Function('fs', 'path', 'ROOT', 'retentionSay',
    SITE.slice(from, to) + '\nreturn { sweepRestoreCopies, RESTORE_ASIDE_DAYS };')(fs, path, '/nowhere', (w, o) => siteSaid.push(w + ' ' + JSON.stringify(o)));
  yes('  keeping them 30 days', sweep.RESTORE_ASIDE_DAYS === 30);
  const SR = path.join(scratch, 'site');
  for (const s of [OLD, NEW]) {
    put(path.join(SR, 'data-before-restore-' + s, 'signins.json'), { a: 1 });
    put(path.join(SR, 'uploads-before-restore-' + s, 'x.png'), 'x');
    put(path.join(SR, 'config.json-before-restore-' + s), { clientSecret: 'not-a-real-one' });
  }
  put(path.join(SR, 'data-before-restore-' + OLD + '-2', 'signins.json'), { a: 1 });
  put(path.join(SR, 'data', 'signins.json'), { live: 1 });
  put(path.join(SR, 'config.json'), { live: 1 });
  put(path.join(SR, 'feed-before-restore-' + OLD, 'published.json'), {});
  put(path.join(SR, 'config.json-before-restore-' + stamp(NOW - 50 * DAY), 'a-folder.txt'), 'x');
  const got = sweep.sweepRestoreCopies(NOW, SR);
  yes('the site deletes the data, uploads and config.json a restore set aside 31 days ago, and a second in that second',
      got.deleted === 4 && !there(path.join(SR, 'data-before-restore-' + OLD)) && !there(path.join(SR, 'uploads-before-restore-' + OLD)) &&
      !there(path.join(SR, 'config.json-before-restore-' + OLD)) && !there(path.join(SR, 'data-before-restore-' + OLD + '-2')));
  yes('  keeps the ones set aside 29 days ago',
      there(path.join(SR, 'data-before-restore-' + NEW, 'signins.json')) && there(path.join(SR, 'uploads-before-restore-' + NEW)) && there(path.join(SR, 'config.json-before-restore-' + NEW)));
  yes('  never touches the live data and config.json, the feed\'s copy, or a folder where config.json\'s copy should be a file',
      there(path.join(SR, 'data', 'signins.json')) && there(path.join(SR, 'config.json')) && there(path.join(SR, 'feed-before-restore-' + OLD)) &&
      there(path.join(SR, 'config.json-before-restore-' + stamp(NOW - 50 * DAY))));
  yes('  says each one it deleted, by name and never what was in it',
      siteSaid.filter((l) => /^restore-copy .*"event":"deleted"/.test(l)).length === 4 && !siteSaid.some((l) => /not-a-real-one/.test(l)));
  yes('  and the hourly retention sweep, which also runs as the site starts, runs it',
      /restoreCopies: sweepRestoreCopies\(now\)/.test(SITE.slice(to, to + 2000)));

  // What people and staff read says the same.
  const page = read('site/data/site/privacy.md').split(/\s+/).join(' ');
  yes('the privacy page says a wipe or restore keeps the old characters 30 days, then deletes them',
      /set aside on the server for 30 days, so it can be undone, and then deleted/.test(page));
  yes('Wipe-Saves.ps1 no longer says the old storage sits there until somebody decides',
      !/until you decide it can go/.test(read('scripts/ops/Wipe-Saves.ps1')) && /30 days/.test(read('scripts/ops/Wipe-Saves.ps1')));
  yes('  and its last words no longer send the operator to Clean-Everything.ps1, which has no part for these copies',
      !/Clean-Everything/.test(read('scripts/ops/Wipe-Saves.ps1')) && /deletes it 30 days from today/.test(read('scripts/ops/Wipe-Saves.ps1')));
  yes('Restore-Server.ps1 no longer says the copy is never deleted', !/world-before-restore-<stamp> inside it, never deleted/.test(read('scripts/vps/Restore-Server.ps1')));
  yes('Reset-Character.ps1 and Reset-Appearance.ps1 say their copies go after 30 days',
      /30 days/.test(read('scripts/ops/Reset-Character.ps1')) && /30 days/.test(read('scripts/ops/Reset-Appearance.ps1')));
} catch (e) {
  yes('the harness ran to the end: ' + (e && e.stack || e), false);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
