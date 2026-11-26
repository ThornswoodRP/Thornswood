// test-play-characters.js
//
// Each Discord account's characters are kept by the site (#5938), so a
// reinstall or another PC finds them again. Until this the list of which
// profile ids were somebody's, with play time, lived only in the launcher's
// Profile\Characters\profiles.txt.
//
// Runs site\lib\characters.js itself, and the /api/play/characters route
// lifted out of the site with stand-ins for the files, Discord and the reply,
// the way test-play-join.js runs /api/play/join. Then reads the launcher:
// Chars.cs asks the route and writes no list of its own.
//
// And each game server's list apart from the other's (#6904), and each door
// reading only its own (#6906): main's and dev's characters are two worlds,
// and nothing on one list is read for the other.
//
// Read only. Nothing here touches linked.json.
const fs = require('fs');
const path = require('path');
const siteFiles = require('./site-files');
const chars = require('../site/lib/characters');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
const none = { slots: 2, pk: () => false, revived: () => false };

// ---- the module ---------------------------------------------------------------

{
  const linked = { '101': { id: '101', profiles: [] } };
  const said = chars.settle(linked, '101', 'main', none);
  const a = linked['101'];
  yes('a new account gets a spare minted by the site', a.spare >= 1000 && Array.isArray(a.chars) && a.chars.length === 0);
  yes('and the spare is on the door\'s list for that account', a.profiles.indexOf(a.spare) >= 0);
  yes('and nothing is said about it', said.length === 0);

  const spare = a.spare;
  yes('picking the spare at the menu is allowed', chars.choose(linked, '101', 'main', spare, 5000) === null);
  chars.settle(linked, '101', 'main', none);
  yes('it becomes the character in slot 1, played now',
      a.chars.length === 1 && a.chars[0].id === spare && a.chars[0].slot === 1 && a.chars[0].played === 5000);
  yes('and a new spare is minted behind it', a.spare > 0 && a.spare !== spare);
  yes('and both are on the door\'s list', a.profiles.indexOf(spare) >= 0 && a.profiles.indexOf(a.spare) >= 0);

  yes('an hour of play is counted', chars.played(linked, '101', 'main', spare, 3600, 9000) === null &&
      a.chars[0].seconds === 3600 && a.chars[0].played === 9000);
  yes('half a minute is not', chars.played(linked, '101', 'main', spare, 30, 9500) !== null && a.chars[0].seconds === 3600);
  yes('more than a day is not', chars.played(linked, '101', 'main', spare, 90000, 9500) !== null && a.chars[0].seconds === 3600);

  const second = a.spare;
  chars.choose(linked, '101', 'main', second, 10000);
  chars.settle(linked, '101', 'main', none);
  yes('a second new character takes slot 2', a.chars.find((c) => c.id === second).slot === 2);

  yes('forgetting the first works', chars.forget(linked, '101', 'main', spare) === null);
  chars.settle(linked, '101', 'main', none);
  yes('it leaves the list and is retired', !a.chars.find((c) => c.id === spare) && a.retired.indexOf(spare) >= 0);
  yes('slot 2 stays where it was', a.chars.find((c) => c.id === second).slot === 2);
  yes('a forgotten character cannot be picked back', chars.choose(linked, '101', 'main', spare, 11000) !== null);
  yes('the spare cannot be forgotten', chars.forget(linked, '101', 'main', a.spare) !== null);

  const third = a.spare;
  chars.choose(linked, '101', 'main', third, 12000);
  chars.settle(linked, '101', 'main', none);
  yes('the next new character takes the free slot 1, the lowest', a.chars.find((c) => c.id === third).slot === 1);
}

{
  // Somebody else's id, and one the door already holds for this account.
  const linked = { '101': { id: '101', profiles: [777] }, '102': { id: '102', profiles: [888] } };
  chars.settle(linked, '101', 'main', none);
  yes('another account\'s id is not taken', chars.choose(linked, '101', 'main', 888, 1) !== null &&
      !linked['101'].chars.find((c) => c.id === 888));
  yes('an id the door already holds for this account becomes a character',
      chars.choose(linked, '101', 'main', 777, 1) === null && linked['101'].chars.find((c) => c.id === 777).slot === 1);
}

