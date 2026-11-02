'use strict';
/*
  test-2758-start-deletions.js

      node tests\test-2758-start-deletions.js

  Issue #2758: a deletion request stops nothing. Delete-Person.ps1 writes it
  into each service's folder, and the service takes it out of its own files
  as it next starts (Patrick, 18 Oct 2026: "it should just fully apply the
  rest upon a server restart"). This runs the two start steps that are code
  of their own, in a scratch folder:

    - server-log.js, which the game servers and voice start under, run for
      real with a stand-in program that only exits:
        a game server loses every change form of theirs, their card, mod menu
        choices, take counts and last-left time, keeps everybody else's
        byte for byte, and marks the part "saves" done in its list; a list
        with every other part done is deleted; an unfinished save holding one
        of theirs leaves the part waiting, said, and one that is not theirs
        does not; a list that is not one is left as it is
        voice loses their chat lines, keeps the ones inside a kept window and
        everybody else's, and deletes the request
        the log says counts and never an id
    - the site's block (site\server.js, between its markers), run against a
      stand-in data folder: everything of theirs goes, the kept session, the
      reports and the reported picture stay, a character made since the
      request goes too, and the request is deleted; a store that will not
      parse leaves it waiting and changes nothing
    - the site's /api/roster after that start (#3677): a game server that has
      not started since sends their old rows, and they stay off; a row it
      wrote after the deletion goes in; the marks go once every server has
      sent a book without them
    - server-log.js's RELEASE_PARTS is the gamemode's PARTS

  The bot's start step is tested by bot\tests\test-2758-deletion-requests.py.
  Nothing leaves this machine.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const siteFiles = require('./site-files');

const REPO = path.resolve(__dirname, '..');
const WRITER = path.join(REPO, 'scripts', 'vps', 'Server-Log.js');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };
const J = (p) => JSON.parse(rd(p));
function put(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
}

const ME = '111111111111111111', YOU = '222222222222222222';
const P1 = 5001, P2 = 5002, PY = 6001;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-2758-'));

// One start under server-log.js, of a program that only exits.
function start(root, env) {
  put(path.join(root, 'exit.js'), 'process.exit(0);');
  const r = cp.spawnSync(process.execPath, [WRITER, '--log', path.join(root, 'server.log'), 'exit.js'],
    { cwd: root, env: Object.assign({}, process.env, env || {}), encoding: 'utf8' });
  return { code: r.status, log: rd(path.join(root, 'server.log')) || '' };
}

(async () => {
try {
  // ---- the parts match
  const SL = require(WRITER);
  const gm = rd(path.join(REPO, 'game', 'gamemode.js'));
  const m = /var PARTS = (\[[^\]]*\]);/.exec(gm);
  yes('server-log.js\'s RELEASE_PARTS is the gamemode\'s PARTS, saves first',
      !!m && JSON.stringify(JSON.parse(m[1].replace(/'/g, '"'))) === JSON.stringify(SL.RELEASE_PARTS) && SL.RELEASE_PARTS[0] === 'saves');

  // ---- a game server
  const G = path.join(scratch, 'server');
  function game(list) {
    fs.rmSync(G, { recursive: true, force: true });
    put(path.join(G, 'server-settings.json'), { privDir: 'private' });
    const CF = path.join(G, 'world', 'changeForms');
    put(path.join(CF, 'ff000a01.json'), { formDesc: 'ff000a01', profileId: P1 });
    put(path.join(CF, 'ff000a09.json'), { formDesc: 'ff000a09', profileId: P1 });
    put(path.join(CF, 'ff000a02.json'), { formDesc: 'ff000a02', profileId: PY });
    put(path.join(CF, '1a2b3.json'), { formDesc: '1a2b3:Skyrim.esm', profileId: -1 });
    const PV = path.join(G, 'private');
    put(path.join(PV, 'characters.json'), '{\n  "who": {\n    "5001": {"name": "Mine"},\n    "6001": {"name": "Yours"}\n  }\n}\n');
    put(path.join(PV, 'mod-settings.json'), { who: { [P1]: { a: 1 }, [PY]: { a: 2 } } });
    put(path.join(PV, 'take-limit.json'), { counts: { [P1 + '|1a2b3']: { n: 1 }, [PY + '|1a2b3']: { n: 2 } } });
    put(path.join(PV, 'last-left.json'), { [P1]: 1, [PY]: 2 });
    put(path.join(PV, 'deleted-characters.json'), list);
  }
  game({ profiles: [P1], actors: [4278192641] });
  const g1 = start(G);
  const CF = path.join(G, 'world', 'changeForms'), PV = path.join(G, 'private');
  yes('the program still starts and its exit code is the task\'s', g1.code === 0);
  yes('a game server loses every change form of theirs before the engine starts',
      !fs.existsSync(path.join(CF, 'ff000a01.json')) && !fs.existsSync(path.join(CF, 'ff000a09.json')));
  yes('  and keeps everybody else\'s and the world\'s', fs.existsSync(path.join(CF, 'ff000a02.json')) && fs.existsSync(path.join(CF, '1a2b3.json')));
  const ch = J(path.join(PV, 'characters.json'));
  yes('  their card goes, the other stays, the file the shape it came in',
      !ch.who[P1] && !!ch.who[PY] && /^\{\n {2}"who"/.test(rd(path.join(PV, 'characters.json'))));
  yes('  and their mod menu choices, take counts and last-left time',
      !J(path.join(PV, 'mod-settings.json')).who[P1] && !!J(path.join(PV, 'mod-settings.json')).who[PY] &&
      !J(path.join(PV, 'take-limit.json')).counts[P1 + '|1a2b3'] && !!J(path.join(PV, 'take-limit.json')).counts[PY + '|1a2b3'] &&
      J(path.join(PV, 'last-left.json'))[P1] === undefined && J(path.join(PV, 'last-left.json'))[PY] === 2);
  const l1 = J(path.join(PV, 'deleted-characters.json'));
  yes('  the list stays for the gamemode, with saves marked done', l1.done && l1.done.saves > 0 && Object.keys(l1.done).length === 1 &&
      JSON.stringify(l1.profiles) === JSON.stringify([P1]));
  yes('  and server.log says it with counts, never an id',
      /deletions: saves: characters 2, cards 1, mod menu choices 1, take counts 1, last-left times 1; the gamemode lets go of the registers as it loads/.test(g1.log) &&
      !/5001|ff000a01|4278192641/.test(g1.log));
  const g2 = start(G);
  yes('the next start finds saves done and does nothing more', !/deletions:/.test(g2.log.slice(g1.log.length)));

  game({ profiles: [P1], actors: [], done: Object.fromEntries(SL.RELEASE_PARTS.filter((p) => p !== 'saves').map((p) => [p, 1])) });
  const g3 = start(G);
  yes('a list with every other part done is deleted once the saves go',
      !fs.existsSync(path.join(PV, 'deleted-characters.json')) && /every part is done, and the list is gone/.test(g3.log));

  game({ profiles: [P1], actors: [] });
  const entry = (pid, n) => ({ file: n + '.json', json: JSON.stringify({ formDesc: n, profileId: pid }, null, 2) });
  put(path.join(CF, '.pending-batch'), { version: 1, batch: [entry(P1, 'ff000a01')], checksum: 'x' });
  const g4 = start(G);
  yes('an unfinished save holding one of theirs leaves the part waiting, said',
      J(path.join(PV, 'deleted-characters.json')).done === undefined &&
      /holds one of their characters, or could not be read; the server replays it as it starts/.test(g4.log) &&
      /the part waits for the next start/.test(g4.log));
  yes('  and the rest of theirs still goes now', !J(path.join(PV, 'characters.json')).who[P1] && !fs.existsSync(path.join(CF, 'ff000a09.json')));
  yes('  and the engine\'s journal is left exactly as it was', J(path.join(CF, '.pending-batch')).checksum === 'x');
  game({ profiles: [P1], actors: [] });
  put(path.join(CF, '.pending-batch'), { version: 1, batch: [entry(PY, 'ff000a02')], checksum: 'x' });
  start(G);
  yes('one that holds nobody of theirs does not hold the part back', J(path.join(PV, 'deleted-characters.json')).done.saves > 0);

  game('{"profiles":[5001,"x"]}');
  const g5 = start(G);
  yes('a list that is not one removes nothing and is left as it is, said',
      fs.existsSync(path.join(CF, 'ff000a01.json')) && rd(path.join(PV, 'deleted-characters.json')) === '{"profiles":[5001,"x"]}' &&
      /is not a list of deleted characters, so nothing was removed and it is left as it is/.test(g5.log));

  // ---- voice
  const V = path.join(scratch, 'voice');
  const mine = JSON.stringify({ at: 1, profileId: P1, text: 'hello' });
  const yours = JSON.stringify({ at: 2, profileId: PY, text: 'hi' });
  const kept = JSON.stringify({ at: 150000, profileId: P1, text: 'kept' });
  put(path.join(V, 'chat', '2026-10-01.jsonl'), [mine, yours, kept, mine].join('\n') + '\n');
  put(path.join(V, 'chat', '2026-10-02.jsonl'), yours + '\n');
  put(path.join(V, 'deletion-requests.json'), { people: [{ discordId: ME, profiles: [P1] }], kept: [{ profile: P1, from: 99000, to: 201000 }] });
  const day2 = rd(path.join(V, 'chat', '2026-10-02.jsonl'));
  const v1 = start(V);
  yes('voice loses their chat lines and keeps the one in a kept session and everybody else\'s',
      rd(path.join(V, 'chat', '2026-10-01.jsonl')) === yours + '\n' + kept + '\n');
  yes('  a day with none of theirs is left byte for byte', rd(path.join(V, 'chat', '2026-10-02.jsonl')) === day2);
  yes('  the request is deleted and the log says counts',
      !fs.existsSync(path.join(V, 'deletion-requests.json')) &&
      /deletions: chat: chat lines 2, days edited 1, chat lines kept with a session staff marked kept 1; the request is done, and gone/.test(v1.log) &&
      !/5001|111111111111111111/.test(v1.log));
  const VC = path.join(scratch, 'voice-chat-elsewhere');
  put(path.join(VC, 'elsewhere', '2026-10-01.jsonl'), mine + '\n');
  put(path.join(VC, 'deletion-requests.json'), { people: [{ discordId: ME, profiles: [P1] }] });
  start(VC, { THORNSWOOD_CHAT_DIR: path.join(VC, 'elsewhere') });
  yes('  and it reads the chat folder voice reads, THORNSWOOD_CHAT_DIR when it is set', rd(path.join(VC, 'elsewhere', '2026-10-01.jsonl')) === '');

  // ---- the site
  const SRC = siteFiles.source();
  const cut = /\/\/ ==== thornswood deletion requests ====([\s\S]*?)\/\/ ==== end thornswood deletion requests ====/.exec(SRC);
  // The block is in site\lib\deletion.js since the split (#5357), and
  // server.js still calls it the line before it listens.
  yes('the site has the deletion block between its markers, and server.js calls it before it listens',
      !!cut && /\napplyDeletionRequests\(\);\r?\n\r?\nhttp\.createServer/.test(fs.readFileSync(path.join(REPO, 'site', 'server.js'), 'utf8')));
  const S = path.join(scratch, 'site'), D = path.join(S, 'data'), UP = path.join(S, 'uploads'), FB = path.join(D, 'for-bot');
  function site() {
    fs.rmSync(S, { recursive: true, force: true });
    put(path.join(D, 'linked.json'), { [ME]: { profiles: [P1, P2, 5003] }, [YOU]: { profiles: [PY, P2] } });
    put(path.join(D, 'rules-accepted.json'), { [ME]: 1, [YOU]: 1 });
    put(path.join(D, 'signins.json'), [{ id: ME, ip: '203.0.113.1' }, { id: YOU, ip: '203.0.113.2' }]);
    put(path.join(D, 'sessions.json'), [{ session: 's1', who: ME, profile: P1 }, { session: 's2', who: ME, profile: P1, keep: true }, { session: 's3', who: YOU }]);
    put(path.join(D, 'session-logs', 's1.json'), { session: 's1', who: ME });
    put(path.join(D, 'session-logs', 's2.json'), { session: 's2', who: ME });
    put(path.join(D, 'session-logs', 's3.json'), { session: 's3', who: YOU });
    put(path.join(FB, 'trouble.json'), [{ session: 's1', who: ME }, { session: 's2', who: ME }, { session: 's3', who: YOU }]);
    put(path.join(D, 'roster.json'), { who: { [P1]: {}, 5003: {}, [P2]: {}, [PY]: {} }, servers: { main: { checked: [P1, PY], held: [P1] } } });
    put(path.join(FB, 'inbox.json'), [{ kind: 'ticket', discordId: ME }, { kind: 'help', profileId: P1 }, { kind: 'report', profileId: P1 }, { kind: 'ticket', discordId: YOU }]);
    put(path.join(D, 'gallery-pending.json'), [{ name: 'mine.png', discordId: ME }, { name: 'yours.png', discordId: YOU }]);
    put(path.join(D, 'gallery.json'), [{ name: 'approved.png' }, { name: 'reported.png' }, { name: 'yours2.png' }]);
    put(path.join(D, 'gallery-reports.json'), [{ name: 'reported.png', discordId: YOU }]);
    for (const n of ['mine.png', 'yours.png', 'approved.png', 'reported.png', 'yours2.png']) put(path.join(UP, n), n);
    put(path.join(UP, 'uploads.json'), { 'mine.png': { discordId: ME }, 'yours.png': { discordId: YOU }, 'approved.png': { discordId: ME },
      'reported.png': { discordId: ME }, 'yours2.png': { discordId: YOU } });
    put(path.join(D, 'bans.json'), { [ME]: { why: 'x' } });
    put(path.join(D, 'deletion-requests.json'), { people: [{ discordId: ME, profiles: [P1] }] });
  }
  function runSite() {
    const logged = [];
    const putJson = (p, o) => { try { fs.writeFileSync(p, JSON.stringify(o, null, 2)); return true; } catch (e) { return false; } };
    const fn = new Function('fs', 'path', 'console', 'putJson', 'DATA', 'UP', 'LINKED', 'RULES_OK', 'ATTEMPTS', 'SESSIONS', 'SLOGS',
      'TROUBLE_FILE', 'ROSTER', 'INBOX', 'GPENDING', 'GALLERY', 'GREPORTS', 'UPMETA', cut[1] + '\napplyDeletionRequests();');
    fn(fs, path, { log: (l) => logged.push(l), error: (l) => logged.push(l) }, putJson, D, UP,
      path.join(D, 'linked.json'), path.join(D, 'rules-accepted.json'), path.join(D, 'signins.json'), path.join(D, 'sessions.json'),
      path.join(D, 'session-logs'), path.join(FB, 'trouble.json'), path.join(D, 'roster.json'), path.join(FB, 'inbox.json'),
      path.join(D, 'gallery-pending.json'), path.join(D, 'gallery.json'), path.join(D, 'gallery-reports.json'), path.join(UP, 'uploads.json'));
    return logged.join('\n');
  }
  if (cut) {
    site();
    const bans = rd(path.join(D, 'bans.json'));
    const said = runSite();
    const lk = J(path.join(D, 'linked.json'));
    yes('the site: their Discord link, rules answer and sign-in rows go, the others stay',
        !lk[ME] && !!lk[YOU] && J(path.join(D, 'rules-accepted.json'))[ME] === undefined &&
        J(path.join(D, 'signins.json')).length === 1 && J(path.join(D, 'signins.json'))[0].id === YOU);
    yes('  their session row and its logs and alert go; the kept session\'s stay',
        J(path.join(D, 'sessions.json')).map((x) => x.session).join(',') === 's2,s3' &&
        !fs.existsSync(path.join(D, 'session-logs', 's1.json')) && fs.existsSync(path.join(D, 'session-logs', 's2.json')) &&
        J(path.join(FB, 'trouble.json')).map((x) => x.session).join(',') === 's2,s3');
    const ro = J(path.join(D, 'roster.json'));
    yes('  their roster rows go, a character made since the request too, the shared one stays',
        !ro.who[P1] && !ro.who[5003] && !!ro.who[P2] && ro.servers.main.checked.join(',') === String(PY) && ro.servers.main.held.length === 0);
    yes('  their ticket and call for help go, their report stays',
        J(path.join(FB, 'inbox.json')).map((x) => x.kind).join(',') === 'report,ticket');
    yes('  their waiting and approved pictures go with the file; the reported one and the others stay',
        J(path.join(D, 'gallery-pending.json')).length === 1 && !fs.existsSync(path.join(UP, 'mine.png')) && !fs.existsSync(path.join(UP, 'approved.png')) &&
        J(path.join(D, 'gallery.json')).map((g) => g.name).join(',') === 'reported.png,yours2.png' && fs.existsSync(path.join(UP, 'reported.png')) &&
        !J(path.join(UP, 'uploads.json'))['approved.png'] && !!J(path.join(UP, 'uploads.json'))['reported.png']);
    yes('  staff\'s records are not touched', rd(path.join(D, 'bans.json')) === bans);
    yes('  the request is deleted, and the log says counts and never an id',
        !fs.existsSync(path.join(D, 'deletion-requests.json')) && /done, and the request is gone/.test(said) && !/111111111111111111|5001/.test(said));

    // ---- a game server that has not started since (#3677)
    const mk = ro.deleted || {};
    yes('  their character numbers are marked in roster.json with the time and nothing else',
        Object.keys(mk).sort().join(',') === [P1, 5003].sort().join(',') &&
        Object.values(mk).every((m) => Object.keys(m).sort().join(',') === 'at,clear' && m.at > 0 && m.clear.length === 0));
    // A Windows checkout has server.js with CRLF; the route is cut at LF.
    const LF = SRC.split('\r').join('');
    const a = LF.indexOf("  if ((route === '/api/roster' || route === '/dev/api/roster') && req.method === 'POST') {");
    const b = a < 0 ? -1 : LF.indexOf('\n  }\n', a);
    yes('server.js has the /api/roster route', a >= 0 && b > a);
    const ROUTE = new Function('route', 'o_body', 'ROSTER', 'fs',
      'const req = { method: "POST" }, res = {}, cfg = { botKey: "k" };\n' +
      'function body() { return Promise.resolve(o_body); }\n' +
      'function passBodyFailure() {}\n' +
      'function sameSecret(x, y) { return x === y; }\n' +
      'function jsonFile(p, d) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } }\n' +
      'function putJson(p, v) { fs.writeFileSync(p, JSON.stringify(v)); return true; }\n' +
      'function sendJson(r, code, obj) { r.code = code; r.obj = obj; return r; }\n' +
      'return (async function () {\n' + LF.slice(a, b + 4) + '\n return null; })();');
    const RO = path.join(D, 'roster.json');
    const push = (srv, o) => ROUTE(srv === 'dev' ? '/dev/api/roster' : '/api/roster', JSON.stringify(Object.assign({ key: 'k', server: srv }, o)), RO, fs);
    const T = mk[P1] ? mk[P1].at : 0;
    let r = await push('main', { who: { [P1]: { name: 'Mine', at: T - 1000 }, [PY]: { name: 'Yours', at: T - 500 }, 5003: { name: 'Mine too' } },
      checked: [P1, PY, 5003], held: [P1, PY, 5003] });
    let st = J(RO);
    yes('a running server\'s book with their old rows does not put them back; everybody else\'s goes in',
        r.code === 200 && r.obj.merged === 1 && !st.who[P1] && !st.who[5003] && st.who[PY].name === 'Yours');
    yes('  a row with no time is not taken as new', !st.who[5003]);
    yes('  and they are not reported held or checked', st.servers.main.held.join(',') === String(PY) && st.servers.main.checked.join(',') === String(PY));
    yes('  and the marks stay', !!st.deleted[P1] && st.deleted[P1].clear.length === 0);
    await push('dev', { who: { [PY]: { name: 'Yours', at: T - 500 } }, checked: [PY], held: [PY] });
    st = J(RO);
    yes('a server whose book never had them clears its part, and the marks stay for the one that has',
        st.deleted[P1].clear.join(',') === 'dev' && st.deleted[5003].clear.join(',') === 'dev');
    await push('main', { who: { [PY]: { name: 'Yours', at: T - 500 } }, checked: [PY], held: [PY] });
    st = J(RO);
    yes('once every server has sent a book without them, the marks are gone', st.deleted === undefined && !st.who[P1]);
    r = await push('main', { who: { [P1]: { name: 'Mine', at: T - 1000 } } });
    yes('  after which the roster takes rows for that number again', r.obj.merged === 1 && J(RO).who[P1].name === 'Mine');

    site();
    runSite();
    const T2 = J(RO).deleted[P1].at;
    r = await push('main', { who: { [P1]: { name: 'New', at: T2 + 1 }, 5003: { name: 'Mine too', at: T2 - 1 } } });
    st = J(RO);
    yes('a row the server wrote after the deletion is a character played since, and goes in',
        r.obj.merged === 1 && st.who[P1].name === 'New' && !st.who[5003] && !st.deleted[P1] && !!st.deleted[5003]);
    r = await push('main', { who: { 5003: { name: 'Mine too', at: T2 - 1 } }, checked: [5003], held: [] });
    yes('  and an old row for another of their numbers is still refused',
        r.obj.merged === 0 && !J(RO).who[5003]);
    await push('main', { who: {}, checked: [], held: [5003] });
    yes('  while a server that still holds the character keeps the mark, with no row in its book',
        !!J(RO).deleted && !!J(RO).deleted[5003] && J(RO).deleted[5003].clear.indexOf('main') < 0);

    site();
    put(path.join(D, 'sessions.json'), '[{"session":');
    const linkedBefore = rd(path.join(D, 'linked.json'));
    const said2 = runSite();
    yes('a store that will not parse leaves the request waiting and changes nothing',
        fs.existsSync(path.join(D, 'deletion-requests.json')) && rd(path.join(D, 'linked.json')) === linkedBefore &&
        /sessions\.json will not parse/.test(said2) && /waits for the next start/.test(said2));
  }
} catch (e) {
  yes('the harness ran to the end: ' + (e && e.stack || e), false);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
