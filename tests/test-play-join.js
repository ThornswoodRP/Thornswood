// test-play-join.js
//
// Checking in with a profile id that somebody else's Discord account already
// holds leaves it on their account and off the caller's, and still lets the
// caller in. Checking in again with your own id keeps it yours.
//
// Found by the triage of To Do List entry 142, identity on the game server
// being a number the client picks: "/api/play/join (server.js:2150-2157) adds
// any profileId to the caller's linked list without checking whether another
// Discord account holds it." Every profile id reaches every voice peer five
// times a second, so any account with the play role could learn somebody's
// id, check in with it, and from then on /api/play/owns answered "theirs" and
// the voice service minted a proven token for somebody else's character.
//
// The route is lifted out of site\server.js and run with stand-ins for the
// file, Discord and the reply, the way test-bans.js lifts standing(), because
// that file opens a port and reads a config when it is required. Run rather
// than read, so this fails if the check is moved after the write, dropped, or
// turned into one that also refuses the person who already holds the id.
//
// And so it fails if it is turned back into a refusal. The first cut answered
// 409, and a reviewer walked it through the launcher: Door.Check sends the id
// played last, the character list is kept per install and not per Discord
// account, so an install relinked to a second account with Unlink and Connect
// Discord got a warning box on every Play and never reached the menu. The
// door's yes carries no password, so refusing it guarded nothing that leaving
// the id off the caller's list does not already guard.
//
// And the relinked install is followed past the door to the character the
// second account makes. A second reviewer found that the spare, the id the
// menu's New character uses, was minted under the first account and checked
// in by it at every Play, so the second account's first character was filed
// under the first while it stays in the Discord: /owns called it somebody else's, /roster gave its
// menu card no name, and /api/allowed let it in on the first account's
// standing. The site cannot tell that spare from an id somebody took, and
// must not, so the fix is the launcher's: Chars.EnsureSpare mints a fresh
// spare under the account the install is linked to now (test-spare-owner.ps1
// runs that half against the real Chars.cs). /owns, /roster and /api/allowed
// are lifted and run here too, so what the second account's own character
// looks like afterwards is asked of the same routes the reviewer asked.
//
// And the relinked install is switched back and forth until the account's
// list is full. A third reviewer found that the list keeps its last eight ids
// in the order they first arrived, and that every switch back mints a spare,
// so the first account's own character fell off the front of its list and the
// second account's next Play claimed it: one character, A to B to A each
// round, taken by B on round eight. The route now moves an id the caller
// already holds to the end, and this plays twelve rounds, and an account
// that starts full.
//
// And somebody who changed accounts is followed until the old one leaves. A
// fourth reviewer ran these routes from main and from here: characters made
// under A, the install relinked to B. On main B simply took them. Here they
// stay A's, so voice refuses B on them, and once A left the Discord the door
// dropped them and turned B away from every one, with a hand edit of
// linked.json the only way back. The first half is a trade for Patrick to
// decide; the second is fixed: an account that has left, and is not banned by
// the file, the role or Discord's own ban list, holds nothing (hasLeft and
// departed in server.js, lifted and run here), and B's next Play takes the ids.
//
// Read only. Nothing here touches linked.json.
const fs = require('fs');
const path = require('path');
const siteFiles = require('./site-files');
const CR = String.fromCharCode(13);
const SRC = path.join(__dirname, '..', 'site', 'server.js');
const src = siteFiles.source(SRC).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------ the route
const HEAD = "  if (p === '/api/play/join' && req.method === 'POST') {";
const from = src.indexOf(HEAD);
const next = src.indexOf("if ((p === '/api/play/start' || p === '/api/play/end')", from);
let block = (from >= 0 && next > from) ? src.slice(from, next) : '';
// What sits between the two routes is the comment that heads the next one.
if (block) block = block.slice(0, block.lastIndexOf('/*'));
yes('the check in route is in server.js where this expects it', !!block);

// The three routes that read what the check in wrote, each from its first
// line to its own closing brace, the last one at two spaces before the next.
function lift(head, stop) {
  const a = src.indexOf(head);
  const b = a >= 0 ? src.indexOf(stop, a + head.length) : -1;
  if (a < 0 || b <= a) return '';
  const s = src.slice(a, b);
  const end = s.lastIndexOf('\n  }');
  return end > 0 ? s.slice(0, end + 4) : '';
}
const ownsBlock = lift("  if (p === '/api/play/owns' && req.method === 'POST') {",
                       "if (p === '/api/play/who'");
const rosterBlock = lift("  if (p === '/api/play/roster' && req.method === 'POST') {",
                         "const devDoor = (route === '/dev/api/allowed');");
const allowedBlock = lift("  const devDoor = (route === '/dev/api/allowed');",
                          "if (p === '/api/play/owns'");
