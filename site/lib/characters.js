/*
  Each Discord account's characters, kept here and nowhere else (#5938).

  A character is a change form on the game server, keyed by a profile id. The
  list saying which ids are somebody's, with each one's slot on the menu, when
  it was last played and for how long, used to live only in the launcher's
  Profile\Characters\profiles.txt, with the ids it had forgotten in
  retired.txt beside it. Reinstall, or sit down at another PC, and that list
  was gone: the launcher minted a new id and the old characters stayed on the
  server with nothing that knew their numbers. Patrick, 12 Nov: "chacrthers,
  saves, and settings should all be cloud saved by the server and linked to
  your discord and not all be saved locally".

  So the list is the account's row in linked.json, the file that already ties
  ids to a Discord account for the game's door:

    chars    [{ id, slot, played, seconds }]  slot -1 is dead for good (#1010),
                                              played is ms since 1970, 0 never
    spare    the id the menu's New character uses next, minted here
    retired  ids forgotten at the menu, never minted or claimed again

  ONE LIST FOR EACH GAME SERVER (#6904). The live server and the dev server
  are two worlds, and a character is a change form in one of them. Until 26
  November the account had one list for both, so the dev menu showed every
  main character as "not on this server", picking one there made a second
  character under the same id in the dev world (Patrick's 678139103, dev
  log 26 Nov 6:20 AM, "Creating character ff00002a"), and the bin on one
  server took a character off the other's menu as well (his 297552318,
  binned on dev on 25 Nov after 62 minutes on main the day before). So main's
  list is those three fields on the row, where it always was, and dev's is
  the same three under dev; nothing on one is ever read for the other. The
  launcher names its server with every ask (channel), and every id is minted
  against both lists of every account, so no id is ever a character on two
  servers again.

  The launcher asks POST /api/play/characters at every Play and after every
  pick, forget and finished session, and draws the menu from the answer.
  Nothing about the list is written on the PC.

  Pure: these change the linked object they are handed and touch no file, so
  the route reads linked.json, calls them, and writes it once, with nothing
  awaited between (the check in route's rule), and test-play-characters.js
  runs them alone.
*/

'use strict';

const crypto = require('crypto');

// The slot of a character staff have killed for good: out of the numbered
// slots, so its number is free for New character, and kept so it is shown
// dead and never minted again.
const DEAD = -1;
// The range the launcher minted from, kept so an id from either never meets
// one from the other.
const LOW = 1000;
const SPAN = 2000000000;
// A session longer than a day is a clock change or a launcher left open over
// a reboot, and under a minute is a launch that never got in.
const LEAST_SECONDS = 60;
const MOST_SECONDS = 86400;
// What an account keeps besides its characters and spare on the door's list
// of checked in ids, the eight most recent, as /api/play/join always cut it.
const OTHER_IDS = 8;

function num(n) { const v = Number(n); return isFinite(v) && v > 0 && Math.floor(v) === v ? v : 0; }

/*
  A Discord id as the key of its row, or '' when it is not one. A Discord id
  is digits and nothing else, so a key that is not cannot reach linked.json,
  and no key can name a property every object has (__proto__ and the rest).
*/
function accountKey(d) {
  const key = String(d == null ? '' : d);
  return /^[0-9]{1,25}$/.test(key) ? key : '';
}

/* The game server a launcher names: dev, or main for anything else. */
function serverKey(s) { return String(s == null ? '' : s) === 'dev' ? 'dev' : 'main'; }

/* One server's three fields made whole, on the object that holds them. */
function whole(l) {
  l.chars = (Array.isArray(l.chars) ? l.chars : [])
    .filter((c) => c && num(c.id))
    .map((c) => ({ id: num(c.id), slot: Number(c.slot) === DEAD ? DEAD : num(c.slot),
                   played: num(c.played), seconds: num(c.seconds) }))
    .filter((c) => c.slot !== 0);
  l.spare = num(l.spare);
  l.retired = (Array.isArray(l.retired) ? l.retired : []).map(num).filter((n) => n > 0);
  return l;
}

/* The account's row, with both servers' lists made whole. */
function rowOf(linked, d) {
  const key = accountKey(d);
  if (!key) throw new Error('not a Discord id');
  if (!linked[key] || typeof linked[key] !== 'object') linked[key] = { id: key };
  const row = linked[key];
  whole(row);
  if (!row.dev || typeof row.dev !== 'object' || Array.isArray(row.dev)) row.dev = {};
  whole(row.dev);
  if (!Array.isArray(row.profiles)) row.profiles = [];
  return row;
}