{
  // Minting never hands out an id anybody holds, had, or retired.
  const linked = { '101': { id: '101', profiles: [1000] }, '102': { id: '102', chars: [{ id: 1001, slot: 1 }], retired: [1002], spare: 1003 } };
  let n = 0;
  const id = chars.mintId(linked, () => n++);
  yes('a minted id skips held, played, retired and spare ids', id === 1004);
}

{
  // Dead for good, brought back, and the allowance.
  const linked = { '101': { id: '101', profiles: [1, 2, 3], spare: 50,
                        chars: [{ id: 1, slot: 1 }, { id: 2, slot: 2 }, { id: 3, slot: 3 }] } };
  const said = chars.settle(linked, '101', 'main', { slots: 2, pk: (id) => id === 1, revived: () => false });
  const a = linked['101'];
  yes('a character staff killed leaves its slot', a.chars.find((c) => c.id === 1).slot === chars.DEAD);
  yes('and the one above the allowance comes down into it', a.chars.find((c) => c.id === 3).slot === 1);
  yes('and both are said', said.length === 2);
  yes('the dead cannot be picked', chars.choose(linked, '101', 'main', 1, 1) !== null);
  chars.settle(linked, '101', 'main', { slots: 3, pk: () => false, revived: (id) => id === 1 });
  yes('a PK an admin undid puts it back in a free slot', a.chars.find((c) => c.id === 1).slot === 3);
  const ans = chars.answer(linked, '101', 'main', 3);
  yes('the answer lists characters in slot order', ans.chars.map((c) => c.id).join(',') === '3,2,1' && ans.spare === 50);
}

{
  // The door's list keeps every character however many other ids came and went.
  const row = { chars: [{ id: 1, slot: 1 }], spare: 2 };
  const kept = chars.keepProfiles([1, 2, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], row);
  yes('the door keeps the characters, the spare and the last eight others',
      kept.join(',') === '1,2,12,13,14,15,16,17,18,19');
  yes('with no characters it is the last eight, as before', chars.keepProfiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {}).join(',') === '3,4,5,6,7,8,9,10');
}

