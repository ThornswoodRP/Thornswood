// test-audit-handlers.js
//
// What a client can ask the server, written down, and the two handlers that
// watch a take and a drop without ever refusing one.
//
// The To Do List entry "The gamemode registers four event handlers, so nothing
// server-side watches for griefing": "Establish what the client is allowed to
// ask the server to do and block the rest at the handler level, then log what
// was allowed." This checks the list and the log. Which take to refuse was
// Patrick's decision, made on 28 September (issue #475), and the take limit
// that holds it has its own harness, tests\test-take-limit.js.
//
// WHAT MATTERS MOST IS THAT THEY ANSWER NOTHING, apart from the one refusal
// the take limit makes. ScampServerListener reads undefined as "let it
// through" and false as "refuse", so a watcher that answered false on any
// other path would shut chests for everybody at once. Every case below checks
// the answer is exactly undefined, including the ones where every read the
// handler makes throws, and checks nothing was written. T10 checks the one
// false comes only from the take limit, and that a limit that throws lets the
// take through.
//
// It drives the REAL guard() and the REAL watchers out of gamemode.js over a
// fake mp. Where the fork is on this
// machine it also checks the list against the fork itself; on a machine
// without it those checks say SKIP.
//
// THE FORK CHECK READS EVERY NAME, NOT ONLY THE EASY ONES. The first version
// collected event names with one pattern for `return "onX";` and passed while
// the fork raised a whole family it could not see: PapyrusEventEvent builds its
// name when it fires, onPapyrusEvent:<Name>, and that family is the one that
// hears hits and spells. So now every GetName in gamemode_events is read, a
// literal is an event, the two families built at runtime are named and checked
// one by one, and any other GetName is a failure rather than a silence. The
// same goes for every call that sends a Papyrus event: each name it can send is
// read, and a call whose name cannot be read fails.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
// The fork is the engine/skymp submodule (scripts/release/Where.ps1 has the
// same rule; the old folder outside the repository went on 28 September).
const FORK = process.env.SKYMP || path.join(REPO_DIR, 'engine', 'skymp');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function skip(what) { console.log('SKIP  ' + what); }

function lift(from, to) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(to, a);
  return b < 0 ? null : src.slice(a, b + to.length);
}

// From `from`, past `anchor`, to the first `to` after the anchor.
function liftThrough(from, anchor, to) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(anchor, a);
  if (b < 0) { return null; }
  const c = src.indexOf(to, b);
  return c < 0 ? null : src.slice(a, c + to.length);
}

// The fifteen events with a fixed name: eleven read out of
// skymp5-server/cpp/server_guest_lib/gamemode_events on 24 September,
// onSpellCast, which skymp #86 added for Overcharge (#2848), onDying,
// which skymp #101 added to ask before a death (#1626), onCraftWork, which
// fork #115 added for the time a craft takes (#3161), and
// onEquipItemAttempt, which the fork added to ask before an item goes on
// (#2262). The last two came with the pin at c5e01b53 (#4896).
const EVENTS = ['onActivate', 'onCraft', 'onCraftWork', 'onDeath', 'onDropItem', 'onDying', 'onEatItem',
                'onEquipItemAttempt', 'onPutItem', 'onReadBook', 'onRespawn', 'onSpellCast', 'onTakeItem',
                'onUpdateAppearanceAttempt', 'onUpdateEquipmentAttempt'];
// The Papyrus family: the engine calls mp['onPapyrusEvent:' + name] for each
// of these. They are the server half of the fork's event list,
// records\papyrus-events.json (issue #503), read out of every
// SendPapyrusEvent call in the fork by scripts\dev\PapyrusEventList.js.
const PAPYRUS_PREFIX = 'onPapyrusEvent:';
const PAPYRUS = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'records', 'papyrus-events.json'), 'utf8')).server.sends;
// The console commands the client forwards, consoleCommandsService.ts.
const CONSOLE = ['additem', 'equipitem', 'placeatme', 'disable', 'mp'];