yes('/owns, /roster and /api/allowed are in server.js where this expects them',
    !!ownsBlock && !!rosterBlock && !!allowedBlock);

// The two functions /join and /owns share for an account that has left the
// Discord, lifted whole and declared inside every route run below, so they
// close over the same stand-ins the route does.
function grab(name) {
  const at = src.indexOf('async function ' + name + '(');
  if (at < 0) return '';
  const b = src.indexOf('{', at);
  let depth = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
}
// What a banned account is told at Play (#1010), lifted the same way.
function grabPlain(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  if (at < 0) return '';
  const b = src.indexOf('{', at);
  let depth = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at + 1, i + 1); }
  }
  return '';
}
// Play's doors answer inside PLAY_ANSWER_MS, and departed() takes that
// deadline (#1094): the constants, within, standingLate and the body
// failure pass-through come along.
const lineOf = (head) => { const at = src.indexOf(head); return at < 0 ? '' : src.slice(at, src.indexOf('\n', at)); };
const classOf = (head) => {
  const at = src.indexOf(head);
  if (at < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
};
const HELPERS = grab('hasLeft') + '\n' + grab('departed') + '\n' +
                grabPlain('banUntilText') + '\n' + grabPlain('accountBanned') + '\n' +
                lineOf('const PLAY_ANSWER_MS') + '\n' + lineOf('const PLAY_BODY_MS') + '\n' +
                classOf('class BodyFailed') + '\n' + grabPlain('passBodyFailure') + '\n' +
                grabPlain('within') + '\n' + grabPlain('standingLate') + '\n';
// /api/allowed asks standingsForDoor for everybody at once since issue #415;
// lifted with the two constants above it and run over the same stand-in.
const FOR_DOOR = src.slice(src.indexOf('const DOOR_BUDGET_MS'), src.indexOf('async function standingsForDoor(')) +
                 grab('standingsForDoor');
function forDoor(standingCached) {
  return new Function('standingCached', 'discordQuietMs', FOR_DOOR + '\nreturn standingsForDoor;')(
    standingCached, function () { return 0; });
}
yes('hasLeft and departed are in server.js', HELPERS.length > 10 &&
    HELPERS.indexOf('async function hasLeft(') === 0 && HELPERS.indexOf('async function departed(') > 0);

if (!block || !ownsBlock || !rosterBlock || !allowedBlock || HELPERS.length <= 10) {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// Everybody is in the Discord with the play role unless over names them.
function standingFrom(over) {
  return async function (d) {
    return Object.assign({
      id: String(d), name: 'name-' + d, inGuild: true, banned: false,
      play: true, dev: false, admin: false, roles: ['Playtester']
    }, (over && over[String(d)]) || {});
  };
}

// Discord's own ban list, as hasLeft asks it: bans names the accounts whose
// lookup answers something other than 404 (200 is banned, 403 is a bot that
// may not read the list). Every path asked is kept in asked.
function discordFrom(world) {
  return async function (p) {
    if (world && world.asked) world.asked.push(p);
    const id = decodeURIComponent(p.slice(p.lastIndexOf('/') + 1));
    const s = (world && world.bans) ? world.bans[id] : undefined;
    if (s === 200) return { ok: true, status: 200, body: { user: { id: id } } };
    if (s) return { ok: false, status: s, body: null, why: 'Discord answered ' + s };
    return { ok: false, status: 404, body: null, why: 'not found' };
  };
}
const SITE_CFG = { botKey: 'door-key',
                   discord: { invite: '', botToken: 'x', guildId: 'g' },
                   access: { dev: ['Owner', 'Dev'] } };

async function runRoute(code, env) {
  const names = Object.keys(env);
  const fn = new AsyncFunction(names.join(','), HELPERS + code + '\nreturn "fell through";');
  let sent = null;
  env.sendJson = function (r, c, obj) { sent = { code: c, obj: obj }; return sent; };
  await fn.apply(null, names.map(function (n) { return env[n]; }));
  return sent;
}

// What /api/play/owns tells the voice service about this account and this id.
// over is the standing of anybody not in the Discord with the play role, and
// bans is what Discord's ban list says about them (discordFrom).
async function owns(table, discordId, profileId, over, bans) {
  return runRoute(ownsBlock, {
    p: '/api/play/owns', req: { method: 'POST' }, res: {},
    body: async function () { return JSON.stringify({ ticket: discordId, profileId: profileId }); },
    readTicket: function (s) { return s ? { d: String(s), n: 'name-' + s } : null; },
    standingCached: standingFrom(over),
    discordGet: discordFrom({ bans: bans || {}, asked: [] }),
    cfg: SITE_CFG,
    jsonFile: function (f, fallback) { return f === 'linked.json' ? clone(table) : fallback; },
    LINKED: 'linked.json',
    sendJson: null
  });
}

// The rows /api/play/roster hands this account's launcher for the menu.
async function roster(table, store, discordId) {
  return runRoute(rosterBlock, {
    p: '/api/play/roster', req: { method: 'POST' }, res: {},
    body: async function () { return JSON.stringify({ ticket: discordId }); },
    readTicket: function (s) { return s ? { d: String(s), n: 'name-' + s } : null; },
    jsonFile: function (f, fallback) {
      if (f === 'linked.json') return clone(table);
      if (f === 'roster.json') return clone(store);
      return fallback;
    },
    LINKED: 'linked.json', ROSTER: 'roster.json',
    // Nobody killed for good or banned by character here (#1010);
    // test-bans-pk.js runs those.
    characterBar: function () { return null; },
    // Nor any PK an admin undid; jsonFile hands pk.json back empty.
    PK: 'pk.json', pkActive: function (r) { return !!r && !r.undone; },
    sendJson: null
  });
}

// What the game server's door is handed every five minutes. The key goes in
// the X-Thornswood-Key header, the way the door sends it since entry 248;
// keyInAddress is the route's note of doors that still put it in the address.
async function allowed(table, over) {
  return runRoute(allowedBlock, {
    route: '/api/allowed', req: { method: 'GET', headers: { 'x-thornswood-key': 'door-key' } }, res: {},
    url: new URL('http://localhost/api/allowed'),
    cfg: { botKey: 'door-key' },
    keyInAddress: new Set(),
    sameSecret: function (a, b) { return a === b; },
    standingCached: standingFrom(over),
    standingsForDoor: forDoor(standingFrom(over)),
    jsonFile: function (f, fallback) { return f === 'linked.json' ? clone(table) : fallback; },
    LINKED: 'linked.json',
    // Staff bans kept on the site (#412); none here. test-staff-bans.js runs them.
    activeBans: function () { return []; },
    pkProfiles: function () { return []; },
    // The hold offices (#2551); none here. test-2551-hold-offices.js runs them.
    officesForDoor: async function () { return []; },
    sendJson: null
  });
}

/*
  One check in. The table is what linked.json holds before it; the answer is
  what came back, what was written, and what the site printed.

  jsonFile hands back a copy each time, the way reading the file does, so the
  route cannot change the table by holding on to it: only putJson writes.

  standingOver is the caller's own standing. world is everybody else's:
  world.over by Discord id, world.bans for Discord's ban list, and
  world.asked collects every path the ban list was asked on.
*/
async function checkIn(table, discordId, profileId, standingOver, world) {
  const state = { table: clone(table), writes: 0, sent: null, logged: [] };
  const request = { ticket: discordId };
  if (profileId !== undefined) request.profileId = profileId;
  const env = {
    p: '/api/play/join',
    req: { method: 'POST' },
    res: {},
    body: async function () { return JSON.stringify(request); },
    readTicket: function (s) { return s ? { d: String(s), n: 'name-' + s } : null; },
    standing: async function (d) {
      return Object.assign({
        id: String(d), name: 'name-' + d, inGuild: true, banned: false,
        play: true, dev: false, admin: false, roles: ['Playtester']
      }, standingOver || {});
    },
    standCache: new Map(),
    standingCached: standingFrom(world && world.over),
    discordGet: discordFrom(world),
    cfg: SITE_CFG,
    LINKED: 'linked.json',
    jsonFile: function (f, fallback) { return f === 'linked.json' ? clone(state.table) : fallback; },
    // The real putJson answers whether the write landed (#2180).
    putJson: function (f, obj) { state.writes++; state.table = clone(obj); return true; },
    sendJson: function (r, code, obj) { state.sent = { code: code, obj: obj }; return state.sent; },
    slotsFor: function () { return 2; },
    // The world is never full here (#481); test-seats.js runs that refusal.
    gameStatus: { up: false, online: 0, max: 0 },
    seatsFull: function () { return false; },
    worldFull: function () { return ''; },
    mostOnlineFallback: function () { return 0; },
    // No crash snapshots asked about here (#2319); test-2319-crash-looked-at.js runs that answer.
    sessionRows: function () { return []; },
    lookedAtFor: function () { return []; },
    console: {
      log: function (s) { state.logged.push(String(s)); },
      error: function (s) { state.logged.push(String(s)); }
    }
  };
  const names = Object.keys(env);
  const run = new AsyncFunction(names.join(','), HELPERS + block + '\nreturn "fell through";');
  const r = await run.apply(null, names.map(function (n) { return env[n]; }));
  state.fellThrough = (r === 'fell through');
  return state;
}

function holds(table, discordId) {
  const e = table[discordId];
  return (e && Array.isArray(e.profiles)) ? e.profiles.map(Number) : [];
}

const A = '111111111111111111';
const B = '222222222222222222';
const PID = 1893288986;

(async function () {
  // ------------------------------------------------- an id nobody holds
  {
    const s = await checkIn({}, A, PID);
    yes('an id nobody holds is let in', s.sent && s.sent.code === 200 && s.sent.obj.ok === true);
    yes('and it is written against the account that checked in with it',
        s.writes === 1 && holds(s.table, A).indexOf(PID) >= 0);
    yes('and the answer says it was claimed', s.sent && s.sent.obj.claimed === true);
  }

  // ------------------------------------------- an id you already hold
  const mine = { };
  mine[A] = { id: A, name: 'name-' + A, first: 1, seen: 1, played: 1, roles: [], profiles: [PID, 42] };
  {
    const s = await checkIn(mine, A, PID);
    yes('checking in again with your own id is let in', s.sent && s.sent.code === 200 && s.sent.obj.ok === true);
    yes('and the id is still yours, once, not twice',
        holds(s.table, A).filter(function (x) { return x === PID; }).length === 1);
    yes('and the other character is still there', holds(s.table, A).indexOf(42) >= 0);
    yes('and it was stamped as seen, which is what a check in is for',
        s.writes === 1 && s.table[A].seen > 1);
    yes('and the answer says it is claimed', s.sent && s.sent.obj.claimed === true);
  }

  // ------------------------------------------ somebody else's id
  {
    const before = clone(mine);
    const s = await checkIn(mine, B, PID);
    // The door's yes. Door.Check reads ok and nothing else, so anything but
    // 200 and ok true here is a warning box and no game for the caller.
    yes('somebody else\'s id does not stop the caller getting in',
        s.sent && s.sent.code === 200 && s.sent.obj.ok === true);
    yes('and the answer says the id was not claimed', s.sent && s.sent.obj.claimed === false);
    yes('and the yes carries no password, so letting them in gave nothing away',
        s.sent && !Object.prototype.hasOwnProperty.call(s.sent.obj, 'password'));
    yes('the id is not written against the caller', holds(s.table, B).indexOf(PID) < 0);
    yes('the account that holds it is left exactly as it was',
        JSON.stringify(s.table[A]) === JSON.stringify(before[A]));
    yes('and the caller was still stamped as seen, because they did check in',
        s.writes === 1 && !!s.table[B] && s.table[B].seen > 0);
    yes('and the site says who asked for whose, so it can be read afterwards',
        s.logged.some(function (l) { return l.indexOf(String(PID)) >= 0 && l.indexOf(A) >= 0 && l.indexOf(B) >= 0; }));
  }

  // ------------------- somebody else's id, from an account with its own
  {
    const both = clone(mine);
    both[B] = { id: B, name: 'name-' + B, first: 5, seen: 5, played: 5, roles: [], profiles: [777] };
    const before = clone(both);
    const s = await checkIn(both, B, PID);
    yes('an account that has its own characters is let in with somebody else\'s id too',
        s.sent && s.sent.code === 200 && s.sent.obj.ok === true && s.sent.obj.claimed === false);
    yes('and its own list is exactly what it was, with the other id not added',
        JSON.stringify(holds(s.table, B)) === JSON.stringify([777]));
    yes('and the holder\'s entry is untouched', JSON.stringify(s.table[A]) === JSON.stringify(before[A]));
    const again = await checkIn(both, B, 777);
    yes('the same account checking in with its own id is still let in',
        again.sent && again.sent.code === 200 && again.sent.obj.claimed === true &&
        holds(again.table, B).indexOf(777) >= 0);
  }

  /*
    THE INSTALL THAT WAS RELINKED, followed to the character B makes.

    One PC, played under account A: A holds its two characters and the spare,
    the id the menu's New character will use, because Shell checks every id
    in Chars.KnownIds in at every Play. The launcher's Unlink and Connect
    Discord link it to account B.

    Door.Check goes first, with the id the settings file holds, which is
    the one A played last. Then Chars.Prepare runs, and it retires the spare
    A holds and mints a fresh one under B before anything else is checked
    in (test-spare-owner.ps1 runs that against the real Chars.cs). So what
    StartPlay checks in is A's two characters and B's own spare. Every one
    of those has to be a yes, or B never reaches the menu. B picks New
    character, which is B's spare; PollChoice checks it in again, Chars.Chose
    mints the next spare under B, and the next Play checks that in as well.

    Then the three routes that read linked.json are asked what B's own
    character looks like, which is where the reviewer found the first cut
    filing it under A.
  */
  {
    const OLD_SPARE = 555, NEW_SPARE = 556, NEXT_SPARE = 557;
    const home = {};
    home[A] = { id: A, name: 'name-' + A, first: 1, seen: 1, played: 1, roles: [], profiles: [PID, 42, OLD_SPARE] };
    let table = clone(home);
    const answers = [];
    async function checkInAll(ids) {
      for (const id of ids) {
        const s = await checkIn(table, B, id);
        answers.push({ id: id, sent: s.sent });
        table = s.table;
      }
    }
    await checkInAll([PID]);                        // Door.Check
    await checkInAll([PID, 42, NEW_SPARE]);         // StartPlay, after Prepare
    yes('a relinked install gets a yes for every id it checks in',
        answers.every(function (a) { return a.sent && a.sent.code === 200 && a.sent.obj.ok === true; }));
    yes('the first account\'s characters stay the first account\'s',
        holds(table, B).indexOf(PID) < 0 && holds(table, B).indexOf(42) < 0 &&
        JSON.stringify(holds(table, A)) === JSON.stringify([PID, 42, OLD_SPARE]));
    const spareAnswer = answers[answers.length - 1];
    yes('the spare minted under the second account is claimed by it before anybody makes a character on it',
        spareAnswer.id === NEW_SPARE && spareAnswer.sent.obj.claimed === true &&
        holds(table, B).indexOf(NEW_SPARE) >= 0);

    await checkInAll([NEW_SPARE]);                              // PollChoice
    await checkInAll([PID, 42, NEW_SPARE, NEXT_SPARE]);         // the next Play
    yes('the second account\'s own character is on its list, and the spare behind it',
        JSON.stringify(holds(table, B)) === JSON.stringify([NEW_SPARE, NEXT_SPARE]));

    const mine = await owns(table, B, NEW_SPARE);
    yes('/owns tells voice the second account\'s new character is theirs',
        mine && mine.code === 200 && mine.obj.ok === true && mine.obj.why === 'theirs');
    const notMine = await owns(table, B, 42);
    yes('and still calls the first account\'s character somebody else\'s',
        notMine && notMine.code === 200 && notMine.obj.ok === false && notMine.obj.why === 'somebody else');

    const store = { who: {} };
    store.who[String(NEW_SPARE)] = { name: 'Bryn', race: 'Nord', trade: 'smith', town: 'Karthwasten' };
    store.who['42'] = { name: 'Arven', race: 'Breton', trade: 'hunter', town: 'Dragon Bridge' };
    store.who[String(PID)] = { name: 'Ilsa', race: 'Imperial', trade: 'cook', town: 'Karthwasten' };
    const r = await roster(table, store, B);
    yes('/roster gives the menu card for the second account\'s character its name',
        r && r.code === 200 && r.obj.rows[String(NEW_SPARE)] && r.obj.rows[String(NEW_SPARE)].name === 'Bryn');
    yes('and hands back nothing about the first account\'s characters',
        r && !r.obj.rows['42'] && !r.obj.rows[String(PID)]);

    const banA = {};
    banA[A] = { banned: true };
    const door = await allowed(table, banA);
    const list = (door && door.obj && door.obj.profiles) || [];
    yes('the game\'s door lets it in on the second account\'s standing: with the first banned, it is still on the list',
        list.indexOf(NEW_SPARE) >= 0 && list.indexOf(NEXT_SPARE) >= 0);
    yes('and the banned account\'s characters are not',
        list.indexOf(42) < 0 && list.indexOf(PID) < 0 && list.indexOf(OLD_SPARE) < 0);
  }

  /*
    The spare the launcher must not hand the second account. Checked in as
    B, the spare A holds gets a yes and stays A's, and /owns calls it
    somebody else's: a character B made on it would be filed under A. The
    site cannot tell this from somebody taking an id they learned off the
    voice service, and must not, so the launcher retires it instead.
  */
  {
    const OLD_SPARE = 555;
    const home = {};
    home[A] = { id: A, name: 'name-' + A, first: 1, seen: 1, played: 1, roles: [], profiles: [PID, 42, OLD_SPARE] };
    const s = await checkIn(home, B, OLD_SPARE);
    yes('the first account\'s spare, checked in by the second, is a yes and stays the first account\'s',
        s.sent && s.sent.code === 200 && s.sent.obj.ok === true && s.sent.obj.claimed === false &&
        holds(s.table, B).indexOf(OLD_SPARE) < 0 && holds(s.table, A).indexOf(OLD_SPARE) >= 0);
    const o = await owns(s.table, B, OLD_SPARE);
    yes('so /owns would call a character made on it somebody else\'s',
        o && o.obj.ok === false && o.obj.why === 'somebody else');
    const chars = fs.readFileSync(path.join(__dirname, '..', 'launcher', 'app', 'Chars.cs'), 'utf8');
    yes('which is why Chars.EnsureSpare retires a spare minted under another account, and test-spare-owner.ps1 runs it',
        /sp\.Owner == who/.test(chars) && /Retire\(sp\.Id\)/.test(chars) &&
        fs.existsSync(path.join(__dirname, 'test-spare-owner.ps1')));
  }

  /*
    THE LIST IS KEPT TO EIGHT, so the ids an install checks in at every Play
    have to be the ones kept.

    One install, one character, switched between A and B with Unlink and
    Connect Discord. Each Play goes the launcher's way: Door.Check with the id
    played last, then Chars.Prepare, which retires a spare minted under the
    other account and mints one under this one, then every id in
    Chars.KnownIds, the character before the spare. So each switch back to A
    puts a new spare on A's list. When the route kept ids in the order they
    first arrived, the character stayed at the front, the spares piled up
    behind it, it fell off A's list on round seven, and B's Play on round
    eight claimed it. lostAt is the first round that ends with it off A's
    list or on B's.
  */
  async function switching(start, rounds) {
    const C1 = 700;
    let nextSpare = 901;
    let spare = { id: 900, owner: A };
    let table = clone(start);
    async function play(who) {
      table = (await checkIn(table, who, C1)).table;                   // Door.Check
      if (spare.owner !== who) spare = { id: nextSpare++, owner: who };  // Prepare
      for (const id of [C1, spare.id]) table = (await checkIn(table, who, id)).table;
    }
    let lostAt = 0;
    for (let round = 1; round <= rounds; round++) {
      await play(B);
      await play(A);
      if (!lostAt && (holds(table, A).indexOf(C1) < 0 || holds(table, B).indexOf(C1) >= 0)) lostAt = round;
    }
    return { table: table, lostAt: lostAt, C1: C1, spare: spare.id };
  }
  {
    const home = {};
    home[A] = { id: A, name: 'name-' + A, first: 1, seen: 1, played: 1, roles: [], profiles: [700, 900] };
    const s = await switching(home, 12);
    yes('an install switched from A to B and back twelve times keeps its character on A' +
        (s.lostAt ? ' (off A\'s list after round ' + s.lostAt + ')' : ''),
        s.lostAt === 0 && holds(s.table, A).indexOf(s.C1) >= 0);
    yes('and B never holds it', holds(s.table, B).indexOf(s.C1) < 0);
    yes('and A\'s list is still kept to eight, with its newest spare on it',
        holds(s.table, A).length === 8 && holds(s.table, A).indexOf(s.spare) >= 0);
    yes('and the spares that dropped off are the oldest ones A was minted',
        holds(s.table, A).indexOf(900) < 0 && holds(s.table, A).indexOf(901) < 0);
    const o = await owns(s.table, A, s.C1);
    yes('/owns still tells voice the character is A\'s',
        o && o.code === 200 && o.obj.ok === true && o.obj.why === 'theirs');
    const other = await owns(s.table, B, s.C1);
    yes('and still calls it somebody else\'s when B asks',
        other && other.code === 200 && other.obj.ok === false && other.obj.why === 'somebody else');
  }

  // An account whose list is already full, with the character first on it,
  // needs only the Play after this launcher arrives and one relink.
  {
    const full = {};
    full[A] = { id: A, name: 'name-' + A, first: 1, seen: 1, played: 1, roles: [],
                profiles: [700, 11, 12, 13, 14, 15, 16, 900] };
    const s = await switching(full, 1);
    yes('an account that starts with a full list keeps its character through a relink' +
        (s.lostAt ? ' (off A\'s list after round ' + s.lostAt + ')' : ''),
        s.lostAt === 0 && holds(s.table, A).indexOf(s.C1) >= 0 && holds(s.table, B).indexOf(s.C1) < 0);
    yes('and what dropped off its list was the old ids it did not check in',
        holds(s.table, A).length === 8 && holds(s.table, A).indexOf(11) < 0);
  }

  /*
    SOMEBODY WHO CHANGED ACCOUNTS, followed until the old one leaves.

    The fourth reviewer's case, the way they ran it: an install with
    characters 700 and 701 made under A, relinked to B. On main B's list
    after one Play was [700, 701, 901] and voice called both characters B's.
    Here B's list is [901]. While A is in the Discord the game's door lets
    700 and 701 in on A's standing and voice refuses B a token on either,
    which is the trade Patrick is to decide, and this holds the route to it
    so a change to it is a decision rather than an accident. What came after
    is the part fixed: A leaves the Discord, /api/allowed drops 700 and 701,
    and the door turned B away from both with nothing but a hand edit of
    linked.json to get them back.
  */
  const changer = {};
  changer[A] = { id: A, name: 'name-' + A, first: 1, seen: 1, played: 1, roles: [], profiles: [700, 701, 900] };
  // One Play by B the launcher's way: Door.Check with 700, the id played
  // last, then Prepare mints B its own spare 901, then every known id.
  async function playAsB(start, world) {
    let table = clone(start);
    const logged = [];
    for (const id of [700, 700, 701, 901]) {
      const s = await checkIn(table, B, id, null, world);
      table = s.table;
      for (const l of s.logged) logged.push(l);
    }
    return { table: table, logged: logged };
  }
  const aLeft = {};
  aLeft[A] = { inGuild: false, play: false, roles: [] };
  {
    const world = { over: {}, bans: {}, asked: [] };
    const s = await playAsB(changer, world);
    yes('while the old account is in the Discord, the new one is kept off the characters made under it',
        JSON.stringify(holds(s.table, B)) === JSON.stringify([901]) &&
        JSON.stringify(holds(s.table, A)) === JSON.stringify([700, 701, 900]));
    yes('and Discord\'s ban list is not asked about an account that is still in the server',
        world.asked.length === 0);
    const door = await allowed(s.table);
    yes('the game\'s door still lets them in, on the old account\'s standing',
        door.obj.profiles.indexOf(700) >= 0 && door.obj.profiles.indexOf(701) >= 0);
    const o = await owns(s.table, B, 700);
    yes('and voice is refused them, which is the price Patrick is to decide',
        o.obj.ok === false && o.obj.why === 'somebody else');

    // A leaves the Discord.
    const doorGone = await allowed(s.table, aLeft);
    yes('once the old account has left, the door drops them until the new one plays again',
        doorGone.obj.profiles.indexOf(700) < 0 && doorGone.obj.profiles.indexOf(701) < 0);
    const early = await owns(s.table, B, 700, aLeft, {});
    yes('but /owns gives voice the character already, before that Play',
        early.obj.ok === true && early.obj.why === 'left');
    const gone = { over: aLeft, bans: {}, asked: [] };
    const next = await playAsB(s.table, gone);
    yes('the new account\'s next Play takes both characters over',
        [700, 701, 901].every(function (n) { return holds(next.table, B).indexOf(n) >= 0; }));
    yes('and takes them off the old account, so one id has one holder',
        holds(next.table, A).indexOf(700) < 0 && holds(next.table, A).indexOf(701) < 0 &&
        holds(next.table, A).indexOf(900) >= 0);
    yes('Discord\'s ban list was asked about the old account before anything moved',
        gone.asked.some(function (p) { return p.indexOf('/bans/' + A) >= 0; }));
    yes('and the site says what it moved and from whom',
        next.logged.some(function (l) {
          return l.indexOf('moved profile 700') >= 0 && l.indexOf(A) >= 0 && l.indexOf(B) >= 0;
        }));
    const doorAfter = await allowed(next.table, aLeft);
    yes('the game\'s door lets them in again, on the new account\'s standing',
        doorAfter.obj.profiles.indexOf(700) >= 0 && doorAfter.obj.profiles.indexOf(701) >= 0);
    const after = await owns(next.table, B, 701);
    yes('and /owns calls them the new account\'s own',
        after.obj.ok === true && after.obj.why === 'theirs');
    const back = await checkIn(next.table, A, 700);
    yes('the old account coming back finds them the new account\'s: they moved, they are not shared',
        back.sent.code === 200 && back.sent.obj.claimed === false &&
        holds(back.table, B).indexOf(700) >= 0 && holds(back.table, A).indexOf(700) < 0);
  }

  /*
    Everything short of having left keeps the ids where they are. A ban from
    inside Discord takes somebody out of the server as well, so it looks like
    leaving to the member lookup, and hasLeft asks Discord's own ban list
    rather than hand a banned account's characters to the second account
    they come back on.
  */
  {
    const cases = [
      ['banned in bans.json', { inGuild: false, banned: true, play: false, roles: [] }, {}],
      ['banned from inside Discord', { inGuild: false, play: false, roles: [] }, { [A]: 200 }],
      ['whose ban the bot may not read', { inGuild: false, play: false, roles: [] }, { [A]: 403 }],
      ['Discord could not be asked about', { inGuild: false, play: false, roles: [],
                                             lookupFailed: 'rate limited by Discord' }, {}],
      ['in the Discord without the play role', { inGuild: true, play: false, roles: [] }, {}]
    ];
    for (const c of cases) {
      const over = {};
      over[A] = c[1];
      const s = await playAsB(changer, { over: over, bans: c[2], asked: [] });
      const o = await owns(s.table, B, 700, over, c[2]);
      yes('an old account ' + c[0] + ' keeps its characters, and voice still calls them its own',
          holds(s.table, B).indexOf(700) < 0 && holds(s.table, A).indexOf(700) >= 0 &&
          o.obj.ok === false && o.obj.why === 'somebody else');
    }

    // A file from before the holder rule can have one id on two accounts.
    // One of them having left frees nothing while the other is still here.
    const C = '333333333333333333';
    const two = clone(changer);
    two[C] = { id: C, name: 'name-' + C, first: 2, seen: 2, played: 2, roles: [], profiles: [700] };
    const s = await playAsB(two, { over: aLeft, bans: {}, asked: [] });
    yes('an id another account in the Discord also holds is not freed by the old one leaving',
        holds(s.table, B).indexOf(700) < 0 && holds(s.table, C).indexOf(700) >= 0 &&
        holds(s.table, A).indexOf(700) >= 0);
    yes('while the id only the departed account held is',
        holds(s.table, B).indexOf(701) >= 0 && holds(s.table, A).indexOf(701) < 0);
  }

  /*
    Asking Discord waits, and the route writes linked.json back whole, so a
    wait between reading the copy it writes and writing it would put back
    whatever another launcher checked in meanwhile. departed() is asked off
    its own copy first; this holds the route to that.
  */
  {
    const readAt = block.indexOf('const linked = jsonFile(LINKED');
    const writeAt = readAt >= 0 ? block.indexOf('putJson(LINKED', readAt) : -1;
    const between = (writeAt > readAt) ? block.slice(readAt, writeAt)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '') : null;
    yes('nothing waits between reading linked.json for the copy written back and writing it',
        between !== null && !/\bawait\b/.test(between));
    yes('and departed is asked before that read',
        readAt > 0 && block.lastIndexOf('await departed(', readAt) >= 0);
  }

  // --------------------------------------------- the shapes an id comes in
  {
    const s = await checkIn(mine, B, String(PID));
    yes('an id sent as a string is kept off the caller all the same',
        s.sent && s.sent.code === 200 && s.sent.obj.claimed === false && holds(s.table, B).indexOf(PID) < 0);
    const hand = {};
    hand[A] = { id: A, profiles: [String(PID)] };
    const t = await checkIn(hand, B, PID);
    yes('and so is one written into the file as a string',
        t.sent && t.sent.code === 200 && t.sent.obj.claimed === false && holds(t.table, B).indexOf(PID) < 0);
    const u = await checkIn(hand, A, PID);
    yes('and the holder of a string id checking in again gets it once, not a second copy as a number',
        u.sent && u.sent.obj.claimed === true &&
        holds(u.table, A).filter(function (x) { return x === PID; }).length === 1);
  }

  /*
    A file written before this change can already have one id against two
    accounts. The person who holds it checking in again keeps it, which is
    why the caller's own list is read before anybody else's, the same order
    /owns reads them in.
  */
  {
    const twice = clone(mine);
    twice[B] = { id: B, name: 'name-' + B, first: 5, seen: 5, played: 5, roles: [], profiles: [PID] };
    const a = await checkIn(twice, A, PID);
    yes('an id already against two accounts is still claimed by the first',
        a.sent && a.sent.code === 200 && a.sent.obj.claimed === true && holds(a.table, A).indexOf(PID) >= 0);
    const b = await checkIn(twice, B, PID);
    yes('and by the second',
        b.sent && b.sent.code === 200 && b.sent.obj.claimed === true && holds(b.table, B).indexOf(PID) >= 0);
  }

  // --------------------------------------------- nothing else moved
  {
    const s = await checkIn(mine, B, undefined);
    yes('a check in with no id at all is let in, as it always was',
        s.sent && s.sent.code === 200 && s.writes === 1 && holds(s.table, B).length === 0);
    yes('and claims nothing', s.sent && s.sent.obj.claimed === false);
    const banned = await checkIn(mine, B, PID, { banned: true });
    yes('a banned account is still told it is banned, before anything about ids',
        banned.sent && banned.sent.code === 403 && banned.sent.obj.why === 'banned' && banned.writes === 0);
    const nobody = await checkIn(mine, '', PID);
    yes('and a copy that is not linked is still told to link', nobody.sent && nobody.sent.code === 401);
    const after = await checkIn(mine, A, PID);
    yes('after somebody else checked in with it, the holder still claims it',
        after.sent && after.sent.code === 200 && after.sent.obj.claimed === true);
  }

  // --------------------------------------------- nowhere does it say no
  {
    // The route's only refusals are the ones about the account itself: not
    // linked, not in the Discord, banned, no role, not allowed on the dev
    // build; and 503 when Discord could not be asked at all (entry 155). A
    // 409 back in the route is the lock out coming back. Read off the
    // sendJson calls rather than the text, because the comment above the
    // check says what the 409 did.
    const codes = [];
    block.replace(/sendJson\(\s*res\s*,\s*(\d+)/g, function (m, c) { codes.push(Number(c)); return m; });
    yes('the check in route answers only 200, 401, 403 and 503, never 409',
        codes.length > 0 && codes.every(function (c) { return c === 200 || c === 401 || c === 403 || c === 503; }));
  }

  // --------------------------------------------- the same loop as /owns
  {
    const o = src.slice(src.indexOf("if (p === '/api/play/owns'"), src.indexOf("if (p === '/api/play/who'"));
    yes('/owns still refuses somebody else\'s id with the same name', /why: 'somebody else'/.test(o));
  }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL  the route threw: ' + (e && e.stack || e));
  console.log('');
  console.log(pass + ' passed, ' + (fail + 1) + ' failed');
  process.exit(1);
});