{
  // One list for each game server (#6904). Patrick, 26 Nov: main characters
  // showed on dev "with a message that they are no longer on the server",
  // and the bin on one took them off the other.
  const linked = { '101': { id: '101', profiles: [] } };
  chars.settle(linked, '101', 'main', none);
  chars.settle(linked, '101', 'dev', none);
  const a = linked['101'];
  yes('each server has a spare of its own', a.spare > 0 && a.dev.spare > 0 && a.spare !== a.dev.spare);
  const onMain = a.spare;
  chars.choose(linked, '101', 'main', onMain, 1000);
  chars.settle(linked, '101', 'main', none);
  yes('a character made on main is on main\'s list', chars.answer(linked, '101', 'main', 2).chars.map((c) => c.id).join() === String(onMain));
  yes('and not on dev\'s', chars.answer(linked, '101', 'dev', 2).chars.length === 0);
  yes('dev cannot pick it, even though the door holds it for this account',
      a.profiles.indexOf(onMain) >= 0 && chars.choose(linked, '101', 'dev', onMain, 2000) === 'that character is on the other server' &&
      a.dev.chars.length === 0);
  const onDev = a.dev.spare;
  chars.choose(linked, '101', 'dev', onDev, 3000);
  chars.settle(linked, '101', 'dev', none);
  yes('a character made on dev is on dev\'s list only',
      a.dev.chars.map((c) => c.id).join() === String(onDev) && !a.chars.some((c) => c.id === onDev));
  yes('main cannot pick it either', chars.choose(linked, '101', 'main', onDev, 4000) === 'that character is on the other server');
  yes('the bin on dev does not know main\'s character', chars.forget(linked, '101', 'dev', onMain) !== null &&
      a.chars.some((c) => c.id === onMain) && a.dev.retired.indexOf(onMain) < 0);
  yes('the bin on dev takes the dev character off dev\'s list alone', chars.forget(linked, '101', 'dev', onDev) === null &&
      a.dev.chars.length === 0 && a.dev.retired.indexOf(onDev) >= 0 && a.retired.indexOf(onDev) < 0 &&
      a.chars.some((c) => c.id === onMain));
  yes('play time goes to the server it was played on', chars.played(linked, '101', 'dev', onMain, 600, 5000) !== null &&
      chars.played(linked, '101', 'main', onMain, 600, 5000) === null && a.chars[0].seconds === 600);
  yes('the door holds the characters and spares of both servers',
      [onMain, a.spare, a.dev.spare].every((n) => a.profiles.indexOf(n) >= 0));
  // Each door lets in its own server's characters and spare, never the
  // account's whole profiles list (#6906).
  yes('main\'s door ids are main\'s characters and spare alone',
      chars.doorIds(a, 'main').slice().sort().join() === [onMain, a.spare].sort().join());
  yes('dev\'s door ids are dev\'s spare alone once its character is binned', chars.doorIds(a, 'dev').join() === String(a.dev.spare));
  yes('a row with no lists lets nothing in, whatever it checked in', chars.doorIds({ profiles: [5, 6] }, 'main').length === 0 &&
      chars.doorIds({ profiles: [5, 6] }, 'dev').length === 0 && chars.doorIds(undefined, 'main').length === 0);
  const leaver = { profiles: [70, 71], chars: [{ id: 70, slot: 1 }], dev: { chars: [{ id: 71, slot: 1 }] } };
  const newer = { profiles: [], chars: [{ id: 80, slot: 1 }] };
  yes('an id taken over from an account that left moves on the list that holds it',
      chars.takeOver(leaver, newer, 70) && chars.takeOver(leaver, newer, 71) &&
      chars.doorIds(newer, 'main').join() === '80,70' && chars.doorIds(newer, 'dev').join() === '71' &&
      chars.doorIds(leaver, 'main').length === 0 && chars.doorIds(leaver, 'dev').length === 0);
  yes('and an id on no list moves nothing', chars.takeOver(leaver, newer, 99) === false);
  let n = 0;
  const taken = { '102': { id: '102', chars: [{ id: 1000, slot: 1 }], spare: 1001, dev: { chars: [{ id: 1002, slot: 1 }], retired: [1003], spare: 1004 } } };
  yes('an id is never minted that either server of any account uses', chars.mintId(taken, () => n++) === 1005);
  yes('anything that is not dev is main', chars.serverKey('dev') === 'dev' && chars.serverKey('main') === 'main' &&
      chars.serverKey('') === 'main' && chars.serverKey(undefined) === 'main' && chars.serverKey('DEV') === 'main');
}

// ---- the route ----------------------------------------------------------------

const CR = String.fromCharCode(13);
const src = siteFiles.source().split(CR).join('');
const HEAD = "  if (p === '/api/play/characters' && req.method === 'POST') {";
const at = src.indexOf(HEAD);
let route = '';
if (at >= 0) {
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { route = src.slice(at, i + 1); break; } }
  }
}
yes('the site has the /api/play/characters route', !!route);
yes('the site loads characters.js', siteFiles.files().indexOf('lib/characters.js') >= 0);

const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
async function ask(files, ticket, req, standing) {
  let sent = null;
  const env = {
    p: '/api/play/characters', req: { method: 'POST' }, res: {},
    body: async function () { return JSON.stringify(Object.assign({ ticket }, req)); },
    PLAY_ANSWER_MS: 1000, PLAY_BODY_MS: 1000,
    passBodyFailure: function (e) { throw e; },
    readTicket: function (s) { return s ? { d: String(s), n: 'n' } : null; },
    within: async function (p) { return p; },
    standingCached: async function () { return Object.assign({ play: true, banned: false, roles: [] }, standing || {}); },
    standingLate: function () { return { lookupFailed: 'late' }; },
    discordUnasked: function () { return { ok: false, why: 'discord' }; },
    accountBanned: function () { return 'banned'; },
    notAcceptedYet: function () { return 'not yet'; },
    jsonFile: function (f, d) { return f in files ? clone(files[f]) : d; },
    putJson: function (f, v) { files[f] = clone(v); return true; },
    LINKED: 'linked.json', PK: 'pk.json',
    characterBar: function () { return null; },
    pkActive: function (r) { return !!r && !r.undone; },
    slotsFor: function () { return 2; },
    chars,
    sendJson: function (r, c, o) { sent = { code: c, obj: o }; return sent; }
  };
  const names = Object.keys(env);
  await new AsyncFunction(names.join(','), route + '\nreturn null;').apply(null, names.map((n) => env[n]));
  return sent;
}

