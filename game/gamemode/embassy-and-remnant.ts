// ==== thornswood embassy and remnant ====
/*
  THE EMBASSY, THE TWO ROLLS AND THE THALMOR MARKER (#1390).

  docs/systems/embassy.md, thalmor.md, npcs.md and cut-items.md are the
  design. Every number here is one of theirs.

  THE BUILDING. "The embassy doors start held by the Ambassador's office,
  so the line at them offers nobody a claim. A steward of Haafingar does
  not evict the Accord." The page calls it a warehouse in Solitude
  ("The Empire wanted the province and got a warehouse. This is that
  warehouse") and names none. EMBASSY_BUILDING is the answer suggested on
  #1390, the Abandoned Warehouse: the one warehouse in Solitude that is
  not a shop and not the East Empire Company's, which the trading company
  replaces. If Patrick names another building, that one line changes. The
  property block asks holds() for the line at the door, before a claim and
  an eviction, and before a deed presented at the door. It is not a hold:
  nothing here makes a box, a board, a ledger or a mint, and Solitude's box
  and board stay Haafingar's.

  THE EMBASSY ROLL. "20 persons in service, no more. Of those, 6 may be
  marked armed, and those 6 bear arms inside the walls only. Naming a 21st
  person is refused. Marking a 7th as armed is refused." Armed is what the
  roll says. Nothing here looks in a pack or takes a sword at the gate. The
  Ambassador is a title and not a command (offices.md), so an admin writes
  the roll, the same way an admin places the Jarl role.

  THE REMNANT ROLL. "The roll is an application, the same kind as a Jarl,
  not a button on K." An admin writes that one too. The page puts no number
  on it.

  /embassy AND /remnant ARE STAFF COMMANDS. Only an admin uses them, and
  nobody else is told to type anything (docs/GAME-SYSTEMS.md, "Buttons, not
  commands"). The person a change is about is told in their own chat when
  they are put on a roll, marked armed or not, or taken off.

  Both rolls are who may craft what the cut file marks embassy and remnant:
  craftAnswer asks onCraftRoll, and onCraftRoll asks has() below. Nobody else
  makes those at a public bench, and the spoils block already keeps the
  world from handing them out.

  THE MARKER. "Wearing Justiciar robes, Thalmor armour, or carrying a
  Dominion flag in a hold is a hostile marker." marked() reads what a
  character has on against what the remnant rows of the recipe table make
  and the game's own two Thalmor robes. Neither the recipe table nor the
  /give table names a Dominion flag, so there is none to read yet. The
  robes are not race locked: races.md says Thalmor robes are a faction,
  not a people.

  THE PATROLS ARE NOT IN THIS BLOCK. They are the Thalmor patrols block,
  after the NPC startup, and a patrol rule in the NPC population policy
  (#1390). Nothing here waits on them, and they do not read either roll.
*/
(function () {
  'use strict';
  var g = globalThis;
  function elog() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[embassy]');
    console.log(a.join(' '));
  }

  // ------------------------------------------------------------ the numbers --

  var ROLL_MOST = 20;     // embassy.md: 20 persons in service, no more
  var ARMED_MOST = 6;     // embassy.md: of those, 6 may be marked armed

  // The Abandoned Warehouse in Solitude, the answer suggested on #1390.
  var EMBASSY_BUILDING = 'e48e:The Great City of Solitude.esp';

  var ROLL_NAME = { embassy: 'the embassy roll', remnant: 'the Thalmor remnant roll' };

  var CLAIM_REFUSED = 'The embassy is held by the Ambassador\'s office under the Accord. ' +
                      'It cannot be claimed.';
  var EVICT_REFUSED = 'The embassy is not a house of the hold. A steward of Haafingar ' +
                      'does not evict the Accord.';
  var NOT_ADMIN = {
    embassy: 'Only an admin writes the embassy roll.',
    remnant: 'The remnant roll is an application. Only an admin writes it.'
  };

  // ------------------------------------------------------------- the file --

  var ROLL_FILE = 'embassy.json';

  /* In the private folder, beside property.json, because every row names a
     profile and the data folder is served to anybody who asks (#541). */
  function privatePath(name) {
    var path = require('path');
    var privDir = 'private';
    try {
      var cfg = JSON.parse(require('fs').readFileSync('server-settings.json', 'utf8'));
      if (cfg && cfg.privDir) { privDir = String(cfg.privDir); }
    } catch (e) { }
    return path.join(privDir, name);
  }

  /*
    The rolls off disk, rebuilt row by row rather than trusted whole, the
    same discipline as the property register. And the caps hold whatever the
    file says: a 21st row is dropped and a 7th armed mark comes off, with a
    line in the log saying so, because a hand edit is not a way round the
    Accord.

    No file yet is two empty rolls. A file that is there and cannot be read
    is not: the rolls stay empty and nothing writes over it until somebody
    puts it right, because writing would throw away every name it holds.
  */
  function cleanRow(r, roll) {
    if (!r || typeof r !== 'object') { return null; }
    var actor = Number(r.actor) || 0;
    if (!(actor > 0)) { return null; }
    var row = { actor: actor, profile: Number(r.profile) || 0,
                name: String(r.name || 'somebody').slice(0, 64), at: Number(r.at) || 0 };
    if (roll === 'embassy') { row.armed = r.armed === true; }
    return row;
  }

  var unreadable = '';

  function loadRolls() {
    var out = { embassy: [], remnant: [] };
    var file = privatePath(ROLL_FILE);
    var text = null;
    try {
      text = String(require('fs').readFileSync(file, 'utf8')).replace(/^\uFEFF/, '');
    } catch (e) {
      if (e && e.code === 'ENOENT') { return out; }
      unreadable = String(e && e.message ? e.message : e);
      elog('could not read', file + ':', unreadable, '- the rolls are empty and nothing is written until it is put right');
      return out;
    }
    var raw = null;
    try { raw = JSON.parse(text); } catch (e2) { raw = null; }
    if (!raw || typeof raw !== 'object') {
      unreadable = 'it is not a roll file';
      elog(file, 'is not a roll file - the rolls are empty and nothing is written until it is put right');
      return out;
    }
    var dropped = 0, disarmed = 0;
    ['embassy', 'remnant'].forEach(function (roll) {
      var list = Array.isArray(raw[roll]) ? raw[roll] : [];
      var armed = 0;
      for (var j = 0; j < list.length; j++) {
        var row = cleanRow(list[j], roll);
        if (!row || rowIn(out[roll], row.actor)) { dropped++; continue; }
        if (roll === 'embassy') {
          if (out.embassy.length >= ROLL_MOST) { dropped++; continue; }
          if (row.armed) {
            if (armed >= ARMED_MOST) { row.armed = false; disarmed++; } else { armed++; }
          }
        }
        out[roll].push(row);
      }
    });
    if (dropped || disarmed) {
      elog('the roll file asked for more than the Accord allows or held rows that were not ' +
           'people:', dropped, 'row(s) left off and', disarmed, 'armed mark(s) taken off');
    }
    return out;
  }

  function rowIn(list, actor) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].actor === actor) { return list[i]; }
    }
    return null;
  }

  var reg = loadRolls();

  /*
    Every change is written before it is made: the next rolls go to disk,
    and only once they are there do they become the rolls. So what the
    server enforces is always what a restart will read, and a write that
    fails changes nothing.
  */
  function commit(roll, list) {
    var next = { embassy: reg.embassy, remnant: reg.remnant };
    next[roll] = list;
    if (unreadable) { return false; }
    var fs = require('fs');
    var file = privatePath(ROLL_FILE);
    try {
      fs.mkdirSync(require('path').dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 1));
      fs.renameSync(file + '.tmp', file);
    } catch (e) {
      elog('could not write', file + ':', e);
      return false;
    }
    var was = reg[roll];
    reg = next;
    /*
      A roll's gear is listed in the crafting menu only for somebody on that
      roll (#613), so whoever went on or came off is handed the list again.
    */
    if (typeof handRecipesHidden === 'function') {
      var moved = was.concat(list).map(function (r) { return r.actor; }).filter(function (a, i, all) {
        return all.indexOf(a) === i && !rowIn(was, a) !== !rowIn(list, a);
      });
      for (var m = 0; m < moved.length; m++) { handRecipesHidden(moved[m]); }
    }
    return true;
  }

  function notWritten() {
    return unreadable
      ? 'The roll file on the server could not be read (' + unreadable + '), so nothing ' +
        'changes until it is put right. Say so in the dev channel.'
      : 'The roll could not be written, so nothing changed. Say so in the dev channel.';
  }

  // ------------------------------------------------------- what is asked --

  /** True when this building is the embassy. Asked by the property block. */
  function holds(building) {
    return !!building && String(building) === EMBASSY_BUILDING;
  }

  /** True when this character is on that roll. onCraftRoll asks this. */
  function has(actorId, roll) {
    if (roll !== 'embassy' && roll !== 'remnant') { return false; }
    return !!rowIn(reg[roll], Number(actorId) || 0);
  }

  function armedCount() {
    var n = 0;
    for (var i = 0; i < reg.embassy.length; i++) { if (reg.embassy[i].armed) { n++; } }
    return n;
  }

  function counts() {
    return reg.embassy.length + ' of ' + ROLL_MOST + ' on the roll, ' + armedCount() +
           ' of ' + ARMED_MOST + ' marked armed.';
  }

  // ------------------------------------------------- writing the rolls --

  /*
    One person onto a roll. who is { actor, profile, name }. Answers
    { ok, line } and changes nothing when it refuses. The two refusals the
    page names are here and nowhere else, so no other road onto the roll
    can step round them.
  */
  function enter(roll, who, armed) {
    var list = reg[roll];
    var already = rowIn(list, who.actor);
    if (already) {
      return { ok: false, line: already.name + ' is already on ' + ROLL_NAME[roll] + '.' };
    }
    if (roll === 'embassy') {
      if (list.length >= ROLL_MOST) {
        return { ok: false, line: 'The embassy roll is full: ' + ROLL_MOST + ' persons in ' +
                 'service, no more. Take somebody off it first.' };
      }
      if (armed && armedCount() >= ARMED_MOST) {
        return { ok: false, line: ARMED_MOST + ' on the roll are already marked armed, which ' +
                 'is all the Accord allows. Nobody was added. Disarm one first.' };
      }
    }
    var row = { actor: who.actor, profile: who.profile || 0,
                name: String(who.name || 'somebody').slice(0, 64), at: Date.now() };
    if (roll === 'embassy') { row.armed = !!armed; }
    if (!commit(roll, list.concat([row]))) { return { ok: false, line: notWritten() }; }
    elog(row.name, 'is on', ROLL_NAME[roll] + (row.armed ? ', marked armed' : ''));
    return { ok: true, row: row,
             line: row.name + ' is on ' + ROLL_NAME[roll] + (row.armed ? ', marked armed' : '') +
                   '.' + (roll === 'embassy' ? ' ' + counts() : ''),
             told: 'You are on ' + ROLL_NAME[roll] +
                   (row.armed ? ', marked armed. You bear arms inside the walls only.' : '.') };
  }

  function setArmed(row, armed) {
    if (!!row.armed === !!armed) {
      return { ok: false, line: row.name + (armed ? ' is already marked armed.' : ' is not marked armed.') };
    }
    if (armed && armedCount() >= ARMED_MOST) {
      return { ok: false, line: ARMED_MOST + ' on the roll are already marked armed, which is ' +
               'all the Accord allows. Disarm one first.' };
    }
    var changed = { actor: row.actor, profile: row.profile, name: row.name, at: row.at, armed: !!armed };
    var list = reg.embassy.map(function (r) { return r === row ? changed : r; });
    if (!commit('embassy', list)) { return { ok: false, line: notWritten() }; }
    elog(row.name, armed ? 'is marked armed' : 'is no longer marked armed');
    return { ok: true, row: changed,
             line: row.name + (armed ? ' is marked armed. Inside the walls only.'
                                     : ' is no longer marked armed.') + ' ' + counts(),
             told: armed ? 'You are marked armed on the embassy roll. You bear arms inside the walls only.'
                         : 'You are no longer marked armed on the embassy roll.' };
  }

  function leave(roll, row) {
    if (reg[roll].indexOf(row) === -1) {
      return { ok: false, line: row.name + ' is not on ' + ROLL_NAME[roll] + '.' };
    }
    var list = reg[roll].filter(function (r) { return r !== row; });
    if (!commit(roll, list)) { return { ok: false, line: notWritten() }; }
    elog(row.name, 'is off', ROLL_NAME[roll]);
    return { ok: true, row: row,
             line: row.name + ' is off ' + ROLL_NAME[roll] + '.' +
                   (roll === 'embassy' ? ' ' + counts() : ''),
             told: 'You are off ' + ROLL_NAME[roll] + '.' };
  }

  // ---------------------------------------------------- finding a person --

  /* Somebody in the world, by name or by the form id the crosshair gives. */
  function inWorld(words) {
    var soc = g.__thornswoodSocial;
    if (!soc || !soc.findPerson) { return { why: 'That is not running on this server.' }; }
    var f = soc.findPerson(words);
    if (!f || !f.actorId) { return { why: (f && f.why) || 'Nobody here by that name.' }; }
    var name = String(soc.nameOfPerson(f.actorId) || '');
    var pid = Number(soc.profileOf(f.actorId)) || 0;
    return { actor: f.actorId, profile: pid, name: name || words };
  }

  /*
    A row already on the roll, by its name or profile number, so somebody who
    is not in the world can still be taken off or disarmed. Then the world.
  */
  function onRollBy(roll, words) {
    var list = reg[roll];
    var low = String(words || '').toLowerCase();
    var asNumber = Number(words) || 0;
    var exact = [], part = [];
    for (var i = 0; i < list.length; i++) {
      var n = String(list[i].name).toLowerCase();
      if (n === low || (asNumber && list[i].profile === asNumber)) { exact.push(list[i]); }
      else if (low && n.indexOf(low) === 0) { part.push(list[i]); }
    }
    var hit = exact.length ? exact : part;
    if (hit.length === 1) { return { row: hit[0] }; }
    if (hit.length > 1) { return { why: 'More than one on ' + ROLL_NAME[roll] + ' answers to that. Say more of the name.' }; }
    var w = inWorld(words);
    if (!w.actor) { return { why: w.why }; }
    var row = rowIn(list, w.actor);
    return row ? { row: row } : { why: w.name + ' is not on ' + ROLL_NAME[roll] + '.' };
  }

  // ------------------------------------------------- the staff commands --

  /*
    An admin's, and nobody else's:

        /embassy                      the roll, the count and which building it is
        /embassy add <person>         onto the roll
        /embassy add <person> armed   onto the roll, marked armed
        /embassy arm <person>         marked armed
        /embassy disarm <person>      no longer marked armed
        /embassy remove <person>      off the roll
        /remnant                      the remnant roll
        /remnant add <person>         onto the remnant roll, after the application
        /remnant remove <person>      off it
  */
  function command(word, parts, actorId, profileId, toProfile) {
    var roll = word === '/remnant' ? 'remnant' : 'embassy';
    var verb = String((parts && parts[1]) || '').toLowerCase();
    var rest = (parts || []).slice(2);
    var adm = g.__thornswoodIsAdmin;
    if (!(typeof adm === 'function' && adm(profileId))) {
      toProfile(profileId, NOT_ADMIN[roll]);
      return true;
    }
    if (!verb) { toProfile(profileId, listing(roll)); return true; }

    var armed = false;
    if (roll === 'embassy' && verb === 'add' && rest.length > 1 &&
        String(rest[rest.length - 1]).toLowerCase() === 'armed') {
      armed = true;
      rest = rest.slice(0, -1);
    }
    var words = rest.join(' ').trim();
    var usage = roll === 'embassy'
      ? '/embassy add, arm, disarm or remove, and a name.'
      : '/remnant add or remove, and a name.';
    if (!words) { toProfile(profileId, usage); return true; }

    var done = null;
    if (verb === 'add') {
      var w = inWorld(words);
      if (!w.actor) { toProfile(profileId, w.why); return true; }
      done = enter(roll, w, armed);
    } else if (verb === 'remove' || (roll === 'embassy' && (verb === 'arm' || verb === 'disarm'))) {
      var found = onRollBy(roll, words);
      if (!found.row) { toProfile(profileId, found.why); return true; }
      done = verb === 'remove' ? leave(roll, found.row) : setArmed(found.row, verb === 'arm');
    } else {
      toProfile(profileId, usage);
      return true;
    }
    toProfile(profileId, done.line);
    // The person it is about hears it in their own chat, if they are in the world.
    if (done.ok && done.row.actor !== actorId) { say(done.row.actor, done.told); }
    return true;
  }

  function listing(roll) {
    var list = reg[roll];
    var names = [];
    for (var i = 0; i < list.length; i++) {
      names.push(list[i].name + (list[i].armed ? ' (armed)' : ''));
    }
    var head = roll === 'embassy' ? 'The embassy roll: ' + counts() : 'The Thalmor remnant roll: ' + list.length + '.';
    var where = '';
    if (roll === 'embassy') {
      var P = g.__thornswoodProperty;
      where = ' The embassy is ' + (P && P.nameOf ? P.nameOf(EMBASSY_BUILDING) : EMBASSY_BUILDING) + '.';
    }
    var broken = unreadable ? ' ' + notWritten() : '';
    return head + (names.length ? ' ' + names.join(', ') + '.' : '') + where + broken;
  }

  // -------------------------------------------------------- the marker --

  /*
    The pieces that read Thalmor: what the remnant rows of the recipe table
    make, and the game's own Thalmor Robes and Hooded Thalmor Robes, which
    those rows do not make (the /give table names both; it is read by /give
    and nothing else, so they are written here). Built once, by base id, and
    a piece whose plugin is not loaded is left out.
  */
  var GAME_THALMOR = ['65bbf:Skyrim.esm', '10c698:Skyrim.esm'];
  var gearIds = null;
  function thalmorGear() {
    if (gearIds) { return gearIds; }
    var out = {};
    for (var k in RECIPES_BY_ID) {
      if (!Object.prototype.hasOwnProperty.call(RECIPES_BY_ID, k)) { continue; }
      var row = RECIPES_BY_ID[k];
      if (!row || row.roll !== 'remnant') { continue; }
      var id = idOf(row.out);
      if (id) { out[id] = true; }
    }
    for (var i = 0; i < GAME_THALMOR.length; i++) {
      var id2 = idOf(GAME_THALMOR[i]);
      if (id2) { out[id2] = true; }
    }
    gearIds = out;
    return out;
  }

  /** True when this character has on something that reads Thalmor. */
  function marked(actorId) {
    var on = wornNow(actorId);
    if (!on || !on.length) { return false; }
    var gear = thalmorGear();
    for (var i = 0; i < on.length; i++) {
      if (Object.prototype.hasOwnProperty.call(gear, on[i])) { return true; }
    }
    return false;
  }

  /*
    A DELETED CHARACTER OFF BOTH ROLLS (#2351). Asked once, as this block
    loads, through __thornswoodRelease, with the list Delete-Person.ps1
    wrote. A row is
    theirs by its profile, or, on a row written before rows kept a profile,
    by its character's form id. A form id on a row that names another
    profile is somebody else's, whatever the list says. Written through
    commit, so the rolls change only when the file does; a roll file that
    could not be read is never written over (unreadable), and then nothing
    is released and the list waits.
  */
  function release(who) {
    var c = { embassy: 0, remnant: 0 };
    var next = {};
    ['embassy', 'remnant'].forEach(function (roll) {
      next[roll] = reg[roll].filter(function (r) {
        var gone = who.profile(r.profile) || (!(r.profile > 0) && who.actor(r.actor));
        if (gone) { c[roll]++; }
        return !gone;
      });
    });
    if (!c.embassy && !c.remnant) { return { counts: c, saved: !unreadable }; }
    var saved = (!c.embassy || commit('embassy', next.embassy)) && (!c.remnant || commit('remnant', next.remnant));
    return { counts: c, saved: saved };
  }
  if (typeof g.__thornswoodRelease === 'function') { g.__thornswoodRelease('embassy', release); }

  g.__thornswoodEmbassy = {
    release: release,
    holds: holds, command: command, enter: enter, setArmed: setArmed, leave: leave,
    listing: listing, rolls: function () { return reg; },
    CLAIM_REFUSED: CLAIM_REFUSED, EVICT_REFUSED: EVICT_REFUSED,
    EMBASSY_BUILDING: EMBASSY_BUILDING, ROLL_MOST: ROLL_MOST, ARMED_MOST: ARMED_MOST
  };
  g.__thornswoodRolls = { has: has };
  g.__thornswoodThalmor = { marked: marked, gear: thalmorGear };
  elog('ready,', reg.embassy.length, 'on the embassy roll,', reg.remnant.length,
       'on the remnant roll' + (unreadable ? ', and the roll file could not be read' : ''));
})();
// ==== end thornswood embassy and remnant ====