// guard() counts its time through countSpent() since #385, so both are lifted.
const guardSrc = lift('function guard(name, fn) {', '\n}\n') &&
  lift('function guard(name, fn) {', '\n}\n') + '\n' + (lift('function countSpent(name, began) {', '\n}\n') || '');
const auditSrc = liftThrough('function auditProfile(refrId) {', 'mp.onDropItem = guard(', '\n});');
const handlersSrc = liftThrough('mp.onTakeItem = guard(', 'mp.onDropItem = guard(', '\n});');
const listSrc = lift('  WHAT A CLIENT CAN ASK THIS SERVER, AND WHAT IT IS TOLD.', '*/');
// The list with its line breaks and indents folded, so a phrase that wraps
// in the comment can be looked for as one phrase.
const listFlat = listSrc === null ? null : listSrc.replace(/\s+/g, ' ');

yes('guard() is in the gamemode', guardSrc !== null);
yes('the take and drop watchers are in the gamemode', auditSrc !== null && handlersSrc !== null);
yes('and so is the list of what a client can ask', listSrc !== null);

// ------------------------------------------------------------ the handlers --

// Every handler this file registers, by the line that registers it: mp.onX,
// mp._x (a custom event), and mp['...'] (the only way to write a Papyrus
// family name, which has a colon in it).
const registered = [];
src.split('\n').forEach(function (line, i) {
  let m = /^mp\.((?:on|_)[\w$]*)\s*=(?!=)\s*(.*)$/.exec(line);
  if (!m) {
    const b = /^mp\[(['"])([^'"]+)\1\]\s*=(?!=)\s*(.*)$/.exec(line);
    if (b) { m = [b[0], b[2], b[3]]; }
  }
  if (m) { registered.push({ name: m[1], rest: m[2], line: i }); }
});

function isFamilyName(name) {
  return name.indexOf(PAPYRUS_PREFIX) === 0 &&
         PAPYRUS.indexOf(name.slice(PAPYRUS_PREFIX.length)) !== -1;
}

// A handler's body, from its line to the first line that closes it.
function bodyOf(h) {
  const lines = src.split('\n');
  const out = [];
  for (let i = h.line; i < lines.length; i++) {
    out.push(lines[i]);
    if (i > h.line && /^\}\);/.test(lines[i])) { break; }
  }
  return out.join('\n');
}

yes('more than the four handlers the entry counted, ' + registered.length + ' of them',
    registered.length > 4);
yes('every one of them is built with guard() under its own name',
    registered.length > 0 && registered.every(function (h) {
      return h.rest.indexOf("guard('" + h.name + "', function") === 0;
    }));
yes('every one is an event the fork actually raises, so none of them is a handler that never fires',
    registered.every(function (h) {
      return EVENTS.indexOf(h.name) !== -1 || isFamilyName(h.name);
    }));
yes('no mp._ function, which is what the list says answers every custom event',
    registered.every(function (h) { return h.name.charAt(0) !== '_'; }));
yes('onTakeItem is registered', registered.some(function (h) { return h.name === 'onTakeItem'; }));
yes('onDropItem is registered', registered.some(function (h) { return h.name === 'onDropItem'; }));
yes('and each event is registered once, so a later line cannot quietly replace an earlier one',
    registered.every(function (h, i) {
      return registered.findIndex(function (o) { return o.name === h.name; }) === i;
    }));

// The list says nothing may ever return false to the Papyrus family or to the
// two attempt events. None is registered today; this is here so the first one
// that is gets read.
const neverFalse = registered.filter(function (h) {
  return h.name.indexOf(PAPYRUS_PREFIX) === 0 ||
         h.name === 'onUpdateAppearanceAttempt' || h.name === 'onUpdateEquipmentAttempt';
});
yes('no handler on the Papyrus family or an attempt event returns false (' +
    (neverFalse.length ? neverFalse.map(function (h) { return h.name; }).join(', ') : 'none registered') + ')',
    neverFalse.every(function (h) { return !/\breturn\s+false\b/.test(bodyOf(h)); }));

if (handlersSrc !== null) {
  // Bound quest items refuse before diagnostics. Other drops pass, and other
  // takes retain the original take-limit refusal and otherwise pass.
  const dropSrc = handlersSrc.slice(handlersSrc.indexOf('mp.onDropItem = guard('));
  const takeSrc = handlersSrc.slice(0, handlersSrc.indexOf('mp.onDropItem = guard('));
  // One more refusal is read and allowed: the pair of Prisoner's Cuffs locked on a
  // prisoner's wrists (#2573, mayLetGo), which refuses that pair and nothing else.
  const CUFFS_DROP = 'if (cuffsDrop && !cuffsDrop.mayLetGo(actorId, baseId, count)) { return false; }';
  yes('the cuffs\' refusal is in the drop watcher at most once',
      dropSrc.split(CUFFS_DROP).length <= 2);
  yes('the drop watcher only refuses bound or unverifiable quest-item identities, and the cuffs on a prisoner',
      (dropSrc.split(CUFFS_DROP).join('').match(/\breturn\b/g)||[]).length===1 && /if\(questItemBlocked\(baseId\)\)return false;/.test(dropSrc));
  yes('the take watcher refuses quest items and the original take limit',
      (takeSrc.match(/\breturn\b/g) || []).length === 2 &&
      /if\(questItemBlocked\(baseId\)\)return false;/.test(takeSrc) &&
      /if \(no\) \{[\s\S]*?return false;\s*\}/.test(takeSrc) &&
      takeSrc.indexOf('__thornswoodTakeLimit') !== -1);
}

// ---------------------------------------------------------------- the list --

if (listSrc !== null) {
  yes('the list names all fifteen events with a fixed name',
      EVENTS.every(function (e) { return listSrc.indexOf(e) !== -1; }));
  yes('the list names the Papyrus family by the name the engine looks up',
      listSrc.indexOf("mp['" + PAPYRUS_PREFIX + "<Name>']") !== -1);
  yes('the list names every Papyrus event the fork sends',
      PAPYRUS.every(function (p) { return new RegExp('\\b' + p + '\\b').test(listSrc); }));
  yes('the list gives OnHit its arguments in the order the engine passes them',
      listFlat.indexOf('(target, aggressor, weapon or spell, null, power, sneak, bash, blocked)') !== -1);
  yes('the list gives OnSpellCast its arguments', listFlat.indexOf('OnSpellCast A cast') !== -1 &&
      listFlat.indexOf('(caster, spell)') !== -1);
  yes('the list says a false on the Papyrus family refuses nothing',
      /A FALSE HERE REFUSES NOTHING/.test(listSrc) &&
      listFlat.indexOf('nothing here may ever return false to this family') !== -1);
  yes('the list no longer says a hit raises no event',
      !/hits?\s+raises?\s+no\s+event/i.test(listFlat) &&
      listFlat.indexOf('hits, spell casts') === -1);
  yes('the list still says a hit or a spell cannot be refused here',
      listFlat.indexOf('cannot refuse a hit or a spell') !== -1);
  yes('the list names all five console commands',
      CONSOLE.every(function (c) { return new RegExp('\\b' + c + '\\b').test(listSrc); }));
  yes('the list says where item creation is refused', /EnsureAdmin/.test(listSrc));
  yes('the list says what Patrick decided and that only the take limit refuses',
      listFlat.indexOf('Patrick decided on 28 September') !== -1 &&
      listFlat.indexOf('THE TAKE LIMIT below is that and nothing more') !== -1);
}

// Two older comments said the same wrong thing about casts, and one counted
// four hooks. Nothing anywhere in the file says either any more.
yes('no comment in the gamemode says the server cannot see a spell being cast',
    !/cannot\s+see\s+a\s+spell/i.test(src));
yes('and none counts four event hooks', !/four\s+event\s+hooks/i.test(src));

// ------------------------------------------------------------- the fork --

function readFork(rel) {
  try { return fs.readFileSync(path.join(FORK, rel), 'utf8').split(CR).join(''); } catch (e) { return null; }
}

// C++ with its comments taken out, so a commented-out call is not counted and
// a name in a comment is not read as code. Strings are kept whole.
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') { i++; }
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { i++; }
      i += 2;
    } else if (c === '"' || (c === '\'' && !/[0-9A-Za-z_]/.test(text[i - 1] || ''))) {
      // A quote straight after a digit or a letter is a digit separator
      // (1'000) or the end of a prefix, not the start of a character.
      const q = c;
      out += c; i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') { out += text[i]; i++; }
        out += text[i]; i++;
      }
      out += q; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