/* The list of one server on a row rowOf made whole: main's on the row, dev's under dev. */
function listOf(row, srv) { return serverKey(srv) === 'dev' ? row.dev : row; }

/* Whether an id is a character, the spare or retired on a list. */
function onList(l, id) {
  return l.spare === id || l.retired.indexOf(id) >= 0 || l.chars.some((c) => c.id === id);
}

/* Every id any account holds, has as a character or a spare, or retired, on either server. */
function takenIds(linked) {
  const all = new Set();
  for (const d of Object.keys(linked)) {
    const r = linked[d] || {};
    for (const n of (Array.isArray(r.profiles) ? r.profiles : [])) if (num(n)) all.add(num(n));
    for (const l of [r, (r.dev && typeof r.dev === 'object') ? r.dev : {}]) {
      for (const c of (Array.isArray(l.chars) ? l.chars : [])) if (c && num(c.id)) all.add(num(c.id));
      for (const n of (Array.isArray(l.retired) ? l.retired : [])) if (num(n)) all.add(num(n));
      if (num(l.spare)) all.add(num(l.spare));
    }
  }
  return all;
}

/*
  An id nobody holds, has had or has retired, at random over the launcher's
  old range. Random rather than counted: every launcher once counted from the
  same start, and two people got the same character (Chars.NextProfileId
  said why). Here the site sees every account, so the id is checked against
  all of them and not one install's list.
*/
function mintId(linked, rand) {
  const taken = takenIds(linked);
  const pick = rand || ((n) => crypto.randomInt(n));
  for (let i = 0; i < 64; i++) {
    const id = LOW + pick(SPAN);
    if (!taken.has(id)) return id;
  }
  // Sixty-four in a row does not happen; something already in use is worse.
  let high = LOW;
  for (const n of taken) if (n > high) high = n;
  return high + 1;
}

/* The lowest slot number no character holds, 1 on an empty list. */
function nextSlot(chars) {
  let n = 1;
  while (chars.some((c) => c.slot === n)) n++;
  return n;
}

/*
  A character numbered above the allowance moves into the lowest free number
  at or below it, lowest number first; one at or below never moves, so the
  menu's fixed slots stay where the person left them (Patrick, 20 Sep). The
  launcher's Slots.Tidy rule, here because the list is here. Returns what
  moved, in words.
*/
function tidySlots(chars, allowance) {
  const moved = [];
  if (!(allowance > 0)) return moved;
  const taken = new Set(chars.filter((c) => c.slot >= 1 && c.slot <= allowance).map((c) => c.slot));
  const above = chars.filter((c) => c.slot > allowance).sort((a, b) => a.slot - b.slot);
  for (const c of above) {
    let free = 1;
    while (free <= allowance && taken.has(free)) free++;
    if (free > allowance) break;
    moved.push('character ' + c.id + ' from slot ' + c.slot + ' to slot ' + free);
    c.slot = free;
    taken.add(free);
  }
  return moved;
}

/*
  The door's list for an account: every id it has as a character or a spare
  on either server, and the eight other ids it checked in most recently, in the order it had
  them. A character never falls off it however many spares came and went.
*/
function keepProfiles(profiles, row) {
  const own = new Set();
  for (const l of [row, (row.dev && typeof row.dev === 'object') ? row.dev : {}]) {
    for (const c of (Array.isArray(l.chars) ? l.chars : [])) if (c && num(c.id)) own.add(num(c.id));
    if (num(l.spare)) own.add(num(l.spare));
  }
  const list = profiles.map(num).filter((n) => n > 0);
  const others = list.filter((n) => !own.has(n)).slice(-OTHER_IDS);
  const keep = new Set(others);
  for (const n of own) keep.add(n);
  const out = [];
  for (const n of list) if (keep.has(n) && out.indexOf(n) < 0) out.push(n);
  for (const n of own) if (out.indexOf(n) < 0) out.push(n);
  return out;
}

