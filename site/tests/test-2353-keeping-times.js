'use strict';
/*
  test-2353-keeping-times.js

      node .\site\tests\test-2353-keeping-times.js

  Issue #2353: the privacy page gave no keeping time for reports, /stuck, the
  staff records, applications, the gallery queue, the join number or the
  door's log, and nothing in the code aged any of them. Decided by Patrick
  on 12 Oct: a keeping time for each store, enforced in the code that writes
  it, the times Claude's to pick. This holds each one:

    A  the site's rules, lifted out of site\server.js on their own: the inbox
       (applications, reports, calls for help) at 365 days, bans that ran
       out, undone PKs and staff notes at 365 days, the moderation log's
       lines at 365 days, gallery reports at 365 days and the gallery queue
       at 90 days, with a time that cannot be read kept rather than guessed.
    B  a real copy of site\server.js in a scratch folder on a spare port,
       planted with old and new rows of every store: as it comes up, with
       nothing sent to it, the retention sweep takes out exactly what is past
       its time, deletes an expired submission's file, and never writes over
       a ban list that will not read.
    C  the game server's block, lifted out of game\gamemode.js and run against
       a scratch folder: for-bot\moderation.log at 365 days and private\door.log
       at 90, written whole through mp.writeFileWhole, a refused write said
       once and the file left as it was; and the door's own log write no
       longer drops a failure with nothing said.
    D  the privacy page says each time the code holds.

  The bot's join number is held by tests\test-2353-join-keeping.py, which
  runs joins_age out of bot\bot.py the same way.

  Synthetic data only. Nothing leaves the machine; every scratch folder is
  under the temp folder and removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const SITE_SRC = path.join(ROOT, 'site', 'server.js');
const site = siteFiles.source(SITE_SRC).split(CR).join('');
const game = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
const privacy = fs.readFileSync(path.join(ROOT, 'site', 'data', 'site', 'privacy.md'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}
function between(src, a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i >= 0 && j > i) ? src.slice(i, j) : '';
}
function grab(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return '';
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  return '';
}
function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const DAY = 86400000;
const NOW = Date.now();
const iso = (t) => new Date(t).toISOString();

// ------------------------------------------------------------------ A --
function rules() {
  console.log('A  THE SITE\'S RULES, ON THEIR OWN');
  const block = between(site, '// ==== thornswood keeping times ====', '// ==== end thornswood keeping times ====');
  yes('the keeping times block is in server.js', block.length > 0);
  const K = new Function(block + '\nreturn { STAFF_DAYS, MODLOG_DAYS, GREPORTS_DAYS, PENDING_DAYS, freshBans,' +
                         ' freshPk, freshNotes, freshModLog, freshGalleryReports, stalePending };')();
  yes('the times are 365 for staff records, the staff log and gallery reports, and 90 for the queue',
      K.STAFF_DAYS === 365 && K.MODLOG_DAYS === 365 && K.GREPORTS_DAYS === 365 && K.PENDING_DAYS === 90);

  const bans = K.freshBans({
    forgood: { at: NOW - 900 * DAY, until: 0, why: 'for good' },
    holding: { at: NOW - 10 * DAY, until: NOW + DAY },
    ranout: { at: NOW - 400 * DAY, until: NOW - 366 * DAY },
    recent: { at: NOW - 40 * DAY, until: NOW - 364 * DAY },
    edge: { until: NOW - 365 * DAY },
    junkuntil: { until: 'soon' },
    notarow: 'x'
  }, NOW);
  yes('bans: one for good and one still holding stay, however old',
      'forgood' in bans && 'holding' in bans);
  yes('a ban that ran out 366 days ago goes, one 364 days ago stays, and one exactly 365 stays',
      !('ranout' in bans) && 'recent' in bans && 'edge' in bans);
  yes('a ban whose end cannot be read is kept, and so is a row that is not one',
      'junkuntil' in bans && bans.notarow === 'x');

  const pkIn = {
    101: { at: NOW - 900 * DAY, name: 'Dead for good' },
    102: { at: NOW - 900 * DAY, undone: { at: NOW - 366 * DAY } },
    103: { at: NOW - 900 * DAY, undone: { at: NOW - 30 * DAY } },
    104: { at: NOW - 900 * DAY, undone: { at: 'last spring' } },
    105: { at: NOW - 5 * DAY, history: [
      { at: NOW - 800 * DAY, undone: { at: NOW - 700 * DAY } },
      { at: NOW - 300 * DAY, undone: { at: NOW - 200 * DAY } },
      { at: NOW - 500 * DAY },
      'junk'
    ] }
  };
  const before = JSON.stringify(pkIn);
  const pk = K.freshPk(pkIn, NOW);
  yes('PK: one that holds stays, however old', '101' in pk);
  yes('one undone 366 days ago goes, one undone 30 days ago stays', !('102' in pk) && '103' in pk);
  yes('one whose undoing has no usable time is kept', '104' in pk);
  yes('a row\'s history loses the PKs undone or made past 365 days and keeps the rest',
      '105' in pk && pk['105'].history.length === 2 && pk['105'].history[0].at === NOW - 300 * DAY &&
      pk['105'].history[1] === 'junk', JSON.stringify(pk['105']));
  yes('the table handed in is left alone', JSON.stringify(pkIn) === before);

  const notes = K.freshNotes({
    a: [{ at: NOW - DAY, text: 'new' }, { at: NOW - 366 * DAY, text: 'old' }, { text: 'no time' }],
    b: [{ at: NOW - 400 * DAY }],
    c: 'not a list'
  }, NOW);
  yes('notes: one from yesterday and one with no time stay, one 366 days old goes',
      notes.a.length === 2 && notes.a[0].text === 'new' && notes.a[1].text === 'no time');
  yes('a person whose every note aged out is gone from the file, and a value that is not a list is left',
      !('b' in notes) && notes.c === 'not a list');

  const log = [
    JSON.stringify({ at: iso(NOW - 400 * DAY), did: 'ban', why: 'old' }),
    JSON.stringify({ at: iso(NOW - 2 * DAY), did: 'note', why: 'new' }),
    'not json at all',
    JSON.stringify({ did: 'note', why: 'no time' }),
    JSON.stringify({ at: iso(NOW - 366 * DAY), did: 'stuck' })
  ].join('\n') + '\n' + '{"at":"' + iso(NOW - 900 * DAY) + '","did":"half';
  const ml = K.freshModLog(log, NOW);
  yes('moderation.log: the lines past 365 days go and the count says two', ml.dropped === 2);
  yes('the rest stay in order, a line that will not read and one with no time included, and a last line with no ending is left as it was',
      ml.text === [JSON.stringify({ at: iso(NOW - 2 * DAY), did: 'note', why: 'new' }), 'not json at all',
        JSON.stringify({ did: 'note', why: 'no time' })].join('\n') + '\n' +
        '{"at":"' + iso(NOW - 900 * DAY) + '","did":"half', JSON.stringify(ml.text));
  yes('an empty log stays empty', K.freshModLog('', NOW).text === '' && K.freshModLog('', NOW).dropped === 0);

  const gr = K.freshGalleryReports([{ id: 'old', at: NOW - 366 * DAY }, { id: 'new', at: NOW - DAY }, { id: 'none' }], NOW);
  yes('gallery reports: past 365 days goes, yesterday and no time stay', gr.map((r) => r.id).join(',') === 'new,none');
  yes('a reports file that is not a list reads as empty', K.freshGalleryReports({}, NOW).length === 0);

  const sp = K.stalePending([{ name: 'a.png', at: NOW - 91 * DAY }, { name: 'b.png', at: NOW - 89 * DAY }, { name: 'c.png' }], NOW);
  yes('the queue: a submission 91 days old has expired, one 89 days old and one with no time wait on',
      sp.expired.map((e) => e.name).join(',') === 'a.png' && sp.left.map((e) => e.name).join(',') === 'b.png,c.png');

  // The inbox's rule lives with the report limits it trims by.
  const lim = between(site, '// ==== thornswood report limits ====', '// ==== end thornswood report limits ====');
  const L = new Function('crypto', 'net', lim + '\nreturn { trimInbox, INBOX_DAYS };')(crypto, net);
  yes('the inbox keeps 365 days', L.INBOX_DAYS === 365);
  const rows = [
    { id: 'new', kind: 'report', at: NOW - DAY },
    { id: 'ticketold', kind: 'ticket', at: NOW - 366 * DAY },
    { id: 'helpold', kind: 'help', at: NOW - 400 * DAY },
    { id: 'ticketnew', kind: 'ticket', at: NOW - 364 * DAY },
    { id: 'notime', kind: 'bug' }
  ];
  yes('inbox: an application and a call for help past 365 days go, the rest stay in order',
      L.trimInbox(rows, NOW).map((r) => r.id).join(',') === 'new,ticketnew,notime');
  yes('with no clock given it ages by now', L.trimInbox([{ at: Date.now() - 400 * DAY }]).length === 0);
}

// ------------------------------------------------------------------ B --
async function sweep() {
  console.log('\nB  THE SITE, AS IT COMES UP, WITH NOTHING SENT');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2353-'));
  siteFiles.copy(dir, SITE_SRC);
  for (const d of ['public', path.join('data', 'for-bot'), 'uploads']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password: crypto.randomBytes(12).toString('hex'),
    discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
    botKey: crypto.randomBytes(16).toString('hex'),
    admins: ['111111111111111111'],
    secret: crypto.randomBytes(32).toString('hex'),
    gameCheckPort: 1,
    onlineFile: path.join(dir, 'online.json')
  }, null, 2));
  const D = (...p) => path.join(dir, 'data', ...p);
  const put = (f, v) => fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  const get = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  // Made-up ids, names and pictures only.
  put(D('for-bot', 'inbox.json'), [
    { id: 'inew', kind: 'report', at: NOW - DAY },
    { id: 'iold', kind: 'ticket', at: NOW - 366 * DAY },
    { id: 'inotime', kind: 'bug' }
  ]);
  put(D('bans.json'), {
    '700000000000000001': { at: NOW - 900 * DAY, until: 0, why: 'for good' },
    '700000000000000002': { at: NOW - 900 * DAY, until: NOW - 400 * DAY, why: 'ran out long ago' },
    'p:7003': { at: NOW - 20 * DAY, until: NOW - 10 * DAY, why: 'ran out last week' }
  });
  put(D('pk.json'), {
    7101: { at: NOW - 900 * DAY, name: 'Stand-in dead' },
    7102: { at: NOW - 900 * DAY, name: 'Stand-in undone', undone: { at: NOW - 500 * DAY } }
  });
  put(D('notes.json'), { '700000000000000004': [{ at: NOW - DAY, text: 'new' }, { at: NOW - 500 * DAY, text: 'old' }] });
  put(D('for-bot', 'moderation.log'), [
    JSON.stringify({ at: iso(NOW - 500 * DAY), server: 'site', did: 'ban', whoName: 'Old' }),
    JSON.stringify({ at: iso(NOW - DAY), server: 'site', did: 'note', whoName: 'New' })
  ].join('\n') + '\n');
  put(D('gallery-reports.json'), [{ id: 'rold', name: 'x.png', at: NOW - 400 * DAY }, { id: 'rnew', name: 'x.png', at: NOW - DAY }]);
  put(D('gallery-pending.json'), [
    { name: 'stale-shot.png', by: 'Stand-in', at: NOW - 100 * DAY, from: 'web' },
    { name: 'fresh-shot.png', by: 'Stand-in', at: NOW - 3 * DAY, from: 'web' }
  ]);
  put(path.join(dir, 'uploads', 'stale-shot.png'), 'a picture');
  put(path.join(dir, 'uploads', 'fresh-shot.png'), 'a picture');
  put(path.join(dir, 'uploads', 'uploads.json'), {
    'stale-shot.png': { orig: 's.png', by: 'Stand-in', at: NOW - 100 * DAY, discordId: '700000000000000005' },
    'fresh-shot.png': { orig: 'f.png', by: 'Stand-in', at: NOW - 3 * DAY }
  });

  async function run(env) {
    const port = await freePort();
    const srv = spawn(process.execPath, ['server.js'], {
      cwd: dir,
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1',
                                            THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') }, env || {})
    });
    let out = '';
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    let up = false;
    /* Up once the site says ready or NOT READY: it says that right after its
       first retention sweep, in the same callback, so the sweep's files are
       all written by then however busy the machine is (#4082). The minute
       only bounds a site that never comes up. */
    for (let i = 0; i < 1200 && !up; i++) {
      if (/\[thornswood-docs\] (ready|NOT READY): /.test(out)) { up = true; break; }
      if (srv.exitCode !== null) break;
      await wait(50);
    }
    await new Promise((ok) => {
      srv.on('exit', ok);
      try { srv.kill(); } catch (e) { ok(); }
      setTimeout(ok, 3000);
    });
    return { up, out };
  }

  try {
    const r = await run();
    yes('the scratch site came up', r.up, r.out);
    yes('inbox: the application past 365 days is gone, the report from yesterday and the row with no time stay',
        get(D('for-bot', 'inbox.json')).map((x) => x.id).join(',') === 'inew,inotime');
    const bans = get(D('bans.json'));
    yes('bans: the one for good and the one that ran out last week stay, the one that ran out 400 days ago is gone',
        Object.keys(bans).sort().join(',') === '700000000000000001,p:7003', JSON.stringify(Object.keys(bans)));
    const pk = get(D('pk.json'));
    yes('PK: the one that holds stays, the one undone 500 days ago is gone', Object.keys(pk).join(',') === '7101');
    yes('notes: yesterday\'s stays, the one 500 days old is gone',
        get(D('notes.json'))['700000000000000004'].map((n) => n.text).join(',') === 'new');
    const ml = fs.readFileSync(D('for-bot', 'moderation.log'), 'utf8');
    yes('moderation.log: the line 500 days old is gone and yesterday\'s stays, whole',
        ml === JSON.stringify({ at: iso(NOW - DAY), server: 'site', did: 'note', whoName: 'New' }) + '\n', JSON.stringify(ml));
    yes('gallery reports: the one 400 days old is gone', get(D('gallery-reports.json')).map((x) => x.id).join(',') === 'rnew');
    yes('the queue: the submission 100 days old is off it, the one 3 days old waits on',
        get(D('gallery-pending.json')).map((x) => x.name).join(',') === 'fresh-shot.png');
    yes('its file is deleted in the same pass, and the waiting one\'s is not',
        !fs.existsSync(path.join(dir, 'uploads', 'stale-shot.png')) && fs.existsSync(path.join(dir, 'uploads', 'fresh-shot.png')));
    const meta = get(path.join(dir, 'uploads', 'uploads.json'));
    yes('and its note with the account that sent it, the waiting one\'s kept',
        !('stale-shot.png' in meta) && 'fresh-shot.png' in meta, JSON.stringify(meta));
    yes('no keeping time failure was said', !/(inbox|bans|pk|notes|moderation-log|gallery-reports|gallery-pending|gallery)-retention/.test(r.out), r.out);

    // A ban list that will not read is never written over (#2186), and a
    // second pass over files already inside their time writes nothing.
    put(D('bans.json'), '{ "700000000000000001": { "until": 1 ');
    const mtimes = ['inbox.json', 'moderation.log'].map((f) => fs.statSync(D('for-bot', f)).mtimeMs);
    await wait(30);
    const r2 = await run();
    yes('a second start came up', r2.up, r2.out);
    yes('a ban list that will not read is left exactly as it was',
        fs.readFileSync(D('bans.json'), 'utf8') === '{ "700000000000000001": { "until": 1 ');
    yes('and a file with nothing past its time is not written again',
        ['inbox.json', 'moderation.log'].every((f, i) => fs.statSync(D('for-bot', f)).mtimeMs === mtimes[i]));
  } catch (err) {
    fail++;
    console.log('FAIL  the site harness threw: ' + (err && err.stack ? err.stack : err));
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }

  const up = site.indexOf("console.log('[thornswood-docs] listening on '");
  const first = site.indexOf('retentionSweep();', up);
  const said = site.indexOf("'ready: bans", up);
  yes('the first sweep runs before the site says ready, which the harnesses wait for (#4082)',
      up > 0 && first > up && said > first && site.indexOf("'NOT READY: '", up) > first);
  const rs = grab(site, 'retentionSweep');
  yes('the hourly sweep runs every new store',
      ['sweepInbox(now)', 'sweepStaffRecords(now)', 'sweepModLog(now)', 'sweepGalleryReports(now)', 'expirePending(now)']
        .every((c) => rs.indexOf(c) >= 0));
  yes('and marks the expired queue before the removed uploads prune, so the file goes in the same pass',
      rs.indexOf('expirePending(now)') >= 0 && rs.indexOf('expirePending(now)') < rs.indexOf('pruneRemovedUploads(now)'));
  yes('every write to the inbox goes through the keeping time',
      (site.match(/putJson\(INBOX, trimInbox\(/g) || []).length === 4 && !/putJson\(INBOX, obj\)/.test(site));
  yes('and so does the hub\'s read of it', /inbox: w\.admin \? trimInbox\(jsonFile\(INBOX, \[\]\), Date\.now\(\)\) : \[\]/.test(site));
  yes('the staff records are aged on the way in and on the way out',
      /freshBans\(readB\.table, Date\.now\(\)\)/.test(grab(site, 'putBan')) &&
      /freshBans\(readB\.table, Date\.now\(\)\)/.test(grab(site, 'dropBan')) &&
      /freshNotes\(jsonFile\(NOTES/.test(grab(site, 'putNote')) &&
      /freshPk\(jsonFile\(PK/.test(grab(site, 'putPk')) &&
      /freshPk\(jsonFile\(PK/.test(grab(site, 'undoPk')) &&
      /freshBans\(/.test(grab(site, 'staffRecords')) && /freshNotes\(/.test(grab(site, 'staffRecords')) &&
      /freshPk\(/.test(grab(site, 'staffRecords')));
}

// ------------------------------------------------------------------ C --
function gameServer() {
  console.log('\nC  THE GAME SERVER\'S STAFF LOG AND DOOR LOG');
  const block = between(game, '// ==== thornswood keeping times ====', '// ==== end thornswood keeping times ====');
  yes('the keeping times block is in gamemode.js', block.length > 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2353-game-'));
  try {
    const priv = path.join(dir, 'private'), forBot = path.join(dir, 'for-bot');
    fs.mkdirSync(priv); fs.mkdirSync(forBot);
    const MOD = path.join(forBot, 'moderation.log'), DOOR = path.join(priv, 'door.log');
    const modText = [
      JSON.stringify({ at: iso(NOW - 400 * DAY), did: 'stuck', byName: 'Old' }),
      JSON.stringify({ at: iso(NOW - 364 * DAY), did: 'kick', byName: 'Kept' }),
      'a line that will not read'
    ].join('\n') + '\n';
    fs.writeFileSync(MOD, modText);
    fs.writeFileSync(DOOR, iso(NOW - 91 * DAY) + '  let in profile 5001 (actor ff000001)\n' +
                           iso(NOW - 89 * DAY) + '  let in profile 5002 (actor ff000002)\n' +
                           'no stamp on this one\n');
    const said = [];
    let refuse = '';
    const writes = [];
    const mp = {
      getServerSettings: () => ({ privDir: priv }),
      writeFileWhole: (p, t) => {
        if (refuse) throw new Error(refuse);
        writes.push(p);
        fs.writeFileSync(p + '.tmp', t); fs.renameSync(p + '.tmp', p);
      }
    };
    const timers = [];
    const g = {};
    new Function('mp', 'require', 'log', 'setInterval', 'clearInterval', 'globalThis', block)(
      mp, require, (l) => said.push(l), (fn, ms) => { timers.push(ms); return timers.length; }, () => {}, g);
    yes('it runs at load and sets an hourly pass', timers.length === 1 && timers[0] === 3600000);
    const K = g.__thornswoodKeepingTimes;
    yes('the times are 365 days for the staff log and 90 for the door', K && K.MODLOG_DAYS === 365 && K.DOOR_DAYS === 90);
    yes('moderation.log, in for-bot beside private: the /stuck line 400 days old is gone, the rest stay in order',
        fs.readFileSync(MOD, 'utf8') === [JSON.stringify({ at: iso(NOW - 364 * DAY), did: 'kick', byName: 'Kept' }),
          'a line that will not read'].join('\n') + '\n', fs.readFileSync(MOD, 'utf8'));
    yes('door.log: the line 91 days old is gone, the one 89 days old and the one with no stamp stay',
        fs.readFileSync(DOOR, 'utf8') === iso(NOW - 89 * DAY) + '  let in profile 5002 (actor ff000002)\nno stamp on this one\n');
    yes('both written whole through mp.writeFileWhole', writes.length === 2 && writes.indexOf(MOD) >= 0 && writes.indexOf(DOOR) >= 0);
    yes('and each said in thornswood.log with its count',
        said.some((l) => /1 line older than 365 days taken out of moderation\.log/.test(l)) &&
        said.some((l) => /1 line older than 90 days taken out of door\.log/.test(l)), said.join(' | '));

    writes.length = 0;
    K.sweep(NOW);
    yes('a pass with nothing past its time writes nothing', writes.length === 0);

    fs.appendFileSync(MOD, JSON.stringify({ at: iso(NOW - 366 * DAY), did: 'ban' }) + '\n');
    const held = fs.readFileSync(MOD, 'utf8');
    refuse = 'the bot holds it';
    said.length = 0;
    K.sweep(NOW); K.sweep(NOW);
    yes('a write the engine refuses leaves the file as it was', fs.readFileSync(MOD, 'utf8') === held);
    yes('and is said once, not every pass', said.filter((l) => /moderation\.log could not be written/.test(l)).length === 1, said.join(' | '));
    refuse = '';
    K.sweep(NOW);
    yes('the next pass that can write takes the line out', fs.readFileSync(MOD, 'utf8').indexOf('"did":"ban"') < 0);

    fs.rmSync(MOD); fs.rmSync(DOOR);
    said.length = 0;
    K.sweep(NOW);
    yes('no files yet is nothing to say', said.length === 0, said.join(' | '));
  } catch (err) {
    fail++;
    console.log('FAIL  the game harness threw: ' + (err && err.stack ? err.stack : err));
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }

  const door = between(game, '// ==== thornswood door ====', '// ==== end thornswood door ====');
  const note = grab(door, 'note');
  yes('the door\'s note() no longer drops a failed write with nothing said',
      note.length > 0 && !/catch \(e\) \{ \}/.test(note) && /could not write ' \+ LOG/.test(note));
}

// ------------------------------------------------------------------ D --
function page() {
  console.log('\nD  THE PRIVACY PAGE SAYS EACH TIME');
  const at = privacy.indexOf('## How long it is kept');
  const end = privacy.indexOf('\n## ', at + 5);
  const keep = at >= 0 ? privacy.slice(at, end) : '';
  const item = (head) => {
    const i = keep.indexOf('- **' + head);
    if (i < 0) return '';
    const j = keep.indexOf('\n- ', i + 3);
    return keep.slice(i, j < 0 ? keep.length : j).replace(/\s+/g, ' ');
  };
  yes('applications: 365 days on the site, and the Discord thread named',
      /365 days/.test(item('Your application')) && /thread in the Discord/.test(item('Your application')));
  yes('the rules answer: for as long as the account is here, and goes with it',
      /for as long as your account is here/.test(item('Your answer to the rules')));
  yes('reports and calls for help: 365 days, gallery reports included',
      /365 days/.test(item('Reports and calls for help')) && /gallery picture/.test(item('Reports and calls for help')));
  yes('/stuck and the staff logs: 365 days, checked every hour',
      /365 days/.test(item('/stuck and the staff logs')) && /every hour/.test(item('/stuck and the staff logs')));
  const staff = item('Staff records');
  yes('staff records: a ban for as long as it holds, 365 days after it ran out, an undone PK and a note 365 days',
      /as long as it holds/.test(staff) && /365 days after it ended/.test(staff) &&
      /365 days after it was undone/.test(staff) && /note is kept for 365 days/.test(staff));
  yes('the door log: 90 days', /90 days/.test(item('The game server\'s door log')));
  yes('the gallery queue: 90 days, then the file deleted',
      /90 days/.test(item('A gallery submission waiting')) && /file deleted/.test(item('A gallery submission waiting')));
  yes('the join number: while in the Discord, and 365 days after leaving',
      /while you are in the Discord/.test(item('Your join number')) && /365\s+days after you leave/.test(item('Your join number')));
  yes('the page says what a join number is', /\*\*Your join number\.\*\*/.test(privacy));
  yes('and that staff records still go when their time is up, deletion request or not',
      /still go when their time above is up/.test(privacy.replace(/\s+/g, ' ')));
}

(async () => {
  rules();
  await sweep();
  gameServer();
  page();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