// From an opening brace to the brace that closes it.
function braceBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') { depth++; }
    else if (text[i] === '}') { depth--; if (depth === 0) { return text.slice(open + 1, i); } }
  }
  return null;
}

// The first argument of a call, from just after its opening parenthesis to
// the first comma or closing parenthesis at the same depth.
function firstArg(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === '\\') { i++; } i++; }
    } else if (c === '(') { depth++; }
    else if (c === ')') { if (depth === 0) { return text.slice(start, i).trim(); } depth--; }
    else if (c === ',' && depth === 0) { return text.slice(start, i).trim(); }
  }
  return null;
}

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { walk(p, out); }
    else if (/\.(cpp|h)$/.test(d.name)) { out.push(p); }
  });
  return out;
}

// Every GetName in gamemode_events, read.
const eventsDir = path.join(FORK, 'skymp5-server', 'cpp', 'server_guest_lib', 'gamemode_events');
let getNames = null;
try {
  getNames = [];
  fs.readdirSync(eventsDir).forEach(function (f) {
    if (!/\.(cpp|h)$/.test(f)) { return; }
    const body = stripComments(fs.readFileSync(path.join(eventsDir, f), 'utf8'));
    const re = /GetName\(\)\s*const(?:\s+override)?\s*\{/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const inner = braceBody(body, m.index + m[0].length - 1);
      const r = inner === null ? null : /return\s+([^;]+);/.exec(inner);
      getNames.push({ file: f, expr: r ? r[1].trim() : null });
    }
  });
} catch (e) {
  getNames = null;
}