/*
  One server's list for the account made right before it is answered or
  written: the dead out of their slots, any an admin brought back into a free
  one, the slots tidied to the allowance when the site knows it, a spare
  minted when there is none, and every character and spare of both servers on
  the door's list. how is { slots, pk(id), revived(id), rand }. Returns lines
  for the launcher's log.
*/
function settle(linked, d, srv, how) {
  const row = rowOf(linked, d);
  const list = listOf(row, srv);
  const said = [];
  const dead = [], raised = [];
  for (const c of list.chars) {
    if (c.slot > 0 && how.pk && how.pk(c.id)) { dead.push(c.id + ' from slot ' + c.slot); c.slot = DEAD; }
  }
  for (const c of list.chars) {
    if (c.slot === DEAD && how.revived && how.revived(c.id)) { c.slot = nextSlot(list.chars); raised.push(c.id + ' to slot ' + c.slot); }
  }
  if (dead.length) said.push('Staff have killed ' + (dead.length === 1 ? 'a character' : dead.length + ' characters') +
    ' for good, so the slot is free for a new one: character ' + dead.join(', character ') + '.');
  if (raised.length) said.push('An admin undid the PK of ' + (raised.length === 1 ? 'a character' : raised.length + ' characters') +
    ', so it can be played again: character ' + raised.join(', character ') + '.');
  const moved = tidySlots(list.chars, how.slots);
  if (moved.length) said.push('Slots tidied for an allowance of ' + how.slots + ': ' + moved.join(', ') + '.');
  const ids = list.chars.map((c) => c.id);
  if (!list.spare || ids.indexOf(list.spare) >= 0 || list.retired.indexOf(list.spare) >= 0) {
    list.spare = 0;
    list.spare = mintId(linked, how.rand);
  }
  row.profiles = keepProfiles(row.profiles, row);
  return said;
}

/*
  The person picked a character at one server's menu. The spare becomes a
  character in the lowest free slot (settle mints the next spare); one of
  theirs has its date moved; on main, an id the door already has against
  this account and the list does not (checked in before this list existed
  here) is added. An id on the other server's list is that world's
  character and never this one's. Anything else is not theirs. Returns null,
  or why not.
*/
function choose(linked, d, srv, pid, now) {
  const row = rowOf(linked, d);
  const list = listOf(row, srv);
  const other = listOf(row, serverKey(srv) === 'dev' ? 'main' : 'dev');
  const id = num(pid);
  if (!id) return 'no character was named';
  const have = list.chars.find((c) => c.id === id);
  if (have && have.slot === DEAD) return 'that character has died for good';
  if (have) { have.played = now; return null; }
  if (list.retired.indexOf(id) >= 0) return 'that character was deleted';
  if (onList(other, id)) return 'that character is on the other server';
  if (id !== list.spare && (serverKey(srv) === 'dev' || row.profiles.map(num).indexOf(id) < 0)) {
    return 'that character is not this account\'s';
  }
  list.chars.push({ id, slot: nextSlot(list.chars), played: now, seconds: 0 });
  if (id === list.spare) list.spare = 0;
  return null;
}

/* A finished stretch of play on one character of one server: its time and date. */
function played(linked, d, srv, pid, seconds, now) {
  const list = listOf(rowOf(linked, d), srv);
  const c = list.chars.find((x) => x.id === num(pid));
  if (!c) return 'that character is not this account\'s';
  const s = Math.floor(Number(seconds));
  if (!(s >= LEAST_SECONDS && s <= MOST_SECONDS)) return 'not a stretch of play worth counting';
  c.seconds += s;
  c.played = now;
  return null;
}

/*
  The bin at one server's menu: the character leaves that server's list and
  its id is retired there, so it is never minted or picked again. The other
  server's list is not touched. The character itself stays on the game
  server, as it always did. The spare is never forgotten; it was never a
  character.
*/
function forget(linked, d, srv, pid) {
  const list = listOf(rowOf(linked, d), srv);
  const id = num(pid);
  const at = list.chars.findIndex((c) => c.id === id);
  if (at < 0) return 'that character is not this account\'s';
  list.chars.splice(at, 1);
  if (list.retired.indexOf(id) < 0) list.retired.push(id);
  return null;
}

/* What the launcher is told about one server: its characters in slot order, then the dead. */
function answer(linked, d, srv, slots) {
  const list = listOf(rowOf(linked, d), srv);
  const live = list.chars.filter((c) => c.slot > 0).sort((a, b) => a.slot - b.slot);
  const dead = list.chars.filter((c) => c.slot === DEAD);
  return { ok: true, server: serverKey(srv), slots: slots || 0, spare: list.spare,
           chars: live.concat(dead).map((c) => ({ id: c.id, slot: c.slot, played: c.played, seconds: c.seconds })) };
}

module.exports = { accountKey, answer, choose, DEAD, forget, keepProfiles, mintId, played, rowOf, serverKey, settle, tidySlots };