(async function () {
  if (route) {
    const files = { 'linked.json': {} };
    const first = await ask(files, '201', {});
    yes('an account with no list gets one, with a spare and no characters',
        first.code === 200 && first.obj.ok && first.obj.spare > 0 && first.obj.chars.length === 0);
    yes('and it is written to linked.json under the Discord id', files['linked.json']['201'] &&
        files['linked.json']['201'].spare === first.obj.spare);
    const picked = await ask(files, '201', { op: 'chose', profileId: first.obj.spare });
    yes('picking the spare answers the character in slot 1 and a new spare',
        picked.obj.ok && picked.obj.chars.length === 1 && picked.obj.chars[0].slot === 1 &&
        picked.obj.spare !== first.obj.spare);
    // A second PC: nothing local, the same Discord account.
    const elsewhere = await ask(files, '201', {});
    yes('the same account on another PC gets the same character back',
        elsewhere.obj.chars.length === 1 && elsewhere.obj.chars[0].id === first.obj.spare);
    const other = await ask(files, '202', { op: 'chose', profileId: first.obj.spare });
    yes('another account cannot pick it', other.obj.ok === false && other.obj.chars.length === 0);
    const odd = await ask(files, '201', { op: 'wipe' });
    yes('an op the site does not know is a 400', odd.code === 400);
    const noTicket = await ask(files, '', {});
    yes('no ticket is a 401', noTicket.code === 401);
    const notAnId = await ask(files, '__proto__', {});
    yes('a ticket whose id is not a Discord id is a 401, and linked.json gains no row', notAnId.code === 401 &&
        Object.keys(files['linked.json']).every((k) => /^[0-9]+$/.test(k)));
    yes('accountKey takes digits only', chars.accountKey('201') === '201' && chars.accountKey('__proto__') === '' &&
        chars.accountKey('') === '' && chars.accountKey(null) === '' && chars.accountKey('12a') === '');
    const devFirst = await ask(files, '201', { channel: 'dev' });
    yes('the dev launcher gets dev\'s list, without main\'s character', devFirst.code === 200 &&
        devFirst.obj.server === 'dev' && devFirst.obj.chars.length === 0 && devFirst.obj.spare > 0 &&
        devFirst.obj.spare !== elsewhere.obj.spare);
    const devPick = await ask(files, '201', { channel: 'dev', op: 'chose', profileId: first.obj.spare });
    yes('and cannot pick main\'s character on dev', devPick.obj.ok === false && devPick.obj.chars.length === 0);
    const devForget = await ask(files, '201', { channel: 'dev', op: 'forget', profileId: first.obj.spare });
    const mainAfter = await ask(files, '201', { channel: 'main' });
    yes('the bin on dev leaves main\'s character on main\'s list', devForget.obj.ok === false &&
        mainAfter.obj.server === 'main' && mainAfter.obj.chars.length === 1 && mainAfter.obj.chars[0].id === first.obj.spare);
    const banned = await ask(files, '201', {}, { banned: true });
    yes('a banned account is refused', banned.code === 403);
    const late = await ask(files, '201', {}, { lookupFailed: 'rate limited' });
    yes('Discord not answering is a 503, not a no', late.code === 503);
  }

  // ---- the launcher -------------------------------------------------------------
  const cs = fs.readFileSync(path.join(__dirname, '..', 'launcher', 'app', 'Chars.cs'), 'utf8');
  yes('Chars.cs asks /api/play/characters', cs.indexOf('/api/play/characters') >= 0);
  yes('Chars.cs keeps no profiles.txt or retired.txt', !/profiles\.txt|retired\.txt/.test(cs.replace(/\/\/.*$/gm, '').replace(/\/\/\/.*$/gm, '')));
  yes('Chars.cs mints no ids of its own', !/RandomNumberGenerator|NextProfileId/.test(cs));
  yes('Chars.cs names the server it plays on with every ask (#6904)',
      /json\.Append\(",\\"channel\\":\\""\)\.Append\(Discord\.Escape\(string\.IsNullOrEmpty\(Discord\.Channel\) \? "main" : Discord\.Channel\)\)/.test(cs));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