if (getNames === null) {
  skip('the fork is not on this machine, so the event list is not checked against it');
} else {
  const literal = [], runtime = [];
  getNames.forEach(function (g) {
    const lit = g.expr === null ? null : /^"(on[A-Za-z]+)"$/.exec(g.expr);
    if (lit) { literal.push(lit[1]); } else { runtime.push(g); }
  });
  literal.sort();
  yes('the fifteen fixed names are exactly the ones the fork raises (' + literal.join(', ') + ')',
      JSON.stringify(literal) === JSON.stringify(EVENTS.slice().sort()));

  // The two families whose name is built when they fire, each checked by what
  // its own source says the name is.
  const papyrusCpp = readFork('skymp5-server/cpp/server_guest_lib/gamemode_events/PapyrusEventEvent.cpp');
  const listenerCpp = readFork('skymp5-server/cpp/server_guest_lib/ActionListener.cpp');
  const KNOWN = {
    'PapyrusEventEvent.cpp': function (g) {
      return g.expr === 'eventNameFull.data()' && papyrusCpp !== null &&
             papyrusCpp.indexOf('eventNameFull += "' + PAPYRUS_PREFIX + '";') !== -1;
    },
    'CustomEvent.cpp': function (g) {
      return g.expr === 'eventName.c_str()' && listenerCpp !== null &&
             /msg\.eventName\[0\]\s*!=\s*'_'/.test(listenerCpp);
    }
  };
  const unread = runtime.filter(function (g) { return !(KNOWN[g.file] && KNOWN[g.file](g)); });
  yes('every other GetName is one of the two families the list names, none the check cannot read' +
      (unread.length ? ' (cannot read: ' + unread.map(function (g) { return g.file + ' ' + g.expr; }).join('; ') + ')' : ''),
      unread.length === 0);
  yes('and both families are there: the Papyrus family as ' + PAPYRUS_PREFIX + '<Name>, custom events under an underscore',
      runtime.some(function (g) { return g.file === 'PapyrusEventEvent.cpp'; }) &&
      runtime.some(function (g) { return g.file === 'CustomEvent.cpp'; }));
}

