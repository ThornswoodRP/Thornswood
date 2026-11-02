// test-5196-bot.js
//
//     node .\tests\test-5196-bot.js
//
// #5196. The bot's own parts, without a server: scripts/bot/bot.js and
// scripts/bot/character.js.
//
//  - The pass a bot signs for a server of its own, and its answer to the
//    login challenge, are what the gamemode's join pass block takes: the
//    block is lifted out of game\gamemode.js between its markers and run in a
//    vm with a stand-in mp (as test-1319-pass-switch.js does), and its own
//    readPass and loginProof judge them.
//  - The bot's login against a stand-in for the engine's createBotClient
//    that answers as the fork's login does: a challenge, then the character.
//  - The character check: a world folder with change forms, plugins with
//    TES4 headers (one light), and createActor messages that match it and
//    that do not, in each way it compares.
//
// Read only, apart from a temp folder it deletes. Nothing connects anywhere.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..');
const bot = require(path.join(ROOT, 'scripts', 'bot', 'bot.js'));
const character = require(path.join(ROOT, 'scripts', 'bot', 'character.js'));

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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-5196-'));
process.on('exit', () => { fs.rmSync(TMP, { recursive: true, force: true }); });

// ------------------------------------------- the gamemode's join pass block
const src = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
const a = src.indexOf('// ==== thornswood join pass ====');
const b = src.indexOf('// ==== end thornswood join pass ====');
yes('the join pass block is in gamemode.js between its markers', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { done(); }

const KEY = 'test-5196-key-made-for-this-test';
const PRIV = path.join(TMP, 'private');
fs.mkdirSync(PRIV);
fs.writeFileSync(path.join(PRIV, 'door.json'), JSON.stringify({ passKey: KEY }));
const logged = [];
const box = {
  console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
  require: require, Buffer: Buffer,
  Date: Date, Math: Math, Number: Number, String: String, Array: Array, Object: Object, JSON: JSON,
  setTimeout: function () { return 1; }, setInterval: function () { return 1; }, clearInterval: function () { },
  mp: {
    getServerSettings: function () { return { privDir: PRIV, thornswoodServer: 'bot', thornswoodRequirePass: true }; },
    get: function () { return []; }, getUserByActor: function () { return -1; }, kick: function () { }
  }
};
vm.createContext(box);
vm.runInContext(src.slice(a, b), box, { filename: 'gamemode.js (join pass)' });
const jp = box.__thornswoodJoinPass;

const now = Date.now();
const minted = bot.mintPass(KEY, { p: 4242, s: 'bot', v: '9.9.9', d: 'bot-4242', i: now, x: now + 600000 });
const read = jp.readPass(minted, KEY, now, 'bot');
yes('a pass the bot signs is one the gamemode reads: profile, launcher, account', read.ok === true && read.p === 4242 && read.v === '9.9.9' && read.d === 'bot-4242');
yes('a pass signed with another key is refused', jp.readPass(bot.mintPass('another key', { p: 4242, s: 'bot', i: now, x: now + 600000 }), KEY, now, 'bot').ok !== true);
yes('a pass for another server is refused', jp.readPass(bot.mintPass(KEY, { p: 4242, s: 'dev', i: now, x: now + 600000 }), KEY, now, 'bot').ok !== true);

const lk = bot.passLoginKey(KEY, minted);
const proof = jp.loginProof({ userId: 0, profileId: 4242, nonce: 'n-1', proof: { pass: minted, mac: bot.loginMac(lk, 'n-1') } }, now);
yes('the bot\'s answer to a challenge is a good login proof', proof.ok === true && proof.p === 4242 && !proof.why);
const stale = jp.loginProof({ userId: 0, profileId: 4242, nonce: 'n-2', proof: { pass: minted, mac: bot.loginMac(lk, 'n-1') } }, now);
yes('an answer made for another connection\'s challenge is not', stale.ok !== true);

// ---------------------------------------------------------- the login
// A stand-in for the engine's createBotClient, answering as the fork's
// login does (thornswoodLogin.ts, then spawn.ts and PartOne).
function engine(character) {
  const sent = [];
  let queue = [{ type: 'connectionAccepted' }];
  return {
    sent,
    createBotClient: function (host, port, password) {
      sent.push({ host, port, password });
      return {
        tick: function () { const q = queue; queue = []; return q; },
        send: function (m) {
          sent.push(m);
          const c = m.t === bot.MSG.CustomPacket ? JSON.parse(m.contentJsonDump) : {};
          if (c.customPacketType === 'loginWithSkympIo') {
            queue.push({ type: 'message', message: { t: 1, contentJsonDump: JSON.stringify({ customPacketType: 'thornswoodLoginChallenge', n: 'nonce-7' }) } });
            queue.push({ type: 'message', raw: JSON.stringify({ type: 'spSnippet', note: 'an older JSON packet' }) });
            queue.push({ type: 'message', message: character });
          }
        },
        isConnected: function () { return true; },
        destroy: function () { }
      };
    }
  };
}

const ROOM = path.join(TMP, 'room');
fs.mkdirSync(path.join(ROOM, 'world', 'changeForms'), { recursive: true });
fs.mkdirSync(path.join(ROOM, 'data'));
function plugin(name, flags) {
  const h = Buffer.alloc(24);
  h.write('TES4', 0, 'latin1');
  h.writeUInt32LE(flags, 8);
  fs.writeFileSync(path.join(ROOM, 'data', name), h);
}
plugin('Skyrim.esm', 1);
plugin('Update.esm', 1);
plugin('Little.esp', 0x201);
plugin('Thornswood-Last.esp', 0);
fs.writeFileSync(path.join(ROOM, 'server-settings.json'), JSON.stringify({
  port: 7801, dataDir: 'data', password: '',
  loadOrder: ['Skyrim.esm', 'Update.esm', 'Little.esp', 'Thornswood-Last.esp']
}));
const INV = [{ baseId: 0xf, count: 120 }, { baseId: 0x12eb7, count: 1, worn: true }];
const FORM = {
  recType: 1, formDesc: '0', baseDesc: '7:Skyrim.esm', profileId: 1909688825,
  position: [1000.5, -2000.25, 300], angle: [0, 0, 90], worldOrCellDesc: '804:Thornswood-Last.esp',
  inv: { entries: INV }, healthPercentage: 0.75, magickaPercentage: 1, staminaPercentage: 0.5,
  isDead: false, isRaceMenuOpen: false, appearanceDump: JSON.stringify({ name: 'Jeff' })
};
fs.writeFileSync(path.join(ROOM, 'world', 'changeForms', '0.json'), JSON.stringify(FORM));
fs.writeFileSync(path.join(ROOM, 'world', 'changeForms', '1.json'), JSON.stringify({ profileId: -1, isDeleted: true }));
// The engine names runtime forms in hex (FormDesc::ToString, %x, #5168), so
// slot 10 is a.json and slot 31 is 1f.json; a placed form names its plugin.
fs.writeFileSync(path.join(ROOM, 'world', 'changeForms', '1f.json'), JSON.stringify(Object.assign({}, FORM, { profileId: 4242, appearanceDump: JSON.stringify({ name: 'Hexa' }) })));
fs.writeFileSync(path.join(ROOM, 'world', 'changeForms', 'a.json'), JSON.stringify({ profileId: -1, recType: 1 }));
fs.writeFileSync(path.join(ROOM, 'world', 'changeForms', '1a2b_Skyrim.esm.json'), JSON.stringify(Object.assign({}, FORM, { profileId: 5151 })));
fs.writeFileSync(path.join(ROOM, 'world', 'changeForms', '2.json'), JSON.stringify(Object.assign({}, FORM, { profileId: 77, appearanceDump: JSON.stringify({ name: 'Other' }) })));

const GOOD = {
  t: 33, idx: 5, isMe: true,
  transform: { pos: [1000.5, -2000.25, 300], rot: [0, 0, 90], worldOrCell: 0x01000804 },
  props: { inventory: { entries: [{ count: 1, worn: true, baseId: 0x12eb7 }, { baseId: 0xf, count: 120 }] },
           healthPercentage: 0.75, magickaPercentage: 1, staminaPercentage: 0.5, isRaceMenuOpen: false },
  appearance: { name: 'Jeff' }, isDead: false
};

(async function () {
  const e = engine(GOOD);
  const b1 = new bot.Bot(e, { port: 7801, password: 'pw' });
  await b1.connect(1000);
  yes('the bot connects with the server\'s own password', b1.state === 'connected' && e.sent[0].port === 7801 && e.sent[0].password === 'pw');
  const p1 = bot.mintPass(KEY, { p: 4242, s: 'bot', v: '9.9.9', d: 'bot-4242', i: now, x: now + 600000 });
  const got = await b1.login(4242, { pass: p1, loginKey: bot.passLoginKey(KEY, p1) }, 1000);
  const loginSent = JSON.parse(e.sent[1].contentJsonDump);
  yes('the login is skymp5-client\'s: loginWithSkympIo with the profile id', e.sent[1].t === 1 && loginSent.customPacketType === 'loginWithSkympIo' && loginSent.gameData.profileId === 4242);
  const proofSent = e.sent.length > 2 ? JSON.parse(e.sent[2].contentJsonDump) : {};
  yes('the challenge is answered once, with the pass', proofSent.customPacketType === 'thornswoodLoginProof' && proofSent.pass === p1 && e.sent.length === 3);
  const judged = jp.loginProof({ userId: 0, profileId: 4242, nonce: 'nonce-7', proof: { pass: proofSent.pass, mac: proofSent.mac } }, Date.now());
  yes('and the gamemode finds that answer good', judged.ok === true && !judged.why);
  yes('the bot is sent its character', got === GOOD && b1.character === GOOD);
  yes('an older JSON-text packet is read as JSON too', b1.inbox.some((m) => m.message && m.message.type === 'spSnippet'));
  b1.close();

  const b2 = new bot.Bot(engine(GOOD), { port: 7801 });
  await b2.connect(1000);
  await b2.login(4242, null, 1000);
  yes('with no pass the challenge is not answered and the login goes on (a rehearsal server)', b2.character === GOOD && !b2.answered);
  b2.close();

  const refused = { createBotClient: () => ({ tick: () => [{ type: 'connectionDenied', error: 'Invalid password' }], send() {}, isConnected: () => false, destroy() {} }) };
  let why = '';
  try { await new bot.Bot(refused, { port: 1 }).connect(1000); } catch (err) { why = err.message; }
  yes('a refused connection says what the server said', /Invalid password/.test(why));
  const silent = { createBotClient: () => ({ tick: () => [{ type: 'connectionAccepted' }], send() {}, isConnected: () => true, destroy() {} }) };
  const b3 = new bot.Bot(silent, { port: 1 });
  await b3.connect(1000);
  why = '';
  try { await b3.login(1, null, 200); } catch (err) { why = err.message; }
  yes('a server that sends no character fails, and says so', /had no character from the server/.test(why));

  let old = '';
  try { bot.loadAddon(path.join(TMP, 'nowhere')); } catch (err) { old = err.message; }
  yes('a folder with no addon is named as not a server folder', /not a server folder/.test(old));

  // ------------------------------------------------- the character check
  const table = character.slots(character.pluginPaths(ROOM, JSON.parse(fs.readFileSync(path.join(ROOM, 'server-settings.json'), 'utf8'))));
  yes('full and light plugins are numbered apart, as the game does', table['thornswood-last.esp'].full && table['thornswood-last.esp'].index === 2 && !table['little.esp'].full && table['little.esp'].index === 0);
  yes('a form desc in a full plugin resolves to its index', character.descToId('804:Thornswood-Last.esp', table) === 0x02000804);
  yes('a form desc in a light plugin resolves to FE plus its slot', character.descToId('a12:Little.esp', table) === 0xfe000a12);
  yes('Tamriel stays 0x3c', character.descToId('3c:Skyrim.esm', table) === 0x3c);

  const want = character.expected(ROOM, 1909688825);
  yes('the character is found by profile id, past a deleted slot', want.file === '0.json' && want.name === 'Jeff' && want.port === 7801);
  const hexa = character.expected(ROOM, 4242);
  yes('a character whose file name has a letter is found too (1f.json, #5168)', hexa.file === '1f.json' && hexa.name === 'Hexa');
  let placed = '';
  try { character.expected(ROOM, 5151); } catch (err) { placed = err.message; }
  yes('a form that names a plugin is no character', /no living character/.test(placed));
  let none = '';
  try { character.expected(ROOM, 5); } catch (err) { none = err.message; }
  yes('a profile with no living character is named', /no living character/.test(none));

  const right = Object.assign({}, GOOD, { transform: Object.assign({}, GOOD.transform, { worldOrCell: 0x02000804 }) });
  const ok = character.compare(want, right);
  yes('the character as the backup holds it passes every line', ok.every((l) => l.ok === true) && ok.length === 11);

  function mutate(f) { const g = JSON.parse(JSON.stringify(right)); f(g); return character.compare(want, g); }
  function failsOn(what, lines) { return lines.some((l) => l.ok === false && l.what.indexOf(what) === 0); }
  yes('moved: position fails', failsOn('position', mutate((g) => { g.transform.pos[0] += 50; })));
  yes('another cell: world or cell fails', failsOn('world or cell', mutate((g) => { g.transform.worldOrCell = 0x3c; })));
  yes('an item gone: inventory fails', failsOn('inventory', mutate((g) => { g.props.inventory.entries.pop(); })));
  yes('a count changed: inventory fails', failsOn('inventory', mutate((g) => { g.props.inventory.entries[1].count = 119; })));
  yes('an item added: inventory fails', failsOn('inventory', mutate((g) => { g.props.inventory.entries.push({ baseId: 0xa, count: 1 }); })));
  yes('health changed: healthPercentage fails', failsOn('healthPercentage', mutate((g) => { g.props.healthPercentage = 1; })));
  yes('dead: dead fails', failsOn('dead', mutate((g) => { g.isDead = true; })));
  yes('another name: name fails', failsOn('name', mutate((g) => { g.appearance.name = 'Other'; })));
  yes('not sent as its owner\'s: isMe fails', failsOn('the server sent', mutate((g) => { g.isMe = false; })));
  const bare = character.compare(Object.assign({}, want, { inventory: undefined }), right);
  yes('a backup with no inventory says SKIP, not PASS', bare.some((l) => l.ok === null && /inventory: the backup holds none/.test(l.what)));

  done();
})().catch((err) => { console.log('FAIL  ' + (err && err.stack || err)); fail++; done(); });
