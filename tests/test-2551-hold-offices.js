'use strict';
/*
  test-2551-hold-offices.js

      node tests/test-2551-hold-offices.js

  #2551. Patrick, 15 October: the hold offices are Discord roles.
    - A Jarl's hold comes from their "Jarl of <Hold>" role.
    - If two accounts hold the same Jarl role, neither acts as Jarl until staff
      fix it, and staff are told which accounts clash.
    - Each hold has "<Hold> Court", "Steward of <Hold>" and "Guard of <Hold>"
      (bot/Build-Discord.py; bot/tests/test-2551-hold-offices.py holds the roles and
      the bot's panel).
    - That hold's Jarl gives and takes those three. In the game the Office
      page asks the site, and the bot's account sets the role, so the role
      stays the one truth.
    - The site reads the roles with the others and hands each profile its
      offices; the game reads them through officeOf.
    - Taking down a board post needs that hold's Guard or Jarl.

  Four parts, each the real code lifted out and run over stand-ins, nothing
  sent anywhere:
    S  the site: the roles read by name, /api/allowed's offices and the
       clashes (said to staff once, through moderation.log), and a Jarl's
       change from the game (changeOffice) with every refusal, and the route
       that takes it.
    D  the game server's door: the offices read off allowed.json, only for a
       proved profile, the holders by account, the clash, the list read again
       at once, and the site asked with the door's key.
    B  the property block, whole: the Jarl of a hold takes posts down on its
       board and no other, a steward keeps their own hold's board only.
    T  the names the four places spell the roles with agree.
*/
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const siteFiles = require('./site-files');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const site = siteFiles.source();
const gm = require('./gamemode-tables.js').joined(read(path.join(REPO_DIR, 'game', 'gamemode.js')));
const builder = read(path.join(REPO_DIR, 'bot', 'Build-Discord.py'));
const botSrc = read(path.join(REPO_DIR, 'bot', 'bot.py'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function toClose(text, from) {
  const b = text.indexOf('{', from);
  let d = 0;
  for (let i = b; i < text.length; i++) {
    if (text[i] === '{') { d++; }
    else if (text[i] === '}') { d--; if (d === 0) { return i + 1; } }
  }
  return -1;
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
const same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };

// ======================================================================= S
// The office block of server.js: from the roles' names to changeOffice.
const blockAt = site.indexOf('const OFFICE_HOLDS = {');
const changeAt = site.indexOf('async function changeOffice(');
const block = (blockAt >= 0 && changeAt > blockAt) ? site.slice(blockAt, toClose(site, changeAt)) : '';
yes('S0 the office block is in server.js, from the roles to changeOffice', block.length > 0 &&
    /function officesOf\(/.test(block) && /async function jarlClashes\(/.test(block) &&
    /async function officesForDoor\(/.test(block));

/*
  The block over a pretend Discord: members (id -> { name, roles: [names] }),
  or no member list at all (members null, the intent switched off), and
  linked.json. Everything it reaches outside itself is here.
*/
function siteWith(opts) {
  const env = {
    modLogged: [], writes: [], standCacheDeleted: [], memberAsked: [],
    members: opts.members === undefined ? {} : opts.members,
    linked: opts.linked || {},
    stand: opts.stand || {}
  };
  const roleIds = {};
  let next = 1000;
  const idOf = function (name) { if (!roleIds[name]) { roleIds[name] = String(next++); } return roleIds[name]; };
  (opts.roles || []).forEach(idOf);
  const names = function () { const o = {}; Object.keys(roleIds).forEach(function (n) { o[roleIds[n]] = n; }); return o; };
  const deps = {
    guildMembers: async function () {
      if (env.members === null) { return null; }
      const out = {};
      Object.keys(env.members).forEach(function (id) {
        const m = env.members[id];
        out[id] = { nick: m.name, user: { id: id }, roles: m.roles.map(idOf) };
      });
      return out;
    },
    roleNames: async function () { return names(); },
    modLog: function (row) { env.modLogged.push(row); },
    jsonFile: function (f, fallback) { return f === 'linked.json' ? JSON.parse(JSON.stringify(env.linked)) : fallback; },
    LINKED: 'linked.json',
    standCache: { delete: function (id) { env.standCacheDeleted.push(id); } },
    standGood: { delete: function () { } },
    standingCached: async function (id) {
      const s = env.stand[id];
      if (s) { return s; }
      const m = env.members && env.members[id];
      return m ? { id: id, name: m.name, roles: m.roles.slice(), play: true } : { lookupFailed: 'not asked' };
    },
    memberOf: async function (id) {
      env.memberAsked.push(id);
      const m = env.members && env.members[id];
      if (opts.memberFails) { return { ok: false, status: 0, why: 'Discord did not answer' }; }
      return m ? { ok: true, status: 200, body: { roles: m.roles.map(idOf) } } : { ok: false, status: 404, why: 'not found' };
    },
    discordWrite: async function (method, p, reason) {
      env.writes.push([method, p, reason]);
      if (opts.writeFails) { return { ok: false, status: opts.writeFails, why: 'Discord answered ' + opts.writeFails }; }
      // Discord does it: the member's roles change.
      const m = /\/members\/([^/]+)\/roles\/(\d+)$/.exec(p);
      const who = env.members[m[1]];
      const role = names()[m[2]];
      if (method === 'PUT') { who.roles.push(role); } else { who.roles = who.roles.filter(function (r) { return r !== role; }); }
      return { ok: true, status: 204 };
    },
    cfg: { discord: { guildId: 'G' } },
    membersCache: { at: 1, byId: {} }
  };
  const keys = Object.keys(deps);
  const api = new Function(keys.join(','), block +
    '\nreturn { OFFICE_ROLE: OFFICE_ROLE, officesOf: officesOf, holdsAnOffice: holdsAnOffice, ' +
    'jarlClashes: jarlClashes, officesForDoor: officesForDoor, changeOffice: changeOffice, ' +
    'accountOfProfile: accountOfProfile };')
    .apply(null, keys.map(function (k) { return deps[k]; }));
  api.env = env;
  api.roleId = idOf;
  return api;
}

(async function () {
  if (!block) { done(); return; }
  // ------------------------------------------------------- S1. the names
  {
    const S = siteWith({});
    yes('S1 each office of each hold has the role name Build-Discord.py makes',
        S.OFFICE_ROLE('jarl', 'whiterun') === 'Jarl of Whiterun' && S.OFFICE_ROLE('court', 'whiterun') === 'Whiterun Court' &&
        S.OFFICE_ROLE('steward', 'riften') === 'Steward of Riften' && S.OFFICE_ROLE('guard', 'ravenrock') === 'Guard of Raven Rock' &&
        S.OFFICE_ROLE('guard', 'narnia') === '' && S.OFFICE_ROLE('thane', 'whiterun') === '');
    const o = S.officesOf(['Playtester', 'Jarl of Whiterun', 'Guard of Riften', 'Whiterun Court', 'Steward of Markarth',
                          'Jarl of Whiterun\'s dog', 'guard of riften', 'Citizen of Whiterun']);
    yes('S2 the roles a person holds are read by exact name into their offices, and nothing else is',
        same(o, { jarl: ['whiterun'], court: ['whiterun'], steward: ['markarth'], guard: ['riften'] }));
    yes('S3 nobody with none of them holds an office', !S.holdsAnOffice(S.officesOf(['Playtester', 'Owner'])) &&
        !S.holdsAnOffice(S.officesOf(null)));
  }

  // ------------------------------------------------ S4. /api/allowed's offices
  {
    const S = siteWith({
      members: { A: { name: 'Ann', roles: ['Jarl of Whiterun'] }, B: { name: 'Bo', roles: ['Guard of Whiterun'] },
                 C: { name: 'Cy', roles: [] } },
      linked: { A: { profiles: [11, 12] }, B: { profiles: [21] }, C: { profiles: [31] } }
    });
    const answers = new Map([['A', { roles: ['Jarl of Whiterun'] }], ['B', { roles: ['Guard of Whiterun'] }],
                             ['C', { roles: [] }]]);
    const out = { offices: {}, people: [{ id: 'A', profiles: [11, 12] }, { id: 'B', profiles: [21] }, { id: 'C', profiles: [31] }] };
    const clash = await S.officesForDoor(out, answers, S.env.linked);
    yes('S4 every profile of an account let in carries the account\'s offices, and nobody else is named',
        same(out.offices['11'].jarl, ['whiterun']) && same(out.offices['12'].jarl, ['whiterun']) &&
        same(out.offices['21'].guard, ['whiterun']) && !out.offices['31'] && clash.length === 0);
    const out2 = { offices: {}, people: [{ id: 'B', profiles: [21] }] };
    await S.officesForDoor(out2, answers, S.env.linked);
    yes('S5 an account the route left out (the dev door, a ban) gets nothing', !out2.offices['11'] && !!out2.offices['21']);
    yes('S5 and no clash means nothing said to staff', S.env.modLogged.length === 0);
  }

  // ---------------------------------------------------- S6. one Jarl a hold
  {
    const S = siteWith({
      members: { A: { name: 'Ann', roles: ['Jarl of Whiterun', 'Guard of Riften'] },
                 B: { name: 'Bo', roles: ['Jarl of Whiterun'] },
                 Z: { name: 'Zed', roles: ['Jarl of Riften'] } },
      linked: { A: { profiles: [11] }, B: { profiles: [21, 22] }, Z: { profiles: [91] } }
    });
    const answers = new Map([['A', { roles: ['Jarl of Whiterun', 'Guard of Riften'] }], ['B', { roles: ['Jarl of Whiterun'] }],
                             ['Z', { roles: ['Jarl of Riften'] }]]);
    const out = { offices: {}, people: [{ id: 'A', profiles: [11] }, { id: 'B', profiles: [21, 22] }, { id: 'Z', profiles: [91] }] };
    const clash = await S.officesForDoor(out, answers, S.env.linked);
    yes('S6 two accounts holding the Jarl of Whiterun role is a clash, naming both and every profile of theirs',
        clash.length === 1 && clash[0].hold === 'whiterun' && same(clash[0].people.map(function (p) { return p.id; }), ['A', 'B']) &&
        same(clash[0].profiles, [11, 21, 22]));
    yes('S7 and neither acts as its Jarl: the hold comes off both, the rest of their offices stay',
        !out.offices['11'].jarl.length && same(out.offices['11'].guard, ['riften']) && !out.offices['21'] && !out.offices['22'] &&
        same(out.offices['91'].jarl, ['riften']));
    yes('S8 staff are told once, in moderation.log, which accounts clash',
        S.env.modLogged.length === 1 && S.env.modLogged[0].did === 'jarlclash' && S.env.modLogged[0].role === 'Jarl of Whiterun' &&
        same(S.env.modLogged[0].people, [{ id: 'A', name: 'Ann' }, { id: 'B', name: 'Bo' }]));
    await S.officesForDoor({ offices: {}, people: [] }, answers, S.env.linked);
    yes('S9 the next refresh with the same clash says nothing more', S.env.modLogged.length === 1);
    S.env.members.B.roles = [];
    await S.officesForDoor({ offices: {}, people: [] }, new Map(), S.env.linked);
    yes('S10 and when staff take the role from one, staff are told the hold has one Jarl again, once',
        S.env.modLogged.length === 2 && S.env.modLogged[1].did === 'jarlclear' && S.env.modLogged[1].role === 'Jarl of Whiterun');
    const cached = answers.get('A');
    yes('S11 the clash never changes the cached answer it read the roles from', same(cached.roles, ['Jarl of Whiterun', 'Guard of Riften']));
  }
  {
    // A second holder who never played still counts, from the member list.
    const S = siteWith({
      members: { A: { name: 'Ann', roles: ['Jarl of Whiterun'] }, N: { name: 'New', roles: ['Jarl of Whiterun'] } },
      linked: { A: { profiles: [11] } }
    });
    const out = { offices: {}, people: [{ id: 'A', profiles: [11] }] };
    const clash = await S.officesForDoor(out, new Map([['A', { roles: ['Jarl of Whiterun'] }]]), S.env.linked);
    yes('S12 a second holder who has never played still makes it a clash', clash.length === 1 && !out.offices['11']);
  }
  {
    // No member list (the intent off): the accounts the door asked about.
    const S = siteWith({ members: null, linked: { A: { profiles: [11] }, B: { profiles: [21] } } });
    const answers = new Map([['A', { roles: ['Jarl of Whiterun'], name: 'Ann' }], ['B', { roles: ['Jarl of Whiterun'], name: 'Bo' }]]);
    const out = { offices: {}, people: [{ id: 'A', profiles: [11] }, { id: 'B', profiles: [21] }] };
    const clash = await S.officesForDoor(out, answers, S.env.linked);
    yes('S13 with no member list it counts the accounts the door asked about', clash.length === 1 && !out.offices['11']);
  }

  // ------------------------------------------- S14. a Jarl's change from the game
  {
    const roles = ['Jarl of Whiterun', 'Whiterun Court', 'Steward of Whiterun', 'Guard of Whiterun', 'Guard of Riften'];
    const world = function (extra) {
      return siteWith(Object.assign({
        roles: roles,
        members: { J: { name: 'Balgruuf', roles: ['Jarl of Whiterun'] }, P: { name: 'Proventus', roles: [] },
                   O: { name: 'Other', roles: [] } },
        linked: { J: { profiles: [11] }, P: { profiles: [21, 22] }, X: { profiles: [31] } }
      }, extra || {}));
    };
    const ask = function (S, o) {
      return S.changeOffice(Object.assign({ by: 11, byName: 'Balgruuf', who: 22, whoName: 'Proventus',
                                            office: 'guard', hold: 'whiterun', give: true }, o || {}), 'main');
    };
    let S = world();
    let r = await ask(S);
    yes('S14 the Jarl of Whiterun gives a guard of Whiterun: the role is put on the account the character is on',
        r.ok === true && /Proventus holds Guard of Whiterun now/.test(r.said) && S.env.writes.length === 1 &&
        S.env.writes[0][0] === 'PUT' && S.env.writes[0][1] === '/guilds/G/members/P/roles/' + S.roleId('Guard of Whiterun'));
    yes('S14 with the reason Discord\'s audit log keeps', S.env.writes[0][2] === 'Given by Balgruuf, Jarl of Whiterun, in the game');
    yes('S15 the Jarl was asked fresh, and the next read of the person is Discord\'s new answer',
        S.env.standCacheDeleted.indexOf('J') !== -1 && S.env.standCacheDeleted.indexOf('P') !== -1);
    yes('S16 staff are told who changed what, through moderation.log',
        S.env.modLogged.length === 1 && S.env.modLogged[0].did === 'office' && S.env.modLogged[0].give === true &&
        S.env.modLogged[0].role === 'Guard of Whiterun' && S.env.modLogged[0].by === 11 && S.env.modLogged[0].who === 22 &&
        S.env.modLogged[0].byName === 'Balgruuf' && S.env.modLogged[0].whoName === 'Proventus' && S.env.modLogged[0].from === 'main');
    r = await ask(S);
    yes('S17 giving it again changes nothing, and says so', r.ok === false && /already holds Guard of Whiterun/.test(r.said) &&
        S.env.writes.length === 1);
    r = await ask(S, { give: false });
    yes('S18 taking it back takes the role off', r.ok === true && S.env.writes[1][0] === 'DELETE' &&
        S.env.writes[1][2] === 'Taken by Balgruuf, Jarl of Whiterun, in the game');
    r = await ask(S, { give: false });
    yes('S19 and taking it from somebody without it says so', r.ok === false && /does not hold Guard of Whiterun/.test(r.said));
    r = await ask(S, { hold: 'riften' });
    yes('S20 the Jarl of Whiterun gives nothing in Riften', r.ok === false && r.said === 'Only the Jarl of Riften gives its offices.' &&
        S.env.writes.length === 2);
    r = await ask(S, { by: 21 });
    yes('S21 nor does somebody with no Jarl role', r.ok === false && r.said === 'Only the Jarl of Whiterun gives its offices.');
    r = await ask(S, { office: 'jarl' });
    yes('S22 a Jarl gives no Jarl role, and nothing that is not one of the three',
        r.ok === false && /Court, a Steward and Guards/.test(r.said) &&
        (await ask(S, { office: 'thane' })).ok === false && S.env.writes.length === 2);
    r = await ask(S, { who: 77 });
    yes('S23 a character linked to no account has nobody for the role to go to', r.ok === false && /not linked/.test(r.said));
    r = await ask(S, { by: 77 });
    yes('S24 nor can an unlinked character be Jarl', r.ok === false && /not linked/.test(r.said));
    r = await ask(S, { who: 31 });
    yes('S25 somebody who has left the Discord is said to be gone', r.ok === false && /is not in the Discord/.test(r.said));
    S = world();
    S.env.members.T = { name: 'Two', roles: ['Jarl of Whiterun'] };
    r = await ask(S);
    yes('S26 while two accounts hold the Jarl of Whiterun role, neither gives anything, and staff are said to know',
        r.ok === false && /Two Discord accounts hold the Jarl of Whiterun role, so neither acts as Jarl/.test(r.said) &&
        S.env.writes.length === 0);
    S = world({ roles: ['Jarl of Whiterun'] });
    r = await ask(S, { office: 'court' });
    yes('S27 a role the Discord does not have yet is said, by name', r.ok === false &&
        r.said === 'There is no Whiterun Court role in the Discord yet. Staff make it with the Discord builder.');
    S = world({ writeFails: 403 });
    r = await ask(S);
    yes('S28 a role above the bot\'s own is said as that, and nothing is told to staff',
        r.ok === false && /its own role has to sit above it/.test(r.said) && S.env.modLogged.length === 0);
    S = world({ memberFails: true });
    r = await ask(S);
    yes('S29 Discord not answering is said, and nothing is retried', r.ok === false && /could not be asked just now/.test(r.said) &&
        S.env.memberAsked.length === 1 && S.env.writes.length === 0);
    S = world({ stand: { J: { lookupFailed: 'rate limited by Discord' } } });
    r = await ask(S);
    yes('S30 nor is anything done when the Jarl\'s own roles cannot be read', r.ok === false && /could not be asked/.test(r.said) &&
        S.env.writes.length === 0);
    S = world({ stand: { J: { banned: true, roles: ['Jarl of Whiterun'] } } });
    r = await ask(S);
    yes('S31 a banned Jarl gives nothing', r.ok === false && r.said === 'Only the Jarl of Whiterun gives its offices.');
  }

  // ------------------------------------------------ S32. the two routes
  {
    const allowedAt = site.indexOf("if ((route === '/api/allowed' || devDoor) && req.method === 'GET') {");
    const allowed = allowedAt < 0 ? '' : site.slice(allowedAt, toClose(site, allowedAt));
    const run = async function (linked, standings, extra) {
      let sent = null;
      const S = siteWith({ members: null, linked: linked });
      const f = new Function('route', 'devDoor', 'req', 'res', 'cfg', 'url', 'sameSecret', 'sendJson', 'jsonFile', 'LINKED',
        'standingCached', 'keyInAddress', 'standingsForDoor', 'activeBans', 'pkProfiles', 'officesForDoor',
        'return (async function () {\n' + allowed + '\n})();');
      await f('/api/allowed', false, { method: 'GET', headers: { 'x-thornswood-key': 'k' } }, {}, { botKey: 'k' }, null,
        function (a, b) { return a === b; }, function (r, c, b) { sent = JSON.parse(JSON.stringify(b)); },
        function () { return linked; }, 'linked.json', null, new Set(),
        async function (ids) { return new Map(ids.map(function (id) { return [id, standings[id]]; })); },
        function () { const b = (extra && extra.bans) || []; if (extra && extra.broken) { b.broken = true; } return b; },
        function () { return (extra && extra.pk) || []; }, S.officesForDoor);
      return sent;
    };
    const linked = { A: { profiles: [11] }, B: { profiles: [21] } };
    const st = { A: { play: true, roles: ['Playtester', 'Jarl of Whiterun'], name: 'Ann' },
                 B: { play: true, roles: ['Playtester', 'Guard of Whiterun'], name: 'Bo' } };
    let out = await run(linked, st);
    yes('S32 /api/allowed hands the door each profile\'s offices and the clashes, and no jarlProfiles',
        !!out && same(out.offices['11'].jarl, ['whiterun']) && same(out.offices['21'].guard, ['whiterun']) &&
        Array.isArray(out.jarlClash) && !('jarlProfiles' in out));
    out = await run(linked, st, { pk: [21] });
    yes('S33 a character killed for good holds no office in the answer', !!out.offices['11'] && !out.offices['21']);
    out = await run(linked, st, { broken: true });
    yes('S34 and a broken ban list lets nobody through, offices included', same(out.offices, {}));

    const officeAt = site.indexOf("if ((route === '/api/office' || route === '/dev/api/office') && req.method === 'POST') {");
    const office = officeAt < 0 ? '' : site.slice(officeAt, toClose(site, officeAt));
    const post = async function (route, headers, text) {
      let sent = null;
      const asked = [];
      const f = new Function('route', 'req', 'cfg', 'sameSecret', 'sendJson', 'body', 'changeOffice', 'res',
        'return (async function () {\n' + office + '\n})();');
      await f(route, { method: 'POST', headers: headers }, { botKey: 'k' }, function (a, b) { return a === b; },
        function (r, c, b) { sent = { code: c, body: b }; }, async function () { return text; },
        async function (o, server) { asked.push([o, server]); return { ok: true, said: 'done' }; }, {});
      return { sent: sent, asked: asked };
    };
    let p = await post('/api/office', {}, '{}');
    yes('S35 /api/office answers nobody without the door\'s key, and changes nothing', p.sent.code === 401 && p.asked.length === 0);
    p = await post('/api/office', { 'x-thornswood-key': 'nope' }, '{}');
    yes('S35 nor with the wrong one', p.sent.code === 401 && p.asked.length === 0);
    p = await post('/dev/api/office', { 'x-thornswood-key': 'k' }, '{"office":"guard"}');
    yes('S36 with the key it hands the request on, saying which server asked', p.sent.code === 200 &&
        p.asked.length === 1 && p.asked[0][1] === 'dev' && p.asked[0][0].office === 'guard');
    p = await post('/api/office', { 'x-thornswood-key': 'k' }, 'not json');
    yes('S37 a body that is not JSON is refused in words', p.sent.code === 400 && p.asked.length === 0 && !!p.sent.body.said);
  }

  // ===================================================================== D
  {
    const d0 = gm.indexOf('// ==== thornswood door ====');
    const d1 = gm.indexOf('// ==== end thornswood door ====');
    yes('D0 the door is in gamemode.js between its markers', d0 >= 0 && d1 > d0);
    const files = {};
    const allowedFile = path.join('private', 'allowed.json');
    files[path.join('private', 'door.json')] = JSON.stringify({ site: 'https://site.invalid/dev', key: 'door-key' });
    files[allowedFile] = JSON.stringify({ enforce: false, profiles: [11, 12, 21, 31, 32],
      offices: { 11: { jarl: ['whiterun'], court: [], steward: [], guard: [] },
                 21: { jarl: [], court: [], steward: ['whiterun'], guard: ['riften', 'narnia'] },
                 22: { jarl: [], court: [], steward: ['whiterun'], guard: ['riften'] },
                 x: { jarl: ['whiterun'] } },
      jarlClash: [{ hold: 'riften', profiles: [31, 32], people: [{ id: 'C', name: 'Cy' }, { id: 'D', name: 'Di' }] },
                  { hold: 'narnia', profiles: [33] }],
      people: [{ id: 'A', name: 'Ann', profiles: [11, 12] }, { id: 'B', name: 'Bo', profiles: [21, 22] }] });
    const sent = { requests: [], gets: [] };
    let answerWith = { ok: true, said: 'Bo holds Guard of Whiterun now.' };
    const fakeFs = {
      readFileSync: function (p) { if (!Object.prototype.hasOwnProperty.call(files, p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[p]; },
      writeFileSync: function (p, s) { files[p] = String(s); }, appendFileSync: function () { }, existsSync: function () { return true; },
      mkdirSync: function () { }, statSync: function () { return { mtimeMs: 0 }; }
    };
    const respond = function (status, bodyText, cb) {
      const handlers = {};
      const resp = { statusCode: status, on: function (ev, f) { handlers[ev] = f; return resp; } };
      cb(resp);
      if (handlers.data) { handlers.data(bodyText); }
      if (handlers.end) { handlers.end(); }
    };
    const fakeHttps = {
      get: function (url, options, cb) {
        sent.gets.push([url, options]);
        // The door asks once as it loads; that one is left unanswered, so the
        // list read below is the one written here.
        if (!sent.answerGets) { return { on: function () { }, setTimeout: function () { } }; }
        respond(200, JSON.stringify({ profiles: [11, 21], offices: { 21: { jarl: [], court: [], steward: [], guard: ['whiterun'] } },
                                      jarlClash: [] }), cb);
        return { on: function () { }, setTimeout: function () { } };
      },
      request: function (options, cb) {
        const req = { body: '', on: function () { return req; }, setTimeout: function () { },
                      end: function (data) { req.body = data; sent.requests.push([options, data]);
                                             respond(200, JSON.stringify(answerWith), cb); } };
        return req;
      }
    };
    const notes = [];
    const trusted = { 11: true, 21: true, 31: true };
    const box = {
      console: { log: function (l) { notes.push(String(l)); }, error: function () { } },
      require: function (m) { if (m === 'fs') { return fakeFs; } if (m === 'path') { return path; } if (m === 'https') { return fakeHttps; } return {}; },
      Buffer: Buffer, Date: Date, Math: Math, Number: Number, String: String, Array: Array, Object: Object, JSON: JSON, URL: URL,
      setTimeout: function () { return 1; }, setInterval: function () { return 1; }, clearInterval: function () { }, clearTimeout: function () { },
      mp: { getServerSettings: function () { return {}; }, get: function () { return []; }, kick: function () { },
            // The engine's whole-file write (#2740), onto the fake disk.
            writeFileWhole: function (p, s) { fakeFs.writeFileSync(p, s); } }
    };
    box.globalThis = box;
    box.__thornswoodPassTrusts = function (pid) { return !!trusted[pid]; };
    vm.createContext(box);
    let ran = true;
    try { vm.runInContext(gm.slice(d0, d1), box, { filename: 'gamemode.js (door)' }); } catch (e) { ran = false; console.log('      ' + e); }
    yes('D1 the door block runs over a stand-in server, with the office answers',
        ran && typeof box.__thornswoodOffices === 'function' && typeof box.__thornswoodOfficeHolders === 'function' &&
        typeof box.__thornswoodJarlClash === 'function' && typeof box.__thornswoodAskSite === 'function' &&
        typeof box.__thornswoodDoorReadNow === 'function' && typeof box.__thornswoodIsJarl === 'undefined');
    if (ran) {
      yes('D2 a proved profile has its offices, read field by field: a hold that is not one of the ten is dropped',
          same(box.__thornswoodOffices(11).jarl, ['whiterun']) && same(box.__thornswoodOffices(21).guard, ['riften']) &&
          same(box.__thornswoodOffices(21).steward, ['whiterun']));
      yes('D3 a profile the pass has not proved has none, though the list names it',
          box.__thornswoodOffices(22).steward.length === 0 && box.__thornswoodOfficesOnRecord(22).steward.join() === 'whiterun');
      const h = box.__thornswoodOfficeHolders('steward', 'whiterun');
      yes('D4 the holders of an office are one row an account, with every profile of it',
          h.length === 1 && h[0].account === 'B' && same(h[0].profiles.sort(), [21, 22]) &&
          box.__thornswoodOfficeHolders('court', 'whiterun').length === 0 && box.__thornswoodOfficeHolders('thane', 'x').length === 0);
      yes('D5 the clash names the hold to each of its profiles, and a hold that is not one of the ten is dropped',
          same(box.__thornswoodJarlClash(31), ['riften']) && box.__thornswoodJarlClash(11).length === 0 &&
          box.__thornswoodJarlClash(33).length === 0);
      yes('D6 the door\'s log says the clash once', notes.filter(function (l) { return /Jarl role of riften/.test(l); }).length === 1);
      let got = null;
      box.__thornswoodAskSite('/api/office', { by: 11, who: 21, office: 'guard', hold: 'whiterun', give: true },
        function (why, doc) { got = [why, doc]; });
      const req = sent.requests[0] || [{}, ''];
      yes('D7 the site is asked by POST at the door\'s own site, the dev one under /dev, with the key in a header and never the address',
          req[0].method === 'POST' && req[0].hostname === 'site.invalid' && req[0].path === '/dev/api/office' &&
          req[0].headers['X-Thornswood-Key'] === 'door-key' && !/door-key/.test(req[0].path) &&
          JSON.parse(req[1]).office === 'guard');
      yes('D8 and hears the site\'s answer', !!got && got[0] === '' && got[1].ok === true);
      yes('D8b the door says which account a profile is on, and that it has a list of the roles (#2551, an office is one character\'s)',
          box.__thornswoodAccountOf(22) === 'B' && box.__thornswoodAccountOf(99) === '' && box.__thornswoodRolesKnown() === true);
      let readOk = null;
      let heard = 0;
      box.__thornswoodRolesRead = function () { heard++; };
      sent.answerGets = true;
      box.__thornswoodDoorReadNow(function (ok) { readOk = ok; });
      yes('D9b and once the new list is written, whoever keeps which character holds an office reads it', heard === 1);
      const written = JSON.parse(files[allowedFile]);
      yes('D9 reading the list now fetches it once, writes it, and says so', readOk === true && sent.gets.length >= 1 &&
          same(written.offices['21'].guard, ['whiterun']) && Array.isArray(written.jarlClash) && !('jarlProfiles' in written));
      delete files[path.join('private', 'door.json')];
      let gone = null;
      box.__thornswoodAskSite('/api/office', {}, function (why) { gone = why; });
      yes('D10 a server whose door names no site says so, and asks nothing', /no door\.json/.test(gone) && sent.requests.length === 1);
    }
  }

  // ===================================================================== B
  {
    const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
    const clock = { t: Date.UTC(2026, 9, 16, 7, 0, 0) };
    class FakeDate extends Date { static now() { return clock.t; } }
    const GOLD = 0x0000000F;
    const JARL_W = { a: 0xff000101, pid: 101, name: 'Balgruuf' };
    const JARL_R = { a: 0xff000202, pid: 202, name: 'Laila' };
    const STEW_R = { a: 0xff000303, pid: 303, name: 'Anuriel' };
    const ALICE = { a: 0xff000404, pid: 404, name: 'Alice' };
    const PEOPLE = [JARL_W, JARL_R, STEW_R, ALICE];
    const ROLES = { 101: { jarl: ['whiterun'] }, 202: { jarl: ['riften'] }, 303: { steward: ['riften'] } };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2551-'));
    fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
    fs.mkdirSync(path.join(dir, 'private'));
    // Which character holds each office (#2551, Patrick, 16 Oct).
    fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: { 'jarl:whiterun': { 'p:101': { pid: 101, name: 'Balgruuf' } }, 'jarl:riften': { 'p:202': { pid: 202, name: 'Laila' } }, 'steward:riften': { 'p:303': { pid: 303, name: 'Anuriel' } } } }));
    const T = clock.t - 3600000;
    fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({
      claims: {}, boxes: {},
      boards: { whiterun: { cell: '3c:Skyrim.esm', pos: [0, 0, 0], where: 'Whiterun', placed: true },
                riften: { cell: '3c:Skyrim.esm', pos: [100000, 0, 0], where: 'Riften', placed: true } },
      funds: { whiterun: 40, riften: 20 },
      notices: {
        whiterun: [{ by: ALICE.pid, name: 'Alice', title: 'Lost: a grey cat', text: 'Grey.', at: T, job: false, taken: 0 },
                   { by: ALICE.pid, name: 'Alice', title: 'Selling a cart', text: 'Cheap.', at: T, job: false, taken: 0 }],
        riften: [{ by: ALICE.pid, name: 'Alice', title: 'Selling a horse', text: 'A good one.', at: T, job: false, taken: 0 }]
      }
    }));
    const inDir = function (f) { const was = process.cwd(); process.chdir(dir); try { return f(); } finally { process.chdir(was); } };
    const refs = {};
    PEOPLE.forEach(function (p) {
      refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: '3c:Skyrim.esm', pos: [50, 0, 0],
                    inventory: { entries: [{ baseId: GOLD, count: 100 }] } };
    });
    const mp = {
      makeProperty: function () { },
      get: function (id, key) {
        if (id === 0 && key === 'onlinePlayers') { return PEOPLE.map(function (p) { return p.a; }); }
        if (!refs[id]) { throw new Error('no reference ' + id); }
        const v = refs[id][key];
        return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
      },
      set: function (id, key, v) { if (!refs[id]) { refs[id] = {}; } refs[id][key] = JSON.parse(JSON.stringify(v)); },
      getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
      lookupEspmRecordById: function () { return null; },
      getNeighborsByPosition: function () { return []; }
    };
    const logged = [];
    const box = {
      console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
      require: require, mp: mp, Date: FakeDate,
      BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
      idOf: function () { return 0; }, notify: function () { }, say: function () { },
      guard: function (n, f) { return f; }, setInterval: function () { return 1; }, clearInterval: function () { },
      log: function () { },
      __thornswoodCharacter: { stateOf: function () { return { prof: 'cook' }; }, writeState: function () { } },
      __thornswoodOffices: function (pid) {
        const o = ROLES[pid] || {};
        return { jarl: o.jarl || [], court: o.court || [], steward: o.steward || [], guard: o.guard || [] };
      }
    };
    box.globalThis = box;
    inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
    const W = box.__thornswoodProperty;
    yes('B0 the property block runs with the offices read from the roles', !!W && typeof W.officeOf === 'function');
    if (W) {
      const boards = W.boards();
      const standAt = function (p, hold) { const b = boards[hold]; refs[p.a].pos = [b.pos[0] + 50, b.pos[1], b.pos[2]]; };
      const word = function (p, w, args) {
        const by = {};
        inDir(function () { W.command(w, [w].concat(args || []), p.a, p.pid, function (pid, m) { (by[pid] = by[pid] || []).push(m); }); });
        return { mine: (by[p.pid] || []).join(' '), by: by };
      };
      const panel = function (p) { let v = null; inDir(function () { v = W.boardPanel(p.a, p.pid); }); return v; };
      PEOPLE.forEach(function (p) { standAt(p, 'whiterun'); });
      yes('B1 at Whiterun\'s board its Jarl has Take down on every post, Riften\'s Jarl does not',
          panel(JARL_W).guard === true && panel(JARL_R).guard === false && panel(ALICE).guard === false);
      let r = word(JARL_R, '/unpin', ['1']);
      yes('B2 Riften\'s Jarl takes nothing down at Whiterun\'s board', /not yours to take down/.test(r.mine) &&
          !W.notices().whiterun[0].down);
      r = word(JARL_W, '/unpin', ['1']);
      yes('B3 Whiterun\'s Jarl takes Alice\'s notice down there (' + r.mine + ')',
          !!W.notices().whiterun[0].down && /You take Alice's notice down\./.test(r.mine));
      yes('B4 and Alice is told it was the Jarl', (r.by[ALICE.pid] || []).some(function (m) { return /^The Jarl took your notice in whiterun down\./.test(m); }));
      yes('B5 and the server log names the Jarl and the hold',
          logged.some(function (l) { return /law: the Jarl of whiterun \(Balgruuf, profile 101\) took down Alice's notice 1/.test(l); }));
      standAt(JARL_W, 'riften');
      r = word(JARL_W, '/unpin', ['1']);
      yes('B6 and nothing at Riften\'s board', /not yours to take down/.test(r.mine) && !W.notices().riften[0].down);
      refs[STEW_R.a].pos = [7, 7, 7];
      r = word(STEW_R, '/board', ['move', 'whiterun']);
      yes('B7 the Steward of Riften does not move Whiterun\'s board', boards.whiterun.pos[0] === 0 &&
          /Whiterun's board\. Its Steward or its Jarl moves it\./.test(r.mine));
      yes('B8 officeOf says what the roles say, and the Steward of Riften keeps Riften alone',
          same(W.officeOf(STEW_R.pid).stewardOf, ['riften']) && W.officeOf(STEW_R.pid).jarl === false &&
          same(W.officeOf(JARL_W.pid).stewardOf, ['whiterun']));
    }
  }

  // ===================================================================== T
  {
    const towns = (/HOLDS = \[([^\]]+)\]/.exec(builder) || [])[1] || '';
    // Raven Rock is one of the builder's HOLDS since #3317 (Patrick, 22 Oct,
    // page card q-3317-raven-rock, A): ten holds, all of them the site's.
    const ten = towns.split(',').map(function (s) { return s.trim().replace(/'/g, ''); }).filter(Boolean);
    const siteTowns = /const OFFICE_HOLDS = \{([^}]+)\}/.exec(site);
    yes('T1 every hold the Discord builder makes roles for is a hold the site reads, by the same town name',
        ten.length === 10 && ten[9] === 'Raven Rock' && !!siteTowns && ten.every(function (t) { return siteTowns[1].indexOf("'" + t + "'") !== -1; }));
    yes('T2 the builder, the site and the bot spell the three offices the same way',
        /_h \+ ' Court'/.test(builder) && /'Steward of ' \+ _h/.test(builder) && /'Guard of ' \+ _h/.test(builder) &&
        /return town \+ ' Court';/.test(site) && /return 'Steward of ' \+ town;/.test(site) && /return 'Guard of ' \+ town;/.test(site) &&
        /return town \+ ' Court'/.test(botSrc) && /return 'Steward of ' \+ town/.test(botSrc) && /return 'Guard of ' \+ town/.test(botSrc));
    // Raven Rock (Patrick, 16 Oct, B): its Jarl and its three offices are made like the nine, and the
    // game's offices, its board and its drop box are of the same ten holds.
    const ledger = (/var LEDGER_HOLDS = \[([^\]]+)\]/.exec(gm) || [])[1] || '';
    const holdTown = (/var HOLD_TOWN = \{([^}]+)\}/.exec(gm) || [])[1] || '';
    yes('T4 Raven Rock\'s Jarl and offices are made, and the game reads them for its board and its drop box',
        /OFFICE_HOLDS = list\(HOLDS\)/.test(builder) && ten.indexOf('Raven Rock') !== -1 && /for _h in OFFICE_HOLDS:/.test(builder) &&
        /ravenrock: 'Raven Rock'/.test(holdTown) && /'ravenrock'/.test(ledger) && /ravenrock: 'Raven Rock'/.test(siteTowns ? siteTowns[1] : ''));
    yes('T3 and the game names them the same way to people',
        /return town \+ ' Court';/.test(gm) && /return 'Steward of ' \+ town;/.test(gm) && /return 'Guard of ' \+ town;/.test(gm));
  }
  done();
})().catch(function (e) { console.log('FAIL  the harness threw: ' + (e && e.stack || e)); fail++; done(); });