// Every name a Papyrus event can be sent under, read off every call in the
// server's C++. A call written X::SendPapyrusEvent( is a definition or a
// forward and carries no name of its own; BeforeSendPapyrusEvent is a hook.
// The one call allowed a name it does not spell out is the hand-off to the
// Papyrus scripts in PapyrusEventEvent.cpp, WorldState::SendPapyrusEvent,
// which takes the form first and the name second.
const cppDir = path.join(FORK, 'skymp5-server', 'cpp');
let sends = null;
try {
  sends = { names: [], unread: [] };
  walk(cppDir, []).forEach(function (file) {
    if (!/\.cpp$/.test(file)) { return; }
    const body = stripComments(fs.readFileSync(file, 'utf8'));
    const re = /(^|[^\w:])SendPapyrusEvent\s*\(/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const arg = firstArg(body, m.index + m[0].length);
      const names = (arg || '').match(/"([A-Za-z]+)"/g) || [];
      if (names.length) {
        names.forEach(function (s) { sends.names.push(s.replace(/"/g, '')); });
      } else if (!(path.basename(file) === 'PapyrusEventEvent.cpp' && arg === 'form')) {
        sends.unread.push(path.basename(file) + ' ' + arg);
      }
    }
  });
  sends.names = sends.names.filter(function (n, i, a) { return a.indexOf(n) === i; }).sort();
} catch (e) {
  sends = null;
}

if (sends === null) {
  skip('the fork is not on this machine, so the Papyrus names are not checked against it');
} else {
  yes('the Papyrus names are exactly the ones the fork sends (' + sends.names.join(', ') + ')',
      JSON.stringify(sends.names) === JSON.stringify(PAPYRUS.slice().sort()));
  yes('and no call sends a Papyrus event under a name the check cannot read' +
      (sends.unread.length ? ' (' + sends.unread.join('; ') + ')' : ''),
      sends.unread.length === 0);
}

// What the list says about the Papyrus family, checked in the source it was
// read out of.
const mpForm = readFork('skymp5-server/cpp/server_guest_lib/MpForm.cpp');
const papyrusEv = readFork('skymp5-server/cpp/server_guest_lib/gamemode_events/PapyrusEventEvent.cpp');
const actionListener = readFork('skymp5-server/cpp/server_guest_lib/ActionListener.cpp');
if (mpForm === null || papyrusEv === null || actionListener === null) {
  skip('the fork is not on this machine, so what a false does to the Papyrus family is not checked against it');
} else {
  yes('MpForm::SendPapyrusEvent throws away what Fire returns, so a false there refuses nothing',
      /^\s*papyrusEventEvent\.Fire\(parent\);/m.test(mpForm));
  yes('and PapyrusEventEvent has no OnFireBlocked of its own, so a false does nothing but skip the scripts',
      !/OnFireBlocked/.test(papyrusEv) && /OnFireSuccess[\s\S]*worldState->SendPapyrusEvent\(form,/.test(papyrusEv));

  const onHitSend = (function () {
    const a = actionListener.indexOf('void ActionListener::SendPapyrusOnHitEvent(');
    if (a < 0) { return null; }
    const b = actionListener.indexOf('\n}', a);
    return b < 0 ? null : actionListener.slice(a, b);
  })();
  yes('OnHit carries aggressor, weapon or spell, projectile, power, sneak, bash and blocked, in that order',
      onHitSend !== null &&
      /args\[0\][\s\S]*?akAggressor[\s\S]*?args\[1\][\s\S]*?akSource[\s\S]*?args\[2\][\s\S]*?akProjectile[\s\S]*?args\[3\][\s\S]*?abPowerAttack[\s\S]*?args\[4\][\s\S]*?abSneakAttack[\s\S]*?args\[5\][\s\S]*?abBashAttack[\s\S]*?args\[6\][\s\S]*?abHitBlocked/.test(onHitSend) &&
      /args\[2\]\s*=\s*VarValue::None\(\)/.test(onHitSend));

  const weaponHit = (function () {
    const a = actionListener.indexOf('void ActionListener::OnWeaponHit(');
    if (a < 0) { return null; }
    const b = actionListener.indexOf('\n}', a);
    return b < 0 ? null : actionListener.slice(a, b);
  })();
  yes('a weapon hit raises OnHit before the attack speed check, the block and the damage',
      weaponHit !== null && weaponHit.indexOf('SendPapyrusOnHitEvent(') !== -1 &&
      weaponHit.indexOf('SendPapyrusOnHitEvent(') < weaponHit.indexOf('CanHit(') &&
      weaponHit.indexOf('SendPapyrusOnHitEvent(') < weaponHit.indexOf('isHitBlocked = true') &&
      weaponHit.indexOf('SendPapyrusOnHitEvent(') < weaponHit.indexOf('CalculateDamage('));

  const spellCast = (function () {
    const a = actionListener.indexOf('void ActionListener::OnSpellCast(');
    if (a < 0) { return null; }
    const b = actionListener.indexOf('\n}', a);
    return b < 0 ? null : actionListener.slice(a, b);
  })();
  yes('a cast raises OnSpellCast only after it has gone out to everybody nearby, and not for an interrupt',
      spellCast !== null &&
      spellCast.indexOf('SendToNeighbours(') < spellCast.indexOf('"OnSpellCast"') &&
      spellCast.indexOf('interruptCast') < spellCast.indexOf('"OnSpellCast"'));
}

const cmds = readFork('skymp5-client/src/services/services/consoleCommandsService.ts');
if (cmds === null) {
  skip('the fork\'s client is not on this machine, so the console commands are not checked against it');
} else {
  const m = /type\s+CmdName\s*=\s*([^;]+);/.exec(cmds);
  const named = m ? (m[1].match(/"([a-z]+)"/g) || []).map(function (s) { return s.replace(/"/g, ''); }).sort() : [];
  yes('the five console commands are exactly the ones the client forwards (' + named.join(', ') + ')',
      JSON.stringify(named) === JSON.stringify(CONSOLE.slice().sort()));
}

const forms = readFork('skymp5-server/cpp/server_guest_lib/MpChangeForms.h');
if (forms === null) {
  skip('the fork is not on this machine, so the -1 profile id is not checked against it');
} else {
  yes('an actor nobody plays starts at profile id -1 in the fork, which is why a person is above zero',
      /int32_t\s+profileId\s*=\s*-1\s*;/.test(forms));
}

// ----------------------------------------------------------- driving them --

const ALICE = 0xff000058;
const BOB = 0xff000060;
const CHEST = 0x000a1b2c;
const BANDIT = 0x0001a2b3;
const BOX = 0x0000aaaa;
const ORE = 0x00071cf3;
const GOLD = 0x0000000f;
const BREEZEHOME = '165a7:Skyrim.esm';

function world(opts) {
  opts = opts || {};
  const lines = [], errors = [], writes = [];
  const refs = {};
  refs[ALICE] = { profileId: 101, appearance: { name: 'Alice' }, worldOrCellDesc: BREEZEHOME };
  refs[BOB] = { profileId: 202, appearance: { name: 'Bob' }, worldOrCellDesc: BREEZEHOME };
  // What the engine answers for a container: no profile id at all.
  refs[CHEST] = { profileId: undefined, baseDesc: 'd9f2:Skyrim.esm' };
  // And for an NPC: -1, straight out of its change form.
  refs[BANDIT] = { profileId: -1, appearance: null, baseDesc: '1e7d5:Skyrim.esm' };
  refs[BOX] = { profileId: undefined, baseDesc: 'd9f2:Skyrim.esm' };
  const descs = {};
  descs[ORE] = '71cf3:Skyrim.esm';
  descs[GOLD] = 'f:Skyrim.esm';

  const mp = {
    get: function (id, prop) {
      if (opts.everyReadThrows) { throw new Error('no such reference'); }
      if (!Object.prototype.hasOwnProperty.call(refs, id)) { throw new Error('no reference ' + id); }
      return refs[id][prop];
    },
    getDescFromId: function (id) {
      if (opts.everyReadThrows) { throw new Error('no descriptor'); }
      return descs[id] || '';
    },
    set: function () { writes.push(Array.prototype.slice.call(arguments)); }
  };
  const fakeLog = function () {
    if (opts.logThrows) { throw new Error('disk full'); }
    lines.push(Array.prototype.slice.call(arguments).join(' '));
  };
  const fakeConsole = {
    log: function () { },
    error: function (m) { errors.push(String(m)); }
  };
  const g = {};
  if (opts.prop) { g.__thornswoodProperty = opts.prop; }
  if (opts.takeLimit) { g.__thornswoodTakeLimit = opts.takeLimit; }
  const make = new Function('mp', 'log', 'console', 'globalThis',
                            require('./fixtures/ordinary-quest-items') + guardSrc + '\n' + auditSrc + '\nreturn mp;');
  make(mp, fakeLog, fakeConsole, g);
  return {
    take: function () { return mp.onTakeItem.apply(null, arguments); },
    drop: function () { return mp.onDropItem.apply(null, arguments); },
    lines: lines, errors: errors, writes: writes
  };
}

const whiterunBox = {
  holdOfBox: function (id) { return id === BOX ? 'whiterun' : null; }
};

if (guardSrc !== null && auditSrc !== null) {
  // T1: an ordinary chest, which is what nearly every take is.
  {
    const w = world({ prop: whiterunBox });
    const out = w.take(CHEST, ALICE, ORE, 3);
    yes('T1 a take from a chest answers exactly undefined, so it goes through', out === undefined);
    yes('T1 and leaves one line', w.lines.length === 1);
    const l = w.lines[0] || '';
    yes('T1 the line starts with take: so it can be found', l.indexOf('take: ') === 0);
    yes('T1 it names the person by profile and character', l.indexOf('profile 101 (Alice, 0xff000058)') !== -1);
    yes('T1 it names the count and the item by its descriptor', l.indexOf('took 3 71cf3:Skyrim.esm') !== -1);
    yes('T1 it names the chest by reference and base', l.indexOf('from 0xa1b2c (d9f2:Skyrim.esm)') !== -1);
    yes('T1 and the cell they were standing in', l.indexOf('in ' + BREEZEHOME) !== -1);
    yes('T1 and nothing was written to anybody', w.writes.length === 0);
    yes('T1 and nothing threw', w.errors.length === 0);
  }

  // T2: another person's body, the take rule 3 and rule 4 are about.
  {
    const w = world({ prop: whiterunBox });
    const out = w.take(BOB, ALICE, GOLD, 40);
    yes('T2 a take from another person\'s body goes through', out === undefined);
    yes('T2 and says whose body it was',
        (w.lines[0] || '').indexOf('from the body of profile 202 (Bob, 0xff000060)') !== -1);
  }

  // T3: an NPC's body. Its profile id is -1, not 0, and a check written as
  //     "is it zero" would call every dead bandit a person.
  {
    const w = world({ prop: whiterunBox });
    const out = w.take(BANDIT, ALICE, GOLD, 12);
    const l = w.lines[0] || '';
    yes('T3 a take from an NPC\'s body goes through', out === undefined);
    yes('T3 and is not called anybody\'s body', l.indexOf('the body of') === -1);
    yes('T3 and never says profile -1', l.indexOf('profile -1') === -1);
    yes('T3 it names the body by reference and base', l.indexOf('from 0x1a2b3 (1e7d5:Skyrim.esm)') !== -1);
  }

  // T4: a chest a steward once marked as a hold's box. The marking is
  //     retired (#2298, Patrick, 15 Oct): it is an ordinary chest, and the
  //     line names it by reference and base like any other, never as a hold's.
  {
    const w = world({ prop: whiterunBox });
    const out = w.take(BOX, ALICE, GOLD, 100);
    yes('T4 a take from a chest that was a hold\'s box goes through', out === undefined);
    yes('T4 and names it as a chest, never as a hold\'s box',
        (w.lines[0] || '').indexOf('from 0xaaaa (d9f2:Skyrim.esm)') !== -1 &&
        (w.lines[0] || '').indexOf('box') === -1);
  }

  // T5: the property block missing, or throwing, changes nothing: the audit
  //     line asks it nothing since #2298.
  {
    const w = world({ prop: { holdOfBox: function () { throw new Error('the audit asked about a marked box'); } } });
    const out = w.take(BOX, ALICE, GOLD, 100);
    yes('T5 a property block that throws still lets the take through', out === undefined);
    yes('T5 and the take is still logged', w.lines.length === 1 && w.errors.length === 0);
    const w2 = world({});
    yes('T5 no property block at all lets it through too', w2.take(CHEST, ALICE, ORE, 1) === undefined);
  }

  // T6: a drop.
  {
    const w = world({ prop: whiterunBox });
    const out = w.drop(ALICE, ORE, 2);
    const l = w.lines[0] || '';
    yes('T6 a drop answers exactly undefined, so it goes through', out === undefined);
    yes('T6 the line starts with drop: so it can be found', l.indexOf('drop: ') === 0);
    yes('T6 it names the person, the count, the item and the cell',
        l.indexOf('profile 101 (Alice, 0xff000058)') !== -1 &&
        l.indexOf('dropped 2 71cf3:Skyrim.esm') !== -1 &&
        l.indexOf('in ' + BREEZEHOME) !== -1);
    yes('T6 and nothing was written to anybody', w.writes.length === 0);
  }

  // T7: every read the server can make throws. The press still goes through
  //     and the line says what it could.
  {
    const w = world({ everyReadThrows: true, prop: whiterunBox });
    const t = w.take(CHEST, ALICE, ORE, 3);
    const d = w.drop(ALICE, ORE, 1);
    yes('T7 with every read throwing, a take still goes through', t === undefined);
    yes('T7 and a drop still goes through', d === undefined);
    yes('T7 and both are still logged, by id', w.lines.length === 2 &&
        w.lines[0].indexOf('0xff000058') !== -1 && w.lines[0].indexOf('0x71cf3') !== -1 &&
        w.lines[1].indexOf('0x71cf3') !== -1);
    yes('T7 and nothing escaped to the engine', w.errors.length === 0);
  }

  // T8: the log itself failing. guard() is what stands between that and the
  //     engine, and it answers undefined.
  {
    const w = world({ logThrows: true, prop: whiterunBox });
    const t = w.take(CHEST, ALICE, ORE, 3);
    const d = w.drop(ALICE, ORE, 1);
    yes('T8 a log that throws still lets a take through', t === undefined);
    yes('T8 and a drop', d === undefined);
    yes('T8 and guard() reports it under the handler\'s name',
        w.errors.length === 2 && w.errors[0].indexOf('onTakeItem threw') !== -1 &&
        w.errors[1].indexOf('onDropItem threw') !== -1);
  }

  // T9: arguments that are not what the engine promises.
  {
    const w = world({ prop: whiterunBox });
    yes('T9 absent item identities refuse before diagnostics', w.take() === false && w.drop() === false);
    yes('T9 no unverified transfer is logged as successful', w.lines.length === 0);
  }

  // T10: the take limit. Its reason refuses the take with one line; its
  //      silence, or a throw, lets it through as before.
  {
    const refusing = { take: function () { return 'the limit of 3 takes'; } };
    const w = world({ prop: whiterunBox, takeLimit: refusing });
    const out = w.take(BOB, ALICE, GOLD, 40);
    const l = w.lines[0] || '';
    yes('T10 a take the limit refuses answers false', out === false);
    yes('T10 and leaves one take refused: line with the reason',
        w.lines.length === 1 && l.indexOf('take refused: ') === 0 &&
        l.indexOf('(the limit of 3 takes)') !== -1 && l.indexOf('the body of profile 202') !== -1);
    const w2 = world({ prop: whiterunBox, takeLimit: { take: function () { return null; } } });
    yes('T10 a take the limit allows answers undefined', w2.take(BOB, ALICE, GOLD, 4) === undefined &&
        (w2.lines[0] || '').indexOf('take: ') === 0);
    const w3 = world({ prop: whiterunBox, takeLimit: { take: function () { throw new Error('broken'); } } });
    yes('T10 a take limit that throws lets the take through', w3.take(BOB, ALICE, GOLD, 40) === undefined &&
        w3.errors.length === 0);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
